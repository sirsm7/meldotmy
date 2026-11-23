(function () {
  "use strict";

  const EMAIL_DOMAIN = "@melaka.my";
  const SEKOLAH_CACHE_TTL_MS = 30 * 60 * 1000;
  const STATS_CACHE_TTL_MS = 2 * 60 * 1000;

  const state = {
    schools: [],
    schoolsSet: new Set(),
    activeSearchNoKp: "",
    searchResults: [],
    statsSekolahFilter: "",
    searchAbortController: null,
    isSearching: false,
    pendingConfirmIds: new Set(),
    adminUser: null,
    isAuthenticatingAdmin: false
  };

  const dom = {};

  function cacheDomReferences() {
    dom.realtimeStatusBadge = document.getElementById("realtimeStatusBadge");
    dom.globalBanner = document.getElementById("globalBanner");

    dom.statsScopeSelect = document.getElementById("statsScopeSelect");
    dom.btnRefreshStats = document.getElementById("btnRefreshStats");
    dom.statTotalPengguna = document.getElementById("statTotalPengguna");
    dom.statSudahMaklum = document.getElementById("statSudahMaklum");
    dom.statPeratusMaklum = document.getElementById("statPeratusMaklum");
    dom.statProgressBar = document.getElementById("statProgressBar");
    dom.statBelumMaklum = document.getElementById("statBelumMaklum");
    dom.statTotalSekolah = document.getElementById("statTotalSekolah");
    dom.statGuruSummary = document.getElementById("statGuruSummary");
    dom.statPelajarSummary = document.getElementById("statPelajarSummary");

    dom.searchForm = document.getElementById("searchForm");
    dom.searchNoKpInput = document.getElementById("searchNoKpInput");
    dom.btnSearch = document.getElementById("btnSearch");
    dom.btnResetSearch = document.getElementById("btnResetSearch");
    dom.searchFeedback = document.getElementById("searchFeedback");

    dom.resultsSection = document.getElementById("resultsSection");
    dom.resultsCountBadge = document.getElementById("resultsCountBadge");
    dom.resultsContainer = document.getElementById("resultsContainer");

    dom.toggleMigrationPanel = document.getElementById("toggleMigrationPanel");
    dom.migrationPanel = document.getElementById("migrationPanel");
    dom.btnExportJson = document.getElementById("btnExportJson");
    dom.importJsonInput = document.getElementById("importJsonInput");
    dom.btnImportJson = document.getElementById("btnImportJson");
    dom.btnCancelMigration = document.getElementById("btnCancelMigration");
    dom.migrationProgressWrap = document.getElementById("migrationProgressWrap");
    dom.migrationProgressBar = document.getElementById("migrationProgressBar");
    dom.migrationProgressText = document.getElementById("migrationProgressText");
    dom.migrationStatusBox = document.getElementById("migrationStatusBox");

    dom.btnOpenAdminLogin = document.getElementById("btnOpenAdminLogin");
    dom.adminBadgeWrap = document.getElementById("adminBadgeWrap");
    dom.adminEmailDisplay = document.getElementById("adminEmailDisplay");
    dom.btnAdminLogout = document.getElementById("btnAdminLogout");
    dom.adminLoginModal = document.getElementById("adminLoginModal");
    dom.btnCloseAdminModal = document.getElementById("btnCloseAdminModal");
    dom.adminLoginForm = document.getElementById("adminLoginForm");
    dom.adminLoginEmail = document.getElementById("adminLoginEmail");
    dom.adminLoginPassword = document.getElementById("adminLoginPassword");
    dom.btnSubmitAdminLogin = document.getElementById("btnSubmitAdminLogin");
    dom.adminLoginFeedback = document.getElementById("adminLoginFeedback");

    dom.adminWorkspaceSection = document.getElementById("adminWorkspaceSection");
    dom.importCsvInput = document.getElementById("importCsvInput");
    dom.btnImportCsv = document.getElementById("btnImportCsv");
    dom.btnCancelCsv = document.getElementById("btnCancelCsv");
    dom.csvProgressWrap = document.getElementById("csvProgressWrap");
    dom.csvProgressBar = document.getElementById("csvProgressBar");
    dom.csvProgressText = document.getElementById("csvProgressText");
    dom.csvStatusBox = document.getElementById("csvStatusBox");
  }

  function formatNumber(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) {
      return "0";
    }
    return new Intl.NumberFormat("ms-MY").format(num);
  }

  function formatTimestamp(isoString) {
    if (!isoString) {
      return "";
    }
    const parsed = new Date(isoString);
    if (Number.isNaN(parsed.getTime())) {
      return String(isoString);
    }
    return new Intl.DateTimeFormat("ms-MY", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuala_Lumpur"
    }).format(parsed);
  }

  function sanitizeNoKp(rawValue) {
    return String(rawValue || "").replace(/[^0-9]/g, "");
  }

  function buildFullEmail(record) {
    if (record && typeof record.emel === "string" && record.emel.indexOf("@") !== -1) {
      return record.emel.trim().toLowerCase();
    }
    const uname = record && record.username ? String(record.username).trim().toLowerCase() : "";
    return uname ? uname + EMAIL_DOMAIN : "";
  }

  function clearElementChildren(el) {
    if (!el) {
      return;
    }
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function showAlertBox(container, type, message) {
    if (!container) {
      return;
    }
    clearElementChildren(container);
    if (!message) {
      container.classList.add("hidden");
      return;
    }

    const box = document.createElement("div");
    let toneClass = "border-blue-200 bg-blue-50 text-blue-800";
    if (type === "error") {
      toneClass = "border-red-200 bg-red-50 text-red-800";
    } else if (type === "success") {
      toneClass = "border-emerald-200 bg-emerald-50 text-emerald-800";
    } else if (type === "warning") {
      toneClass = "border-amber-200 bg-amber-50 text-amber-800";
    }

    box.className = "rounded-xl border px-4 py-3 text-sm font-medium " + toneClass;
    box.setAttribute("role", "status");
    box.textContent = message;

    container.appendChild(box);
    container.classList.remove("hidden");
  }

  function updateRealtimeBadge(status) {
    if (!dom.realtimeStatusBadge) {
      return;
    }
    const badge = dom.realtimeStatusBadge;
    let label = "Sedia";
    let tone = "bg-slate-100 text-slate-700 border-slate-200";

    if (status === "connected") {
      label = "Segerak Langsung";
      tone = "bg-emerald-50 text-emerald-700 border-emerald-200";
    } else if (status === "connecting") {
      label = "Menyambung...";
      tone = "bg-amber-50 text-amber-700 border-amber-200";
    } else if (status === "offline") {
      label = "Luar Talian";
      tone = "bg-rose-50 text-rose-700 border-rose-200";
    } else if (status === "disconnected" || status === "error") {
      label = "Mod Standard";
      tone = "bg-slate-100 text-slate-700 border-slate-200";
    }

    badge.className = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium " + tone;
    clearElementChildren(badge);

    const dot = document.createElement("span");
    dot.className = status === "connected"
      ? "h-2 w-2 rounded-full bg-emerald-500"
      : status === "offline"
        ? "h-2 w-2 rounded-full bg-rose-500"
        : "h-2 w-2 rounded-full bg-slate-400";
    badge.appendChild(dot);

    const textNode = document.createTextNode(label);
    badge.appendChild(textNode);
  }

  function normalizeSchoolArray(rawList) {
    if (!Array.isArray(rawList)) {
      return [];
    }
    const uniqueSet = new Set();
    for (let i = 0; i < rawList.length; i += 1) {
      const item = rawList[i];
      const name = typeof item === "string"
        ? item.trim()
        : item && typeof item.nama_sekolah === "string"
          ? item.nama_sekolah.trim()
          : "";
      if (name) {
        uniqueSet.add(name);
      }
    }
    return Array.from(uniqueSet).sort(function (a, b) {
      return a.localeCompare(b, "ms");
    });
  }

  async function fetchSchoolsFromSupabase() {
    const supabase = await window.getSupabaseClient();

    try {
      const rpcRes = await supabase.rpc("meldotmy_get_schools");
      if (!rpcRes.error && Array.isArray(rpcRes.data)) {
        return normalizeSchoolArray(rpcRes.data);
      }
    } catch (_) {}

    const allSchools = [];
    const pageSize = 1000;
    let offset = 0;

    while (true) {
      const response = await supabase
        .from("meldotmy_sekolah")
        .select("nama_sekolah")
        .order("nama_sekolah", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (response.error) {
        throw new Error("Gagal memuatkan senarai sekolah: " + response.error.message);
      }

      const rows = Array.isArray(response.data) ? response.data : [];
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i] && rows[i].nama_sekolah) {
          allSchools.push(String(rows[i].nama_sekolah).trim());
        }
      }

      if (rows.length < pageSize) {
        break;
      }
      offset += pageSize;
    }

    return normalizeSchoolArray(allSchools);
  }

  function populateSchoolControls(schoolList) {
    state.schools = normalizeSchoolArray(schoolList);
    state.schoolsSet = new Set(state.schools);

    if (dom.statsScopeSelect) {
      const previousVal = dom.statsScopeSelect.value || state.statsSekolahFilter || "";
      clearElementChildren(dom.statsScopeSelect);
      const frag = document.createDocumentFragment();

      const allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = "Semua Sekolah Negeri Melaka (" + formatNumber(state.schools.length) + ")";
      frag.appendChild(allOption);

      for (let i = 0; i < state.schools.length; i += 1) {
        const opt = document.createElement("option");
        opt.value = state.schools[i];
        opt.textContent = state.schools[i];
        frag.appendChild(opt);
      }

      dom.statsScopeSelect.appendChild(frag);
      if (previousVal && state.schoolsSet.has(previousVal)) {
        dom.statsScopeSelect.value = previousVal;
      } else {
        dom.statsScopeSelect.value = "";
        state.statsSekolahFilter = "";
      }
    }
  }

  async function loadSchools(forceRefresh) {
    const cache = window.IDBCache || window.cacheService;
    if (cache && typeof cache.getWithSWR === "function") {
      let effectiveForce = Boolean(forceRefresh);
      if (!effectiveForce && typeof cache.get === "function") {
        const cachedEntry = await cache.get("meldotmy_sekolah", "all_schools");
        if (cachedEntry && (!Array.isArray(cachedEntry.data) || cachedEntry.data.length === 0)) {
          if (typeof cache.invalidateKey === "function") {
            await cache.invalidateKey("meldotmy_sekolah", "all_schools");
          }
          effectiveForce = true;
        }
      }

      const result = await cache.getWithSWR(
        "meldotmy_sekolah",
        "all_schools",
        fetchSchoolsFromSupabase,
        {
          ttlMs: SEKOLAH_CACHE_TTL_MS,
          forceRefresh: effectiveForce,
          onUpdate: function (freshList) {
            if (Array.isArray(freshList) && freshList.length > 0) {
              populateSchoolControls(freshList);
            }
          }
        }
      );

      const list = Array.isArray(result.data) ? result.data : [];
      if (list.length === 0 && typeof cache.invalidateKey === "function") {
        await cache.invalidateKey("meldotmy_sekolah", "all_schools");
      }
      populateSchoolControls(list);
      return;
    }

    const directList = await fetchSchoolsFromSupabase();
    populateSchoolControls(directList);
  }

  async function fetchDashboardStatsFromSupabase(namaSekolah) {
    const supabase = await window.getSupabaseClient();
    const cleaned = namaSekolah && String(namaSekolah).trim() !== ""
      ? String(namaSekolah).trim()
      : null;

    const response = await supabase.rpc("meldotmy_get_dashboard_stats", {
      p_nama_sekolah: cleaned
    });

    if (response.error) {
      throw new Error("Gagal memuatkan statistik papan pemuka: " + response.error.message);
    }

    return response.data || {};
  }

  function renderDashboardStats(stats) {
    const totalPengguna = Number(stats && stats.total_pengguna ? stats.total_pengguna : 0);
    const totalSudah = Number(stats && stats.total_sudah_maklum ? stats.total_sudah_maklum : 0);
    const totalBelum = Number(stats && stats.total_belum_maklum ? stats.total_belum_maklum : 0);
    const totalSekolah = Number(stats && stats.total_sekolah ? stats.total_sekolah : 0);
    const totalGuru = Number(stats && stats.total_guru ? stats.total_guru : 0);
    const guruSudah = Number(stats && stats.guru_sudah_maklum ? stats.guru_sudah_maklum : 0);
    const totalPelajar = Number(stats && stats.total_pelajar ? stats.total_pelajar : 0);
    const pelajarSudah = Number(stats && stats.pelajar_sudah_maklum ? stats.pelajar_sudah_maklum : 0);

    const percentage = totalPengguna > 0
      ? Math.min(100, (totalSudah / totalPengguna) * 100)
      : 0;

    if (dom.statTotalPengguna) {
      dom.statTotalPengguna.textContent = formatNumber(totalPengguna);
    }
    if (dom.statSudahMaklum) {
      dom.statSudahMaklum.textContent = formatNumber(totalSudah);
    }
    if (dom.statBelumMaklum) {
      dom.statBelumMaklum.textContent = formatNumber(totalBelum);
    }
    if (dom.statTotalSekolah) {
      dom.statTotalSekolah.textContent = formatNumber(totalSekolah);
    }
    if (dom.statPeratusMaklum) {
      dom.statPeratusMaklum.textContent = percentage.toFixed(1) + "%";
    }
    if (dom.statProgressBar) {
      dom.statProgressBar.style.width = percentage.toFixed(1) + "%";
      dom.statProgressBar.setAttribute("aria-valuenow", percentage.toFixed(1));
    }
    if (dom.statGuruSummary) {
      dom.statGuruSummary.textContent = formatNumber(guruSudah) + " / " + formatNumber(totalGuru) + " maklum";
    }
    if (dom.statPelajarSummary) {
      dom.statPelajarSummary.textContent = formatNumber(pelajarSudah) + " / " + formatNumber(totalPelajar) + " maklum";
    }
  }

  async function loadDashboardStats(forceRefresh) {
    const scopeKey = state.statsSekolahFilter ? "school::" + state.statsSekolahFilter : "all";
    const cache = window.IDBCache || window.cacheService;

    if (cache && typeof cache.getWithSWR === "function") {
      const result = await cache.getWithSWR(
        "meldotmy_stats",
        scopeKey,
        function () {
          return fetchDashboardStatsFromSupabase(state.statsSekolahFilter);
        },
        {
          ttlMs: STATS_CACHE_TTL_MS,
          forceRefresh: Boolean(forceRefresh),
          onUpdate: function (freshStats) {
            renderDashboardStats(freshStats);
          }
        }
      );
      renderDashboardStats(result.data || {});
      return;
    }

    const freshStats = await fetchDashboardStatsFromSupabase(state.statsSekolahFilter);
    renderDashboardStats(freshStats);
  }

  async function copyEmailToClipboard(emailText, buttonEl) {
    if (!emailText) {
      return;
    }
    const originalText = buttonEl ? buttonEl.textContent : "Salin Emel";

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(emailText);
      } else {
        const tempInput = document.createElement("input");
        tempInput.value = emailText;
        tempInput.setAttribute("readonly", "");
        tempInput.style.position = "fixed";
        tempInput.style.opacity = "0";
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand("copy");
        document.body.removeChild(tempInput);
      }

      if (buttonEl) {
        buttonEl.textContent = "Emel Disalin";
        buttonEl.classList.add("border-emerald-300", "bg-emerald-50", "text-emerald-700");
        window.setTimeout(function () {
          buttonEl.textContent = originalText;
          buttonEl.classList.remove("border-emerald-300", "bg-emerald-50", "text-emerald-700");
        }, 2000);
      }
    } catch (_) {
      showAlertBox(dom.searchFeedback, "warning", "Tidak dapat menyalin secara automatik. Sila salin alamat emel secara manual.");
    }
  }

  async function handleConfirmationToggle(record, checkboxEl, cardStatusBadgeEl, cardTimestampEl) {
    const recordId = record && record.id;
    if (!recordId || state.pendingConfirmIds.has(recordId)) {
      return;
    }

    const nextChecked = Boolean(checkboxEl.checked);
    state.pendingConfirmIds.add(recordId);
    checkboxEl.disabled = true;

    try {
      await window.ENV_READY;
      const supabase = await window.getSupabaseClient();

      const response = await supabase.rpc("meldotmy_sahkan_maklum", {
        p_id: record.id,
        p_no_kp: record.no_kp,
        p_sudah_maklum: nextChecked
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const updatedRows = Array.isArray(response.data) ? response.data : [];
      const updated = updatedRows.length > 0 ? updatedRows[0] : null;

      if (!updated) {
        throw new Error("Rekod pengesahan tidak ditemui.");
      }

      record.sudah_maklum = Boolean(updated.sudah_maklum);
      record.tarikh_maklum = updated.tarikh_maklum || null;
      record.updated_at = updated.updated_at || new Date().toISOString();

      if (window.RealtimeSync && typeof window.RealtimeSync.trackRecord === "function") {
        window.RealtimeSync.trackRecord("meldotmy_pengguna", record);
      }

      updateResultCardStatusUI(record, checkboxEl, cardStatusBadgeEl, cardTimestampEl);

      const cache = window.IDBCache || window.cacheService;
      if (cache && typeof cache.invalidateStore === "function") {
        await cache.invalidateStore("meldotmy_stats");
      }
      await loadDashboardStats(true);

      showAlertBox(
        dom.searchFeedback,
        "success",
        record.sudah_maklum
          ? "Pengesahan makluman bagi " + buildFullEmail(record) + " telah berjaya direkodkan."
          : "Status makluman bagi " + buildFullEmail(record) + " telah dikemas kini kepada Belum Maklum."
      );
    } catch (err) {
      checkboxEl.checked = Boolean(record.sudah_maklum);
      showAlertBox(
        dom.searchFeedback,
        "error",
        "Gagal mengemas kini pengesahan: " + (err && err.message ? err.message : "Ralat tidak diketahui.")
      );
    } finally {
      state.pendingConfirmIds.delete(recordId);
      checkboxEl.disabled = false;
    }
  }

  function updateResultCardStatusUI(record, checkboxEl, statusBadgeEl, timestampEl) {
    const isConfirmed = Boolean(record.sudah_maklum);
    if (checkboxEl) {
      checkboxEl.checked = isConfirmed;
    }
    if (statusBadgeEl) {
      statusBadgeEl.className = isConfirmed
        ? "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
        : "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800";
      statusBadgeEl.textContent = isConfirmed ? "Sudah Maklum" : "Belum Maklum";
    }
    if (timestampEl) {
      if (isConfirmed && record.tarikh_maklum) {
        timestampEl.textContent = "Disahkan pada: " + formatTimestamp(record.tarikh_maklum);
        timestampEl.classList.remove("hidden");
      } else {
        timestampEl.textContent = "";
        timestampEl.classList.add("hidden");
      }
    }
  }

  function renderSearchResults(records) {
    state.searchResults = Array.isArray(records) ? records : [];

    if (!dom.resultsSection || !dom.resultsContainer) {
      return;
    }

    clearElementChildren(dom.resultsContainer);

    if (state.searchResults.length === 0) {
      dom.resultsSection.classList.add("hidden");
      return;
    }

    if (dom.resultsCountBadge) {
      dom.resultsCountBadge.textContent = state.searchResults.length + " Akaun Ditemui";
    }

    const fragment = document.createDocumentFragment();

    for (let i = 0; i < state.searchResults.length; i += 1) {
      const record = state.searchResults[i];
      if (window.RealtimeSync && typeof window.RealtimeSync.trackRecord === "function") {
        window.RealtimeSync.trackRecord("meldotmy_pengguna", record);
      }

      const fullEmail = buildFullEmail(record);

      const card = document.createElement("article");
      card.className = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors";
      card.setAttribute("data-record-id", String(record.id));

      const topRow = document.createElement("div");
      topRow.className = "flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4";

      const identityWrap = document.createElement("div");
      identityWrap.className = "min-w-0 flex-1";

      const roleBadge = document.createElement("span");
      const isGuru = String(record.jenis_id || "").toUpperCase() === "GURU";
      roleBadge.className = isGuru
        ? "inline-flex items-center rounded-md bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700"
        : "inline-flex items-center rounded-md bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700";
      roleBadge.textContent = String(record.jenis_id || "PENGGUNA").toUpperCase();
      identityWrap.appendChild(roleBadge);

      const nameHeading = document.createElement("h3");
      nameHeading.className = "mt-2 break-words text-base font-bold text-slate-900 sm:text-lg";
      nameHeading.textContent = record.nama_penuh || "-";
      identityWrap.appendChild(nameHeading);

      const schoolText = document.createElement("p");
      schoolText.className = "mt-1 break-words text-xs font-medium text-slate-600 sm:text-sm";
      schoolText.textContent = record.nama_sekolah || "-";
      identityWrap.appendChild(schoolText);

      const kpText = document.createElement("p");
      kpText.className = "mt-1 text-xs text-slate-500";
      kpText.textContent = "No. KP: " + (record.no_kp || "-");
      identityWrap.appendChild(kpText);

      topRow.appendChild(identityWrap);

      const statusBadge = document.createElement("span");
      statusBadge.setAttribute("data-role", "status-badge");
      topRow.appendChild(statusBadge);

      card.appendChild(topRow);

      const emailBox = document.createElement("div");
      emailBox.className = "mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4";

      const emailLabel = document.createElement("p");
      emailLabel.className = "text-xs font-semibold uppercase tracking-wide text-slate-500";
      emailLabel.textContent = "Alamat Emel Rasmi Melaka dot My";
      emailBox.appendChild(emailLabel);

      const emailActionRow = document.createElement("div");
      emailActionRow.className = "mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between";

      const emailValueWrap = document.createElement("div");
      emailValueWrap.className = "min-w-0";

      const emailValue = document.createElement("p");
      emailValue.className = "break-all font-mono text-base font-bold text-blue-700 sm:text-lg";
      emailValue.textContent = fullEmail;
      emailValueWrap.appendChild(emailValue);

      const usernameSub = document.createElement("p");
      usernameSub.className = "mt-0.5 text-xs text-slate-500";
      usernameSub.textContent = "Username: " + (record.username || "-");
      emailValueWrap.appendChild(usernameSub);

      emailActionRow.appendChild(emailValueWrap);

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "min-h-[44px] shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500";
      copyBtn.textContent = "Salin Emel";
      copyBtn.addEventListener("click", function () {
        copyEmailToClipboard(fullEmail, copyBtn);
      });
      emailActionRow.appendChild(copyBtn);

      emailBox.appendChild(emailActionRow);
      card.appendChild(emailBox);

      const confirmWrap = document.createElement("div");
      confirmWrap.className = "mt-4 border-t border-slate-100 pt-4";

      const checkboxId = "confirm-maklum-" + String(record.id);
      const labelEl = document.createElement("label");
      labelEl.setAttribute("for", checkboxId);
      labelEl.className = "flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-blue-300 hover:bg-blue-50/40";

      const checkboxEl = document.createElement("input");
      checkboxEl.type = "checkbox";
      checkboxEl.id = checkboxId;
      checkboxEl.setAttribute("data-role", "confirm-checkbox");
      checkboxEl.className = "mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500";
      checkboxEl.checked = Boolean(record.sudah_maklum);

      const labelTextWrap = document.createElement("span");
      labelTextWrap.className = "text-sm leading-snug text-slate-800";

      const mainInstruction = document.createElement("span");
      mainInstruction.className = "font-semibold";
      mainInstruction.textContent = "Saya mengesahkan bahawa saya telah maklum akan username emel @melaka.my saya di atas.";
      labelTextWrap.appendChild(mainInstruction);

      const timestampEl = document.createElement("span");
      timestampEl.setAttribute("data-role", "timestamp-text");
      timestampEl.className = "mt-1 block text-xs font-medium text-emerald-700";
      labelTextWrap.appendChild(timestampEl);

      labelEl.appendChild(checkboxEl);
      labelEl.appendChild(labelTextWrap);
      confirmWrap.appendChild(labelEl);

      checkboxEl.addEventListener("change", function () {
        handleConfirmationToggle(record, checkboxEl, statusBadge, timestampEl);
      });

      updateResultCardStatusUI(record, checkboxEl, statusBadge, timestampEl);

      card.appendChild(confirmWrap);
      fragment.appendChild(card);
    }

    dom.resultsContainer.appendChild(fragment);
    dom.resultsSection.classList.remove("hidden");
  }

  async function executeSearch(noKpInput, silentRefresh) {
    const cleanedNoKp = sanitizeNoKp(noKpInput);

    if (cleanedNoKp.length !== 12) {
      if (!silentRefresh) {
        renderSearchResults([]);
        showAlertBox(dom.searchFeedback, "error", "Sila masukkan 12 digit No. Kad Pengenalan anda tanpa tanda \"-\" atau aksara lain.");
      }
      return;
    }

    if (state.searchAbortController) {
      state.searchAbortController.abort();
    }

    const controller = new AbortController();
    state.searchAbortController = controller;
    state.isSearching = true;
    state.activeSearchNoKp = cleanedNoKp;

    if (dom.btnSearch && !silentRefresh) {
      dom.btnSearch.disabled = true;
      dom.btnSearch.textContent = "Mencari...";
    }

    try {
      await window.ENV_READY;
      const supabase = await window.getSupabaseClient();

      let query = supabase.rpc("meldotmy_cari_pengguna", {
        p_no_kp: cleanedNoKp,
        p_nama_sekolah: null
      });

      if (typeof query.abortSignal === "function") {
        query = query.abortSignal(controller.signal);
      }

      const response = await query;

      if (controller.signal.aborted) {
        return;
      }

      if (response.error) {
        throw new Error(response.error.message);
      }

      const rows = Array.isArray(response.data) ? response.data : [];
      renderSearchResults(rows);

      if (rows.length === 0) {
        showAlertBox(
          dom.searchFeedback,
          "warning",
          "Tiada rekod ditemui bagi No. KP " + cleanedNoKp + ". Sila semak semula 12 digit No. Kad Pengenalan anda (tanpa tanda \"-\")."
        );
      } else if (!silentRefresh) {
        showAlertBox(
          dom.searchFeedback,
          "info",
          "Carian berjaya. Sila semak alamat emel anda dan tandakan kotak pengesahan di bawah."
        );
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        return;
      }
      if (!silentRefresh) {
        renderSearchResults([]);
        showAlertBox(
          dom.searchFeedback,
          "error",
          "Ralat semasa membuat carian: " + (err && err.message ? err.message : "Sila cuba sebentar lagi.")
        );
      }
    } finally {
      if (state.searchAbortController === controller) {
        state.searchAbortController = null;
      }
      state.isSearching = false;
      if (dom.btnSearch) {
        dom.btnSearch.disabled = false;
        dom.btnSearch.textContent = "Semak Emel";
      }
    }
  }

  function resetSearchView() {
    if (state.searchAbortController) {
      state.searchAbortController.abort();
      state.searchAbortController = null;
    }
    state.activeSearchNoKp = "";
    state.searchResults = [];

    if (dom.searchForm) {
      dom.searchForm.reset();
    }
    renderSearchResults([]);
    showAlertBox(dom.searchFeedback, "", "");
    if (dom.searchNoKpInput) {
      dom.searchNoKpInput.focus();
    }
  }

  function handleRealtimePenggunaChange(changeEvent) {
    if (!changeEvent || !changeEvent.newRecord) {
      return;
    }
    const incoming = changeEvent.newRecord;
    if (!state.searchResults || state.searchResults.length === 0) {
      return;
    }

    let matched = false;
    for (let i = 0; i < state.searchResults.length; i += 1) {
      if (String(state.searchResults[i].id) === String(incoming.id)) {
        state.searchResults[i].sudah_maklum = Boolean(incoming.sudah_maklum);
        state.searchResults[i].tarikh_maklum = incoming.tarikh_maklum || null;
        state.searchResults[i].updated_at = incoming.updated_at || state.searchResults[i].updated_at;
        matched = true;

        if (dom.resultsContainer) {
          const cardEl = dom.resultsContainer.querySelector('[data-record-id="' + String(incoming.id) + '"]');
          if (cardEl) {
            const cb = cardEl.querySelector('[data-role="confirm-checkbox"]');
            const badge = cardEl.querySelector('[data-role="status-badge"]');
            const ts = cardEl.querySelector('[data-role="timestamp-text"]');
            updateResultCardStatusUI(state.searchResults[i], cb, badge, ts);
          }
        }
      }
    }

    if (matched) {
      loadDashboardStats(false).catch(function () {});
    }
  }

  function updateMigrationProgressUI(progressInfo) {
    if (!dom.migrationProgressWrap || !dom.migrationProgressBar || !dom.migrationProgressText) {
      return;
    }
    dom.migrationProgressWrap.classList.remove("hidden");
    const pct = typeof progressInfo.percent === "number" ? progressInfo.percent : 0;
    dom.migrationProgressBar.style.width = pct + "%";
    dom.migrationProgressBar.setAttribute("aria-valuenow", String(pct));
    dom.migrationProgressText.textContent = (progressInfo.message || "Memproses...") + " (" + pct + "%)";
  }

  function setMigrationControlsBusy(isBusy) {
    if (dom.btnExportJson) {
      dom.btnExportJson.disabled = isBusy;
    }
    if (dom.btnImportJson) {
      dom.btnImportJson.disabled = isBusy;
    }
    if (dom.importJsonInput) {
      dom.importJsonInput.disabled = isBusy;
    }
    if (dom.btnCancelMigration) {
      if (isBusy) {
        dom.btnCancelMigration.classList.remove("hidden");
      } else {
        dom.btnCancelMigration.classList.add("hidden");
      }
    }
  }

  async function handleExportJsonClick() {
    const migration = window.MigrationService;
    if (!migration || migration.isBusy()) {
      return;
    }

    setMigrationControlsBusy(true);
    migration.renderStatusMessage(dom.migrationStatusBox, "info", "Memulakan eksport sandaran JSON...", []);

    try {
      const result = await migration.exportBackupJson({
        onProgress: updateMigrationProgressUI
      });

      migration.renderStatusMessage(
        dom.migrationStatusBox,
        "success",
        "Eksport sandaran JSON berjaya dimuat turun.",
        [
          "Nama fail: " + result.filename,
          "Jumlah sekolah: " + formatNumber(result.counts.meldotmy_sekolah),
          "Jumlah pengguna: " + formatNumber(result.counts.meldotmy_pengguna)
        ]
      );
    } catch (err) {
      const msg = err && err.message ? err.message : "Eksport gagal.";
      migration.renderStatusMessage(dom.migrationStatusBox, "error", "Eksport sandaran gagal.", [msg]);
    } finally {
      setMigrationControlsBusy(false);
    }
  }

  async function handleImportJsonClick() {
    const migration = window.MigrationService;
    if (!migration || migration.isBusy()) {
      return;
    }

    const file = dom.importJsonInput && dom.importJsonInput.files ? dom.importJsonInput.files[0] : null;
    if (!file) {
      migration.renderStatusMessage(
        dom.migrationStatusBox,
        "error",
        "Tiada fail dipilih.",
        ["Sila pilih fail sandaran berformat .json terlebih dahulu."]
      );
      return;
    }

    setMigrationControlsBusy(true);
    migration.renderStatusMessage(dom.migrationStatusBox, "info", "Mengesahkan dan memulihkan fail JSON...", []);

    try {
      const result = await migration.importBackupJson(file, {
        onProgress: updateMigrationProgressUI,
        onCompleted: async function () {
          await loadSchools(true);
          await loadDashboardStats(true);
          if (state.activeSearchNoKp) {
            await executeSearch(state.activeSearchNoKp, true);
          }
        }
      });

      if (dom.importJsonInput) {
        dom.importJsonInput.value = "";
      }

      migration.renderStatusMessage(
        dom.migrationStatusBox,
        "success",
        "Pemulihan data 1-ke-1 selesai sepenuhnya.",
        [
          "Rekod sekolah dipulihkan: " + formatNumber(result.counts.meldotmy_sekolah || 0),
          "Rekod pengguna dipulihkan: " + formatNumber(result.counts.meldotmy_pengguna || 0),
          "Jujukan ID pangkalan data telah diselaraskan semula."
        ]
      );
    } catch (err) {
      const msg = err && err.message ? err.message : "Pemulihan gagal.";
      migration.renderStatusMessage(dom.migrationStatusBox, "error", "Pemulihan sandaran JSON gagal.", [msg]);
    } finally {
      setMigrationControlsBusy(false);
    }
  }

  function applyAdminSessionState(user) {
    state.adminUser = user || null;
    const isAdmin = Boolean(state.adminUser);

    if (dom.btnOpenAdminLogin) {
      if (isAdmin) {
        dom.btnOpenAdminLogin.classList.add("hidden");
      } else {
        dom.btnOpenAdminLogin.classList.remove("hidden");
      }
    }

    if (dom.adminBadgeWrap) {
      if (isAdmin) {
        dom.adminBadgeWrap.classList.remove("hidden");
      } else {
        dom.adminBadgeWrap.classList.add("hidden");
      }
    }

    if (dom.adminEmailDisplay) {
      dom.adminEmailDisplay.textContent = isAdmin && state.adminUser.email
        ? state.adminUser.email
        : "";
    }

    if (dom.adminWorkspaceSection) {
      if (isAdmin) {
        dom.adminWorkspaceSection.classList.remove("hidden");
      } else {
        dom.adminWorkspaceSection.classList.add("hidden");
      }
    }
  }

  async function syncAdminSessionFromSupabase() {
    if (typeof window.getAuthenticatedAdmin !== "function") {
      applyAdminSessionState(null);
      return null;
    }
    try {
      const adminUser = await window.getAuthenticatedAdmin();
      applyAdminSessionState(adminUser);
      return adminUser;
    } catch (_) {
      applyAdminSessionState(null);
      return null;
    }
  }

  function openAdminLoginModal() {
    if (!dom.adminLoginModal) {
      return;
    }
    showAlertBox(dom.adminLoginFeedback, "", "");
    dom.adminLoginModal.classList.remove("hidden");
    if (dom.adminLoginEmail) {
      dom.adminLoginEmail.focus();
    }
  }

  function closeAdminLoginModal() {
    if (!dom.adminLoginModal) {
      return;
    }
    dom.adminLoginModal.classList.add("hidden");
    if (dom.adminLoginPassword) {
      dom.adminLoginPassword.value = "";
    }
    showAlertBox(dom.adminLoginFeedback, "", "");
  }

  async function handleAdminLoginSubmit(event) {
    event.preventDefault();
    if (state.isAuthenticatingAdmin) {
      return;
    }

    const emailVal = dom.adminLoginEmail ? String(dom.adminLoginEmail.value || "").trim() : "";
    const passwordVal = dom.adminLoginPassword ? String(dom.adminLoginPassword.value || "") : "";

    if (!emailVal || !passwordVal) {
      showAlertBox(dom.adminLoginFeedback, "error", "Sila masukkan emel dan kata laluan Super Admin.");
      return;
    }

    state.isAuthenticatingAdmin = true;
    if (dom.btnSubmitAdminLogin) {
      dom.btnSubmitAdminLogin.disabled = true;
      dom.btnSubmitAdminLogin.textContent = "Mengesahkan...";
    }

    try {
      await window.ENV_READY;
      const supabase = await window.getSupabaseClient();
      const signInRes = await supabase.auth.signInWithPassword({
        email: emailVal,
        password: passwordVal
      });

      if (signInRes.error) {
        throw new Error("Pengesahan gagal: " + signInRes.error.message);
      }

      const verifiedAdmin = await syncAdminSessionFromSupabase();
      if (!verifiedAdmin) {
        throw new Error("Akaun tidak disahkan dalam auth.users Supabase.");
      }

      if (dom.adminLoginForm) {
        dom.adminLoginForm.reset();
      }
      closeAdminLoginModal();
      showAlertBox(
        dom.globalBanner,
        "success",
        "Log masuk Super Admin berjaya (" + (verifiedAdmin.email || "auth.users") + "). Panel pentadbiran telah dibuka."
      );
    } catch (err) {
      if (dom.adminLoginPassword) {
        dom.adminLoginPassword.value = "";
      }
      showAlertBox(
        dom.adminLoginFeedback,
        "error",
        err && err.message ? err.message : "Gagal mengesahkan akaun Super Admin."
      );
    } finally {
      state.isAuthenticatingAdmin = false;
      if (dom.btnSubmitAdminLogin) {
        dom.btnSubmitAdminLogin.disabled = false;
        dom.btnSubmitAdminLogin.textContent = "Log Masuk Admin";
      }
    }
  }

  async function handleAdminLogoutClick() {
    try {
      await window.ENV_READY;
      const supabase = await window.getSupabaseClient();
      await supabase.auth.signOut();
    } catch (_) {}
    applyAdminSessionState(null);
    showAlertBox(dom.globalBanner, "info", "Sesi Super Admin telah ditamatkan.");
  }

  function updateCsvProgressUI(progressInfo) {
    if (!dom.csvProgressWrap || !dom.csvProgressBar || !dom.csvProgressText) {
      return;
    }
    dom.csvProgressWrap.classList.remove("hidden");
    const pct = typeof progressInfo.percent === "number" ? progressInfo.percent : 0;
    dom.csvProgressBar.style.width = pct + "%";
    dom.csvProgressBar.setAttribute("aria-valuenow", String(pct));
    dom.csvProgressText.textContent = (progressInfo.message || "Memproses...") + " (" + pct + "%)";
  }

  function setCsvControlsBusy(isBusy) {
    if (dom.btnImportCsv) {
      dom.btnImportCsv.disabled = isBusy;
    }
    if (dom.importCsvInput) {
      dom.importCsvInput.disabled = isBusy;
    }
    if (dom.btnCancelCsv) {
      if (isBusy) {
        dom.btnCancelCsv.classList.remove("hidden");
      } else {
        dom.btnCancelCsv.classList.add("hidden");
      }
    }
  }

  async function handleImportCsvClick() {
    const importer = window.CsvImporter;
    if (!importer || importer.isBusy()) {
      return;
    }

    if (!state.adminUser) {
      importer.renderStatusMessage(
        dom.csvStatusBox,
        "error",
        "Akses tidak dibenarkan.",
        ["Hanya Super Admin berdaftar dalam auth.users dibenarkan memuat naik CSV."]
      );
      return;
    }

    const file = dom.importCsvInput && dom.importCsvInput.files ? dom.importCsvInput.files[0] : null;
    if (!file) {
      importer.renderStatusMessage(
        dom.csvStatusBox,
        "error",
        "Tiada fail CSV dipilih.",
        ["Sila pilih fail berformat .csv terlebih dahulu."]
      );
      return;
    }

    setCsvControlsBusy(true);
    importer.renderStatusMessage(dom.csvStatusBox, "info", "Memulakan muat naik dan kemas kini CSV...", []);

    try {
      const result = await importer.importCsvFile(file, {
        onProgress: updateCsvProgressUI,
        onCompleted: async function () {
          await loadSchools(true);
          await loadDashboardStats(true);
          if (state.activeSearchNoKp) {
            await executeSearch(state.activeSearchNoKp, true);
          }
        }
      });

      if (dom.importCsvInput) {
        dom.importCsvInput.value = "";
      }

      importer.renderStatusMessage(
        dom.csvStatusBox,
        "success",
        "Kemas kini data CSV selesai sepenuhnya.",
        [
          "Jumlah baris CSV diproses: " + formatNumber(result.rows_processed || 0),
          "Sekolah baharu ditambah: " + formatNumber(result.schools_inserted || 0),
          "Rekod pengguna dikemas kini: " + formatNumber(result.users_upserted || 0)
        ]
      );
    } catch (err) {
      const msg = err && err.message ? err.message : "Muat naik CSV gagal.";
      importer.renderStatusMessage(dom.csvStatusBox, "error", "Muat naik CSV gagal.", [msg]);
    } finally {
      setCsvControlsBusy(false);
    }
  }

  function bindEventListeners() {
    if (dom.searchNoKpInput) {
      dom.searchNoKpInput.addEventListener("input", function () {
        const digitsOnly = sanitizeNoKp(dom.searchNoKpInput.value).slice(0, 12);
        if (dom.searchNoKpInput.value !== digitsOnly) {
          dom.searchNoKpInput.value = digitsOnly;
        }
      });
    }

    if (dom.searchForm) {
      dom.searchForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const noKpVal = dom.searchNoKpInput ? dom.searchNoKpInput.value : "";
        executeSearch(noKpVal, false);
      });
    }

    if (dom.btnResetSearch) {
      dom.btnResetSearch.addEventListener("click", function () {
        resetSearchView();
      });
    }

    if (dom.statsScopeSelect) {
      dom.statsScopeSelect.addEventListener("change", function () {
        state.statsSekolahFilter = dom.statsScopeSelect.value || "";
        loadDashboardStats(false).catch(function (err) {
          showAlertBox(dom.globalBanner, "error", err && err.message ? err.message : "Gagal memuatkan statistik.");
        });
      });
    }

    if (dom.btnRefreshStats) {
      dom.btnRefreshStats.addEventListener("click", function () {
        state.statsSekolahFilter = "";
        if (dom.statsScopeSelect) {
          dom.statsScopeSelect.value = "";
        }
        Promise.all([
          loadSchools(true),
          loadDashboardStats(true)
        ]).catch(function (err) {
          showAlertBox(dom.globalBanner, "error", err && err.message ? err.message : "Gagal menyegarkan statistik.");
        });
      });
    }

    if (dom.toggleMigrationPanel && dom.migrationPanel) {
      dom.toggleMigrationPanel.addEventListener("click", function () {
        const isHidden = dom.migrationPanel.classList.contains("hidden");
        if (isHidden) {
          dom.migrationPanel.classList.remove("hidden");
          dom.toggleMigrationPanel.setAttribute("aria-expanded", "true");
        } else {
          dom.migrationPanel.classList.add("hidden");
          dom.toggleMigrationPanel.setAttribute("aria-expanded", "false");
        }
      });
    }

    if (dom.btnExportJson) {
      dom.btnExportJson.addEventListener("click", handleExportJsonClick);
    }

    if (dom.btnImportJson) {
      dom.btnImportJson.addEventListener("click", handleImportJsonClick);
    }

    if (dom.btnCancelMigration) {
      dom.btnCancelMigration.addEventListener("click", function () {
        if (window.MigrationService && typeof window.MigrationService.cancelActiveOperation === "function") {
          window.MigrationService.cancelActiveOperation();
        }
      });
    }

    if (dom.btnOpenAdminLogin) {
      dom.btnOpenAdminLogin.addEventListener("click", openAdminLoginModal);
    }

    if (dom.btnCloseAdminModal) {
      dom.btnCloseAdminModal.addEventListener("click", closeAdminLoginModal);
    }

    if (dom.adminLoginModal) {
      dom.adminLoginModal.addEventListener("click", function (event) {
        if (event.target === dom.adminLoginModal) {
          closeAdminLoginModal();
        }
      });
    }

    if (dom.adminLoginForm) {
      dom.adminLoginForm.addEventListener("submit", handleAdminLoginSubmit);
    }

    if (dom.btnAdminLogout) {
      dom.btnAdminLogout.addEventListener("click", handleAdminLogoutClick);
    }

    if (dom.btnImportCsv) {
      dom.btnImportCsv.addEventListener("click", handleImportCsvClick);
    }

    if (dom.btnCancelCsv) {
      dom.btnCancelCsv.addEventListener("click", function () {
        if (window.CsvImporter && typeof window.CsvImporter.cancelActiveImport === "function") {
          window.CsvImporter.cancelActiveImport();
        }
      });
    }
  }

  async function bootstrapApplication() {
    cacheDomReferences();
    bindEventListeners();

    try {
      await window.ENV_READY;
      const supabase = await window.getSupabaseClient();

      await syncAdminSessionFromSupabase();

      if (supabase && supabase.auth && typeof supabase.auth.onAuthStateChange === "function") {
        supabase.auth.onAuthStateChange(function (_event, session) {
          const sessionUser = session && session.user ? session.user : null;
          applyAdminSessionState(sessionUser);
        });
      }

      await Promise.all([
        loadSchools(false),
        loadDashboardStats(false)
      ]);

      if (window.RealtimeSync && typeof window.RealtimeSync.init === "function") {
        window.RealtimeSync.init({
          onPenggunaChange: handleRealtimePenggunaChange,
          onSekolahChange: function () {
            loadSchools(true).catch(function () {});
            loadDashboardStats(true).catch(function () {});
          },
          onSyncRequired: function (reason) {
            if (reason === "visibilitychange" || reason === "online") {
              loadDashboardStats(false).catch(function () {});
              if (state.activeSearchNoKp) {
                executeSearch(state.activeSearchNoKp, true);
              }
            }
          },
          onStatusChange: updateRealtimeBadge
        }).catch(function () {
          updateRealtimeBadge("disconnected");
        });
      }
    } catch (err) {
      showAlertBox(
        dom.globalBanner,
        "error",
        "Ralat sambungan sistem: " + (err && err.message ? err.message : "Sila semak konfigurasi pelayan.")
      );
      updateRealtimeBadge("error");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrapApplication);
  } else {
    bootstrapApplication();
  }
})();