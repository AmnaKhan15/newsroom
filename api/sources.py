"""GET /api/sources?q=<topic>

Collects open evidence about a topic from public sources (no scraping):
  - GDELT DOC 2.0     : global news coverage, last 3 months
  - News RSS feeds    : the public feeds major outlets publish for readers and news apps
                        (DW, BBC, Dawn, The Guardian, NPR, Tagesschau…), searched for the topic.
                        GDELT often refuses shared cloud servers, so the feeds keep news flowing.
  - The Guardian      : reporting from one reference outlet (needs GUARDIAN_API_KEY)
  - OpenAlex          : academic research
  - Wikipedia         : neutral background
"""
import json
import os
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, wait
from email.utils import parsedate_to_datetime
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

UA = "Newsroom/1.0 (journalism research prototype)"
TIMEOUT = 12


def fetch_json(url):
    req = Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # GDELT answers bad queries with a plain-text explanation
        raise ValueError(raw.strip()[:200] or "Invalid response")


def gdelt(topic):
    url = (
        "https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json"
        "&maxrecords=60&sort=hybridrel&timespan=3months&query=" + quote(topic)
    )
    # GDELT allows one request per 5 s per IP. Cloud servers share IPs, so a refusal is common;
    # one quick attempt is enough because the RSS feeds cover news when GDELT says no.
    req = Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urlopen(req, timeout=10) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError(raw.strip()[:200] or "Invalid response")
    out, seen = [], set()
    for a in data.get("articles", []):
        title = (a.get("title") or "").strip()
        key = title.lower()[:80]
        if not title or key in seen:
            continue
        seen.add(key)
        d = a.get("seendate", "")
        out.append({
            "title": title,
            "url": a.get("url"),
            "domain": a.get("domain"),
            "date": f"{d[0:4]}-{d[4:6]}-{d[6:8]}" if len(d) >= 8 else None,
            "country": a.get("sourcecountry") or None,
            "language": a.get("language") or None,
            "image": a.get("socialimage") or None,
        })
    return out[:40]


# (outlet, feed URL, country, language). Feeds that are slow or unreachable are skipped.
FEEDS = [
    ("DW", "https://rss.dw.com/rdf/rss-en-all", "Germany", "English"),
    ("DW Urdu", "https://rss.dw.com/rdf/rss-ur-all", "Germany", "Urdu"),
    ("DW Deutsch", "https://rss.dw.com/rdf/rss-de-all", "Germany", "German"),
    ("BBC News", "https://feeds.bbci.co.uk/news/world/rss.xml", "United Kingdom", "English"),
    ("BBC News", "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", "United Kingdom", "English"),
    ("BBC Urdu", "https://feeds.bbci.co.uk/urdu/rss.xml", "United Kingdom", "Urdu"),
    ("Dawn", "https://www.dawn.com/feeds/home", "Pakistan", "English"),
    ("The Express Tribune", "https://tribune.com.pk/feed/home", "Pakistan", "English"),
    ("The Guardian", "https://www.theguardian.com/world/rss", "United Kingdom", "English"),
    ("The Guardian", "https://www.theguardian.com/environment/rss", "United Kingdom", "English"),
    ("The Guardian", "https://www.theguardian.com/science/rss", "United Kingdom", "English"),
    ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", "Qatar", "English"),
    ("France 24", "https://www.france24.com/en/rss", "France", "English"),
    ("The Hindu", "https://www.thehindu.com/news/international/feeder/default.rss", "India", "English"),
    ("NPR", "https://feeds.npr.org/1001/rss.xml", "United States", "English"),
    ("CBC News", "https://www.cbc.ca/webfeed/rss/rss-world", "Canada", "English"),
    ("ABC News", "https://www.abc.net.au/news/feed/51120/rss.xml", "Australia", "English"),
    ("Euronews", "https://www.euronews.com/rss", "France", "English"),
    ("Tagesschau", "https://www.tagesschau.de/xml/rss2/", "Germany", "German"),
]
_FEED_STOP = {"the", "and", "for", "with", "from", "about", "der", "die", "das", "und"}


