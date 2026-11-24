(function () {
  "use strict";

  const EMAIL_DOMAIN = "@melaka.my";
  const EMAIL_LOGIN_URL = "https://email.melaka.my/auth/login.html";
  const DEFAULT_EMAIL_PASSWORD = "Email@26";
  const SEKOLAH_CACHE_TTL_MS = 30 * 60 * 1000;
  const STATS_CACHE_TTL_MS = 2 * 60 * 1000;

  const state = {
    schools: [],
    schoolsSet: new Set(),
    activeSearchNoKp: "",
    searchResults: [],
    statsSekolahFilter: "",
    statsSchoolDropdownIndex: -1,
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

    dom.statsScopeInput = document.getElementById("statsScopeInput");
    dom.statsScopeListbox = document.getElementById("statsScopeListbox");
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

  function hideStatsSchoolDropdown() {
    state.statsSchoolDropdownIndex = -1;
    if (dom.statsScopeListbox) {
      dom.statsScopeListbox.classList.add("hidden");
    }
    if (dom.statsScopeInput) {
      dom.statsScopeInput.setAttribute("aria-expanded", "false");
    }
  }

  function highlightStatsSchoolOption(index) {
    if (!dom.statsScopeListbox) {
      return;
    }
    const items = dom.statsScopeListbox.querySelectorAll("[data-stats-school-option]");
    if (!items.length) {
      state.statsSchoolDropdownIndex = -1;
      return;
    }
    let nextIdx = index;
    if (nextIdx < 0) {
      nextIdx = items.length - 1;
    } else if (nextIdx >= items.length) {
      nextIdx = 0;
    }
    state.statsSchoolDropdownIndex = nextIdx;

    for (let i = 0; i < items.length; i += 1) {
      const isSelected = i === nextIdx;
      items[i].setAttribute("aria-selected", isSelected ? "true" : "false");
      if (isSelected) {
        items[i].classList.add("bg-blue-50", "text-blue-800");
        if (typeof items[i].scrollIntoView === "function") {
          items[i].scrollIntoView({ block: "nearest" });
        }
      } else {
        items[i].classList.remove("bg-blue-50", "text-blue-800");
      }
    }
  }

  function selectStatsSchoolScope(schoolValue) {
    const normalizedVal = schoolValue && state.schoolsSet.has(schoolValue) ? schoolValue : "";
    state.statsSekolahFilter = normalizedVal;
    if (dom.statsScopeInput) {
      dom.statsScopeInput.value = normalizedVal;
    }
    hideStatsSchoolDropdown();
    loadDashboardStats(false).catch(function (err) {
      showAlertBox(dom.globalBanner, "error", err && err.message ? err.message : "Gagal memuatkan statistik.");
    });
  }

  function filterMatchingSchools(rawQuery) {
    const query = String(rawQuery || "").trim().toUpperCase();
    if (!query) {
      return state.schools.slice();
    }
    const tokens = query.split(/\s+/).filter(Boolean);
    const prefixMatches = [];
    const substringMatches = [];
    const tokenMatches = [];

    for (let i = 0; i < state.schools.length; i += 1) {
      const schoolName = state.schools[i];
      const upperSchool = schoolName.toUpperCase();
      if (upperSchool.indexOf(query) === 0) {
        prefixMatches.push(schoolName);
      } else if (upperSchool.indexOf(query) !== -1) {
        substringMatches.push(schoolName);
      } else if (tokens.length > 1) {
        let allTokensFound = true;
        for (let t = 0; t < tokens.length; t += 1) {
          if (upperSchool.indexOf(tokens[t]) === -1) {
            allTokensFound = false;
            break;
          }
        }
        if (allTokensFound) {
          tokenMatches.push(schoolName);
        }
      }
    }

    return prefixMatches.concat(substringMatches, tokenMatches);
  }

  function renderStatsSchoolDropdown(filterText) {
    if (!dom.statsScopeListbox || !dom.statsScopeInput) {
      return;
    }

    clearElementChildren(dom.statsScopeListbox);
    state.statsSchoolDropdownIndex = -1;

    const matches = filterMatchingSchools(filterText);
    const frag = document.createDocumentFragment();

    const headerNote = document.createElement("div");
    headerNote.className = "sticky top-0 border-b border-slate-100 bg-slate-50 px-3.5 py-2 text-[11px] font-semibold text-slate-500";
    headerNote.textContent = matches.length > 0
      ? "Paparan: " + formatNumber(matches.length) + " daripada " + formatNumber(state.schools.length) + " sekolah"
      : "Tiada sekolah sepadan ditemui";
    frag.appendChild(headerNote);

    const allOptionBtn = document.createElement("button");
    allOptionBtn.type = "button";
    allOptionBtn.setAttribute("role", "option");
    allOptionBtn.setAttribute("aria-selected", state.statsSekolahFilter === "" ? "true" : "false");
    allOptionBtn.setAttribute("data-stats-school-option", "");
    allOptionBtn.className = "block w-full border-b border-slate-100 px-3.5 py-2.5 text-left text-xs font-semibold text-blue-700 transition hover:bg-blue-50 focus:bg-blue-50 focus:outline-none sm:text-sm";
    allOptionBtn.textContent = "Semua Sekolah Negeri Melaka (" + formatNumber(state.schools.length) + ")";
    allOptionBtn.addEventListener("mousedown", function (event) {
      event.preventDefault();
    });
    allOptionBtn.addEventListener("click", function () {
      selectStatsSchoolScope("");
    });
    frag.appendChild(allOptionBtn);

    for (let i = 0; i < matches.length; i += 1) {
      const schoolName = matches[i];
      const optionBtn = document.createElement("button");
      optionBtn.type = "button";
      optionBtn.setAttribute("role", "option");
      optionBtn.setAttribute("aria-selected", state.statsSekolahFilter === schoolName ? "true" : "false");
      optionBtn.setAttribute("data-stats-school-option", schoolName);
      optionBtn.className = "block w-full px-3.5 py-2.5 text-left text-xs font-medium text-slate-800 transition hover:bg-blue-50 hover:text-blue-800 focus:bg-blue-50 focus:outline-none sm:text-sm";
      optionBtn.textContent = schoolName;

      optionBtn.addEventListener("mousedown", function (event) {
        event.preventDefault();
      });
      optionBtn.addEventListener("click", function () {
        selectStatsSchoolScope(schoolName);
      });

      frag.appendChild(optionBtn);
    }

    dom.statsScopeListbox.appendChild(frag);
    dom.statsScopeListbox.classList.remove("hidden");
    dom.statsScopeInput.setAttribute("aria-expanded", "true");
  }

  function populateSchoolControls(schoolList) {
    state.schools = normalizeSchoolArray(schoolList);
    state.schoolsSet = new Set(state.schools);

    if (dom.statsScopeInput) {
      dom.statsScopeInput.placeholder = "Semua Sekolah Negeri Melaka (" + formatNumber(state.schools.length) + ")";
      const previousVal = state.statsSekolahFilter || String(dom.statsScopeInput.value || "").trim().toUpperCase();
      if (previousVal && state.schoolsSet.has(previousVal)) {
        state.statsSekolahFilter = previousVal;
        dom.statsScopeInput.value = previousVal;
      } else if (state.statsSekolahFilter && !state.schoolsSet.has(state.statsSekolahFilter)) {
        state.statsSekolahFilter = "";
        dom.statsScopeInput.value = "";
      }
    }

    if (dom.statsScopeListbox && !dom.statsScopeListbox.classList.contains("hidden")) {
      renderStatsSchoolDropdown(dom.statsScopeInput ? dom.statsScopeInput.value : "");
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

  async function writeTextToClipboard(textValue) {
    if (!textValue) {
      return false;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(textValue);
        return true;
      } catch (_) {}
    }
    try {
      const tempInput = document.createElement("input");
      tempInput.value = textValue;
      tempInput.setAttribute("readonly", "");
      tempInput.style.position = "fixed";
      tempInput.style.opacity = "0";
      document.body.appendChild(tempInput);
      tempInput.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(tempInput);
      return Boolean(copied);
    } catch (_) {
      return false;
    }
  }

  async function copyEmailToClipboard(emailText, buttonEl) {
    if (!emailText) {
      return false;
    }

    const copied = await writeTextToClipboard(emailText);
    if (!copied) {
      showAlertBox(dom.searchFeedback, "warning", "Tidak dapat menyalin secara automatik. Sila salin alamat emel secara manual.");
      return false;
    }

    if (buttonEl) {
      buttonEl.textContent = "Emel Disalin";
      buttonEl.classList.remove(
        "border-slate-300",
        "bg-white",
        "text-slate-700",
        "hover:bg-slate-100",
        "focus:ring-blue-500"
      );
      buttonEl.classList.add(
        "border-emerald-600",
        "bg-emerald-600",
        "text-white",
        "hover:bg-emerald-700",
        "focus:ring-emerald-500"
      );

      const emailBoxEl = buttonEl.closest('[data-role="email-box"]');
      if (emailBoxEl) {
        const noticeEl = emailBoxEl.querySelector('[data-role="pre-copy-notice"]');
        if (noticeEl) {
          noticeEl.classList.add("hidden");
        }
        const accessPanelEl = emailBoxEl.querySelector('[data-role="login-access-panel"]');
        if (accessPanelEl) {
          accessPanelEl.classList.remove("hidden");
        }
      }
    }
    return true;
  }

  function resetCopyButtonUI(buttonEl) {
    if (!buttonEl) {
      return;
    }
    buttonEl.dataset.copyTriggered = "false";
    buttonEl.textContent = "Salin Emel";
    buttonEl.classList.remove(
      "border-emerald-600",
      "bg-emerald-600",
      "text-white",
      "hover:bg-emerald-700",
      "focus:ring-emerald-500"
    );
    buttonEl.classList.add(
      "border-slate-300",
      "bg-white",
      "text-slate-700",
      "hover:bg-slate-100",
      "focus:ring-blue-500"
    );

    const emailBoxEl = buttonEl.closest('[data-role="email-box"]');
    if (emailBoxEl) {
      const noticeEl = emailBoxEl.querySelector('[data-role="pre-copy-notice"]');
      if (noticeEl) {
        noticeEl.classList.remove("hidden");
      }
      const accessPanelEl = emailBoxEl.querySelector('[data-role="login-access-panel"]');
      if (accessPanelEl) {
        accessPanelEl.classList.add("hidden");
      }
      const copyPwdBtnEl = emailBoxEl.querySelector('[data-role="copy-password-btn"]');
      if (copyPwdBtnEl) {
        copyPwdBtnEl.textContent = "Salin Kata Laluan";
        copyPwdBtnEl.classList.remove(
          "border-emerald-600",
          "bg-emerald-600",
          "text-white",
          "hover:bg-emerald-700"
        );
        copyPwdBtnEl.classList.add(
          "border-slate-300",
          "bg-white",
          "text-slate-700",
          "hover:bg-slate-100"
        );
      }
    }
  }

  async function handleConfirmationToggle(record, checkboxEl, cardStatusBadgeEl, cardTimestampEl, copyBtnEl) {
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

      updateResultCardStatusUI(record, checkboxEl, cardStatusBadgeEl, cardTimestampEl, copyBtnEl);

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

  function updateResultCardStatusUI(record, checkboxEl, statusBadgeEl, timestampEl, copyBtnEl) {
    const isConfirmed = Boolean(record.sudah_maklum);
    if (checkboxEl) {
      checkboxEl.checked = isConfirmed;
    }
    if (!isConfirmed && copyBtnEl) {
      resetCopyButtonUI(copyBtnEl);
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
      emailBox.setAttribute("data-role", "email-box");
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
      copyBtn.setAttribute("data-role", "copy-email-btn");
      copyBtn.className = "min-h-[44px] shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500";
      copyBtn.textContent = "Salin Emel";
      emailActionRow.appendChild(copyBtn);

      emailBox.appendChild(emailActionRow);

      const preCopyNotice = document.createElement("p");
      preCopyNotice.setAttribute("data-role", "pre-copy-notice");
      preCopyNotice.className = "mt-3 rounded-lg border border-blue-200 bg-blue-50/90 px-3 py-2 text-xs font-medium leading-relaxed text-blue-800";
      preCopyNotice.textContent = "Makluman: Sila klik butang \"Salin Emel\" di atas untuk menyalin alamat emel anda serta memaparkan kata laluan lalai dan pautan terus ke laman log masuk emel @melaka.my.";
      emailBox.appendChild(preCopyNotice);

      const loginAccessPanel = document.createElement("div");
      loginAccessPanel.setAttribute("data-role", "login-access-panel");
      loginAccessPanel.className = "mt-3 hidden rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5";

      const accessHeading = document.createElement("p");
      accessHeading.className = "text-xs font-semibold text-emerald-900";
      accessHeading.textContent = "Emel berjaya disalin! Sila teruskan log masuk ke akaun emel @melaka.my anda:";
      loginAccessPanel.appendChild(accessHeading);

      const passwordRow = document.createElement("div");
      passwordRow.className = "mt-2 flex flex-col gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between";

      const passwordInfo = document.createElement("p");
      passwordInfo.className = "text-xs font-medium text-slate-700";
      passwordInfo.appendChild(document.createTextNode("Kata Laluan Lalai: "));

      const passwordCode = document.createElement("span");
      passwordCode.className = "font-mono text-sm font-bold text-slate-900";
      passwordCode.textContent = DEFAULT_EMAIL_PASSWORD;
      passwordInfo.appendChild(passwordCode);
      passwordRow.appendChild(passwordInfo);

      const copyPwdBtn = document.createElement("button");
      copyPwdBtn.type = "button";
      copyPwdBtn.setAttribute("data-role", "copy-password-btn");
      copyPwdBtn.className = "min-h-[36px] shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500";
      copyPwdBtn.textContent = "Salin Kata Laluan";
      copyPwdBtn.addEventListener("click", async function () {
        const copiedPwd = await writeTextToClipboard(DEFAULT_EMAIL_PASSWORD);
        if (copiedPwd) {
          copyPwdBtn.textContent = "Kata Laluan Disalin";
          copyPwdBtn.classList.remove("border-slate-300", "bg-white", "text-slate-700", "hover:bg-slate-100");
          copyPwdBtn.classList.add("border-emerald-600", "bg-emerald-600", "text-white", "hover:bg-emerald-700");
        }
      });
      passwordRow.appendChild(copyPwdBtn);
      loginAccessPanel.appendChild(passwordRow);

      const loginLinkBtn = document.createElement("a");
      loginLinkBtn.href = EMAIL_LOGIN_URL;
      loginLinkBtn.target = "_blank";
      loginLinkBtn.rel = "noopener noreferrer";
      loginLinkBtn.className = "mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-auto sm:text-sm";
      loginLinkBtn.textContent = "Log Masuk Emel @melaka.my";
      loginAccessPanel.appendChild(loginLinkBtn);

      emailBox.appendChild(loginAccessPanel);
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

      copyBtn.addEventListener("click", async function () {
        const isFirstCopyClick = copyBtn.dataset.copyTriggered !== "true";
        copyBtn.dataset.copyTriggered = "true";
        await copyEmailToClipboard(fullEmail, copyBtn);
        if (isFirstCopyClick && !checkboxEl.checked && !checkboxEl.disabled) {
          checkboxEl.checked = true;
          handleConfirmationToggle(record, checkboxEl, statusBadge, timestampEl, copyBtn);
        }
      });

      checkboxEl.addEventListener("change", function () {
        handleConfirmationToggle(record, checkboxEl, statusBadge, timestampEl, copyBtn);
      });

      updateResultCardStatusUI(record, checkboxEl, statusBadge, timestampEl, copyBtn);

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
    if (state.adminUser && window.AdminDrilldown && typeof window.AdminDrilldown.refreshIfOpen === "function") {
      window.AdminDrilldown.refreshIfOpen().catch(function () {});
    }
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
            const copyBtnEl = cardEl.querySelector('[data-role="copy-email-btn"]');
            updateResultCardStatusUI(state.searchResults[i], cb, badge, ts, copyBtnEl);
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
          if (window.AdminDrilldown && typeof window.AdminDrilldown.refreshIfOpen === "function") {
            await window.AdminDrilldown.refreshIfOpen();
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

    if (window.AdminDrilldown && typeof window.AdminDrilldown.setAdminEnabled === "function") {
      window.AdminDrilldown.setAdminEnabled(isAdmin);
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
          if (window.AdminDrilldown && typeof window.AdminDrilldown.refreshIfOpen === "function") {
            await window.AdminDrilldown.refreshIfOpen();
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

    if (dom.statsScopeInput) {
      dom.statsScopeInput.addEventListener("focus", function () {
        const currentVal = String(dom.statsScopeInput.value || "").trim().toUpperCase();
        renderStatsSchoolDropdown(currentVal === state.statsSekolahFilter ? "" : currentVal);
      });

      dom.statsScopeInput.addEventListener("click", function () {
        const currentVal = String(dom.statsScopeInput.value || "").trim().toUpperCase();
        renderStatsSchoolDropdown(currentVal === state.statsSekolahFilter ? "" : currentVal);
      });

      dom.statsScopeInput.addEventListener("input", function () {
        const start = dom.statsScopeInput.selectionStart;
        const end = dom.statsScopeInput.selectionEnd;
        const upperVal = String(dom.statsScopeInput.value || "").toUpperCase();
        if (dom.statsScopeInput.value !== upperVal) {
          dom.statsScopeInput.value = upperVal;
          if (typeof start === "number" && typeof end === "number" && typeof dom.statsScopeInput.setSelectionRange === "function") {
            dom.statsScopeInput.setSelectionRange(start, end);
          }
        }

        const trimmedUpper = upperVal.trim();
        if (!trimmedUpper && state.statsSekolahFilter !== "") {
          state.statsSekolahFilter = "";
          loadDashboardStats(false).catch(function () {});
        } else if (state.schoolsSet.has(trimmedUpper) && state.statsSekolahFilter !== trimmedUpper) {
          state.statsSekolahFilter = trimmedUpper;
          loadDashboardStats(false).catch(function () {});
        }

        renderStatsSchoolDropdown(upperVal);
      });

      dom.statsScopeInput.addEventListener("keydown", function (event) {
        if (!dom.statsScopeListbox || dom.statsScopeListbox.classList.contains("hidden")) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            const currentVal = String(dom.statsScopeInput.value || "").trim().toUpperCase();
            renderStatsSchoolDropdown(currentVal === state.statsSekolahFilter ? "" : currentVal);
            highlightStatsSchoolOption(0);
          }
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          highlightStatsSchoolOption(state.statsSchoolDropdownIndex + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          highlightStatsSchoolOption(state.statsSchoolDropdownIndex - 1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          const items = dom.statsScopeListbox.querySelectorAll("[data-stats-school-option]");
          if (state.statsSchoolDropdownIndex >= 0 && items[state.statsSchoolDropdownIndex]) {
            const chosen = items[state.statsSchoolDropdownIndex].getAttribute("data-stats-school-option") || "";
            selectStatsSchoolScope(chosen);
          } else {
            const typedUpper = String(dom.statsScopeInput.value || "").trim().toUpperCase();
            if (!typedUpper) {
              selectStatsSchoolScope("");
            } else if (state.schoolsSet.has(typedUpper)) {
              selectStatsSchoolScope(typedUpper);
            } else {
              const matches = filterMatchingSchools(typedUpper);
              if (matches.length === 1) {
                selectStatsSchoolScope(matches[0]);
              }
            }
          }
        } else if (event.key === "Escape") {
          hideStatsSchoolDropdown();
        }
      });
    }

    document.addEventListener("click", function (event) {
      if (!dom.statsScopeListbox || dom.statsScopeListbox.classList.contains("hidden")) {
        return;
      }
      const target = event.target;
      if (dom.statsScopeInput && dom.statsScopeInput.contains(target)) {
        return;
      }
      if (dom.statsScopeListbox.contains(target)) {
        return;
      }
      hideStatsSchoolDropdown();
    });

    if (dom.btnRefreshStats) {
      dom.btnRefreshStats.addEventListener("click", function () {
        state.statsSekolahFilter = "";
        if (dom.statsScopeInput) {
          dom.statsScopeInput.value = "";
        }
        hideStatsSchoolDropdown();
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

    if (window.AdminDrilldown && typeof window.AdminDrilldown.init === "function") {
      window.AdminDrilldown.init({
        getSchoolScope: function () {
          return state.statsSekolahFilter;
        }
      });
    }

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