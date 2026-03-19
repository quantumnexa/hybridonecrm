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

function localDateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export async function startWorkSession({ userId, role }) {
  if (!supabaseConfigured || !userId) return;
  const now = new Date();
  const workDate = localDateKey(now);
  const { data: openToday } = await supabase
    .from("work_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("work_date", workDate)
    .is("logout_at", null)
    .order("login_at", { ascending: false })
    .limit(1);
  if ((openToday || []).length > 0) return;

  const { data: prof } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("user_id", userId)
    .maybeSingle();

  await supabase.from("work_sessions").insert({
    org_id: prof?.org_id || null,
    user_id: userId,
    role: role || null,
    work_date: workDate,
    login_at: now.toISOString(),
    logout_at: null,
    duration_minutes: 0,
  });
}

export async function endWorkSession({ userId }) {
  if (!supabaseConfigured || !userId) return;
  const now = new Date();
  const { data: open } = await supabase
    .from("work_sessions")
    .select("*")
    .eq("user_id", userId)
    .is("logout_at", null)
    .order("login_at", { ascending: false })
    .limit(1);
  const row = (open || [])[0];
  if (!row) return;

  const loginAt = new Date(row.login_at);
  const loginDay = localDateKey(loginAt);
  const logoutDay = localDateKey(now);

  if (loginDay === logoutDay) {
    const mins = Math.max(0, Math.floor((now.getTime() - loginAt.getTime()) / 60000));
    await supabase
      .from("work_sessions")
      .update({ logout_at: now.toISOString(), duration_minutes: mins })
      .eq("id", row.id);
    return;
  }

  const endDay = endOfLocalDay(loginAt);
  const mins1 = Math.max(0, Math.floor((endDay.getTime() - loginAt.getTime()) / 60000));
  await supabase
    .from("work_sessions")
    .update({ logout_at: endDay.toISOString(), duration_minutes: mins1 })
    .eq("id", row.id);

  const startDay2 = startOfLocalDay(now);
  const mins2 = Math.max(0, Math.floor((now.getTime() - startDay2.getTime()) / 60000));
  const { data: prof } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("user_id", userId)
    .maybeSingle();
  await supabase.from("work_sessions").insert({
    org_id: prof?.org_id || null,
    user_id: userId,
    role: prof?.role || null,
    work_date: logoutDay,
    login_at: startDay2.toISOString(),
    logout_at: now.toISOString(),
    duration_minutes: mins2,
  });
}

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
