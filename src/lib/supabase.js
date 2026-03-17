import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

let __userCache = null;
let __userPromise = null;

export async function getUserCached() {
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
