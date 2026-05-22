# French Reader · 法语阅读器

一个纯静态的网页版法语精读工具，复刻 Readlang 的核心体验，**无每日翻译限额**。
点词查义、选句翻译、生词高亮、阅读进度自动保存、导入 epub/txt。所有数据都存在你自己的浏览器里。

## 功能

- **点词翻译**：点任意单词，弹出译文（法语撇号词 `l'amie`、连字符词 `peut-être` 都能正确识别）
- **选句/选短语翻译**：用鼠标划选一段文字，自动翻译
- **整句翻译**：点词后弹窗里点「翻译整句」
- **生词高亮**：点过的词自动标黄；可标记为「已掌握」（标绿）或移除
- **阅读进度**：自动记住每本书读到哪，刷新/重开不丢
- **导入**：拖入或选择 `.epub` / `.txt`，或直接粘贴文本
- **离线优先**：书籍存 IndexedDB，生词/进度/设置存 localStorage，不上传任何服务器

## 翻译引擎

默认用支持浏览器跨域（CORS）的免费端点，自动按顺序 fallback：

1. Google `dict-chrome-ex` 端点（质量 = Google Translate 本体）
2. Google `gtx` 端点
3. Lingva（开源 Google 代理，多实例）
4. MyMemory（兜底，匿名 5000 词/天）

哪个能用就用哪个，单个端点挂掉不影响使用。

### 关于 DeepL（可选，最高质量）

DeepL 官方 API 不返回 CORS 头，浏览器**无法直连**。本项目自带一个本地代理解决这个问题。

**用法**：

1. 把你的 DeepL key 写进项目根目录的 `deepl_key.txt`（一行，`xxxx:fx` 这种）。
   该文件已被 `.gitignore`，**不会进仓库**。
2. 启动代理（纯 Python 标准库，无需 pip 安装）：
   ```bash
   python3 proxy/deepl_proxy.py
   ```
3. 在 French Reader 的「设置」里把 **DeepL 代理地址** 填成 `http://localhost:1188`，保存。

之后翻译会优先走 DeepL；代理没开时自动 fallback 到免费端点，不影响使用。

**注意**：代理是 HTTP localhost，只在你**本地运行 app**（`http://localhost:8000`）时生效。
部署到 GitHub Pages（HTTPS）的站点调用 `http://localhost` 属于混合内容，浏览器会拦——
那种场景用免费端点，或改用 Cloudflare Worker 等 HTTPS 代理。

**其实免费端点对「读小说点词点句」已经完全够用**，DeepL 的优势主要在整句语气，按需开即可。

## 本地运行

因为用到 `fetch` 和 ES 模块化脚本，**不要直接双击 `index.html`**（`file://` 协议下跨域和路径会出问题）。起一个本地服务器：

```bash
cd french-reader
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 部署到 GitHub Pages

```bash
cd french-reader
git init
git add .
git commit -m "Initial commit: French Reader"
git branch -M main
git remote add origin https://github.com/<你的用户名>/french-reader.git
git push -u origin main
```

然后在仓库 Settings → Pages → Source 选 `main` 分支 `/ (root)`，几分钟后访问
`https://<你的用户名>.github.io/french-reader/`。

> 仓库里的 `.nojekyll` 文件用于关闭 GitHub Pages 默认的 Jekyll 处理，避免 `js/` 目录被忽略。

## 文件结构

```
french-reader/
├── index.html        # 单页：书库 + 阅读 + 设置
├── style.css         # 样式
├── js/
│   ├── storage.js    # IndexedDB（书籍）+ localStorage（生词/进度/设置）
│   ├── translate.js  # 多端点 fallback 翻译引擎
│   ├── library.js    # txt/epub 导入解析
│   └── reader.js     # 渲染 + 交互 + UI 接线
├── README.md
└── .nojekyll
```

## 隐私

- 不需要登录、不需要后端、不收集任何数据
- 书籍正文 + 生词 + 进度 + 设置（含 DeepL key）全部只存在你这台机器的浏览器里
- 翻译请求直接从你的浏览器发往翻译端点，本应用不经手
