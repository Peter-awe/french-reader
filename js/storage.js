/* storage.js — persistence layer
   - book text (large) → IndexedDB (localStorage's ~5MB cap can't hold novels)
   - vocabulary / reading progress / settings (small) → localStorage
*/
const Storage = (() => {
  const DB_NAME = 'frenchReaderDB';
  const DB_VERSION = 1;
  const BOOK_STORE = 'books';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(BOOK_STORE)) {
          db.createObjectStore(BOOK_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function saveBook(book) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BOOK_STORE, 'readwrite');
      tx.objectStore(BOOK_STORE).put(book);
      tx.oncomplete = () => resolve(book.id);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getBook(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BOOK_STORE, 'readonly');
      const req = tx.objectStore(BOOK_STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllBooks() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BOOK_STORE, 'readonly');
      const req = tx.objectStore(BOOK_STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.addedAt - a.addedAt));
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteBook(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BOOK_STORE, 'readwrite');
      tx.objectStore(BOOK_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ---------- localStorage helpers ---------- */
  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
  }
  function writeJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  /* ---------- settings ---------- */
  const SETTINGS_KEY = 'fr_settings';
  const DEFAULT_SETTINGS = { srcLang: 'fr', tgtLang: 'en', deeplKey: '', deeplProxy: '', autoHighlight: true };
  function getSettings() { return Object.assign({}, DEFAULT_SETTINGS, readJSON(SETTINGS_KEY, {})); }
  function getSetting(k) { return getSettings()[k]; }
  function setSetting(k, v) { const s = getSettings(); s[k] = v; writeJSON(SETTINGS_KEY, s); }
  function saveSettings(obj) { writeJSON(SETTINGS_KEY, Object.assign(getSettings(), obj)); }

  /* ---------- vocabulary (highlight state) ---------- */
  // shape: { "mot": { status: 'learning'|'known', trans: '...', ts } }
  const WORDS_KEY = 'fr_words';
  function getWords() { return readJSON(WORDS_KEY, {}); }
  function getWord(w) { return getWords()[w.toLowerCase()] || null; }
  function setWord(w, data) {
    const words = getWords();
    const key = w.toLowerCase();
    words[key] = Object.assign({}, words[key], data, { ts: Date.now() });
    writeJSON(WORDS_KEY, words);
  }
  function removeWord(w) {
    const words = getWords();
    delete words[w.toLowerCase()];
    writeJSON(WORDS_KEY, words);
  }
  function clearWords() { writeJSON(WORDS_KEY, {}); }

  /* ---------- reading progress (0–1 ratio) ---------- */
  const PROGRESS_KEY = 'fr_progress';
  function getBookProgress(bookId) { return readJSON(PROGRESS_KEY, {})[bookId] || 0; }
  function setBookProgress(bookId, ratio) {
    const p = readJSON(PROGRESS_KEY, {}); p[bookId] = ratio; writeJSON(PROGRESS_KEY, p);
  }

  return {
    saveBook, getBook, getAllBooks, deleteBook,
    getSettings, getSetting, setSetting, saveSettings,
    getWords, getWord, setWord, removeWord, clearWords,
    getBookProgress, setBookProgress,
  };
})();