def _local(tag):
    return tag.rsplit("}", 1)[-1].lower()


def _feed_items(xml_text):
    """Items from RSS 2.0, RSS 1.0 (RDF) and Atom feeds, without caring about namespaces."""
    root = ET.fromstring(xml_text)
    for el in root.iter():
        if _local(el.tag) not in ("item", "entry"):
            continue
        f = {}
        for child in el:
            name = _local(child.tag)
            if name == "link" and child.get("href"):
                f.setdefault("link", child.get("href"))
            elif name in ("title", "link", "description", "summary", "pubdate", "date", "published", "updated"):
                f.setdefault(name, (child.text or "").strip())
            elif name in ("content", "thumbnail") and child.get("url"):
                f.setdefault("image", child.get("url"))
        yield f


def _feed_date(f):
    raw = f.get("pubdate") or f.get("date") or f.get("published") or f.get("updated") or ""
    try:
        return parsedate_to_datetime(raw).date().isoformat()
    except (TypeError, ValueError):
        m = re.match(r"\d{4}-\d{2}-\d{2}", raw)
        return m.group(0) if m else None


def _fetch_feed(feed):
    outlet, url, country, language = feed
    with urlopen(Request(url, headers={"User-Agent": UA}), timeout=6) as resp:
        text = resp.read(3_000_000).decode("utf-8", errors="replace")
    return feed, list(_feed_items(text))


def rss_news(topic):
    """Search the latest items of public news feeds for the topic's words."""
    words = [w for w in re.findall(r"\w+", topic.lower()) if len(w) > 2 and w not in _FEED_STOP]
    if not words:
        return [], 0
    # word stems, so "glaciers" matches "glacier" and "melting" matches "melt"
    stems = [w[: max(4, len(w) - 3)] if len(w) > 5 else w for w in words]
    need = len(stems) if len(stems) <= 2 else len(stems) - 1
    pool = ThreadPoolExecutor(max_workers=10)
    futures = [pool.submit(_fetch_feed, f) for f in FEEDS]
    done, _ = wait(futures, timeout=8)
    pool.shutdown(wait=False, cancel_futures=True)
    out, ok = [], 0
    for fut in done:
        try:
            (outlet, _, country, language), items = fut.result()
        except Exception:
            continue
        ok += 1
        for f in items:
            title = re.sub(r"\s+", " ", f.get("title") or "").strip()
            text = (title + " " + re.sub(r"<[^>]+>", " ", f.get("description") or f.get("summary") or "")).lower()
            if not title or sum(1 for s in stems if s in text) < need:
                continue
            link = f.get("link") or ""
            out.append({
                "title": title, "url": link,
                "domain": urlparse(link).hostname.removeprefix("www.") if link else outlet,
                "date": _feed_date(f), "country": country, "language": language,
                "image": f.get("image"), "outlet": outlet,
            })
    out.sort(key=lambda a: a["date"] or "", reverse=True)
    return out[:30], ok


def guardian(topic):
    key = os.environ.get("GUARDIAN_API_KEY")
    if not key:
        return []
    url = ("https://content.guardianapis.com/search?page-size=15&order-by=relevance"
           "&show-fields=thumbnail&q=" + quote(topic) + "&api-key=" + quote(key))
    data = fetch_json(url).get("response", {})
    return [{
        "title": r.get("webTitle"),
        "url": r.get("webUrl"),
        "domain": "theguardian.com",
        "date": (r.get("webPublicationDate") or "")[:10] or None,
        "country": "United Kingdom",
        "language": "English",
        "image": (r.get("fields") or {}).get("thumbnail"),
    } for r in data.get("results", [])]


def rebuild_abstract(inv):
    if not inv:
        return ""
    words = sorted((pos, w) for w, positions in inv.items() for pos in positions)
    text = " ".join(w for _, w in words)
    return text[:2000] + ("…" if len(text) > 2000 else "")


