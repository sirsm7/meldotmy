(function () {
  "use strict";

  const CONFIG_ENDPOINT = "/api/config";
  const FETCH_TIMEOUT_MS = 10000;
  let supabaseClientInstance = null;

  async function loadEnvironmentConfig() {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(function () {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await window.fetch(CONFIG_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        headers: {
          "Accept": "application/json"
        },
        signal: controller.signal
      });
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error("Masa tamat semasa mendapatkan konfigurasi pelayan.");
      }
      throw new Error("Gagal menyambung ke titik hujung konfigurasi pelayan.");
    } finally {
      window.clearTimeout(timeoutId);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      throw new Error("Format respons konfigurasi pelayan tidak sah.");
    }

    if (!response.ok || !payload || payload.ok === false) {
      const detail = payload && typeof payload.error === "string"
        ? payload.error
        : "Ralat HTTP " + response.status + " semasa memuatkan konfigurasi.";
      throw new Error(detail);
    }

    const supabaseUrl = typeof payload.SUPABASE_URL === "string" ? payload.SUPABASE_URL.trim() : "";
    const supabaseAnonKey = typeof payload.SUPABASE_ANON_KEY === "string" ? payload.SUPABASE_ANON_KEY.trim() : "";
    const gasEndpointUrl = typeof payload.GAS_ENDPOINT_URL === "string" ? payload.GAS_ENDPOINT_URL.trim() : "";

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Pemboleh ubah SUPABASE_URL atau SUPABASE_ANON_KEY tiada atau kosong.");
    }

    const frozenEnv = {
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: supabaseAnonKey
    };

    if (gasEndpointUrl) {
      frozenEnv.GAS_ENDPOINT_URL = gasEndpointUrl;
    }

    Object.freeze(frozenEnv);
    window.__ENV = frozenEnv;
    return frozenEnv;
  }

  window.ENV_READY = loadEnvironmentConfig();

  window.getSupabaseClient = async function () {
    const env = await window.ENV_READY;
    if (supabaseClientInstance) {
      return supabaseClientInstance;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Pustaka klien Supabase tidak dimuatkan.");
    }
    supabaseClientInstance = window.supabase.createClient(
      env.SUPABASE_URL,
      env.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );
    window._supabase = supabaseClientInstance;
    return supabaseClientInstance;
  };
})();