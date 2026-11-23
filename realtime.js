(function () {
  "use strict";

  const CHANNEL_NAME = "meldotmy-public-sync";
  const TARGET_TABLES = Object.freeze(["meldotmy_pengguna", "meldotmy_sekolah"]);
  const MAX_TRACKED_RECORDS = 500;

  let supabaseRef = null;
  let activeChannel = null;
  let subscribePromise = null;
  let lifecycleBound = false;
  let currentStatus = "idle";

  const timestampRegistry = new Map();
  const penggunaListeners = new Set();
  const sekolahListeners = new Set();
  const syncListeners = new Set();
  const statusListeners = new Set();

  function setStatus(nextStatus) {
    if (currentStatus === nextStatus) {
      return;
    }
    currentStatus = nextStatus;
    statusListeners.forEach(function (listener) {
      try {
        listener(nextStatus);
      } catch (_) {}
    });
  }

  function buildRegistryKey(tableName, record) {
    if (!record || typeof record !== "object") {
      return null;
    }
    const identifier = record.id !== undefined && record.id !== null
      ? String(record.id)
      : record.username !== undefined && record.username !== null
        ? String(record.username)
        : record.nama_sekolah !== undefined && record.nama_sekolah !== null
          ? String(record.nama_sekolah)
          : null;
    if (!identifier) {
      return null;
    }
    return tableName + "::" + identifier;
  }

  function parseTimestampValue(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  }

  function trackRecord(tableName, record) {
    const key = buildRegistryKey(tableName, record);
    if (!key) {
      return;
    }
    if (record && Object.prototype.hasOwnProperty.call(record, "updated_at") && record.updated_at) {
      if (timestampRegistry.size >= MAX_TRACKED_RECORDS && !timestampRegistry.has(key)) {
        const oldestKey = timestampRegistry.keys().next().value;
        if (oldestKey) {
          timestampRegistry.delete(oldestKey);
        }
      }
      timestampRegistry.set(key, record.updated_at);
    }
  }

  function passesTimestampGuard(tableName, incomingRecord) {
    if (!incomingRecord || typeof incomingRecord !== "object") {
      return true;
    }
    const hasIncomingUpdatedAt = Object.prototype.hasOwnProperty.call(incomingRecord, "updated_at") &&
      incomingRecord.updated_at !== null &&
      incomingRecord.updated_at !== undefined;

    if (!hasIncomingUpdatedAt) {
      return true;
    }

    const key = buildRegistryKey(tableName, incomingRecord);
    if (!key || !timestampRegistry.has(key)) {
      trackRecord(tableName, incomingRecord);
      return true;
    }

    const cachedRaw = timestampRegistry.get(key);
    const incomingMs = parseTimestampValue(incomingRecord.updated_at);
    const cachedMs = parseTimestampValue(cachedRaw);

    if (incomingMs === null || cachedMs === null) {
      trackRecord(tableName, incomingRecord);
      return true;
    }

    if (incomingMs >= cachedMs) {
      timestampRegistry.set(key, incomingRecord.updated_at);
      return true;
    }

    return false;
  }

  function notifySyncRequired(reason) {
    syncListeners.forEach(function (listener) {
      try {
        listener(reason);
      } catch (_) {}
    });
  }

  async function invalidateCacheForTable(tableName) {
    const cache = window.IDBCache || window.cacheService;
    if (!cache || typeof cache.invalidateStore !== "function") {
      return;
    }
    try {
      if (tableName === "meldotmy_pengguna") {
        await cache.invalidateStore("meldotmy_stats");
      } else if (tableName === "meldotmy_sekolah") {
        await cache.invalidateStore("meldotmy_sekolah");
        await cache.invalidateStore("meldotmy_stats");
      }
    } catch (_) {}
  }

  async function handlePostgresChange(tableName, payload) {
    const eventType = payload && payload.eventType ? payload.eventType : "UPDATE";
    const newRecord = payload && payload.new ? payload.new : null;
    const oldRecord = payload && payload.old ? payload.old : null;

    if (eventType === "DELETE") {
      const delKey = buildRegistryKey(tableName, oldRecord);
      if (delKey) {
        timestampRegistry.delete(delKey);
      }
    } else if (!passesTimestampGuard(tableName, newRecord)) {
      return;
    }

    await invalidateCacheForTable(tableName);

    const changeEvent = {
      table: tableName,
      eventType: eventType,
      newRecord: newRecord,
      oldRecord: oldRecord
    };

    if (tableName === "meldotmy_pengguna") {
      penggunaListeners.forEach(function (listener) {
        try {
          listener(changeEvent);
        } catch (_) {}
      });
    } else if (tableName === "meldotmy_sekolah") {
      sekolahListeners.forEach(function (listener) {
        try {
          listener(changeEvent);
        } catch (_) {}
      });
    }

    notifySyncRequired("realtime:" + tableName);
  }

  async function teardownChannel() {
    const channelToRemove = activeChannel;
    activeChannel = null;
    subscribePromise = null;

    if (channelToRemove && supabaseRef && typeof supabaseRef.removeChannel === "function") {
      try {
        await supabaseRef.removeChannel(channelToRemove);
      } catch (_) {}
    }
    setStatus("disconnected");
  }

  function isChannelHealthy() {
    if (!activeChannel) {
      return false;
    }
    return activeChannel.state === "joined" || activeChannel.state === "joining";
  }

  async function subscribe() {
    if (subscribePromise) {
      return subscribePromise;
    }

    subscribePromise = (async function () {
      try {
        if (window.ENV_READY) {
          await window.ENV_READY;
        }
        if (typeof window.getSupabaseClient !== "function") {
          throw new Error("Fungsi getSupabaseClient tidak tersedia.");
        }

        supabaseRef = await window.getSupabaseClient();

        if (activeChannel) {
          await teardownChannel();
        }

        setStatus("connecting");

        const channel = supabaseRef.channel(CHANNEL_NAME);

        for (let i = 0; i < TARGET_TABLES.length; i += 1) {
          const tableName = TARGET_TABLES[i];
          channel.on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: tableName
            },
            function (payload) {
              handlePostgresChange(tableName, payload);
            }
          );
        }

        activeChannel = channel;

        channel.subscribe(function (status) {
          if (activeChannel !== channel) {
            return;
          }
          if (status === "SUBSCRIBED") {
            setStatus("connected");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setStatus("disconnected");
          }
        });

        return channel;
      } catch (err) {
        setStatus("error");
        throw err;
      } finally {
        subscribePromise = null;
      }
    })();

    return subscribePromise;
  }

  async function handleResumeSync(triggerReason) {
    if (navigator && navigator.onLine === false) {
      setStatus("offline");
      return;
    }

    try {
      if (!isChannelHealthy()) {
        await teardownChannel();
        await subscribe();
      }
    } catch (_) {}

    notifySyncRequired(triggerReason);
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      handleResumeSync("visibilitychange");
    }
  }

  function handleOnline() {
    handleResumeSync("online");
  }

  function handleOffline() {
    setStatus("offline");
  }

  function handlePageHide() {
    teardownChannel();
  }

  function bindLifecycleListeners() {
    if (lifecycleBound) {
      return;
    }
    lifecycleBound = true;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("pagehide", handlePageHide);
  }

  function registerListener(setRef, callback) {
    if (typeof callback !== "function") {
      return function () {};
    }
    setRef.add(callback);
    return function () {
      setRef.delete(callback);
    };
  }

  async function init(options) {
    const opts = options && typeof options === "object" ? options : {};
    if (typeof opts.onPenggunaChange === "function") {
      penggunaListeners.add(opts.onPenggunaChange);
    }
    if (typeof opts.onSekolahChange === "function") {
      sekolahListeners.add(opts.onSekolahChange);
    }
    if (typeof opts.onSyncRequired === "function") {
      syncListeners.add(opts.onSyncRequired);
    }
    if (typeof opts.onStatusChange === "function") {
      statusListeners.add(opts.onStatusChange);
    }
    bindLifecycleListeners();
    return subscribe();
  }

  const api = Object.freeze({
    init: init,
    subscribe: subscribe,
    teardown: teardownChannel,
    trackRecord: trackRecord,
    onPenggunaChange: function (fn) {
      return registerListener(penggunaListeners, fn);
    },
    onSekolahChange: function (fn) {
      return registerListener(sekolahListeners, fn);
    },
    onSyncRequired: function (fn) {
      return registerListener(syncListeners, fn);
    },
    onStatusChange: function (fn) {
      return registerListener(statusListeners, fn);
    },
    getStatus: function () {
      return currentStatus;
    }
  });

  window.RealtimeSync = api;
})();