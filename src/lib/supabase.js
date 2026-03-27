import { createClient } from "@supabase/supabase-js";

const normalizeEnv = (v) => {
  if (typeof v !== "string") return "";
  const t = v.trim();
  return t.replace(/^['"`]+|['"`]+$/g, "").trim();
};

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const rawSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseUrl = normalizeEnv(rawSupabaseUrl);
const supabaseAnonKey = normalizeEnv(rawSupabaseAnonKey);

const isValidSupabaseUrl = (() => {
  if (!supabaseUrl) return false;
  try {
    const u = new URL(supabaseUrl);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
})();

const supabaseConfigError = (() => {
  if (!supabaseUrl && !supabaseAnonKey) return "Missing NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.";
  if (!supabaseUrl) return "Missing NEXT_PUBLIC_SUPABASE_URL.";
  if (!supabaseAnonKey) return "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY.";
  if (!isValidSupabaseUrl) return "Invalid NEXT_PUBLIC_SUPABASE_URL.";
  return "";
})();

export const supabaseConfigured = !supabaseConfigError;

const fetchWithConfigGuard = async (...args) => {
  if (!supabaseConfigured) {
    throw new Error(`Supabase is not configured. ${supabaseConfigError}`);
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
  // Check for ANY open session, regardless of work_date
  const { data: openAny } = await supabase
    .from("work_sessions")
    .select("id")
    .eq("user_id", userId)
    .is("logout_at", null)
    .order("login_at", { ascending: false })
    .limit(1);
  if ((openAny || []).length > 0) return;

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
  await logActivity({
    actorId: userId,
    action: "work_session_started",
    entityType: "work_session",
    entityId: null,
    meta: { work_date: workDate },
  });
  const p = await getProfileBasicCached(userId);
  await notifyAdmins({
    actorId: userId,
    type: "activity",
    title: `${p?.display_name || "User"} started work session`,
    message: `Date: ${workDate}`,
    entityType: "work_session",
    entityId: null,
    url: "/admin/attendance",
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
  const loginDay = row.work_date;

  // Simply end the session without splitting across dates
  const mins = Math.max(0, Math.floor((now.getTime() - loginAt.getTime()) / 60000));
  await supabase
    .from("work_sessions")
    .update({ logout_at: now.toISOString(), duration_minutes: mins })
    .eq("id", row.id);

  await logActivity({
    actorId: userId,
    action: "work_session_ended",
    entityType: "work_session",
    entityId: row.id,
    meta: { work_date: loginDay, duration_minutes: mins },
  });
  const p = await getProfileBasicCached(userId);
  await notifyAdmins({
    actorId: userId,
    type: "activity",
    title: `${p?.display_name || "User"} ended work session`,
    message: `Started: ${loginDay} • Total: ${mins} min`,
    entityType: "work_session",
    entityId: row.id,
    url: "/admin/attendance",
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

let __adminIdsCache = null;
let __adminIdsPromise = null;

export async function getAdminUserIdsCached() {
  if (!supabaseConfigured) return [];
  if (Array.isArray(__adminIdsCache)) return __adminIdsCache;
  if (__adminIdsPromise) return __adminIdsPromise;
  __adminIdsPromise = supabase
    .from("profiles")
    .select("user_id")
    .in("role", ["super_admin", "admin"])
    .then(({ data }) => {
      __adminIdsCache = (data || []).map((r) => r.user_id).filter(Boolean);
      __adminIdsPromise = null;
      return __adminIdsCache;
    })
    .catch(() => {
      __adminIdsCache = [];
      __adminIdsPromise = null;
      return __adminIdsCache;
    });
  return __adminIdsPromise;
}

let __profileCache = new Map();

export async function getProfileBasicCached(userId) {
  if (!supabaseConfigured || !userId) return null;
  if (__profileCache.has(userId)) return __profileCache.get(userId);
  const { data } = await supabase.from("profiles").select("user_id, org_id, role, display_name").eq("user_id", userId).maybeSingle();
  const row = data || null;
  __profileCache.set(userId, row);
  return row;
}

export async function createNotifications(rows) {
  if (!supabaseConfigured) return;
  const arr = Array.isArray(rows) ? rows : [rows];
  if (!arr.length) return;
  const { error } = await supabase.from("notifications").insert(arr);
  if (error) {
    console.error("notifications.insert failed", error);
  }
}

export async function markNotificationRead(notificationId) {
  if (!supabaseConfigured || !notificationId) return;
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", notificationId);
  if (error) {
    console.error("notifications.markRead failed", error);
    return;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("notifications:changed", { detail: { type: "mark_read", ids: [notificationId] } }));
  }
}

export async function markAllNotificationsRead(userId) {
  if (!supabaseConfigured || !userId) return;
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("is_read", false);
  if (error) {
    console.error("notifications.markAllRead failed", error);
    return;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("notifications:changed", { detail: { type: "mark_all_read", user_id: userId } }));
  }
}

export async function logActivity({ actorId, action, entityType, entityId, meta }) {
  if (!supabaseConfigured || !actorId || !action) return;
  const prof = await getProfileBasicCached(actorId);
  const { error } = await supabase.from("activity_logs").insert({
    org_id: prof?.org_id || null,
    actor_id: actorId,
    actor_role: prof?.role || null,
    action,
    entity_type: entityType || null,
    entity_id: entityId || null,
    meta: meta || {},
  });
  if (error) {
    console.error("activity_logs.insert failed", error);
  }
}

export async function notifyAdmins({ actorId, type, title, message, entityType, entityId, url }) {
  if (!supabaseConfigured || !title) return;
  const adminIds = await getAdminUserIdsCached();
  if (!adminIds.length) return;
  const prof = actorId ? await getProfileBasicCached(actorId) : null;
  const rows = adminIds.map((uid) => ({
    org_id: prof?.org_id || null,
    user_id: uid,
    actor_id: actorId || null,
    type: type || "activity",
    title,
    message: message || null,
    entity_type: entityType || null,
    entity_id: entityId || null,
    url: url || null,
  }));
  await createNotifications(rows);
}

export async function notifyUser({ userId, actorId, type, title, message, entityType, entityId, url }) {
  if (!supabaseConfigured || !userId || !title) return;
  const prof = actorId ? await getProfileBasicCached(actorId) : null;
  await createNotifications({
    org_id: prof?.org_id || null,
    user_id: userId,
    actor_id: actorId || null,
    type: type || "activity",
    title,
    message: message || null,
    entity_type: entityType || null,
    entity_id: entityId || null,
    url: url || null,
  });
}

export async function taskUrlForUser(taskId, userId) {
  if (!taskId || !userId) return null;
  const p = await getProfileBasicCached(userId);
  const r = p?.role || null;
  if (r === "super_admin") return `/admin/tasks/${taskId}`;
  if (r === "general_user") return `/general/tasks/${taskId}`;
  return `/sales/tasks/${taskId}`;
}
