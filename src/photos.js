/* ---------- progress photos: IndexedDB store (device-local) ------------------
 * Body-progress photos are large binaries, so they live in IndexedDB — NOT the
 * ~5 MB localStorage that holds the app state (putting images there risks the
 * quota failures that lose real data). Everything stays on the device; nothing
 * is ever uploaded. The user's originals remain in their Photos library — these
 * are just working copies for the timeline and the before/after collage.
 * -------------------------------------------------------------------------- */
const DB_NAME = 'localfit-photos'
const STORE = 'progress'
const VERSION = 1

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no-indexeddb'))
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'date' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Store (or replace) the photo for a given ISO date. `blob` is the compressed
// image; meta carries width/height for aspect handling.
export async function putPhoto(date, blob, meta = {}) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ date, blob, ts: Date.now(), ...meta })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getPhoto(date) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(date)
    rq.onsuccess = () => resolve(rq.result || null)
    rq.onerror = () => reject(rq.error)
  })
}

// All photos, ascending by date.
export async function allPhotos() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const rq = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    rq.onsuccess = () => resolve((rq.result || []).sort((a, b) => a.date.localeCompare(b.date)))
    rq.onerror = () => reject(rq.error)
  })
}

export async function deletePhoto(date) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(date)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// Downscale a picked file to a sane max dimension + JPEG quality, so the store
// stays light (a full iPhone photo is ~4 MB; this lands ~150–400 KB).
export function compressImage(file, max = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      c.getContext('2d').drawImage(img, 0, 0, w, h)
      c.toBlob((blob) => (blob ? resolve({ blob, w, h }) : reject(new Error('encode-failed'))), 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode-failed')) }
    img.src = url
  })
}
