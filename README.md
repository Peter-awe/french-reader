# Mot à Mot

*Read French in your browser, one word at a time.*

A small web app for close-reading French texts. Click any word for an instant translation, select a phrase or sentence to translate it, highlight the words you've looked up, and pick up where you left off. Bring your own EPUB/TXT books. No daily translation limit, no account, no backend — everything stays in your browser.

**▶ Try it live: https://peter-awe.github.io/mot-a-mot/**

> Open it in **Chrome**. Some ad/privacy blockers (and Safari) block the translation services and you'll see "Failed to fetch" — see [Translation engine](#translation-engine) below.

## Features

- **Click to translate** — click any word for a popup translation. French apostrophe words (`l'amie`, `j'ai`) and hyphenated words (`peut-être`) are recognized correctly.
- **Phrase & sentence translation** — select any span of text to translate it, or hit "Translate sentence" in the word popup.
- **Vocabulary highlighting** — words you've looked up get highlighted automatically. Mark one as "known" or clear it.
- **Reading progress** — your spot in each book is saved and restored across reloads.
- **Import** — drag in or pick an `.epub` / `.txt` file, or just paste text.
- **Local-first** — books live in IndexedDB; vocabulary, progress, and settings in localStorage. Nothing is uploaded.

## Quick start

**Just want to read?** Open the live demo above in Chrome, import a book, and go. Nothing to install.

**Run it locally** (required if you want DeepL, see below):

```bash
git clone https://github.com/Peter-awe/mot-a-mot.git
cd mot-a-mot
python3 -m http.server 8000
# then open http://localhost:8000
```

Don't open `index.html` directly as a `file://` URL — fetch and script loading break under `file://`. Use the local server.

## Translation engine

By default the app uses free, CORS-enabled endpoints and tries each in order until one answers:

1. Google `dict-chrome-ex` (same quality as Google Translate)
2. Google `gtx`
3. Lingva (open-source Google proxy, several instances)
4. MyMemory (fallback, ~5000 words/day anonymous)

If one is down, it falls through to the next.

> **Seeing "Failed to fetch"?** An ad/privacy blocker is probably blocking the translation domains, or you're on Safari with strict privacy settings. Use Chrome, or allow the site in your blocker, or run the DeepL proxy below.

### DeepL (optional, best quality)

DeepL's API doesn't send CORS headers, so a browser can't call it directly. This repo ships a tiny local proxy that fixes that.

1. Put your DeepL key in `deepl_key.txt` in the project root (one line, e.g. `xxxx:fx`). This file is `.gitignore`d and is never committed.
2. Start the proxy (pure Python standard library, nothing to `pip install`):
   ```bash
   python3 proxy/deepl_proxy.py
   ```
3. In the app's **Settings**, set **DeepL proxy address** to `http://localhost:1188` and save.

Translations then prefer DeepL and fall back to the free endpoints whenever the proxy isn't running.

> The proxy is plain HTTP on localhost, so it only works when you run the app locally (`http://localhost:8000`). The deployed HTTPS site can't call `http://localhost` (mixed content), so the live demo always uses the free endpoints. For reading and looking up words, the free quality is already good.

## Project structure

```
mot-a-mot/
├── index.html         # single page: library + reader + settings
├── style.css
├── js/
│   ├── storage.js     # IndexedDB (books) + localStorage (vocab/progress/settings)
│   ├── translate.js   # multi-endpoint fallback translation engine
│   ├── library.js     # txt/epub import & parsing
│   └── reader.js      # rendering + interaction + UI wiring
├── proxy/
│   └── deepl_proxy.py # optional local DeepL proxy
└── .nojekyll          # keeps GitHub Pages from running Jekyll (so the js/ folder is served)
```

## Privacy

- No login, no backend, no analytics.
- Your books, vocabulary, progress, and settings (including any DeepL key) stay in your browser and on your machine.
- Translation requests go straight from your browser to the translation endpoint. The app never sees them.

## Deploy your own

It's a static site, so any static host works. For GitHub Pages with the `gh` CLI:

```bash
gh repo create mot-a-mot --public --source=. --push
gh api -X POST repos/<your-username>/mot-a-mot/pages -f "source[branch]=main" -f "source[path]=/"
```

Then open `https://<your-username>.github.io/mot-a-mot/`.

## License

MIT — do whatever you like with it.
