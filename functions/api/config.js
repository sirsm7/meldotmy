export async function onRequestGet(context) {
  const env = context && context.env ? context.env : {};
  const supabaseUrl = typeof env.SUPABASE_URL === "string" ? env.SUPABASE_URL.trim() : "";
  const supabaseAnonKey = typeof env.SUPABASE_ANON_KEY === "string" ? env.SUPABASE_ANON_KEY.trim() : "";
  const gasEndpointUrl = typeof env.GAS_ENDPOINT_URL === "string" ? env.GAS_ENDPOINT_URL.trim() : "";

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff"
  };

  if (!supabaseUrl || !supabaseAnonKey) {
    const missing = [];
    if (!supabaseUrl) {
      missing.push("SUPABASE_URL");
    }
    if (!supabaseAnonKey) {
      missing.push("SUPABASE_ANON_KEY");
    }

    return new Response(
      JSON.stringify({
        ok: false,
        error: "Konfigurasi persekitaran pelayan tidak lengkap.",
        missing
      }),
      {
        status: 500,
        headers
      }
    );
  }

  const payload = {
    ok: true,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: supabaseAnonKey
  };

  if (gasEndpointUrl) {
    payload.GAS_ENDPOINT_URL = gasEndpointUrl;
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers
  });
}