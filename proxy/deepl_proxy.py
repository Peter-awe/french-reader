#!/usr/bin/env python3
"""
DeepL 本地代理 —— 给浏览器补 CORS 头，把翻译请求转发到 DeepL。

为什么需要它：DeepL API 不返回 Access-Control-Allow-Origin，浏览器无法直连。
这个代理在本地转发，并补上 CORS 头，让 French Reader 能用上 DeepL 的高质量翻译。

用法：
    python3 proxy/deepl_proxy.py
然后在 French Reader 的「设置」里把「DeepL 代理地址」填成：
    http://localhost:1188

key 来源（按优先级）：
    1. 环境变量 DEEPL_KEY
    2. 项目根目录的 deepl_key.txt（已 gitignore，不会进仓库）

纯标准库，无需 pip 安装任何东西。Ctrl+C 停止。
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
        os.path.join(here, "..", "deepl_key.txt"),  # 项目根
        os.path.join(here, "deepl_key.txt"),         # proxy 目录
        "deepl_key.txt",                              # 当前工作目录
    ]
    for p in candidates:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                return f.read().strip()
    sys.exit("✗ 找不到 DeepL key：设置 DEEPL_KEY 环境变量，或在项目根放 deepl_key.txt")


KEY = load_key()
# :fx 结尾是 Free 版，否则是 Pro 版
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
        # 健康检查
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
        pass  # 安静运行


if __name__ == "__main__":
    print(f"✓ DeepL 代理运行于 http://localhost:{PORT}")
    print(f"  转发目标: {ENDPOINT}")
    print(f"  在 French Reader 设置里把「DeepL 代理地址」填 http://localhost:{PORT}")
    print("  Ctrl+C 停止")
    try:
        http.server.HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
