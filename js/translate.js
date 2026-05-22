/* translate.js — translation engine
   Strategy: if a DeepL key/proxy is set, try DeepL first; otherwise (or on failure)
   fall back through the free endpoints in order.
   Every free endpoint is one that supports CORS (callable directly from the browser).
*/
const Translator = (() => {

  /* ---- Endpoint implementations: take (text, sl, tl), return a translation string, throw on failure ---- */

  // 1. Google dict-chrome-ex endpoint (used by the Chrome extension; native CORS; same quality as Google Translate)
  async function googleDictChrome(text, sl, tl) {
    const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${sl}&tl=${tl}&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('dict-chrome ' + res.status);
    const data = await res.json();
    // This endpoint's response comes in a few shapes; parse defensively:
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) {
      // like [["translation","original",...], ...] or ["translation","lang"]
      if (Array.isArray(data[0])) return data.map(seg => seg[0]).join('');
      if (typeof data[0] === 'string') return data[0];
    }
    if (data.sentences) return data.sentences.map(s => s.trans || '').join('');
    throw new Error('dict-chrome parse fail');
  }

  // 2. Google gtx endpoint (well-defined format, CORS varies; used as a backup)
  async function googleGtx(text, sl, tl) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('gtx ' + res.status);
    const data = await res.json();
    return data[0].map(seg => seg[0]).join('');
  }

  // 3. Lingva (open-source Google proxy, CORS-enabled, no daily cap)
  async function lingva(text, sl, tl) {
    const bases = ['https://lingva.ml', 'https://translate.plausibility.cloud', 'https://lingva.lunar.icu'];
    let lastErr;
    for (const base of bases) {
      try {
        const url = `${base}/api/v1/${sl}/${tl}/${encodeURIComponent(text)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('lingva ' + res.status);
        const data = await res.json();
        if (data.translation) return data.translation;
        throw new Error('lingva empty');
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('lingva all instances down');
  }

  // 4. MyMemory (CORS-enabled, ~5000 words/day anonymous, average quality, last-resort fallback)
  async function myMemory(text, sl, tl) {
    const langpair = `${sl === 'auto' ? 'fr' : sl}|${tl}`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('mymemory ' + res.status);
    const data = await res.json();
    if (data.responseStatus && data.responseStatus !== 200)
      throw new Error('mymemory ' + data.responseStatus + ' ' + (data.responseDetails || ''));
    return data.responseData.translatedText;
  }

  // DeepL (high quality, but the Free API has no browser CORS — usually fails unless behind a local proxy)
  async function deepl(text, sl, tl, key) {
    const endpoint = key.endsWith(':fx')
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';
    const body = new URLSearchParams();
    body.set('text', text);
    if (sl && sl !== 'auto') body.set('source_lang', sl.toUpperCase());
    body.set('target_lang', tl.toUpperCase());
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': 'DeepL-Auth-Key ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error('deepl ' + res.status);
    const data = await res.json();
    return data.translations[0].text;
  }

  // DeepL via the local proxy (proxy/deepl_proxy.py) — works around CORS; the key stays in the proxy
  async function deeplViaProxy(text, sl, tl, proxyUrl) {
    const body = new URLSearchParams();
    body.set('text', text);
    if (sl && sl !== 'auto') body.set('source_lang', sl.toUpperCase());
    body.set('target_lang', tl.toUpperCase());
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error('deepl-proxy ' + res.status);
    const data = await res.json();
    if (!data.translations) throw new Error('deepl-proxy: ' + (data.error || 'bad response'));
    return data.translations[0].text;
  }

  const FREE_CHAIN = [googleDictChrome, googleGtx, lingva, myMemory];

  // Translation cache: never re-request the same text
  const cache = new Map();

  async function translate(text, sl, tl) {
    text = (text || '').trim();
    if (!text) return '';
    sl = sl || Storage.getSetting('srcLang') || 'fr';
    tl = tl || Storage.getSetting('tgtLang') || 'en';
    const ck = `${sl}|${tl}|${text}`;
    if (cache.has(ck)) return cache.get(ck);

    const chain = [];
    // 1. Prefer the local DeepL proxy (if an address is set and the proxy is running)
    const proxyUrl = (Storage.getSetting('deeplProxy') || '').trim();
    if (proxyUrl) chain.push((t, s, l) => deeplViaProxy(t, s, l, proxyUrl));
    // 2. Direct DeepL (usually blocked by CORS; kept as a fallback for advanced users)
    const deeplKey = (Storage.getSetting('deeplKey') || '').trim();
    if (deeplKey) chain.push((t, s, l) => deepl(t, s, l, deeplKey));
    // 3. Free-endpoint fallback
    chain.push(...FREE_CHAIN);

    let lastErr;
    for (const fn of chain) {
      try {
        const out = await fn(text, sl, tl);
        if (out && out.trim()) { cache.set(ck, out); return out; }
      } catch (e) { lastErr = e; /* try the next endpoint */ }
    }
    throw lastErr || new Error('All translation endpoints failed');
  }

  return { translate };
})();
