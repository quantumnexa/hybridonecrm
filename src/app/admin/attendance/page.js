"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";

function localDateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

function weekStart(d) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

function boundsForPreset(preset) {
  const now = new Date();
  if (preset === "today") {
    const from = startOfDay(now);
    const to = addDays(from, 1);
    return { from, to };
  }
  if (preset === "yesterday") {
    const to = startOfDay(now);
    const from = addDays(to, -1);
    return { from, to };
  }
  if (preset === "this_week") {
    const from = weekStart(now);
    const to = addDays(from, 7);
    return { from, to };
  }
  if (preset === "this_month") {
    const from = startOfMonth(now);
    const to = addMonths(from, 1);
    return { from, to };
  }
  if (preset === "custom") return null;
  return null;
}

function toIsoInputValue(d) {
  if (!d) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export default function AdminAttendancePage() {
  const [orgId, setOrgId] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPresentOnly, setShowPresentOnly] = useState(false);
  const [query, setQuery] = useState("");

  const initialToday = useMemo(() => {
    const b = boundsForPreset("today");
    return b;
  }, []);
  const [preset, setPreset] = useState("today");
  const [customFrom, setCustomFrom] = useState(toIsoInputValue(initialToday?.from));
  const [customTo, setCustomTo] = useState(toIsoInputValue(initialToday?.to));
  const [bounds, setBounds] = useState(() => ({
    from: initialToday.from.toISOString(),
    to: initialToday.to.toISOString(),
  }));

  const changePreset = (next) => {
    setPreset(next);
    if (next === "custom") return;
    const b = boundsForPreset(next);
    if (!b) return;
    setCustomFrom(toIsoInputValue(b.from));
    setCustomTo(toIsoInputValue(b.to));
    setBounds({ from: b.from.toISOString(), to: b.to.toISOString() });
  };

  const applyCustom = () => {
    if (!customFrom || !customTo) return;
    const from = new Date(customFrom);
    const to = new Date(customTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return;
    if (to <= from) return;
    setBounds({ from: from.toISOString(), to: to.toISOString() });
  };

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

    const fromKey = localDateKey(new Date(bounds.from));
    const toKey = localDateKey(new Date(new Date(bounds.to).getTime() - 1));

    const { data: ws, error: wErr } = await supabase
      .from("work_sessions")
      .select("*")
      .gte("work_date", fromKey)
      .lte("work_date", toKey)
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
  }, [bounds.from, bounds.to]);

  useEffect(() => {
    const init = async () => {
      await loadAll();
    };
    init();
  }, [loadAll]);

  const rangeInfo = useMemo(() => {
    const from = startOfDay(new Date(bounds.from));
    const to = startOfDay(new Date(bounds.to));
    const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
    const fromKey = localDateKey(from);
    const toKey = localDateKey(addDays(to, -1));
    return { from, to, days, fromKey, toKey };
  }, [bounds.from, bounds.to]);

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
      const presentDays = new Set();
      let minutes = 0;
      let firstIn = null;
      let lastOut = null;
      let activeLoginAt = null;

      arr.forEach((s) => {
        const d = s.work_date || (s.login_at ? String(s.login_at).slice(0, 10) : "");
        if (d) presentDays.add(d);

        minutes += Number(s.duration_minutes || 0);
        const li = s.login_at ? new Date(s.login_at) : null;
        const lo = s.logout_at ? new Date(s.logout_at) : null;
        if (li && (!firstIn || li < firstIn)) firstIn = li;
        if (lo && (!lastOut || lo > lastOut)) lastOut = lo;
        if (!s.logout_at && li && (!activeLoginAt || li > activeLoginAt)) activeLoginAt = li;
      });

      if (activeLoginAt) {
        const start = new Date(Math.max(activeLoginAt.getTime(), rangeInfo.from.getTime()));
        const end = new Date(Math.min(now.getTime(), rangeInfo.to.getTime()));
        if (end > start) {
          minutes += Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
        }
      }

      const present = !!activeLoginAt;
      const presentDaysCount = presentDays.size;
      const absentDays = Math.max(0, rangeInfo.days - presentDaysCount);
      const displayName = p.display_name || "Unknown";
      return {
        user_id: p.user_id,
        name: displayName,
        role: p.role || "-",
        present,
        presentDays: presentDaysCount,
        absentDays,
        firstIn,
        lastOut,
        minutes,
      };
    });

    const filtered = showPresentOnly ? items.filter((r) => r.present) : items;
    return filtered.sort((a, b) => Number(b.present) - Number(a.present) || (b.minutes || 0) - (a.minutes || 0));
  }, [profiles, sessions, showPresentOnly, rangeInfo.from, rangeInfo.to, rangeInfo.days]);

  const presentNowCount = useMemo(() => rows.filter((r) => r.present).length, [rows]);
  const totalHours = useMemo(() => rows.reduce((sum, r) => sum + Number(r.minutes || 0), 0) / 60, [rows]);
  const totalEmployees = useMemo(() => rows.length, [rows]);
  const totalPresentDays = useMemo(() => rows.reduce((sum, r) => sum + Number(r.presentDays || 0), 0), [rows]);
  const totalAbsentDays = useMemo(() => rows.reduce((sum, r) => sum + Number(r.absentDays || 0), 0), [rows]);
  const avgHours = useMemo(() => (totalEmployees ? totalHours / totalEmployees : 0), [totalEmployees, totalHours]);

  const filteredRows = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = String(r.name || "").toLowerCase();
      const role = String(r.role || "").toLowerCase();
      return name.includes(q) || role.includes(q);
    });
  }, [rows, query]);

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-heading text-2xl font-bold">Attendance</h1>
            <div className="mt-1 text-xs text-black/60">
              {rangeInfo.fromKey} → {rangeInfo.toKey} • {rangeInfo.days} days
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">Present Now</div>
            <div className="mt-2 text-2xl font-semibold text-heading">{presentNowCount}</div>
            <div className="mt-1 text-xs text-black/60">out of {totalEmployees}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">Hours Worked</div>
            <div className="mt-2 text-2xl font-semibold text-heading">{totalHours.toFixed(2)}</div>
            <div className="mt-1 text-xs text-black/60">avg {avgHours.toFixed(2)} / employee</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">Present Days</div>
            <div className="mt-2 text-2xl font-semibold text-heading">{totalPresentDays}</div>
            <div className="mt-1 text-xs text-black/60">sum across employees</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">Absent Days</div>
            <div className="mt-2 text-2xl font-semibold text-heading">{totalAbsentDays}</div>
            <div className="mt-1 text-xs text-black/60">sum across employees</div>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: "today", label: "Today" },
                { key: "yesterday", label: "Yesterday" },
                { key: "this_week", label: "This Week" },
                { key: "this_month", label: "This Month" },
                { key: "custom", label: "Custom" },
              ].map((i) => (
                <button
                  key={i.key}
                  className={
                    "rounded-md border border-black/10 bg-white px-3 py-2 text-sm hover:bg-blue-600 hover:text-white" +
                    (preset === i.key ? " bg-blue-600 text-white" : "")
                  }
                  onClick={() => (i.key === "custom" ? setPreset("custom") : changePreset(i.key))}
                >
                  {i.label}
                </button>
              ))}
              {preset === "custom" && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    className="rounded-md border border-black/10 px-2 py-2 text-sm"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                  <span className="text-sm text-black/60">to</span>
                  <input
                    type="datetime-local"
                    className="rounded-md border border-black/10 px-2 py-2 text-sm"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                  <button
                    className="rounded-md bg-heading px-3 py-2 text-sm text-background hover:bg-hover disabled:opacity-50"
                    onClick={applyCustom}
                    disabled={!customFrom || !customTo}
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                className="rounded-md border border-black/10 px-3 py-2 text-sm"
                placeholder="Search employee or role..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className={
                  "rounded-md border border-black/10 px-3 py-2 text-sm hover:bg-black/5" +
                  (showPresentOnly ? " bg-black/5" : "")
                }
                onClick={() => setShowPresentOnly((v) => !v)}
              >
                {showPresentOnly ? "Present Only" : "All Employees"}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-4 text-sm text-black/60">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1100px] w-full text-sm">
                <thead className="bg-black/5 text-black/70">
                  <tr>
                    <th className="px-4 py-3 text-left">Employee</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-left">Now</th>
                    <th className="px-4 py-3 text-right">Present</th>
                    <th className="px-4 py-3 text-right">Absent</th>
                    <th className="px-4 py-3 text-left">First Login</th>
                    <th className="px-4 py-3 text-left">Last Logout</th>
                    <th className="px-4 py-3 text-right">Hours</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r, idx) => (
                    <tr key={r.user_id} className={(idx % 2 === 0 ? "bg-white" : "bg-black/[0.015]") + " border-t hover:bg-black/[0.03]"}>
                      <td className="px-4 py-3 font-medium text-heading">{r.name}</td>
                      <td className="px-4 py-3 text-black/70">{r.role}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs " +
                            (r.present ? "bg-green-100 text-green-700" : "bg-black/5 text-black/60")
                          }
                        >
                          <span className={"h-2 w-2 rounded-full " + (r.present ? "bg-green-600" : "bg-black/40")} />
                          {r.present ? "Present" : "Offline"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.presentDays}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.absentDays}</td>
                      <td className="px-4 py-3">{r.firstIn ? r.firstIn.toLocaleString() : "-"}</td>
                      <td className="px-4 py-3">{r.lastOut ? r.lastOut.toLocaleString() : "-"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{(Number(r.minutes || 0) / 60).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/admin/users/${r.user_id}`} className="rounded-md border border-black/10 px-3 py-1 hover:bg-black/5">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td className="px-4 py-10 text-center text-black/60" colSpan={9}>
                        No employees found for this filter.
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
