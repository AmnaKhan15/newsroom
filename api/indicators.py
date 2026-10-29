"""GET /api/indicators

The full list of World Bank Open Data indicators (World Development Indicators,
about 1,500 measures), trimmed to code, name and topic so the Data Desk can
search it. The World Bank's own list is ~1.5 MB because it includes long
descriptions; this response is a small fraction of that and is cached at
Vercel's edge for a day.
"""
import json
from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen

SOURCE = "https://api.worldbank.org/v2/sources/2/indicators?format=json&per_page=2000"
UA = "Newsroom/1.0 (data journalism; indicator search)"


def load_indicators():
    with urlopen(Request(SOURCE, headers={"User-Agent": UA}), timeout=20) as resp:
        meta, rows = json.loads(resp.read().decode("utf-8"))
    items = []
    for r in rows or []:
        if not r.get("id") or not r.get("name"):
            continue
        topics = [t.get("value", "").strip() for t in (r.get("topics") or []) if t.get("value")]
        items.append([r["id"], r["name"].strip(), topics[0] if topics else ""])
    items.sort(key=lambda i: i[1].lower())
    return items


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            items = load_indicators()
        except Exception:
            return self._send(502, {"error": "Could not reach the World Bank."}, cache=False)
        self._send(200, {"count": len(items), "items": items})

    def _send(self, status, body, cache=True):
        payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if cache:
            self.send_header("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800")
        self.end_headers()
        self.wfile.write(payload)
