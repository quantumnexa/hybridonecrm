"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import { formatSecondsAsHHMMSS, formatLocalDateTime12, formatDateCustom } from "@/lib/timeFormat";

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
  const [nowTs, setNowTs] = useState(0);
  const [assignments, setAssignments] = useState([]);
  const [shifts, setShifts] = useState([]);

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

    const { data: asg } = await supabase
      .from("shift_assignments")
      .select("user_id, work_date, shift_id")
      .gte("work_date", fromKey)
      .lte("work_date", toKey)
      .in("user_id", ids);
    setAssignments(asg || []);
    const shiftIds = Array.from(new Set((asg || []).map(a => a.shift_id).filter(Boolean)));
    let shMap = [];
    if (shiftIds.length) {
      const { data: sh } = await supabase.from("shifts").select("*").in("id", shiftIds);
      shMap = sh || [];
    }
    setShifts(shMap);
    setLoading(false);
  }, [bounds.from, bounds.to]);

  useEffect(() => {
    const init = async () => {
      await loadAll();
    };
    init();
  }, [loadAll]);

  useEffect(() => {
    const kick = setTimeout(() => setNowTs(Date.now()), 0);
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => {
      clearTimeout(kick);
      clearInterval(id);
    };
  }, []);

  const rangeInfo = useMemo(() => {
    const from = startOfDay(new Date(bounds.from));
    const to = startOfDay(new Date(bounds.to));
    const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
    const fromKey = localDateKey(from);
    const toKey = localDateKey(addDays(to, -1));
    return { from, to, days, fromKey, toKey };
  }, [bounds.from, bounds.to]);

  const rows = useMemo(() => {
    const now = new Date(nowTs);
    const shiftsById = new Map((shifts || []).map(s => [s.id, s]));
    const assignByUserDate = new Map();
    (assignments || []).forEach(a => {
      if (!a.user_id || !a.work_date) return;
      if (!assignByUserDate.has(a.user_id)) assignByUserDate.set(a.user_id, new Map());
      assignByUserDate.get(a.user_id).set(String(a.work_date), a);
    });
    const byUser = new Map();
    (sessions || []).forEach((s) => {
      if (!s.user_id) return;
      if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
      byUser.get(s.user_id).push(s);
    });

    const items = (profiles || []).map((p) => {
      const arr = byUser.get(p.user_id) || [];
      const byDate = new Map();
      arr.forEach(s => {
        const k = String(s.work_date || (s.login_at ? String(s.login_at).slice(0,10) : ""));
        if (!byDate.has(k)) byDate.set(k, []);
        byDate.get(k).push(s);
      });

      const presentDays = new Set();
      let seconds = 0;
      let firstIn = null;
      let lastOut = null;
      let activeLoginAt = null;

      // Iterate each day in range and compute overlap within shift windows
      for (let d = new Date(rangeInfo.from); d < rangeInfo.to; d = addDays(d, 1)) {
        const key = localDateKey(d);
        const a = assignByUserDate.get(p.user_id)?.get(key) || null;
        const sh = a?.shift_id ? shiftsById.get(a.shift_id) : null;
        const sessionsToday = byDate.get(key) || [];
        const nextKey = localDateKey(addDays(d, 1));
        const sessionsNext = byDate.get(nextKey) || [];

        // If shift exists, measure overlap in its window; else fallback to raw
        if (sh) {
          const [shh, sm] = String(sh.start_time || "09:00").split(":").map(x => Number(x || 0));
          const [ehh, em] = String(sh.end_time || "18:00").split(":").map(x => Number(x || 0));
          const segs = [];
          const startTs = new Date(`${key}T${String(shh).padStart(2,"0")}:${String(sm).padStart(2,"0")}:00`).getTime();
          const endSame = new Date(`${key}T${String(ehh).padStart(2,"0")}:${String(em).padStart(2,"0")}:00`).getTime();
          if (!sh.is_night) {
            segs.push([startTs, endSame]);
          } else {
            const nextStart = new Date(`${nextKey}T00:00:00`).getTime();
            const nextEnd = new Date(`${nextKey}T${String(ehh).padStart(2,"0")}:${String(em).padStart(2,"0")}:00`).getTime();
            segs.push([startTs, Math.max(startTs, new Date(`${key}T23:59:59`).getTime() + 1000)]);
            segs.push([nextStart, nextEnd]);
          }
          const clamp = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
          const addFrom = (list, s1, s2) => {
            list.forEach(row => {
              const li = row.login_at ? new Date(row.login_at).getTime() : null;
              const lo = row.logout_at ? new Date(row.logout_at).getTime() : null;
              const endTs = lo || now.getTime();
              const startTs2 = li || s1;
              const ov = clamp(startTs2, endTs, s1, s2);
              if (ov > 0) {
                seconds += Math.floor(ov / 1000);
                const liD = row.login_at ? new Date(row.login_at) : null;
                const loD = row.logout_at ? new Date(row.logout_at) : null;
                if (liD && (!firstIn || liD < firstIn)) firstIn = liD;
                if (loD && (!lastOut || loD > lastOut)) lastOut = loD;
                presentDays.add(key);
                if (!row.logout_at && li) activeLoginAt = li;
              }
            });
          };
          addFrom(sessionsToday, segs[0][0], segs[0][1]);
          if (sh.is_night) addFrom(sessionsNext, segs[1][0], segs[1][1]);
        } else {
          // Fallback: raw sessions for the day
          sessionsToday.forEach(row => {
            seconds += Number(row.duration_minutes || 0) * 60;
            const li = row.login_at ? new Date(row.login_at) : null;
            const lo = row.logout_at ? new Date(row.logout_at) : null;
            if (li && (!firstIn || li < firstIn)) firstIn = li;
            if (lo && (!lastOut || lo > lastOut)) lastOut = lo;
            presentDays.add(key);
            if (!row.logout_at && li) activeLoginAt = li;
          });
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
        lastOut: present ? null : lastOut,
        seconds,
      };
    });

    const filtered = showPresentOnly ? items.filter((r) => r.present) : items;
    return filtered.sort((a, b) => Number(b.present) - Number(a.present) || (b.seconds || 0) - (a.seconds || 0));
  }, [profiles, sessions, assignments, shifts, showPresentOnly, rangeInfo.from, rangeInfo.to, rangeInfo.days, nowTs]);

  const presentNowCount = useMemo(() => rows.filter((r) => r.present).length, [rows]);
  const totalSeconds = useMemo(() => rows.reduce((sum, r) => sum + Number(r.seconds || 0), 0), [rows]);
  const totalEmployees = useMemo(() => rows.length, [rows]);
  const totalPresentDays = useMemo(() => rows.reduce((sum, r) => sum + Number(r.presentDays || 0), 0), [rows]);
  const totalAbsentDays = useMemo(() => rows.reduce((sum, r) => sum + Number(r.absentDays || 0), 0), [rows]);
  const avgSeconds = useMemo(() => (totalEmployees ? Math.floor(totalSeconds / totalEmployees) : 0), [totalEmployees, totalSeconds]);

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
              {formatDateCustom(rangeInfo.from)} → {formatDateCustom(addDays(rangeInfo.to, -1))} • {rangeInfo.days} days
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
            <div className="mt-2 text-2xl font-semibold text-heading">{formatSecondsAsHHMMSS(totalSeconds)}</div>
            <div className="mt-1 text-xs text-black/60">avg {formatSecondsAsHHMMSS(avgSeconds)} / employee</div>
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
                    "rounded-md border px-3 py-2 text-sm " +
                    (preset === i.key
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-black/10 bg-white text-black/70 hover:bg-black/5")
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
                    <th className="px-4 py-3 text-left">Login</th>
                    <th className="px-4 py-3 text-left">Logout</th>
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
                      <td className="px-4 py-3">{r.firstIn ? formatLocalDateTime12(r.firstIn) : "-"}</td>
                      <td className="px-4 py-3">{r.lastOut ? formatLocalDateTime12(r.lastOut) : "-"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatSecondsAsHHMMSS(r.seconds)}</td>
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
