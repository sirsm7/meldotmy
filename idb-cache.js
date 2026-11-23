(function () {
  "use strict";

  const DB_NAME = "meldotmy_portal_cache";
  const DB_VERSION = 1;
  const STORES = Object.freeze(["meldotmy_sekolah", "meldotmy_stats"]);
  const DEFAULT_TTL_MS = 5 * 60 * 1000;

  if (!window.__memoryCache || typeof window.__memoryCache !== "object") {
    window.__memoryCache = {};
  }

  let dbPromise = null;
  let idbAvailable = typeof window.indexedDB !== "undefined" && window.indexedDB !== null;
  const inFlightRevalidations = new Map();

  function getMemoryStore(storeName) {
    if (!window.__memoryCache[storeName]) {
      window.__memoryCache[storeName] = Object.create(null);
    }
    return window.__memoryCache[storeName];
  }

  function openDatabase() {
    if (!idbAvailable) {
      return Promise.resolve(null);
    }
    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise(function (resolve) {
      let request;
      try {
        request = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (_) {
        idbAvailable = false;
        dbPromise = null;
        resolve(null);
        return;
      }

      request.onupgradeneeded = function (event) {
        const db = event.target.result;
        for (let i = 0; i < STORES.length; i += 1) {
          const storeName = STORES[i];
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: "key" });
          }
        }
      };

      request.onsuccess = function (event) {
        const db = event.target.result;
        db.onversionchange = function () {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = function () {
        idbAvailable = false;
        dbPromise = null;
        resolve(null);
      };

      request.onblocked = function () {
        idbAvailable = false;
        dbPromise = null;
        resolve(null);
      };
    });

    return dbPromise;
  }

  async function readRecord(storeName, key) {
    const memStore = getMemoryStore(storeName);
    const db = await openDatabase();

    if (!db) {
      return memStore[key] || null;
    }

    return new Promise(function (resolve) {
      try {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const req = store.get(key);

        req.onsuccess = function () {
          const record = req.result || null;
          if (record) {
            memStore[key] = record;
          }
          resolve(record || memStore[key] || null);
        };

        req.onerror = function () {
          resolve(memStore[key] || null);
        };
      } catch (_) {
        resolve(memStore[key] || null);
      }
    });
  }

  async function writeRecord(storeName, key, data, ttlMs) {
    const now = Date.now();
    const effectiveTtl = typeof ttlMs === "number" && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
    const record = {
      key: String(key),
      data: data,
      cachedAt: now,
      expiresAt: now + effectiveTtl
    };

    const memStore = getMemoryStore(storeName);
    memStore[record.key] = record;

    const db = await openDatabase();
    if (!db) {
      return record;
    }

    return new Promise(function (resolve) {
      try {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        store.put(record);

        tx.oncomplete = function () {
          resolve(record);
        };

        tx.onerror = function () {
          resolve(record);
        };
      } catch (_) {
        resolve(record);
      }
    });
  }

  async function removeRecord(storeName, key) {
    const normalizedKey = String(key);
    const memStore = getMemoryStore(storeName);
    delete memStore[normalizedKey];

    const db = await openDatabase();
    if (!db) {
      return;
    }

    return new Promise(function (resolve) {
      try {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        store.delete(normalizedKey);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          resolve();
        };
      } catch (_) {
        resolve();
      }
    });
  }

  async function clearStore(storeName) {
    window.__memoryCache[storeName] = Object.create(null);

    const db = await openDatabase();
    if (!db) {
      return;
    }

    return new Promise(function (resolve) {
      try {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        store.clear();
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          resolve();
        };
      } catch (_) {
        resolve();
      }
    });
  }

  async function revalidateEntry(storeName, key, fetcherFn, ttlMs, onUpdate) {
    const inflightKey = storeName + "::" + String(key);
    if (inFlightRevalidations.has(inflightKey)) {
      return inFlightRevalidations.get(inflightKey);
    }

    const task = (async function () {
      try {
        if (window.ENV_READY) {
          await window.ENV_READY;
        }
        const freshData = await fetcherFn();
        await writeRecord(storeName, key, freshData, ttlMs);
        if (typeof onUpdate === "function") {
          onUpdate(freshData);
        }
        return freshData;
      } finally {
        inFlightRevalidations.delete(inflightKey);
      }
    })();

    inFlightRevalidations.set(inflightKey, task);
    return task;
  }

  async function getWithSWR(storeName, key, fetcherFn, options) {
    if (STORES.indexOf(storeName) === -1) {
      throw new Error("Stor cache tidak berdaftar: " + storeName);
    }

    const opts = options && typeof options === "object" ? options : {};
    const ttlMs = typeof opts.ttlMs === "number" ? opts.ttlMs : DEFAULT_TTL_MS;
    const forceRefresh = Boolean(opts.forceRefresh);
    const onUpdate = typeof opts.onUpdate === "function" ? opts.onUpdate : null;

    if (forceRefresh) {
      const fresh = await revalidateEntry(storeName, key, fetcherFn, ttlMs, null);
      return {
        data: fresh,
        source: "network",
        stale: false
      };
    }

    const existing = await readRecord(storeName, String(key));
    const now = Date.now();

    if (existing && typeof existing.data !== "undefined") {
      const isExpired = now >= existing.expiresAt;
      if (isExpired && typeof fetcherFn === "function") {
        revalidateEntry(storeName, key, fetcherFn, ttlMs, onUpdate).catch(function () {});
      }
      return {
        data: existing.data,
        source: idbAvailable ? "indexeddb" : "memory",
        stale: isExpired
      };
    }

    if (typeof fetcherFn !== "function") {
      return {
        data: null,
        source: "none",
        stale: false
      };
    }

    const initialData = await revalidateEntry(storeName, key, fetcherFn, ttlMs, null);
    return {
      data: initialData,
      source: "network",
      stale: false
    };
  }

  async function clearAll() {
    for (let i = 0; i < STORES.length; i += 1) {
      await clearStore(STORES[i]);
    }
  }

  const api = Object.freeze({
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORES: STORES,
    getWithSWR: getWithSWR,
    get: readRecord,
    set: writeRecord,
    invalidateKey: removeRecord,
    invalidateStore: clearStore,
    clearAll: clearAll,
    isIndexedDBAvailable: function () {
      return idbAvailable;
    }
  });

  window.IDBCache = api;
  window.cacheService = api;
})();