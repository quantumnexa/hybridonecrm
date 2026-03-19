import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

const fetchWithConfigGuard = async (...args) => {
  if (!supabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return fetch(...args);
};

export const supabase = createClient(supabaseUrl || "https://example.invalid", supabaseAnonKey || "invalid", {
  global: { fetch: fetchWithConfigGuard },
});

let __userCache = null;
let __userPromise = null;

export async function getUserCached() {
  if (!supabaseConfigured) return null;
  if (__userCache) return __userCache;
  if (__userPromise) return __userPromise;
  __userPromise = supabase.auth.getUser().then((res) => {
    __userCache = res?.data?.user || null;
    __userPromise = null;
    return __userCache;
  });
  return __userPromise;
}

supabase.auth.onAuthStateChange((_event, session) => {
  __userCache = session?.user || null;
});
