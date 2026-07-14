/* ---------- progress photos: IndexedDB store (device-local) ------------------
 * Body-progress photos are large binaries, so they live in IndexedDB — NOT the
 * ~5 MB localStorage that holds the app state (putting images there risks the
 * quota failures that lose real data). Everything stays on the device; nothing
 * is ever uploaded. The user's originals remain in their Photos library — these
 * are just working copies for the timeline and the before/after collage.
 *
 * Each shot is tagged with an ANGLE (front / side / back) so whole-body change
 * can be compared like-for-like — the side profile is where belly fat reads
 * most dramatically. Keyed by `${date}__${pose}`.
 * -------------------------------------------------------------------------- */
const DB_NAME = 'localfit-photos'
const STORE = 'shots'
const VERSION = 2

export const POSES = [
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'back', label: 'Back' },
]

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no-indexeddb'))
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result, tx = req.transaction
      if (!db.objectStoreNames.contains(STORE)) {
        const shots = db.createObjectStore(STORE, { keyPath: 'id' })
        shots.createIndex('date', 'date')
        // Migrate v1 records (keyed by date, no angle) → treat each as a front shot.
        if (db.objectStoreNames.contains('progress')) {
          tx.objectStore('progress').openCursor().onsuccess = (ev) => {
            const cur = ev.target.result
            if (cur) {
              const r = cur.value
              shots.put({ id: `${r.date}__front`, date: r.date, pose: 'front', blob: r.blob, ts: r.ts || 0, w: r.w, h: r.h })
              cur.continue()
            } else {
              db.deleteObjectStore('progress')
            }
          }
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Store (or replace) the photo for a date + angle.
export async function putPhoto(date, pose, blob, meta = {}) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ id: `${date}__${pose}`, date, pose, blob, ts: Date.now(), ...meta })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// All shots, ascending by date.
export async function allPhotos() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const rq = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    rq.onsuccess = () => resolve((rq.result || []).sort((a, b) => a.date.localeCompare(b.date)))
    rq.onerror = () => reject(rq.error)
  })
}

export async function deletePhoto(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
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
