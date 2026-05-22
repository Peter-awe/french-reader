/* library.js — text import & parsing
   - txt: read directly
   - epub: it's essentially a zip; open with JSZip and pull the body text in spine order
   - pasted text
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
    if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded (check your network/CDN)');
    const zip = await JSZip.loadAsync(file);
    const parser = new DOMParser();

    // 1. META-INF/container.xml → locate the .opf path
    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) throw new Error('Not a valid epub (missing container.xml)');
    const containerXml = await containerFile.async('string');
    const cdoc = parser.parseFromString(containerXml, 'application/xml');
    const rootfile = cdoc.querySelector('rootfile');
    const opfPath = rootfile && rootfile.getAttribute('full-path');
    if (!opfPath) throw new Error('epub is missing the OPF path');
    const opfDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]*$/, '/') : '';

    // 2. parse the .opf: manifest (id→href) + spine (reading order) + title
    const opfXml = await zip.file(opfPath).async('string');
    const opf = parser.parseFromString(opfXml, 'application/xml');

    const manifest = {};
    opf.querySelectorAll('manifest > item').forEach(item => {
      manifest[item.getAttribute('id')] = item.getAttribute('href');
    });

    // dc:title is namespaced; use a namespace-aware lookup (querySelector('title') won't match dc:title)
    const titleEls = opf.getElementsByTagNameNS('*', 'title');
    let title = (titleEls.length && titleEls[0].textContent.trim())
      || file.name.replace(/\.epub$/i, '');

    const spine = [...opf.querySelectorAll('spine > itemref')]
      .map(ir => ir.getAttribute('idref'));

    // 3. read each chapter file in spine order, strip tags, keep the text
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
      // insert newlines at block elements to preserve paragraph breaks
      doc.querySelectorAll('p, br, div, h1, h2, h3, h4, li').forEach(n => {
        n.appendChild(document.createTextNode('\n'));
      });
      const raw = (doc.body ? doc.body.textContent : doc.textContent) || '';
      const clean = normalize(raw);
      if (clean) chapters.push(clean);
    }
    if (!chapters.length) throw new Error('No text found after parsing the epub (it may be encrypted/DRM)');

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
    return importTxt(file); // .txt and other plain text
  }

  async function importText(title, text) {
    const book = {
      id: genId(),
      title: (title || '').trim() || 'Untitled · ' + new Date().toLocaleDateString(),
      type: 'paste',
      text: normalize(text),
      addedAt: Date.now(),
    };
    await Storage.saveBook(book);
    return book;
  }

  // Normalize whitespace: trim each line, collapse inline tabs/non-breaking spaces, 3+ blank lines → 2
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
