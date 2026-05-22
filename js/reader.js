/* reader.js — 渲染 + 交互 + 应用接线 */
(() => {
  'use strict';

  // 法语分词：字母开头，词内允许撇号(l'amie, j'ai)和连字符(peut-être)
  const WORD_RE = /[\p{L}][\p{L}'’\-]*/gu;
  const SENT_ENDERS = /[.!?…]/;

  let currentBook = null;
  let activeWordEl = null;
  let scrollSaveTimer = null;

  /* ===== DOM 引用 ===== */
  const $ = (id) => document.getElementById(id);
  const libraryView = $('library-view');
  const readerView = $('reader-view');
  const content = $('reader-content');
  const popup = $('popup');

  /* ===== 工具 ===== */
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

  /* ===== 渲染 ===== */
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
    // 恢复阅读进度（restoreProgress 内部用 setTimeout 轮询 + ResizeObserver，
    // 不依赖 requestAnimationFrame —— 后台标签页/部分环境下 rAF 会被节流甚至不触发）
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

  /* ===== 句子提取 ===== */
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

  /* ===== 弹窗 ===== */
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
    transEl.textContent = cached && cached.trans ? cached.trans : '翻译中…';
    positionPopup(wordEl.getBoundingClientRect());

    try {
      const trans = await Translator.translate(word);
      transEl.classList.remove('loading');
      transEl.textContent = trans;
      // 记为生词 + 缓存译文 + 高亮
      if (Storage.getSetting('autoHighlight')) {
        const existing = Storage.getWord(word);
        Storage.setWord(word, { status: (existing && existing.status === 'known') ? 'known' : 'learning', trans });
        applyHighlights();
        wordEl.classList.add('active');
      } else {
        Storage.setWord(word, { trans }); // 仅缓存译文，不改状态
      }
      positionPopup(wordEl.getBoundingClientRect());
    } catch (e) {
      transEl.classList.remove('loading');
      transEl.textContent = '⚠️ 翻译失败：' + e.message;
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
    transEl.textContent = '翻译中…';
    positionPopup(rect);
    try {
      const trans = await Translator.translate(text);
      transEl.classList.remove('loading');
      transEl.textContent = trans;
      positionPopup(rect);
    } catch (e) {
      transEl.classList.remove('loading');
      transEl.textContent = '⚠️ 翻译失败：' + e.message;
    }
  }

  /* ===== 阅读进度 ===== */
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
  // 注意：restore 绝不能调用 saveProgress，否则布局未就绪时会把已存进度覆盖成 0。
  // 超大文档（11 万 span）布局可能要几秒，scrollHeight 在此之前等于视口高度，
  // 因此用 ResizeObserver 精确捕捉内容高度增长的时刻，再加长轮询兜底。
  function restoreProgress(bookId) {
    const ratio = Storage.getBookProgress(bookId);
    if (ratio <= 0) { updateProgressUI(); return; }
    let done = false, ro = null;
    const apply = () => {
      if (done) return true;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 100) {
        window.scrollTo(0, ratio * max);  // 触发的 scroll 事件 300ms 后存回同位置，不覆盖
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

  /* ===== 书库 ===== */
  async function renderLibrary() {
    const list = $('book-list');
    const books = await Storage.getAllBooks();
    list.innerHTML = '';
    if (!books.length) {
      list.innerHTML = '<li class="empty-hint">书库还是空的，导入一本法语小说开始吧。</li>';
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
          <span class="book-sub">${book.type} · 约 ${words.toLocaleString()} 词 · 已读 ${prog}%</span>
        </div>
        <div class="book-actions">
          <button class="book-rename" title="重命名">✎</button>
          <button class="book-del" title="删除">🗑</button>
        </div>`;
      li.querySelector('.book-title').textContent = book.title;
      li.querySelector('.book-rename').addEventListener('click', async (e) => {
        e.stopPropagation();
        const newTitle = prompt('重命名为：', book.title);
        if (newTitle && newTitle.trim()) {
          const full = await Storage.getBook(book.id);
          full.title = newTitle.trim();
          await Storage.saveBook(full);
          renderLibrary();
          toast('已重命名');
        }
      });
      li.querySelector('.book-meta').addEventListener('click', async () => {
        const full = await Storage.getBook(book.id);
        renderBook(full);
      });
      li.querySelector('.book-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`删除《${book.title}》？生词记录会保留。`)) {
          await Storage.deleteBook(book.id);
          renderLibrary();
          toast('已删除');
        }
      });
      list.appendChild(li);
    });
  }

  /* ===== 导入处理 ===== */
  async function handleFiles(files) {
    const status = $('import-status');
    for (const file of files) {
      status.textContent = `正在解析 ${file.name} …`;
      try {
        const book = await Library.importFile(file);
        status.textContent = `✅ 已导入《${book.title}》`;
        await renderLibrary();
      } catch (e) {
        status.textContent = `⚠️ ${file.name} 导入失败：${e.message}`;
      }
    }
  }

  /* ===== 设置 ===== */
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
    toast('设置已保存');
  }

  /* ===== 接线 ===== */
  function wire() {
    // 顶栏
    $('btn-library').addEventListener('click', () => { renderLibrary(); showView('library'); });
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-back').addEventListener('click', () => { renderLibrary(); showView('library'); });

    // 导入：选择文件
    $('btn-choose-file').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', (e) => handleFiles(e.target.files));

    // 导入：拖拽
    const dz = $('drop-zone');
    ['dragover', 'dragenter'].forEach(ev =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

    // 导入：粘贴
    $('btn-import-paste').addEventListener('click', async () => {
      const text = $('paste-text').value.trim();
      if (!text) { toast('请先粘贴文本'); return; }
      const book = await Library.importText($('paste-title').value, text);
      $('paste-text').value = ''; $('paste-title').value = '';
      await renderLibrary();
      toast(`已导入《${book.title}》`);
    });

    // 阅读区交互：mouseup 统一处理（区分单词点击 vs 短语选择）
    content.addEventListener('mouseup', (e) => {
      const selText = (window.getSelection().toString() || '').trim();
      if (selText && /\s/.test(selText)) {
        showPhrasePopup(selText, getSelectionRect() || e.target.getBoundingClientRect());
        return;
      }
      const wordEl = e.target.closest('.word');
      if (wordEl) showWordPopup(wordEl);
    });

    // 弹窗按钮
    $('popup-close').addEventListener('click', hidePopup);
    $('popup-sentence').addEventListener('click', async () => {
      if (!activeWordEl) return;
      const sentence = getSentenceAround(activeWordEl);
      const box = $('popup-sentence-trans');
      box.classList.remove('hidden');
      box.textContent = '整句翻译中…';
      try {
        box.textContent = await Translator.translate(sentence);
      } catch (e) { box.textContent = '⚠️ ' + e.message; }
      positionPopup(activeWordEl.getBoundingClientRect());
    });
    $('popup-known').addEventListener('click', () => {
      if (!activeWordEl) return;
      Storage.setWord(activeWordEl.textContent, { status: 'known' });
      applyHighlights();
      toast('已标记为掌握');
    });
    $('popup-forget').addEventListener('click', () => {
      if (!activeWordEl) return;
      Storage.removeWord(activeWordEl.textContent);
      applyHighlights();
      hidePopup();
    });

    // 点空白处关闭弹窗
    document.addEventListener('mousedown', (e) => {
      if (!popup.classList.contains('hidden') &&
          !popup.contains(e.target) && !e.target.closest('.word')) hidePopup();
    });

    // 设置弹窗
    $('btn-save-settings').addEventListener('click', saveSettings);
    $('btn-close-settings').addEventListener('click', () => $('settings-modal').classList.add('hidden'));
    $('btn-clear-words').addEventListener('click', () => {
      if (confirm('清空所有生词高亮？此操作不可撤销。')) {
        Storage.clearWords(); applyHighlights(); toast('已清空生词');
      }
    });

    // 滚动保存进度（节流）
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

  /* ===== 启动 ===== */
  document.addEventListener('DOMContentLoaded', () => {
    wire();
    renderLibrary();
    showView('library');
  });
})();