def openalex(topic):
    url = (
        "https://api.openalex.org/works?per-page=8&search=" + quote(topic)
        + "&select=id,title,publication_year,doi,cited_by_count,primary_location,"
        "authorships,abstract_inverted_index"
    )
    data = fetch_json(url)
    out = []
    for w in data.get("results", []):
        if not w.get("title"):
            continue
        loc = w.get("primary_location") or {}
        src = loc.get("source") or {}
        out.append({
            "id": f"R{len(out) + 1}",
            "title": w["title"],
            "year": w.get("publication_year"),
            "url": w.get("doi") or loc.get("landing_page_url") or w.get("id"),
            "venue": src.get("display_name"),
            "cites": w.get("cited_by_count", 0),
            "authors": [a["author"]["display_name"] for a in (w.get("authorships") or [])[:3]
                        if a.get("author")],
            "abstract": rebuild_abstract(w.get("abstract_inverted_index")),
        })
    return out


def wikipedia(topic):
    s = fetch_json("https://en.wikipedia.org/w/rest.php/v1/search/page?limit=1&q=" + quote(topic))
    pages = s.get("pages") or []
    if not pages:
        return None
    key = pages[0]["key"]
    # Same article in German and Urdu, when Wikipedia has it, so background follows the UI language
    ll = fetch_json("https://en.wikipedia.org/w/api.php?action=query&prop=langlinks&lllimit=500"
                    "&format=json&titles=" + quote(key))
    links = {}
    for page in (ll.get("query") or {}).get("pages", {}).values():
        links = {l["lang"]: l["*"] for l in page.get("langlinks", []) if l["lang"] in ("de", "ur")}
    out = {}
    for lang, title in [("en", key)] + list(links.items()):
        try:
            p = fetch_json(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/"
                           + quote(title.replace(" ", "_")))
        except Exception:
            continue
        out[lang] = {
            "title": p.get("title"),
            "extract": p.get("extract"),
            "url": (p.get("content_urls") or {}).get("desktop", {}).get("page"),
        }
    return out or None


def collect(topic):
    jobs = {"gdelt": gdelt, "rss": rss_news, "guardian": guardian, "papers": openalex, "background": wikipedia}
    result = {"topic": topic, "errors": {}}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {name: pool.submit(fn, topic) for name, fn in jobs.items()}
        for name, fut in futures.items():
            try:
                result[name] = fut.result()
            except Exception as e:  # one failing source should not sink the rest
                result[name] = None if name == "background" else ([], 0) if name == "rss" else []
                result["errors"][name] = str(e)[:200]
    rss, feeds_ok = result.pop("rss")
    gdelt_items = result.pop("gdelt")
    result["news_feeds"] = {"gdelt": len(gdelt_items), "rss": len(rss), "feeds_ok": feeds_ok,
                            "feeds_tried": len(FEEDS)}
    # Merge news sources (same link or same headline counts once), then number them for citing
    articles, seen_url, seen_title = [], set(), set()
    for a in result.pop("guardian") + gdelt_items[:25] + rss + gdelt_items[25:]:
        key = re.sub(r"\W+", " ", (a.get("title") or "").lower()).strip()[:80]
        if not a.get("url") or a["url"] in seen_url or key in seen_title:
            continue
        seen_url.add(a["url"])
        seen_title.add(key)
        articles.append({"id": f"A{len(articles) + 1}", **a})
    result["articles"] = articles[:45]
    return result


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = (parse_qs(urlparse(self.path).query).get("q") or [""])[0].strip()[:120]
        if len(q) < 3:
            return self._send(400, {"error": "Topic must be at least 3 characters."})
        body = collect(q)
        # cache good answers for 15 minutes, but retry soon when a source failed
        self._send(200, body, cache=60 if body["errors"] else 900)

    def _send(self, status, body, cache=0):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if cache:
            self.send_header("Cache-Control", f"s-maxage={cache}, stale-while-revalidate={cache * 4}")
        self.end_headers()
        self.wfile.write(payload)
