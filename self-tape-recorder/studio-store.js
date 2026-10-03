/**
 * Keeps My Scripts and My Videos on the device, in IndexedDB. Videos are
 * stored as files (Blobs), so they're still there after a reload, with no
 * upload needed.
 *
 *   const store = openStudioStore('self-tape-studio');
 *   await store.videos.put({ id, blob, ... });
 *   const videos = await store.videos.all();
 */
const VERSION = 1;

export function openStudioStore(name = 'self-tape-studio') {
  let database = null;
  const open = () =>
    (database ??= new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error("This browser can't save scripts and videos on the device."));
        return;
      }
      const request = indexedDB.open(name, VERSION);
      request.onupgradeneeded = () => {
        for (const store of ['scripts', 'videos']) {
          if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Couldn't open this device's storage."));
      request.onblocked = () => reject(new Error('Close any other tabs with this page open, then try again.'));
    }));

  const run = async (store, mode, action) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = action(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(friendlyError(transaction.error));
      transaction.onabort = () => reject(friendlyError(transaction.error));
    });
  };

  const collection = (store) => ({
    all: () => run(store, 'readonly', (objects) => objects.getAll()),
    get: (id) => run(store, 'readonly', (objects) => objects.get(id)),
    put: (record) => run(store, 'readwrite', (objects) => objects.put(record)),
    delete: (id) => run(store, 'readwrite', (objects) => objects.delete(id)),
  });

  return { scripts: collection('scripts'), videos: collection('videos') };
}

function friendlyError(error) {
  if (error?.name === 'QuotaExceededError') {
    return new Error('This device is out of space for videos. Share or download the ones you want, then delete some.');
  }
  return error ?? new Error("Couldn't save on this device.");
}
