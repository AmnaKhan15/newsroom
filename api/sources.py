"""GET /api/sources?q=<topic>

Collects open evidence about a topic from public APIs (no scraping):
  - GDELT DOC 2.0     : global news coverage, last 3 months
  - The Guardian      : reporting from one reference outlet (needs GUARDIAN_API_KEY)
  - OpenAlex          : academic research
  - Wikipedia         : neutral background
"""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler
from urllib.error import HTTPError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

UA = "ClaimLens/1.0 (journalism research prototype)"
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
    # GDELT allows one request per 5 s per IP and answers in plain text when exceeded
    for attempt in range(3):
        try:
            data = fetch_json(url)
            break
        except (ValueError, HTTPError) as e:
            limited = getattr(e, "code", None) == 429 or "limit requests" in str(e)
            if not limited or attempt == 2:
                raise
            time.sleep(5.5)
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
    return text[:700] + ("…" if len(text) > 700 else "")


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
    jobs = {"gdelt": gdelt, "guardian": guardian, "papers": openalex, "background": wikipedia}
    result = {"topic": topic, "errors": {}}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {name: pool.submit(fn, topic) for name, fn in jobs.items()}
        for name, fut in futures.items():
            try:
                result[name] = fut.result()
            except Exception as e:  # one failing source should not sink the rest
                result[name] = None if name == "background" else []
                result["errors"][name] = str(e)[:200]
    # Merge news sources, then number them so the AI can cite them
    articles, seen = [], set()
    for a in result.pop("guardian") + result.pop("gdelt"):
        if a["url"] not in seen:
            seen.add(a["url"])
            articles.append({"id": f"A{len(articles) + 1}", **a})
    result["articles"] = articles[:45]
    return result


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = (parse_qs(urlparse(self.path).query).get("q") or [""])[0].strip()[:120]
        if len(q) < 3:
            return self._send(400, {"error": "Topic must be at least 3 characters."})
        self._send(200, collect(q))

    def _send(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "s-maxage=900, stale-while-revalidate=3600")
        self.end_headers()
        self.wfile.write(payload)
