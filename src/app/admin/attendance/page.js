"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function AdminAttendancePage() {
  const [orgId, setOrgId] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPresentOnly, setShowPresentOnly] = useState(false);

  const loadAll = useCallback(async () => {
    setError("");
    setLoading(true);

    const u = await getUserCached();
    const uid = u?.id || null;
    if (!uid) {
      setProfiles([]);
      setSessions([]);
      setOrgId(null);
      setLoading(false);
      return;
    }

    const { data: me } = await supabase.from("profiles").select("org_id").eq("user_id", uid).maybeSingle();
    const org = me?.org_id || null;
    setOrgId(org);

    let pQ = supabase.from("profiles").select("user_id, display_name, role, org_id").order("created_at", { ascending: false });
    if (org) pQ = pQ.or(`org_id.is.null,org_id.eq.${org}`);
    const { data: ps, error: pErr } = await pQ;
    if (pErr) {
      setError(pErr.message || "Failed to load employees");
      setLoading(false);
      return;
    }
    const people = (ps || []).filter((p) => p.user_id);
    setProfiles(people);

    const ids = people.map((p) => p.user_id);
    if (ids.length === 0) {
      setSessions([]);
      setLoading(false);
      return;
    }

    const { data: ws, error: wErr } = await supabase
      .from("work_sessions")
      .select("*")
      .eq("work_date", todayKey())
      .in("user_id", ids)
      .order("login_at", { ascending: false });
    if (wErr) {
      setError(wErr.message || "Failed to load attendance");
      setSessions([]);
      setLoading(false);
      return;
    }
    setSessions(ws || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const init = async () => {
      await loadAll();
    };
    init();
  }, [loadAll]);

  const rows = useMemo(() => {
    const now = new Date();
    const byUser = new Map();
    (sessions || []).forEach((s) => {
      if (!s.user_id) return;
      if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
      byUser.get(s.user_id).push(s);
    });

    const items = (profiles || []).map((p) => {
      const arr = byUser.get(p.user_id) || [];
      let minutes = 0;
      let firstIn = null;
      let lastOut = null;
      let activeLoginAt = null;

      arr.forEach((s) => {
        minutes += Number(s.duration_minutes || 0);
        const li = s.login_at ? new Date(s.login_at) : null;
        const lo = s.logout_at ? new Date(s.logout_at) : null;
        if (li && (!firstIn || li < firstIn)) firstIn = li;
        if (lo && (!lastOut || lo > lastOut)) lastOut = lo;
        if (!s.logout_at && li && (!activeLoginAt || li > activeLoginAt)) activeLoginAt = li;
      });

      if (activeLoginAt) {
        minutes += Math.max(0, Math.floor((now.getTime() - activeLoginAt.getTime()) / 60000));
      }

      const present = !!activeLoginAt;
      const displayName = p.display_name || "Unknown";
      return {
        user_id: p.user_id,
        name: displayName,
        role: p.role || "-",
        present,
        firstIn,
        lastOut,
        activeLoginAt,
        minutes,
      };
    });

    const filtered = showPresentOnly ? items.filter((r) => r.present) : items;
    return filtered.sort((a, b) => Number(b.present) - Number(a.present) || (b.minutes || 0) - (a.minutes || 0));
  }, [profiles, sessions, showPresentOnly]);

  const presentCount = useMemo(() => rows.filter((r) => r.present).length, [rows]);

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-heading text-2xl font-bold">Attendance</h1>
            <div className="text-xs text-black/60">
              Date: {todayKey()} • Present: {presentCount} • Total: {rows.length}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={"rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" + (showPresentOnly ? " bg-black/5" : "")}
              onClick={() => setShowPresentOnly((v) => !v)}
            >
              {showPresentOnly ? "Showing Present" : "Show Present Only"}
            </button>
            <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={loadAll}>
              Refresh
            </button>
          </div>
        </div>

        {!orgId && (
          <div className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
            Viewing all employees. Assign an organization to your profile to scope results.
          </div>
        )}

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          {loading ? (
            <div className="text-sm text-black/60">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-black/5 text-black/70">
                  <tr>
                    <th className="px-3 py-2 text-left">Employee</th>
                    <th className="px-3 py-2 text-left">Role</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Login Time</th>
                    <th className="px-3 py-2 text-left">Logout Time</th>
                    <th className="px-3 py-2 text-right">Hours Today</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.user_id} className="border-t">
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2">{r.role}</td>
                      <td className="px-3 py-2">
                        <span className={"inline-flex rounded-md px-2 py-1 text-xs " + (r.present ? "bg-green-100 text-green-700" : "bg-black/5 text-black/60")}>
                          {r.present ? "Present" : "Offline"}
                        </span>
                      </td>
                      <td className="px-3 py-2">{r.activeLoginAt ? r.activeLoginAt.toLocaleString() : r.firstIn ? r.firstIn.toLocaleString() : "-"}</td>
                      <td className="px-3 py-2">{r.lastOut ? r.lastOut.toLocaleString() : r.present ? "-" : "-"}</td>
                      <td className="px-3 py-2 text-right">{(Number(r.minutes || 0) / 60).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">
                        <Link href={`/admin/users/${r.user_id}`} className="rounded-md border border-black/10 px-3 py-1 hover:bg-black/5">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-black/60" colSpan={7}>
                        No employees found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}

