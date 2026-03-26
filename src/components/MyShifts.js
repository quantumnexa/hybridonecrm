"use client";

import { useMemo, useState, useEffect } from "react";
import { supabase, getUserCached } from "@/lib/supabase";
import { formatTimeHM12, formatLocalTime12, formatSecondsAsHHMMSS, formatDateCustom } from "@/lib/timeFormat";

function daysOfMonth(year, monthIndex) {
  const days = [];
  let d = new Date(year, monthIndex, 1);
  while (d.getMonth() === monthIndex) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function MyShifts() {
  const now = new Date();
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState("");
  const [assignMonth, setAssignMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [rows, setRows] = useState([]);
  const [perDaySessions, setPerDaySessions] = useState({});
  const [nowTs, setNowTs] = useState(0);

  const meta = useMemo(() => {
    const [y, m] = assignMonth.split("-").map((x) => Number(x));
    const year = Number.isFinite(y) ? y : new Date().getFullYear();
    const monthIndex = Number.isFinite(m) ? m - 1 : new Date().getMonth();
    const label = new Date(year, monthIndex, 1).toLocaleString(undefined, { year: "numeric", month: "long" });
    const days = daysOfMonth(year, monthIndex);
    return { year, monthIndex, label, days };
  }, [assignMonth]);

  useEffect(() => {
    const init = async () => {
      const u = await getUserCached();
      setUserId(u?.id || null);
    };
    init();
  }, []);

  useEffect(() => {
    const kick = setTimeout(() => setNowTs(Date.now()), 0);
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => {
      clearTimeout(kick);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!userId) return;
      setError("");
      const start = new Date(meta.year, meta.monthIndex, 1);
      const end = new Date(meta.year, meta.monthIndex + 1, 1);
      const { data: assigns, error: aErr } = await supabase
        .from("shift_assignments")
        .select("id, work_date, shift_id")
        .eq("user_id", userId)
        .gte("work_date", toIsoDate(start))
        .lt("work_date", toIsoDate(end))
        .order("work_date", { ascending: true });
      if (aErr) {
        setError(aErr.message || "Failed to load shifts");
        setRows([]);
        return;
      }
      const { data: ws } = await supabase
        .from("work_sessions")
        .select("work_date, login_at, logout_at, duration_minutes")
        .eq("user_id", userId)
        .gte("work_date", toIsoDate(start))
        .lte("work_date", toIsoDate(new Date(meta.year, meta.monthIndex, meta.days.length + 1))); // Buffer for next day sessions
      const byDateSessions = {};
      (ws || []).forEach((s) => {
        const key = String(s.work_date);
        (byDateSessions[key] ||= []).push(s);
      });
      setPerDaySessions(byDateSessions);
      const ids = Array.from(new Set((assigns || []).map((r) => r.shift_id).filter(Boolean)));
      let map = {};
      if (ids.length) {
        const { data: sh } = await supabase.from("shifts").select("*").in("id", ids);
        map = (sh || []).reduce((acc, s) => {
          acc[s.id] = s;
          return acc;
        }, {});
      }
      const byDate = new Map((assigns || []).map((r) => [String(r.work_date), r]));
      const out = meta.days.map((d) => {
        const key = toIsoDate(d);
        const a = byDate.get(key) || null;
        const s = a && a.shift_id ? map[a.shift_id] : null;
        const sessionsToday = byDateSessions[key] || [];
        let firstLogin = null;
        let lastLogout = null;
        let seconds = 0;
        let totalSeconds = 0;
        let awaySeconds = 0;
        const hasShift = !!s;
        let openInWindow = false;
        if (hasShift) {
          const [sh, sm] = String(s.start_time || "09:00").split(":").map((x) => Number(x || 0));
          const shiftStartMs = new Date(key + `T${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}:00`).getTime();
          const shiftWindowEndMs = shiftStartMs + 24 * 3600 * 1000;
          const endLimitMs = Math.min(nowTs, shiftWindowEndMs);

          const next = new Date(d);
          next.setDate(next.getDate() + 1);
          const nextKey = toIsoDate(next);
          const sessionsNext = byDateSessions[nextKey] || [];

          const intervals = [];
          [...sessionsToday, ...sessionsNext].forEach((row) => {
            if (!row.login_at) return;
            const li = new Date(row.login_at).getTime();
            const lo = row.logout_at ? new Date(row.logout_at).getTime() : nowTs;
            const segStart = Math.max(li, shiftStartMs);
            const segEnd = Math.min(lo, shiftWindowEndMs);
            if (segEnd > segStart) {
              intervals.push([segStart, segEnd, !!row.logout_at]);
              const liD = new Date(segStart);
              if (!firstLogin || liD < firstLogin) firstLogin = liD;
              if (!row.logout_at) openInWindow = true;
            }
          });

          // Also track the actual logout for lastLogout calculation across both days
          [...sessionsToday, ...sessionsNext].forEach((row) => {
            if (!row.login_at || !row.logout_at) return;
            const lo = new Date(row.logout_at).getTime();
            if (lo > shiftStartMs && lo <= shiftWindowEndMs) {
              if (!lastLogout || lo > lastLogout.getTime()) lastLogout = new Date(lo);
            }
          });

          intervals.sort((a, b) => a[0] - b[0]);
          const merged = [];
          let cur = null;
          intervals.forEach((iv) => {
            const a = iv[0];
            const b = iv[1];
            if (!cur) {
              cur = [a, b];
              return;
            }
            if (a <= cur[1]) cur[1] = Math.max(cur[1], b);
            else {
              merged.push(cur);
              cur = [a, b];
            }
          });
          if (cur) merged.push(cur);
          seconds = merged.reduce((sum, [a, b]) => sum + Math.floor((b - a) / 1000), 0);

          if (firstLogin) {
            const firstStartMs = firstLogin.getTime();
            const lastMs = openInWindow ? endLimitMs : (lastLogout ? lastLogout.getTime() : firstStartMs);
            totalSeconds = Math.max(0, Math.floor((lastMs - firstStartMs) / 1000));
            awaySeconds = Math.max(0, totalSeconds - seconds);
          } else {
            totalSeconds = 0;
            awaySeconds = 0;
          }
        } else {
          sessionsToday.forEach((row) => {
            const dur = Number(row.duration_minutes || 0);
            if (dur > 0) seconds += dur * 60;
            const li = row.login_at ? new Date(row.login_at) : null;
            const lo = row.logout_at ? new Date(row.logout_at) : null;
            if (li && (!firstLogin || li < firstLogin)) firstLogin = li;
            if (lo && (!lastLogout || lo > lastLogout)) lastLogout = lo;
          });
          totalSeconds = seconds;
          awaySeconds = 0;
        }
        let isCurrent = false;
        if (hasShift && s?.start_time) {
          const [sh, sm] = String(s.start_time || "09:00").split(":").map((x) => Number(x || 0));
          const shiftStartMs = new Date(key + `T${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}:00`).getTime();
          const shiftWindowEndMs = shiftStartMs + 24 * 3600 * 1000;
          isCurrent = nowTs >= shiftStartMs && nowTs < shiftWindowEndMs;
        } else {
          isCurrent = key === toIsoDate(new Date(nowTs));
        }
        return {
          date: key,
          weekday: d.toLocaleString(undefined, { weekday: "short" }),
          label: s ? `${s.name} (${formatTimeHM12(s.start_time)} - ${formatTimeHM12(s.end_time)})` : "OFF",
          hasShift: !!s,
          isNight: s ? !!s.is_night : false,
          isToday: isCurrent,
          clockIn: firstLogin ? formatLocalTime12(firstLogin) : "-",
          clockOut: openInWindow ? "—" : (lastLogout ? formatLocalTime12(lastLogout) : "—"),
          seconds,
          totalSeconds,
          awaySeconds,
        };
      });
      setRows(out);
    };
    load();
  }, [userId, meta.year, meta.monthIndex, meta.days, nowTs, perDaySessions]);

  const stats = useMemo(() => {
    const total = rows.length;
    const withShift = rows.filter((r) => r.hasShift).length;
    const off = total - withShift;
    const today = rows.find((r) => r.isToday) || null;
    return { total, withShift, off, today };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <div className="text-heading text-xl font-semibold">My Shifts</div>
          <div className="rounded-full bg-black/5 px-3 py-1 text-xs text-black/70">{meta.label}</div>
        </div>
        <input
          type="month"
          className="rounded-md border border-black/10 px-2 py-2"
          value={assignMonth}
          onChange={(e) => setAssignMonth(e.target.value)}
        />
      </div>
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-xs text-black/60">Assigned Days</div>
          <div className="mt-1 text-2xl font-semibold text-heading">{stats.withShift}</div>
          <div className="mt-1 text-xs text-black/60">out of {stats.total}</div>
        </div>
        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-xs text-black/60">OFF Days</div>
          <div className="mt-1 text-2xl font-semibold text-heading">{stats.off}</div>
          <div className="mt-1 text-xs text-black/60">in {meta.label}</div>
        </div>
        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-xs text-black/60">Today</div>
          <div className="mt-1 text-lg font-semibold text-heading">
            {stats.today ? (stats.today.hasShift ? stats.today.label : "OFF") : "-"}
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-black/10 bg-white p-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1000px] w-full text-sm">
            <thead className="bg-black/5 text-black/70 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Day</th>
                <th className="px-4 py-3 text-left">Shift</th>
                <th className="px-4 py-3 text-left">Clock In</th>
                <th className="px-4 py-3 text-left">Clock Out</th>
                <th className="px-4 py-3 text-right">Worked</th>
                <th className="px-4 py-3 text-right">Away</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const cls =
                  (r.isToday ? "bg-yellow-50" : idx % 2 === 0 ? "bg-white" : "bg-black/[0.015]") +
                  " border-t";
                const badge =
                  "inline-flex items-center rounded-full px-3 py-1 text-xs " +
                  (r.hasShift
                    ? r.isNight
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-emerald-100 text-emerald-700"
                    : "bg-black/10 text-black/60");
                return (
                  <tr key={r.date} className={cls}>
                    <td className="px-4 py-3">{formatDateCustom(r.date)}</td>
                    <td className="px-4 py-3">{r.weekday}</td>
                    <td className="px-4 py-3">
                      <span className={badge}>{r.label}</span>
                    </td>
                    <td className="px-4 py-3">{r.clockIn}</td>
                    <td className="px-4 py-3">{r.clockOut}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatSecondsAsHHMMSS(r.seconds || 0)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatSecondsAsHHMMSS(r.awaySeconds || 0)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatSecondsAsHHMMSS(r.totalSeconds || 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <div className="p-4 text-sm text-black/60">No rows.</div>}
        </div>
      </div>
    </div>
  );
}
