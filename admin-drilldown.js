(function () {
  "use strict";

  const EMAIL_DOMAIN = "@melaka.my";

  const state = {
    initialized: false,
    isAdminEnabled: false,
    isModalOpen: false,
    viewMode: "schools",
    targetStatus: true,
    schoolScopeOverride: null,
    selectedSchool: "",
    schoolsData: [],
    usersData: [],
    searchQuery: "",
    activeAbortController: null,
    getSchoolScopeFn: null
  };

  const dom = {};

  function cacheDomReferences() {
    dom.cardSudah = document.getElementById("statCardSudahMaklum");
    dom.cardBelum = document.getElementById("statCardBelumMaklum");
    dom.hintSudah = document.getElementById("statCardSudahMaklumHint");
    dom.hintBelum = document.getElementById("statCardBelumMaklumHint");

    dom.modal = document.getElementById("adminDrilldownModal");
    dom.title = document.getElementById("adminDrilldownTitle");
    dom.subtitle = document.getElementById("adminDrilldownSubtitle");
    dom.scopeBanner = document.getElementById("adminDrilldownScopeBanner");
    dom.btnBack = document.getElementById("btnAdminDrilldownBack");
    dom.btnClose = document.getElementById("btnCloseAdminDrilldown");
    dom.searchInput = document.getElementById("adminDrilldownSearchInput");
    dom.countBadge = document.getElementById("adminDrilldownCountBadge");
    dom.feedback = document.getElementById("adminDrilldownFeedback");
    dom.body = document.getElementById("adminDrilldownBody");
  }

  function clearChildren(el) {
    if (!el) {
      return;
    }
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
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
      return "-";
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

  function buildFullEmail(row) {
    if (row && typeof row.emel === "string" && row.emel.indexOf("@") !== -1) {
      return row.emel.trim().toLowerCase();
    }
    const uname = row && row.username ? String(row.username).trim().toLowerCase() : "";
    return uname ? uname + EMAIL_DOMAIN : "-";
  }

  function maskNoKp(rawKp) {
    const cleaned = String(rawKp || "").trim();
    if (!cleaned || cleaned === "-") {
      return "-";
    }
    if (cleaned.indexOf("*") !== -1) {
      return cleaned;
    }
    const digits = cleaned.replace(/[^0-9]/g, "");
    if (digits.length >= 6) {
      return digits.slice(0, 6) + "******";
    }
    return "******";
  }

  function abortInFlightRequest() {
    if (state.activeAbortController) {
      state.activeAbortController.abort();
      state.activeAbortController = null;
    }
  }

  function showFeedback(type, message) {
    if (!dom.feedback) {
      return;
    }
    clearChildren(dom.feedback);
    if (!message) {
      dom.feedback.classList.add("hidden");
      return;
    }

    const box = document.createElement("div");
    let tone = "border-blue-200 bg-blue-50 text-blue-800";
    if (type === "error") {
      tone = "border-red-200 bg-red-50 text-red-800";
    } else if (type === "warning") {
      tone = "border-amber-200 bg-amber-50 text-amber-800";
    }
    box.className = "rounded-xl border px-4 py-3 text-xs font-medium sm:text-sm " + tone;
    box.setAttribute("role", "status");
    box.textContent = message;

    dom.feedback.appendChild(box);
    dom.feedback.classList.remove("hidden");
  }

  function renderLoadingSkeleton(labelText) {
    if (!dom.body) {
      return;
    }
    clearChildren(dom.body);
    const wrap = document.createElement("div");
    wrap.className = "flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-10 text-center";

    const spinner = document.createElement("div");
    spinner.className = "h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent";
    wrap.appendChild(spinner);

    const text = document.createElement("p");
    text.className = "mt-3 text-xs font-medium text-slate-600 sm:text-sm";
    text.textContent = labelText || "Memuatkan data...";
    wrap.appendChild(text);

    dom.body.appendChild(wrap);
  }

  function updateCardInteractiveAppearance(cardEl, hintEl, enabled, activeToneClasses) {
    if (!cardEl) {
      return;
    }
    if (enabled) {
      cardEl.setAttribute("role", "button");
      cardEl.setAttribute("tabindex", "0");
      cardEl.setAttribute("aria-disabled", "false");
      cardEl.classList.add("cursor-pointer", "transition", "hover:shadow-sm");
      for (let i = 0; i < activeToneClasses.length; i += 1) {
        cardEl.classList.add(activeToneClasses[i]);
      }
      if (hintEl) {
        hintEl.classList.remove("hidden");
      }
    } else {
      cardEl.removeAttribute("role");
      cardEl.setAttribute("tabindex", "-1");
      cardEl.setAttribute("aria-disabled", "true");
      cardEl.classList.remove("cursor-pointer", "transition", "hover:shadow-sm");
      for (let i = 0; i < activeToneClasses.length; i += 1) {
        cardEl.classList.remove(activeToneClasses[i]);
      }
      if (hintEl) {
        hintEl.classList.add("hidden");
      }
    }
  }

  function closeModal() {
    abortInFlightRequest();
    state.isModalOpen = false;
    state.viewMode = "schools";
    state.selectedSchool = "";
    state.searchQuery = "";
    if (dom.searchInput) {
      dom.searchInput.value = "";
    }
    if (dom.modal) {
      dom.modal.classList.add("hidden");
    }
    showFeedback("", "");
  }

  function setAdminEnabled(enabled) {
    state.isAdminEnabled = Boolean(enabled);

    updateCardInteractiveAppearance(
      dom.cardSudah,
      dom.hintSudah,
      state.isAdminEnabled,
      ["hover:border-emerald-400", "hover:bg-emerald-50"]
    );

    updateCardInteractiveAppearance(
      dom.cardBelum,
      dom.hintBelum,
      state.isAdminEnabled,
      ["hover:border-amber-400", "hover:bg-amber-50"]
    );

    if (!state.isAdminEnabled) {
      state.schoolsData = [];
      state.usersData = [];
      state.schoolScopeOverride = null;
      closeModal();
    }
  }

  async function verifyAdminSessionActive() {
    if (!state.isAdminEnabled) {
      return false;
    }
    const verifyFn = typeof window.verifySuperAdminServer === "function"
      ? window.verifySuperAdminServer
      : typeof window.getAuthenticatedAdmin === "function"
        ? window.getAuthenticatedAdmin
        : null;
    if (!verifyFn) {
      setAdminEnabled(false);
      return false;
    }
    try {
      const user = await verifyFn();
      if (!user) {
        setAdminEnabled(false);
        return false;
      }
      return true;
    } catch (_) {
      setAdminEnabled(false);
      return false;
    }
  }

  function getActiveSchoolScope() {
    if (state.schoolScopeOverride !== null) {
      return state.schoolScopeOverride;
    }
    if (typeof state.getSchoolScopeFn === "function") {
      const val = state.getSchoolScopeFn();
      return val && String(val).trim() !== "" ? String(val).trim() : "";
    }
    return "";
  }

  function renderScopeBanner() {
    if (!dom.scopeBanner) {
      return;
    }
    clearChildren(dom.scopeBanner);

    const activeScope = getActiveSchoolScope();
    if (state.viewMode !== "schools" || !activeScope) {
      dom.scopeBanner.classList.add("hidden");
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-3.5 py-2 text-xs text-blue-900";

    const info = document.createElement("span");
    info.textContent = "Tapisan skop sekolah aktif: " + activeScope;
    wrap.appendChild(info);

    const showAllBtn = document.createElement("button");
    showAllBtn.type = "button";
    showAllBtn.className = "min-h-[36px] rounded-lg border border-blue-300 bg-white px-3 py-1 text-xs font-semibold text-blue-800 transition hover:bg-blue-100";
    showAllBtn.textContent = "Papar Semua Sekolah";
    showAllBtn.addEventListener("click", function () {
      state.schoolScopeOverride = "";
      loadSchoolsForStatus(state.targetStatus);
    });
    wrap.appendChild(showAllBtn);

    dom.scopeBanner.appendChild(wrap);
    dom.scopeBanner.classList.remove("hidden");
  }

  function getFilteredSchools() {
    const q = String(state.searchQuery || "").trim().toUpperCase();
    if (!q) {
      return state.schoolsData;
    }
    const filtered = [];
    for (let i = 0; i < state.schoolsData.length; i += 1) {
      const row = state.schoolsData[i];
      const name = String(row.nama_sekolah || "").toUpperCase();
      if (name.indexOf(q) !== -1) {
        filtered.push(row);
      }
    }
    return filtered;
  }

  function renderSchoolsListView() {
    if (!dom.body) {
      return;
    }
    clearChildren(dom.body);

    const statusLabel = state.targetStatus ? "Sudah Maklum" : "Belum Maklum";
    if (dom.title) {
      dom.title.textContent = "Senarai Sekolah Terlibat — " + statusLabel;
    }
    if (dom.subtitle) {
      dom.subtitle.textContent = "Klik pada mana-mana sekolah untuk memaparkan senarai ID pengguna yang terlibat.";
    }
    if (dom.btnBack) {
      dom.btnBack.classList.add("hidden");
    }
    if (dom.searchInput) {
      dom.searchInput.placeholder = "Cari nama sekolah terlibat...";
    }

    renderScopeBanner();

    const rows = getFilteredSchools();
    if (dom.countBadge) {
      dom.countBadge.textContent = formatNumber(rows.length) + " / " + formatNumber(state.schoolsData.length) + " Sekolah";
    }

    if (rows.length === 0) {
      const emptyBox = document.createElement("div");
      emptyBox.className = "rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs font-medium text-slate-600 sm:text-sm";
      emptyBox.textContent = state.schoolsData.length === 0
        ? "Tiada sekolah ditemui bagi kategori " + statusLabel + "."
        : "Tiada nama sekolah sepadan dengan kata kunci carian anda.";
      dom.body.appendChild(emptyBox);
      return;
    }

    const tableWrap = document.createElement("div");
    tableWrap.className = "overflow-x-auto rounded-xl border border-slate-200";

    const table = document.createElement("table");
    table.className = "min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm";

    const thead = document.createElement("thead");
    thead.className = "bg-slate-50 text-slate-600";
    const headRow = document.createElement("tr");

    const headers = [
      { text: "Bil.", cls: "w-12 px-3.5 py-3 font-semibold" },
      { text: "Nama Sekolah", cls: "px-3.5 py-3 font-semibold" },
      { text: "Guru", cls: "px-3.5 py-3 text-right font-semibold" },
      { text: "Pelajar", cls: "px-3.5 py-3 text-right font-semibold" },
      { text: "Jumlah ID", cls: "px-3.5 py-3 text-right font-semibold" },
      { text: "Tindakan", cls: "px-3.5 py-3 text-right font-semibold" }
    ];

    for (let h = 0; h < headers.length; h += 1) {
      const th = document.createElement("th");
      th.scope = "col";
      th.className = headers[h].cls;
      th.textContent = headers[h].text;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    tbody.className = "divide-y divide-slate-100 bg-white";

    const frag = document.createDocumentFragment();
    for (let i = 0; i < rows.length; i += 1) {
      const item = rows[i];
      const schoolName = String(item.nama_sekolah || "-");

      const tr = document.createElement("tr");
      tr.className = "cursor-pointer transition hover:bg-blue-50/60";
      tr.addEventListener("click", function () {
        openSchoolUsersDrilldown(schoolName);
      });

      const tdIndex = document.createElement("td");
      tdIndex.className = "whitespace-nowrap px-3.5 py-3 font-mono text-slate-500";
      tdIndex.textContent = String(i + 1);
      tr.appendChild(tdIndex);

      const tdName = document.createElement("td");
      tdName.className = "min-w-[200px] px-3.5 py-3 font-semibold text-slate-900";
      tdName.textContent = schoolName;
      tr.appendChild(tdName);

      const tdGuru = document.createElement("td");
      tdGuru.className = "whitespace-nowrap px-3.5 py-3 text-right font-mono text-indigo-700";
      tdGuru.textContent = formatNumber(item.guru_terlibat);
      tr.appendChild(tdGuru);

      const tdPelajar = document.createElement("td");
      tdPelajar.className = "whitespace-nowrap px-3.5 py-3 text-right font-mono text-sky-700";
      tdPelajar.textContent = formatNumber(item.pelajar_terlibat);
      tr.appendChild(tdPelajar);

      const tdTotal = document.createElement("td");
      tdTotal.className = "whitespace-nowrap px-3.5 py-3 text-right";
      const countPill = document.createElement("span");
      countPill.className = state.targetStatus
        ? "inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 font-mono text-xs font-bold text-emerald-700"
        : "inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 font-mono text-xs font-bold text-amber-800";
      countPill.textContent = formatNumber(item.jumlah_terlibat);
      tdTotal.appendChild(countPill);
      tr.appendChild(tdTotal);

      const tdAction = document.createElement("td");
      tdAction.className = "whitespace-nowrap px-3.5 py-3 text-right";
      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "min-h-[44px] rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100";
      viewBtn.textContent = "Lihat Senarai ID";
      viewBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        openSchoolUsersDrilldown(schoolName);
      });
      tdAction.appendChild(viewBtn);
      tr.appendChild(tdAction);

      frag.appendChild(tr);
    }

    tbody.appendChild(frag);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    dom.body.appendChild(tableWrap);
  }

  function getFilteredUsers() {
    const q = String(state.searchQuery || "").trim().toUpperCase();
    if (!q) {
      return state.usersData;
    }
    const filtered = [];
    for (let i = 0; i < state.usersData.length; i += 1) {
      const u = state.usersData[i];
      const idStr = String(u.id || "");
      const nameStr = String(u.nama_penuh || "").toUpperCase();
      const kpStr = maskNoKp(u.no_kp);
      const userStr = String(u.username || "").toUpperCase();
      const roleStr = String(u.jenis_id || "").toUpperCase();
      if (
        idStr.indexOf(q) !== -1 ||
        nameStr.indexOf(q) !== -1 ||
        kpStr.indexOf(q) !== -1 ||
        userStr.indexOf(q) !== -1 ||
        roleStr.indexOf(q) !== -1
      ) {
        filtered.push(u);
      }
    }
    return filtered;
  }

  function renderSchoolUsersView() {
    if (!dom.body) {
      return;
    }
    clearChildren(dom.body);

    const statusLabel = state.targetStatus ? "Sudah Maklum" : "Belum Maklum";
    if (dom.title) {
      dom.title.textContent = state.selectedSchool || "Senarai ID Terlibat";
    }
    if (dom.subtitle) {
      dom.subtitle.textContent = "Senarai ID pengguna yang terlibat bagi status: " + statusLabel;
    }
    if (dom.btnBack) {
      dom.btnBack.classList.remove("hidden");
    }
    if (dom.scopeBanner) {
      dom.scopeBanner.classList.add("hidden");
    }
    if (dom.searchInput) {
      dom.searchInput.placeholder = "Cari ID, nama penuh, No. KP, atau username...";
    }

    const rows = getFilteredUsers();
    if (dom.countBadge) {
      dom.countBadge.textContent = formatNumber(rows.length) + " / " + formatNumber(state.usersData.length) + " ID";
    }

    if (rows.length === 0) {
      const emptyBox = document.createElement("div");
      emptyBox.className = "rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs font-medium text-slate-600 sm:text-sm";
      emptyBox.textContent = state.usersData.length === 0
        ? "Tiada rekod ID pengguna ditemui bagi sekolah dan status ini."
        : "Tiada rekod ID pengguna sepadan dengan carian anda.";
      dom.body.appendChild(emptyBox);
      return;
    }

    const tableWrap = document.createElement("div");
    tableWrap.className = "overflow-x-auto rounded-xl border border-slate-200";

    const table = document.createElement("table");
    table.className = "min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm";

    const thead = document.createElement("thead");
    thead.className = "bg-slate-50 text-slate-600";
    const headRow = document.createElement("tr");

    const headers = [
      { text: "ID", cls: "w-20 px-3.5 py-3 font-semibold" },
      { text: "Nama Penuh", cls: "px-3.5 py-3 font-semibold" },
      { text: "No. KP", cls: "px-3.5 py-3 font-semibold" },
      { text: "Username & Emel", cls: "px-3.5 py-3 font-semibold" },
      { text: "Kategori", cls: "px-3.5 py-3 font-semibold" },
      { text: "Status / Tarikh", cls: "px-3.5 py-3 font-semibold" }
    ];

    for (let h = 0; h < headers.length; h += 1) {
      const th = document.createElement("th");
      th.scope = "col";
      th.className = headers[h].cls;
      th.textContent = headers[h].text;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    tbody.className = "divide-y divide-slate-100 bg-white";

    const frag = document.createDocumentFragment();
    for (let i = 0; i < rows.length; i += 1) {
      const rec = rows[i];

      const tr = document.createElement("tr");
      tr.className = "hover:bg-slate-50";

      const tdId = document.createElement("td");
      tdId.className = "whitespace-nowrap px-3.5 py-3";
      const idBadge = document.createElement("span");
      idBadge.className = "inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-800";
      idBadge.textContent = "#" + String(rec.id);
      tdId.appendChild(idBadge);
      tr.appendChild(tdId);

      const tdName = document.createElement("td");
      tdName.className = "min-w-[180px] px-3.5 py-3 font-semibold text-slate-900";
      tdName.textContent = rec.nama_penuh || "-";
      tr.appendChild(tdName);

      const tdKp = document.createElement("td");
      tdKp.className = "whitespace-nowrap px-3.5 py-3 font-mono text-slate-700";
      tdKp.textContent = maskNoKp(rec.no_kp);
      tr.appendChild(tdKp);

      const tdEmail = document.createElement("td");
      tdEmail.className = "min-w-[190px] px-3.5 py-3";
      const emailMain = document.createElement("p");
      emailMain.className = "font-mono text-xs font-semibold text-blue-700";
      emailMain.textContent = buildFullEmail(rec);
      tdEmail.appendChild(emailMain);
      const unameSub = document.createElement("p");
      unameSub.className = "text-[11px] text-slate-500";
      unameSub.textContent = "Username: " + (rec.username || "-");
      tdEmail.appendChild(unameSub);
      tr.appendChild(tdEmail);

      const tdRole = document.createElement("td");
      tdRole.className = "whitespace-nowrap px-3.5 py-3";
      const roleVal = String(rec.jenis_id || "PENGGUNA").toUpperCase();
      const rolePill = document.createElement("span");
      rolePill.className = roleVal === "GURU"
        ? "inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700"
        : "inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700";
      rolePill.textContent = roleVal;
      tdRole.appendChild(rolePill);
      tr.appendChild(tdRole);

      const tdStatus = document.createElement("td");
      tdStatus.className = "whitespace-nowrap px-3.5 py-3 text-xs";
      if (rec.sudah_maklum) {
        const doneText = document.createElement("span");
        doneText.className = "font-semibold text-emerald-700";
        doneText.textContent = formatTimestamp(rec.tarikh_maklum);
        tdStatus.appendChild(doneText);
      } else {
        const waitPill = document.createElement("span");
        waitPill.className = "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800";
        waitPill.textContent = "Belum Maklum";
        tdStatus.appendChild(waitPill);
      }
      tr.appendChild(tdStatus);

      frag.appendChild(tr);
    }

    tbody.appendChild(frag);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    dom.body.appendChild(tableWrap);
  }

  async function loadSchoolsForStatus(isSudahMaklum) {
    const allowed = await verifyAdminSessionActive();
    if (!allowed) {
      return;
    }

    abortInFlightRequest();
    const controller = new AbortController();
    state.activeAbortController = controller;

    state.viewMode = "schools";
    state.targetStatus = Boolean(isSudahMaklum);
    state.selectedSchool = "";
    state.searchQuery = "";
    if (dom.searchInput) {
      dom.searchInput.value = "";
    }

    showFeedback("", "");
    renderLoadingSkeleton("Memuatkan senarai sekolah terlibat...");

    try {
      await window.ENV_READY;
      const supabase = await window.getSupabaseClient();
      const scopeSchool = getActiveSchoolScope();

      let rpcCall = supabase.rpc("meldotmy_admin_senarai_sekolah_status", {
        p_sudah_maklum: state.targetStatus,
        p_nama_sekolah: scopeSchool || null
      });

      if (typeof rpcCall.abortSignal === "function") {
        rpcCall = rpcCall.abortSignal(controller.signal);
      }

      const response = await rpcCall;
      if (controller.signal.aborted) {
        return;
      }

      if (response.error) {
        throw new Error(response.error.message);
      }

      state.schoolsData = Array.isArray(response.data) ? response.data : [];
      renderSchoolsListView();
    } catch (err) {
      if (err && err.name === "AbortError") {
        return;
      }
      state.schoolsData = [];
      renderSchoolsListView();
      showFeedback(
        "error",
        "Gagal mendapatkan senarai sekolah terlibat: " + (err && err.message ? err.message : "Ralat pangkalan data.")
      );
    } finally {
      if (state.activeAbortController === controller) {
        state.activeAbortController = null;
      }
    }
  }

  async function openStatusDrilldown(isSudahMaklum) {
    if (!state.isAdminEnabled) {
      return;
    }
    const allowed = await verifyAdminSessionActive();
    if (!allowed) {
      return;
    }

    state.schoolScopeOverride = null;
    state.isModalOpen = true;
    if (dom.modal) {
      dom.modal.classList.remove("hidden");
    }

    await loadSchoolsForStatus(Boolean(isSudahMaklum));
    if (dom.searchInput) {
      dom.searchInput.focus();
    }
  }

  async function openSchoolUsersDrilldown(namaSekolah) {
    if (!state.isAdminEnabled || !namaSekolah) {
      return;
    }
    const allowed = await verifyAdminSessionActive();
    if (!allowed) {
      return;
    }

    abortInFlightRequest();
    const controller = new AbortController();
    state.activeAbortController = controller;

    state.viewMode = "users";
    state.selectedSchool = String(namaSekolah).trim();
    state.searchQuery = "";
    if (dom.searchInput) {
      dom.searchInput.value = "";
    }

    showFeedback("", "");
    renderLoadingSkeleton("Memuatkan senarai ID pengguna bagi " + state.selectedSchool + "...");

    try {
      await window.ENV_READY;
      const supabase = await window.getSupabaseClient();

      let rpcCall = supabase.rpc("meldotmy_admin_senarai_pengguna_sekolah", {
        p_nama_sekolah: state.selectedSchool,
        p_sudah_maklum: state.targetStatus
      });

      if (typeof rpcCall.abortSignal === "function") {
        rpcCall = rpcCall.abortSignal(controller.signal);
      }

      const response = await rpcCall;
      if (controller.signal.aborted) {
        return;
      }

      if (response.error) {
        throw new Error(response.error.message);
      }

      state.usersData = Array.isArray(response.data) ? response.data : [];
      renderSchoolUsersView();
      if (dom.searchInput) {
        dom.searchInput.focus();
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        return;
      }
      state.usersData = [];
      renderSchoolUsersView();
      showFeedback(
        "error",
        "Gagal mendapatkan senarai ID pengguna: " + (err && err.message ? err.message : "Ralat pangkalan data.")
      );
    } finally {
      if (state.activeAbortController === controller) {
        state.activeAbortController = null;
      }
    }
  }

  function handleCardActivation(cardEl, isSudahMaklum) {
    if (!cardEl) {
      return;
    }
    cardEl.addEventListener("click", function () {
      if (!state.isAdminEnabled) {
        return;
      }
      openStatusDrilldown(isSudahMaklum);
    });

    cardEl.addEventListener("keydown", function (event) {
      if (!state.isAdminEnabled) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openStatusDrilldown(isSudahMaklum);
      }
    });
  }

  function bindEvents() {
    handleCardActivation(dom.cardSudah, true);
    handleCardActivation(dom.cardBelum, false);

    if (dom.btnClose) {
      dom.btnClose.addEventListener("click", closeModal);
    }

    if (dom.modal) {
      dom.modal.addEventListener("click", function (event) {
        if (event.target === dom.modal) {
          closeModal();
        }
      });
    }

    if (dom.btnBack) {
      dom.btnBack.addEventListener("click", function () {
        if (!state.isAdminEnabled) {
          closeModal();
          return;
        }
        loadSchoolsForStatus(state.targetStatus);
      });
    }

    if (dom.searchInput) {
      dom.searchInput.addEventListener("input", function () {
        state.searchQuery = dom.searchInput.value || "";
        if (state.viewMode === "schools") {
          renderSchoolsListView();
        } else {
          renderSchoolUsersView();
        }
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && state.isModalOpen) {
        closeModal();
      }
    });
  }

  async function refreshIfOpen() {
    if (!state.isModalOpen || !state.isAdminEnabled) {
      return;
    }
    if (state.viewMode === "users" && state.selectedSchool) {
      await openSchoolUsersDrilldown(state.selectedSchool);
    } else {
      await loadSchoolsForStatus(state.targetStatus);
    }
  }

  function init(options) {
    const opts = options && typeof options === "object" ? options : {};
    if (typeof opts.getSchoolScope === "function") {
      state.getSchoolScopeFn = opts.getSchoolScope;
    }
    cacheDomReferences();
    if (!state.initialized) {
      bindEvents();
      state.initialized = true;
    }
    setAdminEnabled(false);
  }

  const api = Object.freeze({
    init: init,
    setAdminEnabled: setAdminEnabled,
    openStatusDrilldown: openStatusDrilldown,
    openSchoolUsersDrilldown: openSchoolUsersDrilldown,
    refreshIfOpen: refreshIfOpen,
    closeModal: closeModal,
    isOpen: function () {
      return state.isModalOpen;
    }
  });

  window.AdminDrilldown = api;
})();