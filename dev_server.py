"""Local stand-in for Vercel's Python runtime: serves api/*.py on :8787.
Run `python dev_server.py` next to `npm run dev` (Vite proxies /api here)."""
import importlib.util
import pathlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API = pathlib.Path(__file__).parent / "api"


def load(name):
    spec = importlib.util.spec_from_file_location(name, API / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.handler


ROUTES = {"/api/sources": load("sources"), "/api/analyze": load("analyze")}


class Dev(BaseHTTPRequestHandler):
    def _route(self, method):
        target = ROUTES.get(self.path.split("?")[0])
        if not target:
            self.send_error(404)
            return
        self.__class__ = target  # hand the live request to the Vercel-style handler
        getattr(self, method)()

    def do_GET(self):
        self._route("do_GET")

    def do_POST(self):
        self._route("do_POST")


if __name__ == "__main__":
    print("API on http://localhost:8787")
    ThreadingHTTPServer(("127.0.0.1", 8787), Dev).serve_forever()
