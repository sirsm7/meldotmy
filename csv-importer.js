(function () {
  "use strict";

  const REQUIRED_HEADERS = Object.freeze([
    "nama_penuh",
    "no_kp",
    "username",
    "jenis_id",
    "nama_sekolah"
  ]);
  const CSV_BATCH_SIZE = 1000;

  let activeImportController = null;
  let importInProgress = false;

  function emitProgress(onProgress, message, percent) {
    if (typeof onProgress === "function") {
      try {
        onProgress({
          phase: "csv-import",
          message: message,
          percent: typeof percent === "number" ? Math.max(0, Math.min(100, Math.round(percent))) : 0
        });
      } catch (_) {}
    }
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) {
      const abortErr = new Error("Operasi muat naik CSV dibatalkan oleh Super Admin.");
      abortErr.name = "AbortError";
      throw abortErr;
    }
  }

  function normalizeHeaderName(rawHeader) {
    return String(rawHeader || "")
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase();
  }

  function buildHeaderIndexMap(headerCells) {
    const map = Object.create(null);
    for (let i = 0; i < headerCells.length; i += 1) {
      const normalized = normalizeHeaderName(headerCells[i]);
      if (normalized && typeof map[normalized] === "undefined") {
        map[normalized] = i;
      }
    }

    const missing = [];
    for (let i = 0; i < REQUIRED_HEADERS.length; i += 1) {
      const req = REQUIRED_HEADERS[i];
      if (typeof map[req] !== "number") {
        missing.push(req);
      }
    }

    if (missing.length > 0) {
      throw new Error("Lajur wajib tiada dalam fail CSV: " + missing.join(", "));
    }

    return map;
  }

  function normalizeCsvDataRow(cells, headerMap, csvLineNumber) {
    let isCompletelyEmpty = true;
    for (let i = 0; i < cells.length; i += 1) {
      if (String(cells[i] || "").trim() !== "") {
        isCompletelyEmpty = false;
        break;
      }
    }
    if (isCompletelyEmpty) {
      return null;
    }

    const namaPenuh = String(cells[headerMap.nama_penuh] || "").trim();
    const rawNoKp = String(cells[headerMap.no_kp] || "").trim();
    const username = String(cells[headerMap.username] || "").trim().toLowerCase();
    const jenisId = String(cells[headerMap.jenis_id] || "").trim().toUpperCase();
    const namaSekolah = String(cells[headerMap.nama_sekolah] || "").trim();

    if (!namaPenuh || !rawNoKp || !username || !jenisId || !namaSekolah) {
      throw new Error("Data wajib kosong pada baris CSV ke-" + csvLineNumber + ".");
    }

    let digitsNoKp = rawNoKp.replace(/[^0-9]/g, "");
    if (digitsNoKp.length === 11) {
      digitsNoKp = "0" + digitsNoKp;
    }
    if (digitsNoKp.length !== 12) {
      throw new Error("Format no_kp tidak sah pada baris CSV ke-" + csvLineNumber + " (mesti 12 digit).");
    }

    if (username.indexOf("@") !== -1) {
      throw new Error("Format username tidak sah pada baris CSV ke-" + csvLineNumber + " (tidak boleh mengandungi '@').");
    }

    return {
      nama_penuh: namaPenuh,
      no_kp: digitsNoKp,
      username: username,
      jenis_id: jenisId,
      nama_sekolah: namaSekolah
    };
  }

  async function sendCsvBatchToSupabase(supabase, rowsBatch, signal) {
    if (!Array.isArray(rowsBatch) || rowsBatch.length === 0) {
      return {
        schools_inserted: 0,
        users_upserted: 0
      };
    }

    throwIfAborted(signal);

    let rpcCall = supabase.rpc("meldotmy_admin_upsert_csv_batch", {
      p_rows: rowsBatch
    });

    if (signal && typeof rpcCall.abortSignal === "function") {
      rpcCall = rpcCall.abortSignal(signal);
    }

    const response = await rpcCall;
    if (response.error) {
      throw new Error("Ralat kemas kini pangkalan data CSV: " + response.error.message);
    }

    const data = response.data && typeof response.data === "object" ? response.data : {};
    return {
      schools_inserted: Number(data.schools_inserted || 0),
      users_upserted: Number(data.users_upserted || rowsBatch.length)
    };
  }

  async function importCsvFile(file, options) {
    if (importInProgress) {
      throw new Error("Proses muat naik CSV sedang berjalan. Sila tunggu sehingga selesai.");
    }
    if (!file) {
      throw new Error("Sila pilih fail .csv terlebih dahulu.");
    }

    const fileName = typeof file.name === "string" ? file.name.trim() : "";
    if (!/\.csv$/i.test(fileName)) {
      throw new Error("Format fail tidak sah. Sila muat naik fail berformat .csv sahaja.");
    }

    const opts = options && typeof options === "object" ? options : {};
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const onCompleted = typeof opts.onCompleted === "function" ? opts.onCompleted : null;

    const controller = new AbortController();
    activeImportController = controller;
    importInProgress = true;

    try {
      emitProgress(onProgress, "Mengesahkan kelayakan Super Admin...", 2);
      await window.ENV_READY;

      const verifyFn = typeof window.verifySuperAdminServer === "function"
        ? window.verifySuperAdminServer
        : typeof window.getAuthenticatedAdmin === "function"
          ? window.getAuthenticatedAdmin
          : null;

      if (!verifyFn) {
        throw new Error("Modul pengesahan Super Admin tidak tersedia.");
      }

      const adminUser = await verifyFn();
      if (!adminUser) {
        throw new Error("Akses ditolak. Hanya Super Admin berdaftar dan aktif dibenarkan memuat naik CSV.");
      }

      const supabase = await window.getSupabaseClient();
      const totalBytes = typeof file.size === "number" && file.size > 0 ? file.size : 1;
      let bytesProcessed = 0;

      let headerMap = null;
      let csvLineNumber = 0;
      let totalRowsProcessed = 0;
      let totalSchoolsInserted = 0;
      let totalUsersUpserted = 0;
      let batch = [];

      let inQuotes = false;
      let pendingCR = false;
      let currentField = "";
      let currentRow = [];

      async function handleCompletedRow(rowCells) {
        csvLineNumber += 1;
        if (!headerMap) {
          let isHeaderEmpty = true;
          for (let i = 0; i < rowCells.length; i += 1) {
            if (String(rowCells[i] || "").trim() !== "") {
              isHeaderEmpty = false;
              break;
            }
          }
          if (isHeaderEmpty) {
            return;
          }
          headerMap = buildHeaderIndexMap(rowCells);
          return;
        }

        const normalized = normalizeCsvDataRow(rowCells, headerMap, csvLineNumber);
        if (!normalized) {
          return;
        }

        batch.push(normalized);
        totalRowsProcessed += 1;

        if (batch.length >= CSV_BATCH_SIZE) {
          const payloadChunk = batch;
          batch = [];
          const res = await sendCsvBatchToSupabase(supabase, payloadChunk, controller.signal);
          totalSchoolsInserted += res.schools_inserted;
          totalUsersUpserted += res.users_upserted;

          const ratio = Math.min(1, bytesProcessed / totalBytes);
          const pct = 5 + ratio * 87;
          emitProgress(
            onProgress,
            "Memuat naik rekod CSV (" + new Intl.NumberFormat("ms-MY").format(totalRowsProcessed) + " baris diproses)...",
            pct
          );
        }
      }

      async function consumeTextChunk(textChunk) {
        for (let i = 0; i < textChunk.length; i += 1) {
          const ch = textChunk[i];

          if (pendingCR) {
            pendingCR = false;
            if (ch === "\n") {
              continue;
            }
          }

          if (inQuotes) {
            if (ch === "\"") {
              if (i + 1 < textChunk.length && textChunk[i + 1] === "\"") {
                currentField += "\"";
                i += 1;
              } else {
                inQuotes = false;
              }
            } else {
              currentField += ch;
            }
          } else if (ch === "\"") {
            inQuotes = true;
          } else if (ch === ",") {
            currentRow.push(currentField);
            currentField = "";
          } else if (ch === "\r" || ch === "\n") {
            if (ch === "\r") {
              pendingCR = true;
            }
            currentRow.push(currentField);
            currentField = "";
            const completed = currentRow;
            currentRow = [];
            await handleCompletedRow(completed);
          } else {
            currentField += ch;
          }
        }
      }

      emitProgress(onProgress, "Membaca fail CSV...", 5);

      if (file.stream && typeof file.stream === "function") {
        const reader = file.stream().getReader();
        const decoder = new TextDecoder("utf-8");
        while (true) {
          throwIfAborted(controller.signal);
          const step = await reader.read();
          if (step.done) {
            const tail = decoder.decode();
            if (tail) {
              await consumeTextChunk(tail);
            }
            break;
          }
          if (step.value) {
            bytesProcessed += step.value.byteLength;
            const decoded = decoder.decode(step.value, { stream: true });
            await consumeTextChunk(decoded);
          }
        }
      } else {
        const fullText = await file.text();
        bytesProcessed = totalBytes;
        await consumeTextChunk(fullText);
      }

      if (inQuotes) {
        throw new Error("Sintaks fail CSV tidak sah: tanda petikan tidak ditutup.");
      }

      if (currentField.length > 0 || currentRow.length > 0) {
        currentRow.push(currentField);
        await handleCompletedRow(currentRow);
      }

      if (!headerMap || totalRowsProcessed === 0) {
        throw new Error("Fail CSV kosong atau tiada rekod data yang sah ditemui.");
      }

      if (batch.length > 0) {
        const finalChunk = batch;
        batch = [];
        const finalRes = await sendCsvBatchToSupabase(supabase, finalChunk, controller.signal);
        totalSchoolsInserted += finalRes.schools_inserted;
        totalUsersUpserted += finalRes.users_upserted;
      }

      throwIfAborted(controller.signal);
      emitProgress(onProgress, "Menyelaraskan jujukan ID pangkalan data (setval)...", 94);

      const seqRes = await supabase.rpc("meldotmy_reset_sequences", {
        p_tables: ["meldotmy_sekolah", "meldotmy_pengguna"]
      });
      if (seqRes.error) {
        throw new Error("Data CSV dikemas kini tetapi penyelarasan jujukan gagal: " + seqRes.error.message);
      }

      emitProgress(onProgress, "Membersihkan cache setempat dan menyegarkan papan pemuka...", 98);
      const cache = window.IDBCache || window.cacheService;
      if (cache && typeof cache.clearAll === "function") {
        await cache.clearAll();
      }

      const summary = {
        ok: true,
        rows_processed: totalRowsProcessed,
        schools_inserted: totalSchoolsInserted,
        users_upserted: totalUsersUpserted
      };

      if (typeof onCompleted === "function") {
        await onCompleted(summary);
      }

      emitProgress(onProgress, "Muat naik dan kemas kini CSV selesai sepenuhnya.", 100);
      return summary;
    } finally {
      importInProgress = false;
      activeImportController = null;
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

  function cancelActiveImport() {
    if (activeImportController) {
      activeImportController.abort();
      activeImportController = null;
    }
  }

  const api = Object.freeze({
    REQUIRED_HEADERS: REQUIRED_HEADERS,
    importCsvFile: importCsvFile,
    cancelActiveImport: cancelActiveImport,
    isBusy: function () {
      return importInProgress;
    },
    renderStatusMessage: renderStatusMessage
  });

  window.CsvImporter = api;
})();