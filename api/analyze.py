"""POST /api/analyze

Body: the JSON returned by /api/sources, plus optional
  "documents": [{"id": "D1", "name": "report.pdf", "text": "..."}]
uploaded by the user (parsed in the browser).

No paid AI: this is a transparent, rule-based evidence engine.
  1. Split every source into sentences and tokens.
  2. Pick claim-like sentences (numbers, causal verbs) that mention the topic.
  3. Match each claim against every other source by shared key terms.
  4. Rate it from what matched: debunking language in related sources = contested,
     research + independent outlets = corroborated, anything else = unverified.
Every rating carries its basis (counts and source ids) so a journalist can check it.
"""
import json
import math
import re
from collections import Counter
from http.server import BaseHTTPRequestHandler

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
    r"warn(s|ed)?|confirm(s|ed)?|record)\b|\d", re.I)
GAP_CUE = re.compile(
    r"\b(further (research|studies|investigation)|remain(s|ed)? (unclear|unknown|uncertain|limited)|"
    r"not (yet |well |fully )?(understood|known|clear)|lack(s|ing)? of|limited (data|evidence|"
    r"research|knowledge)|knowledge gaps?|are lacking|lacking|challenges in|more research|future (research|studies|work)|inconclusive|"
    r"uncertain(ty|ties)?|need(s|ed)? to be|poorly understood|unknown)\b", re.I)
DEBUNK_CUE = re.compile(
    r"\b(no evidence|myth|debunk(ed|s)?|hoax|fake|false(ly)?|misleading|unproven|unfounded|"
    r"disput(e|ed|es)|refute[sd]?|deny|denies|denied|contrary to|baseless|misinformation|"
    r"disinformation|conspiracy|fact.?check)\b", re.I)
HEDGE_CUE = re.compile(r"\b(may|might|could|possibly|suggests?|potential(ly)?|preliminary)\b", re.I)
# Sentences about the paper itself ("this review aims to…") are not claims about the world
META_CUE = re.compile(
    r"\b(this (review|study|paper|article|work|chapter)|we (review|discuss|present|propose|summari[sz]e|"
    r"examine|investigate|analy[sz]e)|aims? to|in this (review|paper|study)|beyond summari[sz]ing|"
    r"is discussed|are discussed|are reviewed|is reviewed)\b", re.I)


def tokens(text):
    return [w for w in re.findall(r"[a-zà-ÿ0-9]+(?:[-'][a-zà-ÿ0-9]+)*", text.lower())
            if len(w) > 2 and w not in STOP and not w.isdigit()]


def stem(w):
    for suf in ("ations", "ation", "ings", "ing", "ies", "es", "s", "ed"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def keyset(text):
    return {stem(w) for w in tokens(text)}


def sentences(text, lo=40, hi=320):
    text = re.sub(r"\s+", " ", text or "")
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"“])", text)
    return [p.strip() for p in parts if lo <= len(p.strip()) <= hi]


def build_units(data):
    """Every source becomes a unit: id, kind, text, key set, domain."""
    units = []
    for a in data.get("articles") or []:
        units.append({"id": a["id"], "kind": "A", "text": a.get("title") or "",
                      "domain": a.get("domain"), "sents": [a.get("title") or ""]})
    for r in data.get("papers") or []:
        body = f"{r.get('title') or ''}. {r.get('abstract') or ''}"
        units.append({"id": r["id"], "kind": "R", "text": body, "domain": r.get("venue"),
                      "sents": sentences(r.get("abstract")) or [r.get("title") or ""]})
    for d in data.get("documents") or []:
        units.append({"id": d["id"], "kind": "D", "text": d.get("text") or "",
                      "domain": d.get("name"), "sents": sentences(d.get("text"))[:400]})
    for u in units:
        u["keys"] = keyset(u["text"])
    return units


def idf_table(units):
    df = Counter()
    for u in units:
        df.update(u["keys"])
    n = max(len(units), 1)
    return {k: math.log((n + 1) / (c + 0.5)) for k, c in df.items()}


def match(claim_keys, topic_keys, units, own_id):
    """Sources sharing at least two non-topic key terms with the claim."""
    core = claim_keys - topic_keys
    hits = []
    for u in units:
        if u["id"] == own_id or len(core) < 2:
            continue
        shared = core & u["keys"]
        need = 2 if u["kind"] != "D" else 3
        if len(shared) >= need and len(shared) / len(core) >= 0.2:
            hits.append((u, len(shared)))
    hits.sort(key=lambda h: -h[1])
    return [h[0] for h in hits[:8]]


