"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, getUserCached, startWorkSession, endWorkSession } from "@/lib/supabase";
import { formatTimeHM12, formatLocalTime12, formatSecondsAsHHMMSS } from "@/lib/timeFormat";

function localDateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildShiftWindow(dateKey, shift) {
  if (!shift?.start_time || !shift?.end_time) return null;
  const [sh, sm] = String(shift.start_time).split(":").map((t) => Number(t || 0));
  const [eh, em] = String(shift.end_time).split(":").map((t) => Number(t || 0));
  const startMs = new Date(`${dateKey}T${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}:00`).getTime();
  let endMs = new Date(`${dateKey}T${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}:00`).getTime();
  if (endMs <= startMs) endMs += 24 * 3600 * 1000;
  const shiftSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  return { startMs, endMs, shiftSeconds };
}

export default function ClockWidget() {
  const [userId, setUserId] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openLoginAt, setOpenLoginAt] = useState(null);
  const [uiSessionStartAt, setUiSessionStartAt] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [todayShift, setTodayShift] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [firstLoginAt, setFirstLoginAt] = useState(null);
  const [expectedClockOutAt, setExpectedClockOutAt] = useState(null);
  const [awaySeconds, setAwaySeconds] = useState(0);
  const [scheduledStartAt, setScheduledStartAt] = useState(null);
  const [scheduledEndAt, setScheduledEndAt] = useState(null);
  const [lateSeconds, setLateSeconds] = useState(0);

  const [totalWorkedSeconds, setTotalWorkedSeconds] = useState(0);

  const inSession = useMemo(() => !!openLoginAt, [openLoginAt]);

  const loadStatus = useCallback(async () => {
    setError("");
    setLoading(true);
    const u = await getUserCached();
    const uid = u?.id || null;
    setUserId(uid);
    let r = u?.app_metadata?.role || u?.user_metadata?.role || null;
    if (!r && uid) {
      const { data: prof } = await supabase.from("profiles").select("role").eq("user_id", uid).maybeSingle();
      r = prof?.role || null;
    }
    setRole(r || "sales");
    if (!uid) {
      setOpenLoginAt(null);
      setUiSessionStartAt(null);
      setLoading(false);
      return;
    }
    const now = new Date();
    const key = localDateKey(now);
    const { data: open } = await supabase
      .from("work_sessions")
      .select("*")
      .eq("user_id", uid)
      .eq("work_date", key)
      .is("logout_at", null)
      .order("login_at", { ascending: false })
      .limit(1);
    const row = (open || [])[0] || null;
    setOpenLoginAt(row?.login_at || null);
    const refTs = row?.login_at ? new Date(row.login_at).getTime() : now.getTime();
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const yKey = localDateKey(y);

    const { data: assignToday } = await supabase
      .from("shift_assignments")
      .select("shift_id")
      .eq("user_id", uid)
      .eq("work_date", key)
      .maybeSingle();
    const { data: assignY } = await supabase
      .from("shift_assignments")
      .select("shift_id")
      .eq("user_id", uid)
      .eq("work_date", yKey)
      .maybeSingle();
    const { data: shToday } = assignToday?.shift_id
      ? await supabase.from("shifts").select("*").eq("id", assignToday.shift_id).maybeSingle()
      : { data: null };
    const { data: shY } = assignY?.shift_id
      ? await supabase.from("shifts").select("*").eq("id", assignY.shift_id).maybeSingle()
      : { data: null };

    const wToday = shToday ? buildShiftWindow(key, shToday) : null;
    const wY = shY ? buildShiftWindow(yKey, shY) : null;

    let shift = shToday || shY || null;
    let baseKey = key;
    let win = wToday || wY || null;
    if (wToday && refTs >= wToday.startMs && refTs < wToday.endMs) {
      shift = shToday;
      baseKey = key;
      win = wToday;
    } else if (wY && refTs >= wY.startMs && refTs < wY.endMs) {
      shift = shY;
      baseKey = yKey;
      win = wY;
    }
    setTodayShift(shift || null);

    const baseMid = new Date(`${baseKey}T00:00:00`).getTime();
    const nextKey = localDateKey(new Date(baseMid + 86400000));
    const { data: ws } = await supabase
      .from("work_sessions")
      .select("work_date, login_at, logout_at, duration_minutes")
      .eq("user_id", uid)
      .in("work_date", [baseKey, nextKey]);
    setSessions(ws || []);

    const schedStartTs = win?.startMs ?? null;
    const schedEndTs = win?.endMs ?? null;
    const shiftSeconds = win?.shiftSeconds ?? 8 * 3600;
    setScheduledStartAt(schedStartTs ? new Date(schedStartTs) : null);
    setScheduledEndAt(schedEndTs ? new Date(schedEndTs) : null);

    let earliestOverall = null;
    (ws || []).forEach((s) => {
      if (!s.login_at) return;
      const li = new Date(s.login_at).getTime();
      if (!Number.isFinite(li)) return;
      if (!earliestOverall || li < earliestOverall) earliestOverall = li;
    });

    let chosenStart = null;
    if (schedStartTs && schedEndTs) {
      (ws || []).forEach((s) => {
        if (!s.login_at) return;
        const li = new Date(s.login_at).getTime();
        const lo = s.logout_at ? new Date(s.logout_at).getTime() : now.getTime();
        const ovStart = Math.max(li, schedStartTs);
        const ovEnd = Math.min(lo, schedEndTs);
        if (ovEnd > ovStart) {
          if (!chosenStart || ovStart < chosenStart) chosenStart = ovStart;
        }
      });
    }
    if (!chosenStart) chosenStart = earliestOverall;
    setFirstLoginAt(chosenStart ? new Date(chosenStart) : null);

    if (chosenStart) {
      const nowTs = now.getTime();
      const intervals = [];
      (ws || []).forEach((s) => {
        if (!s.login_at) return;
        const li = new Date(s.login_at).getTime();
        const lo = s.logout_at ? new Date(s.logout_at).getTime() : nowTs;
        if (lo > li) intervals.push([li, lo]);
      });
      intervals.sort((a, b) => a[0] - b[0]);
      const merged = [];
      let cur = null;
      intervals.forEach((iv) => {
        if (!cur) { cur = [...iv]; return; }
        if (iv[0] <= cur[1]) cur[1] = Math.max(cur[1], iv[1]);
        else { merged.push(cur); cur = [...iv]; }
      });
      if (cur) merged.push(cur);
      let workedAfterMs = 0;
      merged.forEach(([a, b]) => {
        const aa = Math.max(a, chosenStart);
        const bb = Math.min(b, nowTs);
        if (bb > aa) workedAfterMs += (bb - aa);
      });
      const awayAfterMs = Math.max(0, (nowTs - chosenStart) - workedAfterMs);
      setAwaySeconds(Math.floor(awayAfterMs / 1000));
      const lateMs = schedStartTs ? Math.max(0, chosenStart - schedStartTs) : 0;
      setLateSeconds(Math.floor(lateMs / 1000));
      const projected = new Date(chosenStart + (shiftSeconds * 1000) + awayAfterMs);
    setExpectedClockOutAt(projected);
  } else {
      setAwaySeconds(0);
      setLateSeconds(0);
      setExpectedClockOutAt(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      loadStatus();
    }, 0);
    return () => clearTimeout(t);
  }, [loadStatus]);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      
      // Calculate total worked seconds across all sessions (including live one)
      // This logic is aligned with MyShifts's "Worked" calculation
      const intervals = [];
      const sStart = scheduledStartAt?.getTime();
      const sEnd = scheduledEndAt?.getTime();
      
      (sessions || []).forEach((s) => {
        if (!s.login_at) return;
        const li = new Date(s.login_at).getTime();
        const lo = s.logout_at ? new Date(s.logout_at).getTime() : now;
        
        // If we have a shift window, we should ideally constrain to it (like MyShifts does)
        let segStart = li;
        let segEnd = lo;
        if (sStart && sEnd) {
          segStart = Math.max(li, sStart);
          segEnd = Math.min(lo, sEnd);
        }
        
        if (segEnd > segStart) {
          intervals.push([segStart, segEnd]);
        }
      });
      
      intervals.sort((a, b) => a[0] - b[0]);
      const merged = [];
      let cur = null;
      intervals.forEach((iv) => {
        if (!cur) { cur = [...iv]; return; }
        if (iv[0] <= cur[1]) cur[1] = Math.max(cur[1], iv[1]);
        else { merged.push(cur); cur = [...iv]; }
      });
      if (cur) merged.push(cur);
      
      const total = merged.reduce((sum, [a, b]) => sum + Math.floor((b - a) / 1000), 0);
      setTotalWorkedSeconds(Math.max(0, total));
      
      if (inSession && uiSessionStartAt) {
        setElapsedSeconds(Math.max(0, Math.floor((now - uiSessionStartAt) / 1000)));
      } else {
        setElapsedSeconds(0);
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [inSession, uiSessionStartAt, sessions, scheduledStartAt, scheduledEndAt]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (openLoginAt) {
        const ts = new Date(openLoginAt).getTime();
        setUiSessionStartAt(Number.isFinite(ts) ? ts : null);
      } else {
        setUiSessionStartAt(null);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [openLoginAt]);

  // No polling of Supabase every second; tick only drives UI second counter.

  const action = async () => {
    if (!userId) return;
    setError("");
    setLoading(true);
    try {
      if (inSession) {
        await endWorkSession({ userId });
      } else {
        await startWorkSession({ userId, role });
      }
    } catch (e) {
      setError(e?.message || "Failed");
    }
    await loadStatus();
    setLoading(false);
  };

  const statusText = inSession ? "Clocked In" : "Clocked Out";
  const btnLabel = inSession ? "Clock Out" : "Clock In";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-black/5 bg-white p-6 shadow-lg transition-all hover:shadow-xl">
      {/* Decorative background element */}
      <div className={`absolute -right-8 -top-8 h-32 w-32 rounded-full blur-3xl transition-colors duration-500 ${inSession ? "bg-emerald-400/10" : "bg-slate-400/10"}`} />

      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl shadow-inner transition-all duration-500 ${inSession ? "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100" : "bg-slate-50 text-slate-400 ring-1 ring-slate-100"}`}>
            {inSession ? (
              <svg viewBox="0 0 24 24" className="h-7 w-7 animate-pulse" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${inSession ? "animate-ping bg-emerald-500" : "bg-slate-300"}`} />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{statusText}</span>
            </div>
            
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black tabular-nums text-slate-900">
                {formatSecondsAsHHMMSS(totalWorkedSeconds)}
              </span>
              <span className="text-sm font-medium text-slate-400">Today</span>
            </div>

            <div className="mt-1 flex flex-wrap gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                todayShift 
                  ? (todayShift.is_night ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100" : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100") 
                  : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
              }`}>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                  <path d="M12 6v6l4 2" />
                </svg>
                {todayShift ? `${todayShift.name} (${formatTimeHM12(todayShift.start_time)} - ${formatTimeHM12(todayShift.end_time)})` : "No Shift Assigned"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          <button
            onClick={action}
            disabled={loading || !userId}
            className={`group relative flex h-14 w-full items-center justify-center overflow-hidden rounded-xl px-8 font-bold transition-all active:scale-95 sm:w-auto ${
              inSession 
                ? "bg-rose-500 text-white shadow-rose-200 hover:bg-rose-600 hover:shadow-lg" 
                : "bg-indigo-600 text-white shadow-indigo-200 hover:bg-indigo-700 hover:shadow-lg"
            }`}
          >
            {loading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <span className="flex items-center gap-2">
                {btnLabel}
                <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 rounded-xl bg-slate-50/50 p-4 ring-1 ring-slate-100 sm:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Shift Schedule</span>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <span className="text-indigo-600">{scheduledStartAt ? formatLocalTime12(scheduledStartAt) : "--:--"}</span>
              <span className="text-slate-300">→</span>
              <span className="text-indigo-600">{scheduledEndAt ? formatLocalTime12(scheduledEndAt) : "--:--"}</span>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Your First Clock In</span>
            <span className="mt-1 text-sm font-bold text-slate-900">{firstLoginAt ? formatLocalTime12(firstLoginAt) : "Not clocked in yet"}</span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Estimated Clock Out</span>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm font-bold text-emerald-600">{expectedClockOutAt ? formatLocalTime12(expectedClockOutAt) : "--:--"}</span>
              {inSession && (
                <span className="inline-flex items-center rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                  LIVE
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Session Stats</span>
            <div className="mt-1 flex items-center gap-3 text-xs font-bold">
              <span className={`flex items-center gap-1 ${lateSeconds > 0 ? "text-amber-600" : "text-slate-500"}`}>
                Late: {formatSecondsAsHHMMSS(lateSeconds)}
              </span>
              <span className="h-3 w-[1px] bg-slate-200" />
              <span className={`flex items-center gap-1 ${awaySeconds > 0 ? "text-rose-500" : "text-slate-500"}`}>
                Away: {formatSecondsAsHHMMSS(awaySeconds)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-rose-50 p-3 text-xs font-bold text-rose-600 ring-1 ring-rose-100">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
