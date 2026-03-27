"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { getUserCached, markAllNotificationsRead, markNotificationRead, supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function GeneralNotificationsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("unread");
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setError("");
    setLoading(true);
    const u = await getUserCached();
    const uid = u?.id || null;
    setUserId(uid);
    if (!uid) {
      setRows([]);
      setLoading(false);
      return;
    }
    let q = supabase.from("notifications").select("*").eq("user_id", uid);
    if (tab === "unread") q = q.eq("is_read", false);
    const { data, error: qErr } = await q.order("created_at", { ascending: false }).limit(200);
    if (qErr) setError(qErr.message || "Failed to load notifications");
    setRows(data || []);
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadAll();
    }, 0);
    return () => clearTimeout(t);
  }, [loadAll]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`notifications_page:${userId}:${tab}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        async () => {
          await loadAll();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, tab, loadAll]);

  const unreadCount = useMemo(() => (rows || []).filter((r) => !r.is_read).length, [rows]);

  const markAllRead = async () => {
    if (!userId) return;
    await markAllNotificationsRead(userId);
    await loadAll();
  };

  const openNotification = async (n) => {
    if (!n) return;
    if (n.id && !n.is_read) {
      await markNotificationRead(n.id);
      setRows((prev) => (prev || []).map((x) => (x.id === n.id ? { ...x, is_read: true, read_at: new Date().toISOString() } : x)));
    }
    if (n.url) router.push(n.url);
  };

  return (
    <AuthGuard allowedRoles={["general_user"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-heading text-2xl font-bold">Notifications</h1>
            <div className="mt-1 text-xs text-black/60">{tab === "unread" ? "Unread only" : "All"} • {unreadCount} unread</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={loadAll}>
              Refresh
            </button>
            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={!userId} onClick={markAllRead}>
              Mark all read
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: "unread", label: "Unread" },
              { key: "all", label: "All" },
            ].map((t) => (
              <button
                key={t.key}
                className={
                  "rounded-md border px-3 py-2 text-sm " +
                  (tab === t.key ? "border-blue-600 bg-blue-600 text-white" : "border-black/10 bg-white text-black/70 hover:bg-black/5")
                }
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          {loading ? (
            <div className="text-sm text-black/60">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-black/60">No notifications.</div>
          ) : (
            <div className="space-y-2">
              {rows.map((n) => (
                <button
                  key={n.id}
                  className={`w-full rounded-md border border-black/10 px-3 py-3 text-left hover:bg-black/[0.02] ${n.is_read ? "bg-white" : "bg-blue-50/40"}`}
                  onClick={() => openNotification(n)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-heading">{n.title}</div>
                      {n.message ? <div className="mt-1 text-sm text-black/70 whitespace-pre-wrap">{n.message}</div> : null}
                      <div className="mt-2 text-xs text-black/50">{n.created_at ? new Date(n.created_at).toLocaleString() : ""}</div>
                    </div>
                    <div className="shrink-0">{n.url ? <div className="rounded-md bg-heading px-2 py-1 text-xs text-background">Open</div> : null}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
