"""GET /api/table?url=<public page or CSV>

Pulls tabular data out of a public web page (every <table>) or a CSV link, so
reporters can work with registries and statistics published as HTML.

Safety: http(s) only, public IP addresses only (no localhost or private
ranges, checked after DNS resolution and on every redirect), 4 MB and
12 s limits.
"""
import csv
import io
import ipaddress
import json
import socket
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_BYTES = 4 * 1024 * 1024
MAX_ROWS = 5000
UA = "Newsroom/1.0 (data journalism table importer)"


class Blocked(Exception):
    pass


def check_public(url):
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise Blocked("Only http(s) links are supported.")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80))
    except socket.gaierror:
        raise Blocked("Could not resolve that address.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise Blocked("That address is not a public website.")


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_public(urljoin(req.full_url, newurl))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url):
    check_public(url)
    opener = build_opener(SafeRedirect)
    with opener.open(Request(url, headers={"User-Agent": UA}), timeout=12) as resp:
        ctype = resp.headers.get("Content-Type", "")
        body = resp.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise Blocked("The page is larger than 4 MB.")
    charset = "utf-8"
    if "charset=" in ctype:
        charset = ctype.split("charset=")[-1].split(";")[0].strip() or "utf-8"
    return ctype, body.decode(charset, errors="replace")


class TableParser(HTMLParser):
    """Collects every <table> as a list of rows; handles th/td, colspan and captions."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.stack = [], []
        self.cell = None
        self.caption = None
        self.skip = 0  # inside <style>/<script>, whose text is not table content

    def handle_starttag(self, tag, attrs):
        if tag in ("style", "script"):
            self.skip += 1
        elif tag == "table":
            self.stack.append({"rows": [], "caption": ""})
        elif not self.stack:
            return
        elif tag == "tr":
            self.stack[-1]["rows"].append([])
        elif tag in ("td", "th"):
            span = dict(attrs).get("colspan") or "1"
            self.cell = {"text": [], "span": int(span) if span.isdigit() else 1}
        elif tag == "caption":
            self.caption = []
        elif tag == "br" and self.cell is not None:
            self.cell["text"].append(" ")

    def handle_endtag(self, tag):
        if tag in ("style", "script"):
            self.skip = max(0, self.skip - 1)
            return
        if not self.stack:
            return
        if tag in ("td", "th") and self.cell is not None:
            rows = self.stack[-1]["rows"]
            if not rows:
                rows.append([])
            text = " ".join("".join(self.cell["text"]).split())
            rows[-1].extend([text] * min(self.cell["span"], 20))
            self.cell = None
        elif tag == "caption" and self.caption is not None:
            self.stack[-1]["caption"] = " ".join("".join(self.caption).split())
            self.caption = None
        elif tag == "table":
            t = self.stack.pop()
            rows = [r for r in t["rows"] if any(c.strip() for c in r)]
            if len(rows) >= 2 and max(len(r) for r in rows) >= 2:
                self.tables.append({"caption": t["caption"], "rows": rows[:MAX_ROWS]})

    def handle_data(self, data):
        if self.skip:
            return
        if self.cell is not None:
            self.cell["text"].append(data)
        elif self.caption is not None:
            self.caption.append(data)


def extract(url):
    ctype, text = download(url)
    if "csv" in ctype or url.lower().split("?")[0].endswith(".csv"):
        rows = list(csv.reader(io.StringIO(text)))[:MAX_ROWS]
        return [{"caption": "CSV", "rows": rows}]
    p = TableParser()
    p.feed(text)
    tables = sorted(p.tables, key=lambda t: -len(t["rows"]))[:8]
    for t in tables:
        t["size"] = f"{len(t['rows'])} × {max(len(r) for r in t['rows'])}"
    return tables


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = (parse_qs(urlparse(self.path).query).get("url") or [""])[0].strip()
        try:
            tables = extract(url)
        except Blocked as e:
            return self._send(400, {"error": str(e)})
        except HTTPError as e:
            return self._send(502, {"error": f"The site answered with HTTP {e.code}."})
        except (URLError, TimeoutError, OSError):
            return self._send(502, {"error": "Could not reach that page."})
        if not tables:
            return self._send(404, {"error": "No data tables found on that page."})
        self._send(200, {"url": url, "tables": tables})

    def _send(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(payload)
