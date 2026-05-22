/* translate.js — 翻译引擎
   策略：若填了 DeepL key 先试 DeepL；否则/失败后按顺序 fallback 到免费端点。
   所有免费端点都选支持 CORS（浏览器可直连）的。
*/
const Translator = (() => {

  /* ---- 各端点实现：输入 (text, sl, tl)，输出 译文字符串，失败抛错 ---- */

  // 1. Google dict-chrome-ex 端点（Chrome 扩展用，原生支持 CORS，质量=Google 本体）
  async function googleDictChrome(text, sl, tl) {
    const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${sl}&tl=${tl}&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('dict-chrome ' + res.status);
    const data = await res.json();
    // 该端点返回格式有几种变体，做稳健解析：
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) {
      // 形如 [["译文","原文",...], ...] 或 ["译文","lang"]
      if (Array.isArray(data[0])) return data.map(seg => seg[0]).join('');
      if (typeof data[0] === 'string') return data[0];
    }
    if (data.sentences) return data.sentences.map(s => s.trans || '').join('');
    throw new Error('dict-chrome parse fail');
  }

  // 2. Google gtx 端点（格式确定，CORS 视情况，作为备份）
  async function googleGtx(text, sl, tl) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('gtx ' + res.status);
    const data = await res.json();
    return data[0].map(seg => seg[0]).join('');
  }

  // 3. Lingva（开源 Google 代理，支持 CORS，无日限额）
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

  // 4. MyMemory（支持 CORS，匿名 5000 词/天，质量一般，最后兜底）
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

  // DeepL（高质量，但 Free API 不支持浏览器 CORS —— 通常会失败，除非走本地代理）
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

  // DeepL via 本地代理（proxy/deepl_proxy.py）—— 绕过 CORS，key 藏在代理里
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

  // 译文缓存：同一段文字不重复请求
  const cache = new Map();

  async function translate(text, sl, tl) {
    text = (text || '').trim();
    if (!text) return '';
    sl = sl || Storage.getSetting('srcLang') || 'fr';
    tl = tl || Storage.getSetting('tgtLang') || 'en';
    const ck = `${sl}|${tl}|${text}`;
    if (cache.has(ck)) return cache.get(ck);

    const chain = [];
    // 1. 优先本地 DeepL 代理（若已填地址且代理在跑）
    const proxyUrl = (Storage.getSetting('deeplProxy') || '').trim();
    if (proxyUrl) chain.push((t, s, l) => deeplViaProxy(t, s, l, proxyUrl));
    // 2. 直连 DeepL（多半被 CORS 拦，留作高级用户的兜底）
    const deeplKey = (Storage.getSetting('deeplKey') || '').trim();
    if (deeplKey) chain.push((t, s, l) => deepl(t, s, l, deeplKey));
    // 3. 免费端点 fallback
    chain.push(...FREE_CHAIN);

    let lastErr;
    for (const fn of chain) {
      try {
        const out = await fn(text, sl, tl);
        if (out && out.trim()) { cache.set(ck, out); return out; }
      } catch (e) { lastErr = e; /* 试下一个端点 */ }
    }
    throw lastErr || new Error('所有翻译端点都失败了');
  }

  return { translate };
})();
