(function () {
  "use strict";

  const APP_IDENTIFIER = "meldotmy-portal";
  const SCHEMA_VERSION = "1.0";
  const EXPORT_PAGE_SIZE = 1000;
  const IMPORT_BATCH_SIZE = 500;

  const DEFAULT_TABLE_ORDER = Object.freeze([
    "meldotmy_sekolah",
    "meldotmy_pengguna"
  ]);

  const DECLARATIVE_SCHEMA = Object.freeze({
    meldotmy_sekolah: Object.freeze({
      table_name: "meldotmy_sekolah",
      primary_key: "id",
      unique_key: "nama_sekolah",
      headers: Object.freeze(["nama_sekolah"]),
      optional_headers: Object.freeze(["id", "created_at", "updated_at"]),
      foreign_keys: Object.freeze([])
    }),
    meldotmy_pengguna: Object.freeze({
      table_name: "meldotmy_pengguna",
      primary_key: "id",
      unique_key: "username",
      headers: Object.freeze([
        "nama_penuh",
        "no_kp",
        "username",
        "jenis_id",
        "nama_sekolah"
      ]),
      optional_headers: Object.freeze([
        "id",
        "sudah_maklum",
        "tarikh_maklum",
        "created_at",
        "updated_at"
      ]),
      foreign_keys: Object.freeze([
        {
          column: "nama_sekolah",
          references_table: "meldotmy_sekolah",
          references_column: "nama_sekolah"
        }
      ])
    })
  });

  let activeOperationController = null;
  let operationInProgress = false;

  function emitProgress(onProgress, phase, message, percent) {
    if (typeof onProgress === "function") {
      try {
        onProgress({
          phase: phase,
          message: message,
          percent: typeof percent === "number" ? Math.max(0, Math.min(100, Math.round(percent))) : null
        });
      } catch (_) {}
    }
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) {
      const abortErr = new Error("Operasi migrasi dibatalkan oleh pengguna.");
      abortErr.name = "AbortError";
      throw abortErr;
    }
  }

  async function discoverRuntimeSchema(env, signal) {
    const resolved = {};
    const tableNames = Object.keys(DECLARATIVE_SCHEMA);
    for (let i = 0; i < tableNames.length; i += 1) {
      const name = tableNames[i];
      const base = DECLARATIVE_SCHEMA[name];
      resolved[name] = {
        table_name: base.table_name,
        primary_key: base.primary_key,
        unique_key: base.unique_key,
        headers: base.headers.slice(),
        optional_headers: base.optional_headers.slice(),
        foreign_keys: base.foreign_keys.slice()
      };
    }

    try {
      const response = await window.fetch(env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/", {
        method: "GET",
        headers: {
          "Accept": "application/openapi+json",
          "apikey": env.SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + env.SUPABASE_ANON_KEY
        },
        signal: signal
      });

      if (!response.ok) {
        return resolved;
      }

      const spec = await response.json();
      const definitions = spec && spec.definitions ? spec.definitions : null;
      if (!definitions || typeof definitions !== "object") {
        return resolved;
      }

      for (let i = 0; i < tableNames.length; i += 1) {
        const tName = tableNames[i];
        const def = definitions[tName];
        if (!def || !def.properties || typeof def.properties !== "object") {
          continue;
        }

        const propKeys = Object.keys(def.properties);
        const requiredSet = new Set(Array.isArray(def.required) ? def.required : []);
        const current = resolved[tName];
        const detectedHeaders = [];
        const detectedOptional = [];

        for (let j = 0; j < propKeys.length; j += 1) {
          const col = propKeys[j];
          const propMeta = def.properties[col] || {};
          const desc = typeof propMeta.description === "string" ? propMeta.description : "";
          if (desc.indexOf("<pk/>") !== -1) {
            current.primary_key = col;
          }
          const isAutoOrDefault = col === current.primary_key ||
            col === "created_at" ||
            col === "updated_at" ||
            col === "sudah_maklum" ||
            col === "tarikh_maklum" ||
            typeof propMeta.default !== "undefined";

          if (requiredSet.has(col) && !isAutoOrDefault) {
            detectedHeaders.push(col);
          } else {
            detectedOptional.push(col);
          }
        }

        if (detectedHeaders.length > 0) {
          current.headers = detectedHeaders;
          current.optional_headers = detectedOptional;
        }
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw err;
      }
    }

    return resolved;
  }

  async function fetchAllRowsForTable(supabase, tableMeta, signal, onProgress, basePercent, spanPercent) {
    const rows = [];
    let offset = 0;
    let totalEstimated = null;

    while (true) {
      throwIfAborted(signal);

      let query = supabase
        .from(tableMeta.table_name)
        .select("*", totalEstimated === null ? { count: "exact" } : undefined)
        .order(tableMeta.primary_key, { ascending: true })
        .range(offset, offset + EXPORT_PAGE_SIZE - 1);

      if (signal && typeof query.abortSignal === "function") {
        query = query.abortSignal(signal);
      }

      const result = await query;
      if (result.error) {
        throw new Error("Gagal membaca jadual " + tableMeta.table_name + ": " + result.error.message);
      }

      if (totalEstimated === null && typeof result.count === "number") {
        totalEstimated = result.count;
      }

      const batch = Array.isArray(result.data) ? result.data : [];
      for (let i = 0; i < batch.length; i += 1) {
        rows.push(batch[i]);
      }

      const ratio = totalEstimated && totalEstimated > 0
        ? Math.min(1, rows.length / totalEstimated)
        : 1;
      emitProgress(
        onProgress,
        "export",
        "Mengeksport " + tableMeta.table_name + " (" + rows.length + (totalEstimated ? "/" + totalEstimated : "") + " rekod)...",
        basePercent + ratio * spanPercent
      );

      if (batch.length < EXPORT_PAGE_SIZE) {
        break;
      }
      offset += EXPORT_PAGE_SIZE;
    }

    return rows;
  }

  function triggerJsonDownload(payloadObject, filename) {
    const serialized = JSON.stringify(payloadObject, null, 2);
    const blob = new Blob([serialized], { type: "application/json;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);

    try {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } finally {
      window.setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
      }, 0);
    }
  }

  async function exportBackupJson(options) {
    if (operationInProgress) {
      throw new Error("Operasi migrasi lain sedang dijalankan. Sila tunggu sehingga selesai.");
    }

    const opts = options && typeof options === "object" ? options : {};
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const controller = new AbortController();
    activeOperationController = controller;
    operationInProgress = true;

    try {
      emitProgress(onProgress, "export", "Menyemak konfigurasi & skema pangkalan data...", 5);
      const env = await window.ENV_READY;
      const supabase = await window.getSupabaseClient();
      const schemaMap = await discoverRuntimeSchema(env, controller.signal);

      const tableOrder = DEFAULT_TABLE_ORDER.slice();
      const exportedTables = {};
      const perTableSpan = 85 / tableOrder.length;

      for (let i = 0; i < tableOrder.length; i += 1) {
        const tableName = tableOrder[i];
        const tableMeta = schemaMap[tableName];
        const rows = await fetchAllRowsForTable(
          supabase,
          tableMeta,
          controller.signal,
          onProgress,
          10 + i * perTableSpan,
          perTableSpan
        );

        exportedTables[tableName] = {
          table_name: tableMeta.table_name,
          primary_key: tableMeta.primary_key,
          headers: tableMeta.headers.slice(),
          optional_headers: tableMeta.optional_headers.slice(),
          rows: rows
        };
      }

      const exportedAt = new Date().toISOString();
      const backupDocument = {
        metadata: {
          app: APP_IDENTIFIER,
          schema_version: SCHEMA_VERSION,
          exported_at: exportedAt,
          table_order: tableOrder
        },
        tables: exportedTables
      };

      const stamp = exportedAt.replace(/[:.]/g, "-");
      const filename = "meldotmy-backup-" + stamp + ".json";

      emitProgress(onProgress, "export", "Menjana fail sandaran JSON...", 98);
      triggerJsonDownload(backupDocument, filename);
      emitProgress(onProgress, "export", "Eksport sandaran JSON selesai.", 100);

      return {
        ok: true,
        filename: filename,
        metadata: backupDocument.metadata,
        counts: {
          meldotmy_sekolah: exportedTables.meldotmy_sekolah.rows.length,
          meldotmy_pengguna: exportedTables.meldotmy_pengguna.rows.length
        }
      };
    } finally {
      operationInProgress = false;
      activeOperationController = null;
    }
  }

  function validateAndNormalizeBackup(rawJson, schemaMap) {
    if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) {
      throw new Error("Struktur akar fail JSON mestilah objek yang sah.");
    }

    const metadata = rawJson.metadata;
    if (!metadata || typeof metadata !== "object") {
      throw new Error("Bahagian metadata tiada dalam fail sandaran JSON.");
    }

    if (!Array.isArray(metadata.table_order) || metadata.table_order.length === 0) {
      throw new Error("metadata.table_order tiada atau kosong.");
    }

    const tablesObj = rawJson.tables;
    if (!tablesObj || typeof tablesObj !== "object" || Array.isArray(tablesObj)) {
      throw new Error("Bahagian tables tiada atau tidak sah dalam fail sandaran JSON.");
    }

    const expectedOrder = DEFAULT_TABLE_ORDER.slice();
    for (let i = 0; i < expectedOrder.length; i += 1) {
      if (metadata.table_order.indexOf(expectedOrder[i]) === -1) {
        throw new Error("Jadual mandatori tiada dalam metadata.table_order: " + expectedOrder[i]);
      }
    }

    const orderedTables = [];
    for (let i = 0; i < metadata.table_order.length; i += 1) {
      const tName = metadata.table_order[i];
      if (Object.prototype.hasOwnProperty.call(schemaMap, tName)) {
        orderedTables.push(tName);
      }
    }

    const normalizedByTable = {};
    const schoolSet = new Set();

    for (let i = 0; i < orderedTables.length; i += 1) {
      const tableName = orderedTables[i];
      const expectedMeta = schemaMap[tableName];
      const incomingTable = tablesObj[tableName];

      if (!incomingTable || typeof incomingTable !== "object") {
        throw new Error("Definisi jadual tiada untuk: " + tableName);
      }
      if (incomingTable.table_name !== tableName) {
        throw new Error("Ketidakpadanan table_name bagi jadual: " + tableName);
      }
      if (incomingTable.primary_key !== expectedMeta.primary_key) {
        throw new Error("Ketidakpadanan primary_key bagi " + tableName + " (dijangka: " + expectedMeta.primary_key + ").");
      }
      if (!Array.isArray(incomingTable.headers)) {
        throw new Error("Tatasusunan headers tiada bagi jadual: " + tableName);
      }

      for (let h = 0; h < expectedMeta.headers.length; h += 1) {
        const reqCol = expectedMeta.headers[h];
        if (incomingTable.headers.indexOf(reqCol) === -1) {
          throw new Error("Lajur wajib '" + reqCol + "' tiada dalam headers jadual " + tableName + ".");
        }
      }

      if (!Array.isArray(incomingTable.rows)) {
        throw new Error("Tatasusunan rows tidak sah bagi jadual: " + tableName);
      }

      const allowedColumns = new Set(
        expectedMeta.headers.concat(expectedMeta.optional_headers)
      );
      const uniqueTracker = new Set();
      const pkTracker = new Set();
      const cleanedRows = [];

      for (let r = 0; r < incomingTable.rows.length; r += 1) {
        const rawRow = incomingTable.rows[r];
        if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
          throw new Error("Baris ke-" + (r + 1) + " dalam " + tableName + " bukan objek sah.");
        }

        const cleanRow = {};
        const rawKeys = Object.keys(rawRow);
        for (let k = 0; k < rawKeys.length; k += 1) {
          const colName = rawKeys[k];
          if (allowedColumns.has(colName) && rawRow[colName] !== undefined) {
            cleanRow[colName] = rawRow[colName];
          }
        }

        for (let h = 0; h < expectedMeta.headers.length; h += 1) {
          const reqField = expectedMeta.headers[h];
          const val = cleanRow[reqField];
          if (val === null || val === undefined || String(val).trim() === "") {
            throw new Error("Nilai wajib '" + reqField + "' kosong pada baris ke-" + (r + 1) + " dalam " + tableName + ".");
          }
          if (typeof val === "string") {
            cleanRow[reqField] = val.trim();
          }
        }

        if (tableName === "meldotmy_pengguna") {
          cleanRow.no_kp = String(cleanRow.no_kp).replace(/[^0-9]/g, "");
          if (cleanRow.no_kp.length !== 12) {
            throw new Error("Format no_kp tidak sah pada baris ke-" + (r + 1) + " dalam meldotmy_pengguna (mesti 12 digit).");
          }
          cleanRow.username = String(cleanRow.username).trim().toLowerCase();
          cleanRow.jenis_id = String(cleanRow.jenis_id).trim().toUpperCase();
        }

        const pkVal = cleanRow[expectedMeta.primary_key];
        if (pkVal === null || pkVal === undefined || pkVal === "") {
          delete cleanRow[expectedMeta.primary_key];
        } else {
          const pkKey = String(pkVal);
          if (pkTracker.has(pkKey)) {
            throw new Error("Nilai pendua primary_key '" + pkKey + "' dikesan dalam " + tableName + ".");
          }
          pkTracker.add(pkKey);
        }

        if (expectedMeta.unique_key && cleanRow[expectedMeta.unique_key] !== undefined) {
          const uVal = String(cleanRow[expectedMeta.unique_key]);
          if (uniqueTracker.has(uVal)) {
            throw new Error("Nilai pendua kekangan UNIQUE '" + uVal + "' pada lajur " + expectedMeta.unique_key + " dalam " + tableName + ".");
          }
          uniqueTracker.add(uVal);
        }

        if (tableName === "meldotmy_sekolah") {
          schoolSet.add(cleanRow.nama_sekolah);
        }

        cleanedRows.push(cleanRow);
      }

      if (tableName === "meldotmy_pengguna" && schoolSet.size > 0) {
        for (let r = 0; r < cleanedRows.length; r += 1) {
          if (!schoolSet.has(cleanedRows[r].nama_sekolah)) {
            throw new Error("Rujukan FOREIGN KEY tidak sah: sekolah '" + cleanedRows[r].nama_sekolah + "' pada baris ke-" + (r + 1) + " tiada dalam meldotmy_sekolah.");
          }
        }
      }

      normalizedByTable[tableName] = {
        meta: expectedMeta,
        rows: cleanedRows
      };
    }

    return {
      tableOrder: orderedTables,
      normalizedByTable: normalizedByTable
    };
  }

  async function upsertTableBatches(supabase, tableBundle, signal, onProgress, basePercent, spanPercent) {
    const meta = tableBundle.meta;
    const rows = tableBundle.rows;
    const total = rows.length;

    if (total === 0) {
      emitProgress(onProgress, "import", "Tiada rekod baharu untuk " + meta.table_name + ".", basePercent + spanPercent);
      return 0;
    }

    for (let offset = 0; offset < total; offset += IMPORT_BATCH_SIZE) {
      throwIfAborted(signal);

      const chunk = rows.slice(offset, offset + IMPORT_BATCH_SIZE);
      let allHavePk = true;
      for (let i = 0; i < chunk.length; i += 1) {
        if (chunk[i][meta.primary_key] === undefined || chunk[i][meta.primary_key] === null) {
          allHavePk = false;
          break;
        }
      }

      const conflictTarget = allHavePk ? meta.primary_key : (meta.unique_key || meta.primary_key);

      let query = supabase
        .from(meta.table_name)
        .upsert(chunk, {
          onConflict: conflictTarget,
          ignoreDuplicates: false
        });

      if (signal && typeof query.abortSignal === "function") {
        query = query.abortSignal(signal);
      }

      const result = await query;
      if (result.error) {
        throw new Error("Ralat upsert pada " + meta.table_name + " (kelompok " + (offset + 1) + "): " + result.error.message);
      }

      const processed = Math.min(total, offset + chunk.length);
      const ratio = processed / total;
      emitProgress(
        onProgress,
        "import",
        "Memulihkan " + meta.table_name + " (" + processed + "/" + total + " rekod)...",
        basePercent + ratio * spanPercent
      );
    }

    return total;
  }

  async function importBackupJson(file, options) {
    if (operationInProgress) {
      throw new Error("Operasi migrasi lain sedang dijalankan. Sila tunggu sehingga selesai.");
    }
    if (!file) {
      throw new Error("Sila pilih fail sandaran .json terlebih dahulu.");
    }

    const fileName = typeof file.name === "string" ? file.name.trim() : "";
    const fileType = typeof file.type === "string" ? file.type.trim().toLowerCase() : "";
    const hasJsonExt = /\.json$/i.test(fileName);
    const hasJsonMime = fileType === "" || fileType === "application/json" || fileType === "text/json";

    if (!hasJsonExt || !hasJsonMime) {
      throw new Error("Format fail tidak sah. Hanya fail .json (application/json) dibenarkan.");
    }

    const opts = options && typeof options === "object" ? options : {};
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const onCompleted = typeof opts.onCompleted === "function" ? opts.onCompleted : null;
    const controller = new AbortController();
    activeOperationController = controller;
    operationInProgress = true;

    try {
      emitProgress(onProgress, "import", "Membaca dan mengesahkan fail JSON...", 5);
      const rawText = await file.text();
      throwIfAborted(controller.signal);

      let parsedJson;
      try {
        parsedJson = JSON.parse(rawText);
      } catch (_) {
        throw new Error("Sintaks fail JSON rosak atau tidak dapat dihuraikan.");
      }

      const env = await window.ENV_READY;
      const supabase = await window.getSupabaseClient();
      const schemaMap = await discoverRuntimeSchema(env, controller.signal);

      emitProgress(onProgress, "import", "Mengesahkan skema, kekangan & integriti rujukan...", 12);
      const validated = validateAndNormalizeBackup(parsedJson, schemaMap);
      const tableOrder = validated.tableOrder;
      const perTableSpan = 76 / tableOrder.length;
      const restoredCounts = {};

      for (let i = 0; i < tableOrder.length; i += 1) {
        const tName = tableOrder[i];
        const count = await upsertTableBatches(
          supabase,
          validated.normalizedByTable[tName],
          controller.signal,
          onProgress,
          15 + i * perTableSpan,
          perTableSpan
        );
        restoredCounts[tName] = count;
      }

      throwIfAborted(controller.signal);
      emitProgress(onProgress, "import", "Menyelaraskan jujukan ID pangkalan data (setval)...", 93);

      const seqResult = await supabase.rpc("meldotmy_reset_sequences", {
        p_tables: tableOrder
      });
      if (seqResult.error) {
        throw new Error("Data dipulihkan tetapi tetapan semula jujukan gagal: " + seqResult.error.message);
      }

      emitProgress(onProgress, "import", "Membersihkan cache tempatan dan menyegarkan paparan...", 97);
      const cache = window.IDBCache || window.cacheService;
      if (cache && typeof cache.clearAll === "function") {
        await cache.clearAll();
      }

      if (typeof onCompleted === "function") {
        await onCompleted(restoredCounts);
      }

      emitProgress(onProgress, "import", "Pemulihan sandaran JSON selesai sepenuhnya.", 100);

      return {
        ok: true,
        counts: restoredCounts,
        sequences: seqResult.data
      };
    } finally {
      operationInProgress = false;
      activeOperationController = null;
    }
  }

  function renderStatusMessage(containerEl, type, titleText, detailLines) {
    if (!containerEl) {
      return;
    }
    while (containerEl.firstChild) {
      containerEl.removeChild(containerEl.firstChild);
    }

    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement("div");
    const toneClass = type === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : type === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-blue-200 bg-blue-50 text-blue-800";
    wrapper.className = "rounded-lg border p-3 text-sm " + toneClass;

    const titleEl = document.createElement("p");
    titleEl.className = "font-semibold";
    titleEl.textContent = titleText;
    wrapper.appendChild(titleEl);

    if (Array.isArray(detailLines) && detailLines.length > 0) {
      const listEl = document.createElement("ul");
      listEl.className = "mt-1 list-disc space-y-0.5 pl-5 text-xs";
      for (let i = 0; i < detailLines.length; i += 1) {
        const li = document.createElement("li");
        li.textContent = String(detailLines[i]);
        listEl.appendChild(li);
      }
      wrapper.appendChild(listEl);
    }

    fragment.appendChild(wrapper);
    containerEl.appendChild(fragment);
  }

  function cancelActiveOperation() {
    if (activeOperationController) {
      activeOperationController.abort();
      activeOperationController = null;
    }
  }

  const api = Object.freeze({
    APP_IDENTIFIER: APP_IDENTIFIER,
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_TABLE_ORDER: DEFAULT_TABLE_ORDER,
    DECLARATIVE_SCHEMA: DECLARATIVE_SCHEMA,
    exportBackupJson: exportBackupJson,
    importBackupJson: importBackupJson,
    cancelActiveOperation: cancelActiveOperation,
    isBusy: function () {
      return operationInProgress;
    },
    renderStatusMessage: renderStatusMessage
  });

  window.MigrationService = api;
})();