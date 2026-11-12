import { createBrowserClient } from "@supabase/ssr";

function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return {
    url: url.replace(/\/rest\/v1\/?$/, ""),
    key,
  };
}

export function createClient() {
  const { url, key } = supabaseEnv();
  return createBrowserClient(url, key);
}
