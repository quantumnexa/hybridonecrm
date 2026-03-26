"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import Link from "next/link";
import { getUserCached, markAllNotificationsRead, markNotificationRead, supabase } from "@/lib/supabase";

export default function GeneralNotificationsPage() {
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
    loadAll();
  }, [loadAll]);

  const unreadCount = useMemo(() => (rows || []).filter((r) => !r.is_read).length, [rows]);

  const markAllRead = async () => {
    if (!userId) return;
    await markAllNotificationsRead(userId);
    await loadAll();
  };

  const markOneRead = async (id) => {
    await markNotificationRead(id);
    await loadAll();
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
              {rows.map((n) => {
                const href = n.url || "";
                return (
                  <div key={n.id} className={`rounded-md border border-black/10 px-3 py-3 ${n.is_read ? "bg-white" : "bg-blue-50/40"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-heading">{n.title}</div>
                        {n.message ? <div className="mt-1 text-sm text-black/70 whitespace-pre-wrap">{n.message}</div> : null}
                        <div className="mt-2 text-xs text-black/50">{n.created_at ? new Date(n.created_at).toLocaleString() : ""}</div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {!n.is_read && (
                          <button className="rounded-md border border-black/10 px-2 py-1 text-xs hover:bg-black/5" onClick={() => markOneRead(n.id)}>
                            Mark read
                          </button>
                        )}
                        {href ? (
                          <Link className="rounded-md bg-heading px-2 py-1 text-xs text-background hover:bg-hover" href={href}>
                            Open
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}

