/* library.js — 文本导入与解析
   - txt：直接读取
   - epub：本质是 zip，用 JSZip 解开，按 spine 顺序抽取正文
   - 粘贴文本
*/
const Library = (() => {

  function genId() {
    return 'book_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  async function importTxt(file) {
    const text = await file.text();
    const book = {
      id: genId(),
      title: file.name.replace(/\.txt$/i, ''),
      type: 'txt',
      text: normalize(text),
      addedAt: Date.now(),
    };
    await Storage.saveBook(book);
    return book;
  }

  async function importEpub(file) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip 未加载（检查网络/CDN）');
    const zip = await JSZip.loadAsync(file);
    const parser = new DOMParser();

    // 1. META-INF/container.xml → 找到 .opf 路径
    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) throw new Error('不是有效的 epub（缺 container.xml）');
    const containerXml = await containerFile.async('string');
    const cdoc = parser.parseFromString(containerXml, 'application/xml');
    const rootfile = cdoc.querySelector('rootfile');
    const opfPath = rootfile && rootfile.getAttribute('full-path');
    if (!opfPath) throw new Error('epub 缺少 OPF 路径');
    const opfDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]*$/, '/') : '';

    // 2. 解析 .opf：manifest（id→href）+ spine（阅读顺序）+ 标题
    const opfXml = await zip.file(opfPath).async('string');
    const opf = parser.parseFromString(opfXml, 'application/xml');

    const manifest = {};
    opf.querySelectorAll('manifest > item').forEach(item => {
      manifest[item.getAttribute('id')] = item.getAttribute('href');
    });

    // dc:title 带命名空间，用 NS 感知查询（querySelector('title') 匹配不到 dc:title）
    const titleEls = opf.getElementsByTagNameNS('*', 'title');
    let title = (titleEls.length && titleEls[0].textContent.trim())
      || file.name.replace(/\.epub$/i, '');

    const spine = [...opf.querySelectorAll('spine > itemref')]
      .map(ir => ir.getAttribute('idref'));

    // 3. 按 spine 顺序读每个章节文件，去标签取正文
    const chapters = [];
    for (const idref of spine) {
      let href = manifest[idref];
      if (!href) continue;
      href = decodeURIComponent(href.split('#')[0]);
      const f = zip.file(opfDir + href) || zip.file(href);
      if (!f) continue;
      const html = await f.async('string');
      const doc = parser.parseFromString(html, 'text/html');
      doc.querySelectorAll('script, style').forEach(n => n.remove());
      // 用块级换行保留段落感
      doc.querySelectorAll('p, br, div, h1, h2, h3, h4, li').forEach(n => {
        n.appendChild(document.createTextNode('\n'));
      });
      const raw = (doc.body ? doc.body.textContent : doc.textContent) || '';
      const clean = normalize(raw);
      if (clean) chapters.push(clean);
    }
    if (!chapters.length) throw new Error('epub 解析后没有正文（可能是加密/DRM）');

    const book = {
      id: genId(),
      title,
      type: 'epub',
      text: chapters.join('\n\n'),
      addedAt: Date.now(),
    };
    await Storage.saveBook(book);
    return book;
  }

  async function importFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.epub')) return importEpub(file);
    return importTxt(file); // .txt 及其他纯文本
  }

  async function importText(title, text) {
    const book = {
      id: genId(),
      title: (title || '').trim() || '未命名 · ' + new Date().toLocaleDateString(),
      type: 'paste',
      text: normalize(text),
      addedAt: Date.now(),
    };
    await Storage.saveBook(book);
    return book;
  }

  // 规整空白：逐行 trim + 压缩行内制表符/不间断空格，3+ 空行压成 2
  function normalize(text) {
    return text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(line => line.replace(/[ \t   ]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return { importFile, importText, importEpub, importTxt };
})();
