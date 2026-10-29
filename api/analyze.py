"""POST /api/analyze

Body: the JSON returned by /api/sources, plus optional
  "documents": [{"id": "D1", "name": "report.pdf", "text": "..."}]
uploaded by the user (parsed in the browser).

No paid AI: this is a transparent, rule-based evidence engine.
  1. Read more than headlines: fetch the full text of the most relevant articles.
  2. Pick claim-like sentences (numbers, causal verbs) that mention the topic.
  3. For every other source, find its sentence closest in meaning to the claim,
     matching concepts rather than exact words ("harm" ~ "damage", "heart" ~ "cardiac").
  4. Decide whether that sentence agrees or says the opposite ("no link", "did not find").
  5. Count independent origins, not outlets: copies of one press release or wire
     story count once.
  6. Rate: opposite only = disputed, both = mixed, research + independent reports =
     supported, otherwise not confirmed. Every rating carries its basis and an example
     sentence, so a journalist can check it.
"""
import ipaddress
import json
import math
import re
import socket
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, wait
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

STOP = set("""a about above after again against all also am an and any are as at be because been before
being below between both but by can could did do does doing down during each few for from further had
has have having he her here hers him his how i if in into is it its itself just me more most my no nor
not now of off on once only or other our out over own same she should so some such than that the their
them then there these they this those through to too under until up very was we were what when where
which while who whom why will with would you your new says said say amid after over via get gets got
one two three first last year years day days week weeks may might us um eine einer eines einem einen
der die das den dem des und oder aber auch auf aus bei bis durch für gegen hat haben ist im in mit nach
nicht noch nur sich sie sind so über um von vor wie wird werden zu zum zur ein als am an es er dass
using use used based study studies paper results result data analysis research review article
report reports according company finds found shows show show refer refers basically""".split())

CLAIM_CUE = re.compile(
    r"\b(cause[sd]?|causing|link(ed|s)?|increase[sd]?|decrease[sd]?|reduce[sd]?|rise[sn]?|rising|"
    r"risk[sy]?|found|finds?|shows?|showed|reveal(s|ed)?|lead(s)? to|kill(s|ed)?|harm(s|ful)?|"
    r"threat(en|ens)?|benefit(s)?|double[sd]?|halve[sd]?|percent|per cent|million|billion|"
    r"most|never|always|every|all|no evidence|cure[sd]?|prevent(s|ed)?|destroy(s|ed)?|"
    r"warn(s|ed)?|confirm(s|ed)?|record|affect(s|ed)?|contain(s|ed)?|safe|unsafe|dangerous)\b|\d", re.I)
GAP_CUE = re.compile(
    r"\b(further (research|studies|investigation)|remain(s|ed)? (unclear|unknown|uncertain|limited)|"
    r"not (yet |well |fully )?(understood|known|clear)|lack(s|ing)? of|limited (data|evidence|"
    r"research|knowledge)|knowledge gaps?|are lacking|lacking|challenges in|more research|future (research|studies|work)|inconclusive|"
    r"uncertain(ty|ties)?|need(s|ed)? to be|poorly understood|unknown)\b", re.I)
HEDGE_CUE = re.compile(r"\b(may|might|could|possibly|suggests?|potential(ly)?|preliminary)\b", re.I)
# Sentences about the paper or book itself ("this review aims to…", "this volume will…")
# are not claims about the world
META_CUE = re.compile(
    r"\b(this (review|study|paper|article|work|chapter|volume|book|edition|report|handbook|text|collection)|"
    r"the (book|volume|authors?|editors?)|readers|textbook|we (review|discuss|present|propose|summari[sz]e|"
    r"examine|investigate|analy[sz]e)|aims? to|in this (review|paper|study)|beyond summari[sz]ing|"
    r"is discussed|are discussed|are reviewed|is reviewed)\b", re.I)

