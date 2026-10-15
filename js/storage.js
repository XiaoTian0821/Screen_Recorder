/**
 * storage.js — IndexedDB persistence for recordings.
 *
 * Database: ScreenRecorderDB
 * Stores:
 *   - "recordings"  (keyPath "id", index on "createdAt")
 *
 * Each record holds metadata plus the recording Blob and an optional
 * thumbnail Blob so the library can survive reloads without re-encoding.
 */

const DB_NAME = 'ScreenRecorderDB';
const DB_VERSION = 1;
const STORE = 'recordings';

let dbPromise = null;

/**
 * Open (or create) the database. Returns a Promise<IDBDatabase>.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser context.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      let store = db.objectStoreNames.contains(STORE)
        ? db.transaction(STORE, 'readwrite').objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: 'id' });
      if (!store.indexNames.contains('createdAt')) {
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB.'));
  });

  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/**
 * Create or overwrite a record.
 * @param {object} record
 * @returns {Promise<void>}
 */
export async function putRecording(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
  });
}

/**
 * Fetch a single recording by id.
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export async function getRecording(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Fetch all records, sorted newest-first.
 * @returns {Promise<Array<object>>}
 */
export async function getAllRecordings() {
  const db = await openDB();
  const rows = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return rows;
}

/**
 * Rename a recording (keeps the Blob intact).
 * @param {string} id
 * @param {string} title
 * @returns {Promise<void>}
 */
export async function renameRecording(id, title) {
  const record = await getRecording(id);
  if (!record) return;
  record.title = title;
  record.updatedAt = Date.now();
  await putRecording(record);
}

/**
 * Delete a recording.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteRecording(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Delete aborted.'));
  });
}

/**
 * Persist a lightweight preferences object to LocalStorage.
 * @param {object} prefs
 */
export function savePrefs(prefs) {
  try {
    localStorage.setItem('srs_prefs', JSON.stringify(prefs));
  } catch (e) {
    // Quota or privacy-mode failure is non-fatal.
  }
}

/**
 * Read lightweight preferences from LocalStorage.
 * @returns {object|null}
 */
export function loadPrefs() {
  try {
    const raw = localStorage.getItem('srs_prefs');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
