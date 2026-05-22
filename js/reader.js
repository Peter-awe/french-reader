/* reader.js — rendering + interaction + app wiring */
(() => {
  'use strict';

  // French tokenizer: starts with a letter; allows in-word apostrophes (l'amie, j'ai) and hyphens (peut-être)
  const WORD_RE = /[\p{L}][\p{L}'’\-]*/gu;
  const SENT_ENDERS = /[.!?…]/;

  let currentBook = null;
  let activeWordEl = null;
  let scrollSaveTimer = null;

  /* ===== DOM references ===== */
  const $ = (id) => document.getElementById(id);
  const libraryView = $('library-view');
  const readerView = $('reader-view');
  const content = $('reader-content');
  const popup = $('popup');

  /* ===== helpers ===== */
  function toast(msg, ms = 2000) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }
  function showView(which) {
    libraryView.classList.toggle('hidden', which !== 'library');
    readerView.classList.toggle('hidden', which !== 'reader');
  }

  /* ===== rendering ===== */
  function renderBook(book) {
    currentBook = book;
    $('reader-title').textContent = book.title;
    content.innerHTML = '';
    const frag = document.createDocumentFragment();
    book.text.split(/\n+/).forEach(paraText => {
      if (!paraText.trim()) return;
      const p = document.createElement('p');
      p.className = 'para';
      renderParagraph(paraText, p);
      frag.appendChild(p);
    });
    content.appendChild(frag);
    applyHighlights();
    showView('reader');
    // Restore reading progress. restoreProgress uses setTimeout polling + ResizeObserver,
    // not requestAnimationFrame (rAF is throttled or never fires in background tabs / some environments).
    restoreProgress(book.id);
  }

  function renderParagraph(text, pEl) {
    let last = 0, m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(text)) !== null) {
      if (m.index > last) pEl.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = m[0];
      pEl.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) pEl.appendChild(document.createTextNode(text.slice(last)));
  }

  function applyHighlights() {
    if (!Storage.getSetting('autoHighlight')) return;
    const words = Storage.getWords();
    content.querySelectorAll('.word').forEach(span => {
      const data = words[span.textContent.toLowerCase()];
      span.classList.remove('hl-learning', 'hl-known');
      if (data) span.classList.add('hl-' + (data.status || 'learning'));
    });
  }

  /* ===== sentence extraction ===== */
  function getSentenceAround(wordEl) {
    const pEl = wordEl.closest('.para');
    if (!pEl) return wordEl.textContent;
    const full = pEl.textContent;
    let offset = 0;
    for (const node of pEl.childNodes) {
      if (node === wordEl) break;
      offset += node.textContent.length;
    }
    let start = 0;
    for (let i = offset - 1; i >= 0; i--) {
      if (SENT_ENDERS.test(full[i])) { start = i + 1; break; }
    }
    let end = full.length;
    for (let i = offset + wordEl.textContent.length; i < full.length; i++) {
      if (SENT_ENDERS.test(full[i])) { end = i + 1; break; }
    }
    return full.slice(start, end).trim();
  }

  /* ===== popup ===== */
  function positionPopup(rect) {
    popup.classList.remove('hidden');
    const pw = popup.offsetWidth, ph = popup.offsetHeight;
    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 6;
    const vw = window.scrollX + window.innerWidth;
    if (left + pw > vw - 10) left = vw - pw - 10;
    if (left < window.scrollX + 10) left = window.scrollX + 10;
    if (rect.bottom + ph + 12 > window.innerHeight) top = rect.top + window.scrollY - ph - 6;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }

  function hidePopup() {
    popup.classList.add('hidden');
    if (activeWordEl) { activeWordEl.classList.remove('active'); activeWordEl = null; }
  }

  async function showWordPopup(wordEl) {
    if (activeWordEl) activeWordEl.classList.remove('active');
    activeWordEl = wordEl;
    wordEl.classList.add('active');
    const word = wordEl.textContent;

    $('popup-word').textContent = word;
    $('popup-sentence-trans').classList.add('hidden');
    $('popup-sentence-trans').textContent = '';
    $('popup-sentence').classList.remove('hidden');
    $('popup-known').classList.remove('hidden');
    $('popup-forget').classList.remove('hidden');

    const transEl = $('popup-trans');
    const cached = Storage.getWord(word);
    transEl.classList.add('loading');
    transEl.textContent = cached && cached.trans ? cached.trans : 'Translating…';
    positionPopup(wordEl.getBoundingClientRect());

    try {
      const trans = await Translator.translate(word);
      transEl.classList.remove('loading');
      transEl.textContent = trans;
      // mark as vocabulary + cache the translation + highlight
      if (Storage.getSetting('autoHighlight')) {
        const existing = Storage.getWord(word);
        Storage.setWord(word, { status: (existing && existing.status === 'known') ? 'known' : 'learning', trans });
        applyHighlights();
        wordEl.classList.add('active');
      } else {
        Storage.setWord(word, { trans }); // cache the translation only, don't change status
      }
      positionPopup(wordEl.getBoundingClientRect());
    } catch (e) {
      transEl.classList.remove('loading');
      transEl.textContent = '⚠️ Translation failed: ' + e.message;
    }
  }

  async function showPhrasePopup(text, rect) {
    hidePopup();
    $('popup-word').textContent = text.length > 40 ? text.slice(0, 40) + '…' : text;
    $('popup-sentence').classList.add('hidden');
    $('popup-known').classList.add('hidden');
    $('popup-forget').classList.add('hidden');
    $('popup-sentence-trans').classList.add('hidden');
    const transEl = $('popup-trans');
    transEl.classList.add('loading');
    transEl.textContent = 'Translating…';
    positionPopup(rect);
    try {
      const trans = await Translator.translate(text);
      transEl.classList.remove('loading');
      transEl.textContent = trans;
      positionPopup(rect);
    } catch (e) {
      transEl.classList.remove('loading');
      transEl.textContent = '⚠️ Translation failed: ' + e.message;
    }
  }

  /* ===== reading progress ===== */
  function currentScrollRatio() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  }
  function updateProgressUI() {
    const pct = Math.round(currentScrollRatio() * 100);
    $('progress-fill').style.width = pct + '%';
    $('reader-progress').textContent = pct + '%';
  }
  function saveProgress() {
    if (!currentBook) return;
    Storage.setBookProgress(currentBook.id, currentScrollRatio());
    updateProgressUI();
  }
  // NOTE: restore must never call saveProgress — before layout is ready it would overwrite the
  // saved position with 0. On huge documents (110k+ spans) layout can take seconds, during which
  // scrollHeight still equals the viewport height, so use a ResizeObserver to catch the moment the
  // content grows to its full height, plus a long polling fallback.
  function restoreProgress(bookId) {
    const ratio = Storage.getBookProgress(bookId);
    if (ratio <= 0) { updateProgressUI(); return; }
    let done = false, ro = null;
    const apply = () => {
      if (done) return true;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 100) {
        window.scrollTo(0, ratio * max);  // the scroll event it fires re-saves the same position 300ms later, no clobber
        updateProgressUI();
        done = true;
        if (ro) ro.disconnect();
        return true;
      }
      return false;
    };
    if (window.ResizeObserver) { ro = new ResizeObserver(apply); ro.observe(content); }
    let tries = 0;
    const poll = () => {
      if (apply() || tries++ > 150) { if (ro) ro.disconnect(); return; }
      setTimeout(poll, 100);
    };
    poll();
  }

  /* ===== library ===== */
  async function renderLibrary() {
    const list = $('book-list');
    const books = await Storage.getAllBooks();
    list.innerHTML = '';
    if (!books.length) {
      list.innerHTML = '<li class="empty-hint">Your library is empty. Import a French book to get started.</li>';
      return;
    }
    books.forEach(book => {
      const li = document.createElement('li');
      li.className = 'book-card';
      const prog = Math.round(Storage.getBookProgress(book.id) * 100);
      const words = book.text.split(/\s+/).length;
      li.innerHTML = `
        <div class="book-meta">
          <span class="book-title"></span>
          <span class="book-sub">${book.type} · ~${words.toLocaleString()} words · ${prog}% read</span>
        </div>
        <div class="book-actions">
          <button class="book-rename" title="Rename">✎</button>
          <button class="book-del" title="Delete">🗑</button>
        </div>`;
      li.querySelector('.book-title').textContent = book.title;
      li.querySelector('.book-rename').addEventListener('click', async (e) => {
        e.stopPropagation();
        const newTitle = prompt('Rename to:', book.title);
        if (newTitle && newTitle.trim()) {
          const full = await Storage.getBook(book.id);
          full.title = newTitle.trim();
          await Storage.saveBook(full);
          renderLibrary();
          toast('Renamed');
        }
      });
      li.querySelector('.book-meta').addEventListener('click', async () => {
        const full = await Storage.getBook(book.id);
        renderBook(full);
      });
      li.querySelector('.book-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${book.title}"? Your vocabulary highlights are kept.`)) {
          await Storage.deleteBook(book.id);
          renderLibrary();
          toast('Deleted');
        }
      });
      list.appendChild(li);
    });
  }

  /* ===== import handling ===== */
  async function handleFiles(files) {
    const status = $('import-status');
    for (const file of files) {
      status.textContent = `Parsing ${file.name}…`;
      try {
        const book = await Library.importFile(file);
        status.textContent = `✅ Imported "${book.title}"`;
        await renderLibrary();
      } catch (e) {
        status.textContent = `⚠️ Failed to import ${file.name}: ${e.message}`;
      }
    }
  }

  /* ===== settings ===== */
  function openSettings() {
    const s = Storage.getSettings();
    $('src-lang').value = s.srcLang;
    $('tgt-lang').value = s.tgtLang;
    $('deepl-proxy').value = s.deeplProxy;
    $('deepl-key').value = s.deeplKey;
    $('auto-highlight').checked = s.autoHighlight;
    $('settings-modal').classList.remove('hidden');
  }
  function saveSettings() {
    Storage.saveSettings({
      srcLang: $('src-lang').value,
      tgtLang: $('tgt-lang').value,
      deeplProxy: $('deepl-proxy').value.trim(),
      deeplKey: $('deepl-key').value.trim(),
      autoHighlight: $('auto-highlight').checked,
    });
    $('settings-modal').classList.add('hidden');
    if (currentBook) applyHighlights();
    toast('Settings saved');
  }

  /* ===== wiring ===== */
  function wire() {
    // top bar
    $('btn-library').addEventListener('click', () => { renderLibrary(); showView('library'); });
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-back').addEventListener('click', () => { renderLibrary(); showView('library'); });

    // import: choose file
    $('btn-choose-file').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', (e) => handleFiles(e.target.files));

    // import: drag & drop
    const dz = $('drop-zone');
    ['dragover', 'dragenter'].forEach(ev =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

    // import: paste
    $('btn-import-paste').addEventListener('click', async () => {
      const text = $('paste-text').value.trim();
      if (!text) { toast('Paste some text first'); return; }
      const book = await Library.importText($('paste-title').value, text);
      $('paste-text').value = ''; $('paste-title').value = '';
      await renderLibrary();
      toast(`Imported "${book.title}"`);
    });

    // reader interaction: a single mouseup handler (distinguishes word click vs phrase selection)
    content.addEventListener('mouseup', (e) => {
      const selText = (window.getSelection().toString() || '').trim();
      if (selText && /\s/.test(selText)) {
        showPhrasePopup(selText, getSelectionRect() || e.target.getBoundingClientRect());
        return;
      }
      const wordEl = e.target.closest('.word');
      if (wordEl) showWordPopup(wordEl);
    });

    // popup buttons
    $('popup-close').addEventListener('click', hidePopup);
    $('popup-sentence').addEventListener('click', async () => {
      if (!activeWordEl) return;
      const sentence = getSentenceAround(activeWordEl);
      const box = $('popup-sentence-trans');
      box.classList.remove('hidden');
      box.textContent = 'Translating sentence…';
      try {
        box.textContent = await Translator.translate(sentence);
      } catch (e) { box.textContent = '⚠️ ' + e.message; }
      positionPopup(activeWordEl.getBoundingClientRect());
    });
    $('popup-known').addEventListener('click', () => {
      if (!activeWordEl) return;
      Storage.setWord(activeWordEl.textContent, { status: 'known' });
      applyHighlights();
      toast('Marked as known');
    });
    $('popup-forget').addEventListener('click', () => {
      if (!activeWordEl) return;
      Storage.removeWord(activeWordEl.textContent);
      applyHighlights();
      hidePopup();
    });

    // click outside to close the popup
    document.addEventListener('mousedown', (e) => {
      if (!popup.classList.contains('hidden') &&
          !popup.contains(e.target) && !e.target.closest('.word')) hidePopup();
    });

    // settings modal
    $('btn-save-settings').addEventListener('click', saveSettings);
    $('btn-close-settings').addEventListener('click', () => $('settings-modal').classList.add('hidden'));
    $('btn-clear-words').addEventListener('click', () => {
      if (confirm('Clear all vocabulary highlights? This cannot be undone.')) {
        Storage.clearWords(); applyHighlights(); toast('Highlights cleared');
      }
    });

    // save progress on scroll (throttled)
    window.addEventListener('scroll', () => {
      if (readerView.classList.contains('hidden')) return;
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(saveProgress, 300);
    }, { passive: true });
  }

  function getSelectionRect() {
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    return (r.width || r.height) ? r : null;
  }

  /* ===== startup ===== */
  document.addEventListener('DOMContentLoaded', () => {
    wire();
    renderLibrary();
    showView('library');
  });
})();
