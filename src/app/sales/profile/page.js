"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import { formatMinutesAsHHMM } from "@/lib/timeFormat";

export default function Page() {
  const [userId, setUserId] = useState(null);
  const [userEmail, setUserEmail] = useState("");
  const [profile, setProfile] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nowTs, setNowTs] = useState(0);

  const localDateKey = (d) => {
    const x = d instanceof Date ? d : new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const day = String(x.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);

  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };

  const addMonths = (d, n) => {
    const x = new Date(d);
    x.setMonth(x.getMonth() + n);
    return x;
  };

  const weekStart = (d) => {
    const x = startOfDay(d);
    const day = x.getDay();
    const diff = (day + 6) % 7;
    x.setDate(x.getDate() - diff);
    return x;
  };

  const boundsForPreset = (preset) => {
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
    if (preset === "last_week") {
      const thisW = weekStart(now);
      const from = addDays(thisW, -7);
      const to = thisW;
      return { from, to };
    }
    if (preset === "this_month") {
      const from = startOfMonth(now);
      const to = addMonths(from, 1);
      return { from, to };
    }
    if (preset === "custom") return null;
    return null;
  };

  const toIsoInputValue = (d) => {
    if (!d) return "";
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  };

  const initialToday = useMemo(() => {
    const now = new Date();
    const from = startOfDay(now);
    const to = addDays(from, 1);
    return { from, to };
  }, []);
  const [preset, setPreset] = useState("today");
  const [customFrom, setCustomFrom] = useState(toIsoInputValue(initialToday.from));
  const [customTo, setCustomTo] = useState(toIsoInputValue(initialToday.to));
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

  const todayKey = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const loadAll = useCallback(async () => {
    setError("");
    setLoading(true);
    const u = await getUserCached();
    const uid = u?.id || null;
    setUserId(uid);
    setUserEmail(u?.email || "");
    if (!uid) {
      setProfile(null);
      setSessions([]);
      setTasks([]);
      setLoading(false);
      return;
    }
    const { data: prof } = await supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle();
    setProfile(prof || null);

    const { data: dataSessions, error: err } = await supabase
      .from("work_sessions")
      .select("*")
      .eq("user_id", uid)
      .order("login_at", { ascending: false })
      .limit(200);
    if (err) {
      setError(err.message || "Failed to load work sessions");
      setSessions([]);
      setTasks([]);
      setLoading(false);
      return;
    }
    setSessions(dataSessions || []);

    const fromIso = bounds.from;
    const toIso = bounds.to;
    const { data: taskRows, error: tErr } = await supabase
      .from("tasks")
      .select("id,status,created_at,updated_at")
      .eq("assignee_id", uid)
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("created_at", { ascending: false });
    if (tErr) {
      setError(tErr.message || "Failed to load tasks");
      setTasks([]);
      setLoading(false);
      return;
    }
    setTasks(taskRows || []);
    setLoading(false);
  }, [bounds.from, bounds.to]);

  useEffect(() => {
    const init = async () => {
      await loadAll();
    };
    init();
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [loadAll]);

  const rangeWork = useMemo(() => {
    const from = new Date(bounds.from);
    const to = new Date(bounds.to);
    const fromKey = localDateKey(from);
    const toKey = localDateKey(new Date(to.getTime() - 1));
    const now = new Date(nowTs);
    const map = {};
    let totalMinutes = 0;

    (sessions || []).forEach((s) => {
      const d = s.work_date || (s.login_at ? String(s.login_at).slice(0, 10) : "");
      if (!d || d < fromKey || d > toKey) return;
      if (!map[d]) map[d] = { date: d, minutes: 0, firstIn: null, lastOut: null };
      map[d].minutes += Number(s.duration_minutes || 0);
      const li = s.login_at ? new Date(s.login_at) : null;
      const lo = s.logout_at ? new Date(s.logout_at) : null;
      if (li && (!map[d].firstIn || li < map[d].firstIn)) map[d].firstIn = li;
      if (lo && (!map[d].lastOut || lo > map[d].lastOut)) map[d].lastOut = lo;

      if (!s.logout_at && li) {
        const start = new Date(Math.max(li.getTime(), from.getTime()));
        const end = new Date(Math.min(now.getTime(), to.getTime()));
        if (end > start) {
          const addMins = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
          map[d].minutes += addMins;
        }
      }
    });

    const days = Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1));
    days.forEach((d) => {
      totalMinutes += Number(d.minutes || 0);
    });
    return { totalMinutes, days, fromKey, toKey };
  }, [sessions, bounds.from, bounds.to, nowTs]);

  const workByDay = useMemo(() => {
    const map = {};
    (sessions || []).forEach((s) => {
      const d = s.work_date || (s.login_at ? String(s.login_at).slice(0, 10) : "");
      if (!d) return;
      if (!map[d]) map[d] = { date: d, minutes: 0, firstIn: null, lastOut: null };
      
      let mins = Number(s.duration_minutes || 0);
      const li = s.login_at ? new Date(s.login_at) : null;
      const lo = s.logout_at ? new Date(s.logout_at) : null;
      
      if (!s.logout_at && li) {
        mins = Math.max(0, Math.floor((nowTs - li.getTime()) / 60000));
      }
      
      map[d].minutes += mins;
      if (li && (!map[d].firstIn || li < map[d].firstIn)) map[d].firstIn = li;
      if (lo && (!map[d].lastOut || lo > map[d].lastOut)) map[d].lastOut = lo;
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [sessions, nowTs]);

  const openSession = useMemo(() => {
    return (sessions || []).find((s) => !s.logout_at) || null;
  }, [sessions]);

  const todaySummary = useMemo(() => {
    return workByDay.find((x) => x.date === todayKey) || null;
  }, [workByDay, todayKey]);

  const taskStats = useMemo(() => {
    const total = tasks.length;
    const byStatus = tasks.reduce((acc, t) => {
      const s = t.status || "open";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    return { total, byStatus };
  }, [tasks]);

  return (
    <AuthGuard allowedRoles={["sales"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-heading text-2xl font-bold">Profile</h1>
          <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={loadAll}>
            Refresh
          </button>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">My Details</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-black/60">Name</div>
              <div className="font-semibold">{profile?.display_name || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-black/60">Email</div>
              <div className="font-semibold">{userEmail || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-black/60">Role</div>
              <div className="font-semibold">{profile?.role || "-"}</div>
            </div>
            {profile?.position && (
              <div>
                <div className="text-xs text-black/60">Position</div>
                <div className="font-semibold">{profile.position}</div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Filters</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {[
              { key: "today", label: "Today" },
              { key: "yesterday", label: "Yesterday" },
              { key: "this_week", label: "This Week" },
              { key: "last_week", label: "Last Week" },
              { key: "this_month", label: "This Month" },
              { key: "custom", label: "Custom" },
            ].map((i) => (
              <button
                key={i.key}
                className={
                  "rounded-md border border-black/10 bg-white px-3 py-2 text-sm hover:bg-blue-600 hover:text-white" +
                  (preset === i.key ? " bg-blue-600 text-white" : "")
                }
                onClick={() => changePreset(i.key)}
              >
                {i.label}
              </button>
            ))}
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                className="rounded-md border border-black/10 px-2 py-1 text-sm"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                disabled={preset !== "custom"}
              />
              <span className="text-sm">to</span>
              <input
                type="datetime-local"
                className="rounded-md border border-black/10 px-2 py-1 text-sm"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                disabled={preset !== "custom"}
              />
              <button
                className="rounded-md bg-heading px-3 py-2 text-sm text-background hover:bg-hover disabled:opacity-50"
                onClick={applyCustom}
                disabled={preset !== "custom" || !customFrom || !customTo}
              >
                Apply
              </button>
            </div>
          </div>
          <div className="mt-2 text-xs text-black/60">
            Range: {rangeWork.fromKey} → {rangeWork.toKey}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Work Hours (Today)</div>
            <div className="mt-3 text-3xl font-bold">{todaySummary ? formatMinutesAsHHMM(todaySummary.minutes) : "00:00"}</div>
            <div className="mt-2 text-xs text-black/60">
              In: {todaySummary?.firstIn ? todaySummary.firstIn.toLocaleTimeString() : "-"} • Out:{" "}
              {todaySummary?.lastOut ? todaySummary.lastOut.toLocaleTimeString() : "-"}
            </div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm md:col-span-2">
            <div className="text-sm font-semibold text-heading">Status</div>
            <div className="mt-2 text-sm">
              {loading ? "Loading..." : !userId ? "Not signed in" : openSession ? `Working since ${new Date(openSession.login_at).toLocaleString()}` : "Not working (no active session)"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Work Hours (Range)</div>
            <div className="mt-3 text-3xl font-bold">{formatMinutesAsHHMM(rangeWork.totalMinutes)}</div>
            <div className="mt-2 text-xs text-black/60">Includes ongoing time if currently logged in</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Tasks Assigned (Range)</div>
            <div className="mt-3 text-3xl font-bold">{taskStats.total}</div>
            <div className="mt-2 text-xs text-black/60">
              Open: {taskStats.byStatus.open || 0} • In Progress: {taskStats.byStatus.in_progress || 0} • Completed:{" "}
              {taskStats.byStatus.completed || 0} • Cancelled: {taskStats.byStatus.cancelled || 0}
            </div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Days Worked (Range)</div>
            <div className="mt-3 text-3xl font-bold">{rangeWork.days.length}</div>
            <div className="mt-2 text-xs text-black/60">Days with at least one session</div>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Daily Work Hours (Range)</div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-black/70">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">First Login</th>
                  <th className="px-3 py-2 text-left">Last Logout</th>
                  <th className="px-3 py-2 text-right">Hours</th>
                </tr>
              </thead>
              <tbody>
                {rangeWork.days.slice(0, 31).map((d) => (
                  <tr key={d.date} className="border-t">
                    <td className="px-3 py-2">{d.date}</td>
                    <td className="px-3 py-2">{d.firstIn ? d.firstIn.toLocaleString() : "-"}</td>
                    <td className="px-3 py-2">{d.lastOut ? d.lastOut.toLocaleString() : "-"}</td>
                    <td className="px-3 py-2 text-right">{formatMinutesAsHHMM(d.minutes)}</td>
                  </tr>
                ))}
                {rangeWork.days.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-black/60" colSpan={4}>
                      No work sessions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Tasks Assigned (Range)</div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-black/70">
                <tr>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Task ID</th>
                </tr>
              </thead>
              <tbody>
                {tasks.slice(0, 25).map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="px-3 py-2">{t.created_at ? new Date(t.created_at).toLocaleString() : "-"}</td>
                    <td className="px-3 py-2">{t.status || "-"}</td>
                    <td className="px-3 py-2">{t.id}</td>
                  </tr>
                ))}
                {tasks.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-black/60" colSpan={3}>
                      No tasks assigned in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