# ---------- check 1: same words, different meaning ----------
# A sentence that negates or debunks says the opposite of one that asserts.
NEGATION = re.compile(
    r"\b(no|not|never|none|neither|nor|without|cannot|unlikely|unrelated|unproven|unfounded|"
    r"baseless|myth|hoax|false(ly)?|debunk(s|ed)?|disprove[sd]?|refute[sd]?|den(y|ies|ied)|"
    r"fail(s|ed)? to|lack(s|ed)? (of|any)|absence of|no longer|kein(e|en|er)?|nicht)\b"
    r"|n't\b", re.I)
NOT_REALLY_NEGATION = re.compile(
    r"\b(not only|not just|no doubt|no less than|nothing but|none other|not least|"
    r"not surprising(ly)?|no wonder)\b", re.I)
DEBUNK = re.compile(r"\b(myth|hoax|debunk\w*|baseless|unfounded|unproven|misinformation|"
                    r"disinformation|false(ly)? claim\w*|no (scientific )?evidence)\b", re.I)


def negated(sentence):
    return bool(NEGATION.search(NOT_REALLY_NEGATION.sub(" ", sentence)))


# ---------- check 2: different words, same meaning ----------
# Groups of words that mean (nearly) the same in news about health, climate,
# elections and money. Matching runs on these concepts instead of raw words.
SYNONYMS = [
    "harm damage hurt injure injury impair worsen endanger destroy ruin harmful damaging",
    "cause trigger drive fuel spark produce",
    "increase rise grow growth surge soar jump climb boost spike higher more",
    "decrease fall drop decline lower reduce reduction cut shrink plunge less",
    "heart cardiac cardiovascular cardio coronary",
    "death die dead dies died mortality fatal fatality kill killed deadly",
    "cancer tumour tumor carcinogen carcinogenic malignant oncology",
    "disease illness sickness sick disorder ailment",
    "child children kid kids youth youngster minor infant baby babies",
    "people human humans person persons resident residents citizen citizens public",
    "plastic plastics polymer polymers",
    "brain neural neurological cognitive",
    "lung lungs respiratory pulmonary breathing",
    "blood bloodstream plasma",
    "flood floods flooding inundation deluge",
    "rain rainfall precipitation monsoon downpour",
    "heat heatwave heatwaves hot temperature temperatures warm warming",
    "glacier glaciers glacial icecap ice",
    "pollution pollutant pollutants contamination contaminant toxic toxin toxins",
    "money fund funds funding finance financing budget cash aid grant",
    "election elections vote votes voting voter voters poll polls ballot electoral",
    "deepfake deepfakes fake fabricated manipulated doctored synthetic",
    "link linked association associated connection connected correlation correlated tied",
    "effect effects impact impacts consequence consequences influence",
    "risk risks danger dangers hazard hazards threat threats",
    "doctor doctors physician physicians clinician clinicians",
    "vaccine vaccines vaccination vaccinated jab jabs immunisation immunization",
    "migrant migrants refugee refugees asylum",
    "price prices cost costs inflation expensive",
    "food foods diet meal meals eat eating",
    "woman women female females",
    "drought droughts dry dryness",
]
CONCEPT = {}
for gi, group in enumerate(SYNONYMS):
    for w in group.split():
        CONCEPT.setdefault(w, f"#{gi}")


def tokens(text):
    out = []
    for w in re.findall(r"[a-zà-ÿ0-9]+(?:[-'][a-zà-ÿ0-9]+)*", text.lower()):
        parts = [w] + (w.split("-") if "-" in w else [])
        out.extend(p for p in parts if len(p) > 2 and p not in STOP and not p.isdigit())
    return out


def stem(w):
    for suf in ("ations", "ation", "ings", "ing", "ies", "es", "s", "ed"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def concepts_of(word):
    """A word's concepts: its synonym group, its stem, and for micro-/nano- words, the root."""
    out = set()
    for w in {word, word[5:] if word.startswith("micro") and len(word) > 8 else "",
              word[4:] if word.startswith("nano") and len(word) > 7 else ""}:
        if not w:
            continue
        out.add(CONCEPT.get(w) or CONCEPT.get(stem(w)) or stem(w))
    return out


def keyset(text):
    out = set()
    for w in tokens(text):
        out |= concepts_of(w)
    return out


def sentences(text, lo=40, hi=320):
    text = re.sub(r"\s+", " ", text or "")
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"“])", text)
    return [p.strip() for p in parts if lo <= len(p.strip()) <= hi]