def judge(claim, related):
    papers = [u for u in related if u["kind"] == "R"]
    news = [u for u in related if u["kind"] == "A"]
    docs = [u for u in related if u["kind"] == "D"]
    outlets = {u["domain"] for u in news if u.get("domain")}
    debunks = [u for u in related if DEBUNK_CUE.search(" ".join(u["sents"][:50]))]
    counts = {"papers": len(papers), "outlets": len(outlets), "docs": len(docs)}
    if debunks and not DEBUNK_CUE.search(claim):
        return "disputed", {"basis": "debunk", **counts}
    if papers and (outlets or docs) or len(papers) >= 2 or len(outlets) >= 3:
        return "supported", {"basis": "corroborated", **counts}
    return "unverified", {"basis": "thin", "hedged": bool(HEDGE_CUE.search(claim)), **counts}


def extract_claims(units, topic_keys, idf):
    cands = []
    for u in units:
        for s in u["sents"]:
            cue = CLAIM_CUE.search(s)
            if not cue or GAP_CUE.search(s) or META_CUE.search(s):
                continue
            if u["kind"] == "R" and cue.group(0).isdigit():
                continue  # in abstracts, bare numbers are usually methods, not claims
            ks = keyset(s)
            on_topic = len(ks & topic_keys)
            if topic_keys and not on_topic and u["kind"] != "D":
                continue
            weight = sum(idf.get(k, 0) for k in ks - topic_keys)
            if len(ks - topic_keys) < 2:
                continue
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
        ws = [w for w in tokens(a.get("title") or "") if stem(w) not in topic_keys]
        counts.update(set(ws))
        counts.update({f"{x} {y}" for x, y in zip(ws, ws[1:])})
    for d in data.get("documents") or []:
        ws = [w for w in tokens(d.get("text") or "") if stem(w) not in topic_keys]
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
        ws = [w for w in tokens(d.get("text") or "") if stem(w) not in topic_keys]
        top = [w for w, _ in Counter(ws).most_common(10)]
        mine = [c for c in claims if c["source_id"] == d["id"]]
        out.append({
            "id": d["id"], "name": d.get("name"),
            "words": len((d.get("text") or "").split()),
            "top_terms": top[:8],
            "claims": len(mine),
            "corroborated": sum(1 for c in mine if c["status"] == "supported"),
            "not_in_coverage": [w for w in top if stem(w) not in coverage_keys][:4],
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


def analyze(data):
    topic = data.get("topic") or ""
    topic_keys = keyset(topic)
    units = build_units(data)
    idf = idf_table(units)

    claims = []
    for c in extract_claims(units, topic_keys, idf):
        related = match(c["keys"], topic_keys, units, c["src"]["id"])
        status, basis = judge(c["text"], related)
        claims.append({
            "claim": c["text"], "source_id": c["src"]["id"], "kind": c["src"]["kind"],
            "status": status, "basis": basis,
            "source_ids": [c["src"]["id"]] + [u["id"] for u in related],
        })
    order = {"disputed": 0, "supported": 1, "unverified": 2}
    claims.sort(key=lambda c: order[c["status"]])

    known, unknown = [], []
    for u in units:
        if u["kind"] not in ("R", "D"):
            continue
        for s in u["sents"]:
            if GAP_CUE.search(s) and len(unknown) < 5 and (not topic_keys or keyset(s) & topic_keys
                                                            or u["kind"] == "D"):
                unknown.append({"text": s, "id": u["id"]})
                break
    for u in sorted((u for u in units if u["kind"] == "R"),
                    key=lambda u: -len(u["keys"] & topic_keys)):
        best = [s for s in u["sents"] if not GAP_CUE.search(s) and not HEDGE_CUE.search(s)
                and not META_CUE.search(s)
                and CLAIM_CUE.search(s)]
        if best and len(known) < 4:
            known.append({"text": best[-1], "id": u["id"]})  # conclusions sit at the end

    coverage_keys = keyset(" ".join((a.get("title") or "") for a in data.get("articles") or []))
    docs = document_report(data, topic_keys, claims, coverage_keys)
    return {
        "engine": "evidence-matching v1",
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
