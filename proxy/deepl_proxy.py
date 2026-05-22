#!/usr/bin/env python3
"""
Local DeepL proxy — adds the CORS headers a browser needs and forwards translation requests to DeepL.

Why it's needed: the DeepL API doesn't return Access-Control-Allow-Origin, so a browser can't call it
directly. This proxy forwards the request locally and adds the CORS headers, letting Mot à Mot use
DeepL's higher-quality translations.

Usage:
    python3 proxy/deepl_proxy.py
Then, in Mot à Mot's Settings, set "DeepL proxy address" to:
    http://localhost:1188

Key sources (in priority order):
    1. the DEEPL_KEY environment variable
    2. deepl_key.txt in the project root (gitignored, never committed)

Pure standard library — nothing to pip install. Ctrl+C to stop.
"""
import http.server
import urllib.request
import urllib.parse
import urllib.error
import json
import os
import sys

PORT = int(os.environ.get("DEEPL_PROXY_PORT", "1188"))


def load_key():
    k = os.environ.get("DEEPL_KEY")
    if k:
        return k.strip()
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "..", "deepl_key.txt"),  # project root
        os.path.join(here, "deepl_key.txt"),         # proxy folder
        "deepl_key.txt",                              # current working directory
    ]
    for p in candidates:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                return f.read().strip()
    sys.exit("✗ DeepL key not found: set the DEEPL_KEY env var, or put deepl_key.txt in the project root")


KEY = load_key()
# a key ending in :fx is the Free tier, otherwise Pro
ENDPOINT = ("https://api-free.deepl.com/v2/translate"
            if KEY.endswith(":fx")
            else "https://api.deepl.com/v2/translate")


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        # health check
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "endpoint": ENDPOINT}).encode())

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode("utf-8")
        params = urllib.parse.parse_qs(raw)
        text = params.get("text", [""])[0]
        target = params.get("target_lang", ["EN"])[0]
        source = params.get("source_lang", [""])[0]

        data = {"text": text, "target_lang": target}
        if source and source.upper() != "AUTO":
            data["source_lang"] = source
        req = urllib.request.Request(
            ENDPOINT,
            data=urllib.parse.urlencode(data).encode(),
            headers={"Authorization": "DeepL-Auth-Key " + KEY},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                out = r.read()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(out)
        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body or json.dumps({"error": str(e)}).encode())
        except Exception as e:
            self.send_response(502)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def log_message(self, *args):
        pass  # run quietly


if __name__ == "__main__":
    print(f"✓ DeepL proxy running at http://localhost:{PORT}")
    print(f"  forwarding to: {ENDPOINT}")
    print(f"  in Mot à Mot Settings, set \"DeepL proxy address\" to http://localhost:{PORT}")
    print("  Ctrl+C to stop")
    try:
        http.server.HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