# ---------- check 3: read more than the headline ----------
UA = "Newsroom/1.0 (journalism research; reads public articles)"


def public_url(url):
    u = urlparse(url or "")
    if u.scheme not in ("http", "https") or not u.hostname:
        return False
    try:
        infos = socket.getaddrinfo(u.hostname, None)
    except socket.gaierror:
        return False
    return all(ipaddress.ip_address(i[4][0]).is_global for i in infos)


class _SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urljoin(req.full_url, newurl)
        if not public_url(target):
            raise OSError("redirect to non-public address")
        return super().redirect_request(req, fp, code, msg, headers, target)


class _Paragraphs(HTMLParser):
    """Keeps the text of <p> elements outside navigation, headers, footers and scripts."""
    SKIP = {"script", "style", "nav", "header", "footer", "aside", "form", "noscript", "figure"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth_skip = 0
        self.in_p = False
        self.buf, self.paras = [], []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.depth_skip += 1
        elif tag == "p" and not self.depth_skip:
            self.in_p, self.buf = True, []

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.depth_skip = max(0, self.depth_skip - 1)
        elif tag == "p" and self.in_p:
            text = " ".join("".join(self.buf).split())
            if len(text) >= 60:
                self.paras.append(text)
            self.in_p = False

    def handle_data(self, data):
        if self.in_p and not self.depth_skip:
            self.buf.append(data)


def fetch_body(url):
    if not public_url(url):
        return ""
    opener = build_opener(_SafeRedirect)
    with opener.open(Request(url, headers={"User-Agent": UA}), timeout=6) as resp:
        if "html" not in resp.headers.get("Content-Type", "html"):
            return ""
        raw = resp.read(1_500_000).decode("utf-8", errors="replace")
    p = _Paragraphs()
    p.feed(raw)
    body = " ".join(p.paras)[:20000]
    return body if len(body) >= 400 else ""  # shorter usually means a paywall or cookie wall


def fetch_bodies(articles, limit=16, budget=10):
    picked = articles[:limit]
    bodies = {}
    pool = ThreadPoolExecutor(max_workers=8)
    futures = {pool.submit(fetch_body, a.get("url")): a["id"] for a in picked}
    done, _ = wait(futures, timeout=budget)
    for f in done:
        try:
            body = f.result()
        except Exception:
            body = ""
        if body:
            bodies[futures[f]] = body
    pool.shutdown(wait=False, cancel_futures=True)
    return bodies, len(picked)


# ---------- check 4: popular is not the same as true ----------
WIRE = re.compile(r"\b(Reuters|Associated Press|AFP|Agence France-Presse|dpa|PTI|Press Trust of India|"
                  r"APP|Associated Press of Pakistan|IANS|ANI|Bloomberg|Xinhua|Anadolu)\b")


def independent_origins(articles, bodies):
    """Union-find over articles: same outlet, near-identical headline, overlapping text
    or the same wire story all count as one origin."""
    ids = [a["id"] for a in articles]
    parent = {i: i for i in ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        parent[find(a)] = find(b)

    heads = {a["id"]: keyset(a.get("title") or "") for a in articles}
    shingles = {}
    wires = {}
    for a in articles:
        body = bodies.get(a["id"], "")
        words = re.findall(r"\w+", body.lower())[:400]
        shingles[a["id"]] = {" ".join(words[i:i + 5]) for i in range(max(0, len(words) - 4))}
        m = WIRE.search((a.get("title") or "") + " " + body[:600])
        wires[a["id"]] = m.group(1) if m else None
    by_domain = {}
    for a in articles:
        d = (a.get("domain") or "").removeprefix("www.")
        if d in by_domain:
            union(a["id"], by_domain[d])
        else:
            by_domain[d] = a["id"]
    for i, x in enumerate(ids):
        for y in ids[i + 1:]:
            hx, hy = heads[x], heads[y]
            jac = len(hx & hy) / max(len(hx | hy), 1)
            sx, sy = shingles[x], shingles[y]
            text_overlap = len(sx & sy) / max(min(len(sx), len(sy)), 1) if sx and sy else 0
            same_wire = wires[x] and wires[x] == wires[y] and jac >= 0.3
            if jac >= 0.6 or text_overlap >= 0.25 or same_wire:
                union(x, y)
    return {i: find(i) for i in ids}, wires


# ---------- matching and rating ----------

def build_units(data, bodies):
    """Every source becomes a unit with its sentences and each sentence's concepts."""
    units = []
    for a in data.get("articles") or []:
        body = bodies.get(a["id"], "")
        sents = [a.get("title") or ""] + sentences(body)[:150]
        units.append({"id": a["id"], "kind": "A", "domain": a.get("domain"),
                      "country": a.get("country"), "sents": sents, "full": bool(body)})
    for r in data.get("papers") or []:
        units.append({"id": r["id"], "kind": "R", "domain": r.get("venue"),
                      "sents": [r.get("title") or ""] + sentences(r.get("abstract"))})
    for d in data.get("documents") or []:
        units.append({"id": d["id"], "kind": "D", "domain": d.get("name"),
                      "sents": sentences(d.get("text"))[:400]})
    for u in units:
        u["skeys"] = [keyset(s) for s in u["sents"]]
        u["keys"] = set().union(*u["skeys"]) if u["skeys"] else set()
    return units


def idf_table(units):
    df = Counter()
    for u in units:
        df.update(u["keys"])
    n = max(len(units), 1)
    return {k: math.log((n + 1) / (c + 0.5)) for k, c in df.items()}


def evidence(claim_text, claim_keys, topic_keys, units, own_id):
    """For each other source, its sentence closest to the claim and whether it agrees."""
    core = claim_keys - topic_keys
    if len(core) < 2:
        return []
    claim_neg = negated(claim_text)
    out = []
    for u in units:
        if u["id"] == own_id:
            continue
        need = 3 if u["kind"] == "D" else 2
        best, best_n = None, 0
        for s, ks in zip(u["sents"], u["skeys"]):
            n = len(core & ks)
            if n > best_n:
                best, best_n = s, n
        if best_n < need or best_n / len(core) < 0.25:
            continue
        opposite = negated(best) != claim_neg or (DEBUNK.search(best) and not DEBUNK.search(claim_text))
        out.append({"u": u, "sent": best, "score": best_n, "stance": "contra" if opposite else "agree"})
    out.sort(key=lambda e: -e["score"])
    return out[:10]


def judge(claim_text, ev, origin_of, own_kind):
    def tally(stance):
        es = [e for e in ev if e["stance"] == stance]
        news = [e["u"] for e in es if e["u"]["kind"] == "A"]
        return {
            "papers": sum(1 for e in es if e["u"]["kind"] == "R"),
            "docs": sum(1 for e in es if e["u"]["kind"] == "D"),
            "outlets": len({origin_of[u["id"]] for u in news}),  # independent origins
            "copies": len({u["domain"] for u in news}),  # outlets as published
            "countries": len({u.get("country") for u in news if u.get("country")}),
        }

    a, c = tally("agree"), tally("contra")
    agree_n = a["papers"] + a["outlets"] + a["docs"]
    contra_n = c["papers"] + c["outlets"] + c["docs"]
    basis = {**a, "contra": contra_n, "contra_papers": c["papers"], "agree": agree_n,
             "hedged": bool(HEDGE_CUE.search(claim_text))}
    quote_from = next((e for e in ev if e["stance"] == "contra"), None) or (ev[0] if ev else None)
    if quote_from:
        basis["quote"] = {"id": quote_from["u"]["id"], "text": quote_from["sent"][:240],
                          "stance": quote_from["stance"]}
    if contra_n and agree_n:
        return "mixed", {**basis, "basis": "mixed"}
    if contra_n:
        return "disputed", {**basis, "basis": "contradicted"}
    # Research from another source is the strongest support; news alone needs
    # several independent reports from more than one country.
    # (A claim taken from a paper is only supported by *other* sources.)
    if a["papers"] or (own_kind == "R" and (a["outlets"] or a["docs"])) or (a["outlets"] >= 3 and a["countries"] >= 2):
        return "supported", {**basis, "basis": "corroborated"}
    if agree_n and a["copies"] > a["outlets"]:
        return "unverified", {**basis, "basis": "echo"}
    return "unverified", {**basis, "basis": "thin"}


def extract_claims(units, topic_keys, idf):
    cands = []
    for u in units:
        # claims come from headlines, abstracts and the user's files; article bodies are evidence only
        sents = u["sents"][:1] if u["kind"] == "A" else u["sents"]
        for s, ks in zip(sents, u["skeys"]):
            cue = CLAIM_CUE.search(s)
            if not cue or GAP_CUE.search(s) or META_CUE.search(s):
                continue
            if u["kind"] == "R" and cue.group(0).isdigit():
                continue  # in abstracts, bare numbers are usually methods, not claims
            on_topic = len(ks & topic_keys)
            if topic_keys and not on_topic and u["kind"] != "D":
                continue
            if len(ks - topic_keys) < 2:
                continue
            weight = sum(idf.get(k, 0) for k in ks - topic_keys)
            bonus = {"D": 2.0, "A": 1.0, "R": 0.6}[u["kind"]]
            cands.append({"text": s, "keys": ks, "src": u, "score": weight * bonus + on_topic * 3})
    cands.sort(key=lambda c: -c["score"])
    picked = []
    per_kind = Counter()
    limits = {"D": 4, "A": 4, "R": 3}
    for c in cands:
        if per_kind[c["src"]["kind"]] >= limits[c["src"]["kind"]]:
            continue
        if any(len(c["keys"] & p["keys"]) / max(len(c["keys"] | p["keys"]), 1) > 0.45 for p in picked):
            continue
        picked.append(c)
        per_kind[c["src"]["kind"]] += 1
        if len(picked) == 8:
            break
    return picked


def key_terms(data, topic_keys):
    """Most distinctive words and two-word phrases in headlines and documents."""
    counts = Counter()
    for a in data.get("articles") or []:
        ws = [w for w in tokens(a.get("title") or "") if not concepts_of(w) & topic_keys]
        counts.update(set(ws))
        counts.update({f"{x} {y}" for x, y in zip(ws, ws[1:])})
    for d in data.get("documents") or []:
        ws = [w for w in tokens(d.get("text") or "") if not concepts_of(w) & topic_keys]
        top = Counter(ws).most_common(25)
        counts.update({w: 1 for w, _ in top})
    terms = []
    for term, c in counts.most_common(80):
        if c < 2:
            break
        if " " not in term and any(term in t for t, _ in terms if " " in t):
            continue
        terms.append((term, c))
    return [{"term": t, "count": c} for t, c in terms[:14]]


def document_report(data, topic_keys, claims, coverage_keys):
    out = []
    for d in data.get("documents") or []:
        ws = [w for w in tokens(d.get("text") or "") if not concepts_of(w) & topic_keys]
        top = [w for w, _ in Counter(ws).most_common(10)]
        mine = [c for c in claims if c["source_id"] == d["id"]]
        out.append({
            "id": d["id"], "name": d.get("name"),
            "words": len((d.get("text") or "").split()),
            "top_terms": top[:8],
            "claims": len(mine),
            "corroborated": sum(1 for c in mine if c["status"] == "supported"),
            "not_in_coverage": [w for w in top if not concepts_of(w) & coverage_keys][:4],
        })
    return out


def story_angles(data, claims, docs_report):
    angles = []
    articles = data.get("articles") or []
    covered = keyset(" ".join(a.get("title") or "" for a in articles))
    for p in sorted(data.get("papers") or [], key=lambda r: -(r.get("cites") or 0))[:4]:
        core = keyset(p.get("title") or "")
        if articles and len(core & covered) <= 1:
            angles.append({"type": "research_gap", "id": p["id"], "title": p.get("title"),
                           "cites": p.get("cites")})
            break
    for c in claims:
        if c["status"] == "unverified" and c["kind"] == "A":
            angles.append({"type": "unbacked_claim", "id": c["source_id"], "claim": c["claim"]})
            break
    countries = Counter(a.get("country") for a in articles if a.get("country"))
    if countries and len(articles) >= 6:
        top, n = countries.most_common(1)[0]
        share = round(100 * n / sum(countries.values()))
        if share >= 35:
            angles.append({"type": "concentration", "country": top, "share": share})
    for d in docs_report:
        if d["not_in_coverage"]:
            angles.append({"type": "doc_gap", "id": d["id"], "name": d["name"],
                           "terms": d["not_in_coverage"][:3]})
            break
    if not angles:
        angles.append({"type": "local_voices"})
    return angles[:4]


def analyze(data, read_full_text=True):
    topic = data.get("topic") or ""
    topic_keys = keyset(topic)
    articles = data.get("articles") or []
    bodies, tried = fetch_bodies(articles) if read_full_text and articles else ({}, 0)
    origin_of, wires = independent_origins(articles, bodies)
    units = build_units(data, bodies)
    idf = idf_table(units)

    claims = []
    for c in extract_claims(units, topic_keys, idf):
        ev = evidence(c["text"], c["keys"], topic_keys, units, c["src"]["id"])
        status, basis = judge(c["text"], ev, origin_of, c["src"]["kind"])
        claims.append({
            "claim": c["text"], "source_id": c["src"]["id"], "kind": c["src"]["kind"],
            "status": status, "basis": basis,
            "support_ids": [e["u"]["id"] for e in ev if e["stance"] == "agree"],
            "contra_ids": [e["u"]["id"] for e in ev if e["stance"] == "contra"],
            "source_ids": [c["src"]["id"]] + [e["u"]["id"] for e in ev],
        })
    order = {"disputed": 0, "mixed": 1, "supported": 2, "unverified": 3}
    claims.sort(key=lambda c: order[c["status"]])

    known, unknown = [], []
    for u in units:
        if u["kind"] not in ("R", "D"):
            continue
        for s, ks in zip(u["sents"], u["skeys"]):
            if GAP_CUE.search(s) and len(unknown) < 5 and (not topic_keys or ks & topic_keys or u["kind"] == "D"):
                unknown.append({"text": s, "id": u["id"]})
                break
    for u in sorted((u for u in units if u["kind"] == "R"), key=lambda u: -len(u["keys"] & topic_keys)):
        best = [s for s in u["sents"][1:] if not GAP_CUE.search(s) and not HEDGE_CUE.search(s)
                and not META_CUE.search(s) and CLAIM_CUE.search(s)]
        if best and len(known) < 4:
            known.append({"text": best[-1], "id": u["id"]})  # conclusions sit at the end

    coverage_keys = keyset(" ".join((a.get("title") or "") for a in articles))
    docs = document_report(data, topic_keys, claims, coverage_keys)
    return {
        "engine": "evidence-matching v2",
        "checks": {
            "articles": len(articles),
            "origins": len(set(origin_of.values())),
            "fulltext_ok": len(bodies),
            "fulltext_tried": tried,
            "wire": sum(1 for w in wires.values() if w),
        },
        "claims": claims,
        "known": known,
        "unknown": unknown,
        "key_terms": key_terms(data, topic_keys),
        "documents": docs,
        "story_angles": story_angles(data, claims, docs),
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"error": "Invalid JSON body."})
        for d in data.get("documents") or []:
            d["text"] = (d.get("text") or "")[:60000]
        self._send(200, analyze(data))

    def _send(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(payload)
