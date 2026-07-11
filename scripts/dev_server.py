"""Local dev server for testing — identical to `python -m http.server` except
it disables caching entirely, since browsers otherwise cache these files
aggressively between edits during development.

Usage: python scripts/dev_server.py [port]
"""

import sys
import http.server
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8420
ROOT = os.path.join(os.path.dirname(__file__), "..")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("", PORT), NoCacheHandler)
    print(f"Serving {ROOT} at http://localhost:{PORT} (caching disabled)")
    server.serve_forever()
