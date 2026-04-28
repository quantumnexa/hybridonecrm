"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, getUserCached } from "@/lib/supabase";
import { formatDateCustom, formatLocalTime12, formatMinutesAsHHMM } from "@/lib/timeFormat";

function normalizeHalfDayPart(v) {
  const t = String(v || "").trim().toLowerCase();
  return t === "first" || t === "second" ? t : "";
}

function buildShiftStartEndMs(dateKey, shift) {
  if (!dateKey || !shift?.start_time || !shift?.end_time) return null;
  const pad2 = (n) => String(n).padStart(2, "0");
  const [shh, sm] = String(shift.start_time || "09:00").split(":").map((x) => Number(x || 0));
  const [ehh, em] = String(shift.end_time || "18:00").split(":").map((x) => Number(x || 0));
  const shiftStartMs = new Date(`${dateKey}T${pad2(shh)}:${pad2(sm)}:00`).getTime();
  let shiftEndMs = new Date(`${dateKey}T${pad2(ehh)}:${pad2(em)}:00`).getTime();
  if (shift.is_night || shiftEndMs <= shiftStartMs) shiftEndMs += 24 * 3600 * 1000;
  const midMs = shiftStartMs + Math.floor((shiftEndMs - shiftStartMs) / 2);
  return { shiftStartMs, shiftEndMs, midMs };
}

function resolveHalfDayPart({ explicitPart, firstIn, midMs }) {
  const p = normalizeHalfDayPart(explicitPart);
  if (p) return p;
  if (firstIn instanceof Date && Number.isFinite(firstIn.getTime()) && Number.isFinite(midMs)) {
    const thresholdMs = midMs - 15 * 60 * 1000;
    return firstIn.getTime() >= thresholdMs ? "second" : "first";
  }
  return "first";
}

function getShiftSegmentMs({ dateKey, shift, isHalfDay, halfDayPart, firstIn }) {
  const base = buildShiftStartEndMs(dateKey, shift);
  if (!base) return null;
  if (!isHalfDay) return { segStartMs: base.shiftStartMs, segEndMs: base.shiftEndMs, halfDayPart: "" };
  const part = resolveHalfDayPart({ explicitPart: halfDayPart, firstIn, midMs: base.midMs });
  return part === "second"
    ? { segStartMs: base.midMs, segEndMs: base.shiftEndMs, halfDayPart: part }
    : { segStartMs: base.shiftStartMs, segEndMs: base.midMs, halfDayPart: part };
}

export default function Page() {
  const [userEmail, setUserEmail] = useState("");
  const [profile, setProfile] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [shiftAssignments, setShiftAssignments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nowTs, setNowTs] = useState(0);
  const [attendanceRange, setAttendanceRange] = useState("this_month");

  const localDateKey = useCallback((d) => {
    const x = d instanceof Date ? d : new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const day = String(x.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const isWeekendKey = useCallback((key) => {
    const d = new Date(`${String(key).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return false;
    const day = d.getDay();
    return day === 0 || day === 6;
  }, []);

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

  const loadAll = useCallback(async () => {
    setError("");
    setLoading(true);
    const u = await getUserCached();
    const uid = u?.id || null;
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = new Date(today);
    from.setDate(from.getDate() - 120);
    const fromKey = localDateKey(from);
    const toKey = localDateKey(today);

    const { data: dataSessions, error: err } = await supabase
      .from("work_sessions")
      .select("*")
      .eq("user_id", uid)
      .or(`work_date.gte.${fromKey},logout_at.is.null`)
      .lte("work_date", toKey)
      .order("login_at", { ascending: false });
    if (err) {
      setError(err.message || "Failed to load work sessions");
      setSessions([]);
      setTasks([]);
      setLoading(false);
      return;
    }
    setSessions(dataSessions || []);

    const { data: asg } = await supabase
      .from("shift_assignments")
      .select("work_date, shift_id")
      .eq("user_id", uid)
      .gte("work_date", fromKey)
      .lte("work_date", toKey);
    const asgRows = asg || [];
    setShiftAssignments(asgRows);
    const shiftIds = Array.from(new Set(asgRows.map((a) => a.shift_id).filter(Boolean)));
    if (shiftIds.length) {
      const { data: sh } = await supabase.from("shifts").select("*").in("id", shiftIds);
      setShifts(sh || []);
    } else {
      setShifts([]);
    }

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
  }, [bounds.from, bounds.to, localDateKey]);

  const exportAttendanceExcel = useCallback(async () => {
    const XLSX = await import("xlsx");

    const safeSheetName = (name) =>
      String(name || "Sheet")
        .replace(/[\[\]\*\/\\\?\:]/g, " ")
        .slice(0, 31)
        .trim() || "Sheet";

    const calcLateEarly = (dayRow) => {
      const sh = shiftByDate.get(dayRow.date) || null;
      if (!sh) return { lateInMin: null, earlyOutMin: null, halfDayPart: "" };
      const seg = getShiftSegmentMs({
        dateKey: String(dayRow.date || "").slice(0, 10),
        shift: sh,
        isHalfDay: Boolean(dayRow?.halfDay),
        halfDayPart: dayRow?.halfDayPart,
        firstIn: dayRow?.firstIn,
      });
      if (!seg) return { lateInMin: null, earlyOutMin: null, halfDayPart: "" };
      const reqMin = dayRow?.halfDay ? 4 * 60 : 8 * 60;
      const lateInMinRaw = dayRow.firstIn ? Math.max(0, Math.floor((dayRow.firstIn.getTime() - seg.segStartMs) / 60000)) : null;
      const earlyOutMinRaw =
        dayRow.lastOut && Number(dayRow.minutes || 0) > 0 && Number(dayRow.minutes || 0) < reqMin
          ? Math.max(0, Math.floor((seg.segEndMs - dayRow.lastOut.getTime()) / 60000))
          : null;
      const lateInMin = dayRow?.ignoreLate ? 0 : lateInMinRaw;
      const earlyOutMin = dayRow?.ignoreEarly ? 0 : earlyOutMinRaw;
      return { lateInMin, earlyOutMin, halfDayPart: seg.halfDayPart || "" };
    };

    const byMonth = new Map();
    const now = new Date(nowTs || Date.now());
    now.setHours(0, 0, 0, 0);
    const from = new Date(now);
    from.setDate(from.getDate() - 120);
    let fromKey = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
    if (joinKey && joinKey > fromKey) fromKey = joinKey;

    const byDay = new Map((workByDay || []).map((r) => [String(r?.date || ""), r]));
    const toDate = new Date(`${todayKey}T00:00:00`);
    const fromDate = new Date(`${fromKey}T00:00:00`);
    for (let d = new Date(toDate); d >= fromDate; d.setDate(d.getDate() - 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (isWeekendKey(key)) continue;
      const row = byDay.get(key) || { date: key, minutes: 0, firstIn: null, lastOut: null, halfDay: false, halfDayPart: "", ignoreLate: false, ignoreEarly: false };
      const monthKey = key.slice(0, 7);
      if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
      byMonth.get(monthKey).push(row);
    }

    const header = ["Date", "Day", "First Login", "Last Logout", "Hours", "Overtime", "Late In", "Early Out", "Status", "Half Day", "Half Day Part"];
    const monthKeys = Array.from(byMonth.keys()).sort((a, b) => (a > b ? -1 : 1));

    const wb = XLSX.utils.book_new();

    monthKeys.forEach((monthKey) => {
      const rows = byMonth.get(monthKey) || [];
      const sheetName = safeSheetName(monthKey);
      const isCurrentMonth = String(monthKey) === String(todayKey).slice(0, 7);

      let workedMinutes = 0;
      let actualWorkingMinutes = 0;
      let workingDays = 0;
      let absentDays = 0;
      let overtimeMinutes = 0;
      let gapMinutes = 0;

      rows.forEach((d) => {
        const key = String(d?.date || "");
        const isToday = key === todayKey;
        const isAbsent = !d?.firstIn && !d?.lastOut;
        const requiredMinutes = d?.halfDay ? 4 * 60 : 8 * 60;

        workedMinutes += Number(d?.minutes || 0);
        const ot = Number(d?.minutes || 0) - requiredMinutes;
        if (ot > 0) overtimeMinutes += ot;

        const countForDays = !isCurrentMonth || !isToday;
        if (countForDays) {
          workingDays += 1;
          if (isAbsent) absentDays += 1;
        }

        if (!isAbsent) actualWorkingMinutes += requiredMinutes;

        const countForGap = !isCurrentMonth || key < todayKey;
        if (countForGap) {
          const { lateInMin, earlyOutMin } = calcLateEarly(d);
          if (Number.isFinite(lateInMin) && lateInMin > 30) gapMinutes += lateInMin;
          if (Number.isFinite(earlyOutMin) && earlyOutMin > 30) gapMinutes += earlyOutMin;
        }
      });

      const presentDays = Math.max(0, workingDays - absentDays);
      const gapAfter3x = gapMinutes * 3;
      const yourTotalMinutes = actualWorkingMinutes + gapAfter3x;
      const remainingMinutes = Math.max(0, yourTotalMinutes - workedMinutes);

      const summaryAoa = [
        ["Summary"],
        ["Worked", formatMinutesAsHHMM(workedMinutes)],
        ["Your Total Hours", formatMinutesAsHHMM(yourTotalMinutes)],
        ["You have to work more", formatMinutesAsHHMM(remainingMinutes)],
        ["Actual Working Hours", formatMinutesAsHHMM(actualWorkingMinutes)],
        ["Working Days", workingDays],
        ["Absent Days", absentDays],
        ["Present Days", presentDays],
        ["Overtime", formatMinutesAsHHMM(overtimeMinutes)],
        ["Gap", formatMinutesAsHHMM(gapMinutes)],
        ["Gap (After 3x)", formatMinutesAsHHMM(gapAfter3x)],
        [""],
      ];
      const aoa = [
        ...summaryAoa,
        header,
        ...rows.map((d) => {
          const { lateInMin, earlyOutMin, halfDayPart } = calcLateEarly(d);
          const isAbsent = !d.firstIn && !d.lastOut;
          const requiredMinutes = d?.halfDay ? 4 * 60 : 8 * 60;
          const overtimeMin = Math.max(0, Number(d.minutes || 0) - requiredMinutes);
          const statusParts = [];
          if (Number.isFinite(lateInMin) && lateInMin > 30) statusParts.push("Late");
          if (Number(d.minutes || 0) > 0 && Number(d.minutes || 0) < requiredMinutes && d.lastOut) statusParts.push("Early Left");
          if (d?.halfDay) {
            statusParts.push("Half Day");
            if (halfDayPart === "second") statusParts.push("Second Half");
            if (halfDayPart === "first") statusParts.push("First Half");
          }
          const isToday = String(d.date) === todayKey;
          const status = isAbsent ? (isToday ? "Pending" : "Absent") : statusParts.length ? statusParts.join(" & ") : "-";
          const dayName = (() => {
            const dt = new Date(`${String(d.date).slice(0, 10)}T00:00:00`);
            const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            const idx = dt.getDay();
            return names[idx] || "";
          })();
          return [
            formatDateCustom(d.date),
            dayName,
            d.firstIn ? formatLocalTime12(d.firstIn) : "",
            d.lastOut ? formatLocalTime12(d.lastOut) : "",
            formatMinutesAsHHMM(d.minutes),
            overtimeMin > 0 ? formatMinutesAsHHMM(overtimeMin) : "-",
            Number.isFinite(lateInMin) && lateInMin > 0 ? formatMinutesAsHHMM(lateInMin) : "",
            Number.isFinite(earlyOutMin) && earlyOutMin > 0 ? formatMinutesAsHHMM(earlyOutMin) : "",
            status,
            d?.halfDay ? "Yes" : "No",
            d?.halfDay ? (halfDayPart || "") : "",
          ];
        }),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    const baseName = (profile?.display_name || userEmail || "attendance").replace(/[<>:"/\\|?*\x00-\x1F]/g, " ").trim() || "attendance";
    const fileName = `${baseName}_attendance.xlsx`;
    XLSX.writeFile(wb, fileName, { bookType: "xlsx" });
  }, [isWeekendKey, joinKey, nowTs, profile?.display_name, shiftByDate, todayKey, userEmail, workByDay]);

  const todayKey = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const joinKey = useMemo(() => {
    const jd = profile?.joining_date || null;
    if (!jd) return null;
    return String(jd).slice(0, 10);
  }, [profile?.joining_date]);

  const workByDay = useMemo(() => {
    const map = {};
    (sessions || []).forEach((s) => {
      const d = s.work_date || (s.login_at ? String(s.login_at).slice(0, 10) : "");
      if (!d) return;
      if (!map[d]) map[d] = { date: d, minutes: 0, firstIn: null, lastOut: null, halfDay: false, halfDayPart: "", ignoreLate: false, ignoreEarly: false };

      let mins = Number(s.duration_minutes || 0);
      const li = s.login_at ? new Date(s.login_at) : null;
      const lo = s.logout_at ? new Date(s.logout_at) : null;

      if (!s.logout_at && li) {
        mins = Math.max(0, Math.floor((nowTs - li.getTime()) / 60000));
      }

      map[d].minutes += mins;
      if (li && (!map[d].firstIn || li < map[d].firstIn)) map[d].firstIn = li;
      if (lo && (!map[d].lastOut || lo > map[d].lastOut)) map[d].lastOut = lo;
      if (s?.half_day) map[d].halfDay = true;
      const part = normalizeHalfDayPart(s?.half_day_part);
      if (part && !map[d].halfDayPart) map[d].halfDayPart = part;
      if (s?.ignore_late) map[d].ignoreLate = true;
      if (s?.ignore_early) map[d].ignoreEarly = true;
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [sessions, nowTs]);

  const displayWorkByDay = useMemo(() => {
    const today = new Date(nowTs || Date.now());
    today.setHours(0, 0, 0, 0);
    let startDate = new Date(today);
    let endDate = new Date(today);

    if (attendanceRange === "this_month") {
      startDate = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
    } else if (attendanceRange === "last_month") {
      const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
      endDate = new Date(firstThisMonth);
      endDate.setDate(0);
      startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1, 0, 0, 0, 0);
    } else {
      const days = Math.max(1, Number(attendanceRange || 14) || 14);
      startDate.setDate(startDate.getDate() - Math.max(0, days - 1));
    }

    if (joinKey) {
      const jd = new Date(`${joinKey}T00:00:00`);
      if (!Number.isNaN(jd.getTime())) {
        if (jd > endDate) return [];
        if (jd > startDate) startDate = jd;
      }
    }

    const map = new Map(workByDay.map((r) => [r.date, r]));
    const out = [];
    for (let d = new Date(endDate); d >= startDate; d.setDate(d.getDate() - 1)) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const key = `${y}-${m}-${day}`;
      if (isWeekendKey(key)) continue;
      const row = map.get(key) || null;
      out.push(
        row || {
          date: key,
          minutes: 0,
          firstIn: null,
          lastOut: null,
          halfDay: false,
          halfDayPart: "",
        }
      );
    }
    return out;
  }, [attendanceRange, isWeekendKey, joinKey, nowTs, workByDay]);

  const shiftByDate = useMemo(() => {
    const shiftById = new Map((shifts || []).map((s) => [s.id, s]));
    const out = new Map();
    (shiftAssignments || []).forEach((a) => {
      const k = String(a.work_date || "");
      const sh = a.shift_id ? shiftById.get(a.shift_id) : null;
      if (k && sh) out.set(k, sh);
    });
    return out;
  }, [shiftAssignments, shifts]);

  const thisMonthTotalMinutes = useMemo(() => {
    const now = new Date(nowTs || Date.now());
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    let fromKey = `${y}-${m}-01`;
    if (joinKey && joinKey > fromKey) fromKey = joinKey;
    let sum = 0;
    (workByDay || []).forEach((r) => {
      const k = String(r?.date || "");
      if (!k || k < fromKey || k > todayKey) return;
      if (isWeekendKey(k)) return;
      sum += Number(r?.minutes || 0);
    });
    return sum;
  }, [isWeekendKey, joinKey, nowTs, todayKey, workByDay]);

  const thisMonthLateEarlyGapMinutes = useMemo(() => {
    const now = new Date(nowTs || Date.now());
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    let fromKey = `${y}-${m}-01`;
    if (joinKey && joinKey > fromKey) fromKey = joinKey;
    let sum = 0;

    (workByDay || []).forEach((d) => {
      const key = String(d?.date || "");
      if (!key || key < fromKey || key >= todayKey) return;
      if (isWeekendKey(key)) return;
      const sh = shiftByDate.get(key) || null;
      if (!sh) return;
      const seg = getShiftSegmentMs({
        dateKey: key,
        shift: sh,
        isHalfDay: Boolean(d?.halfDay),
        halfDayPart: d?.halfDayPart,
        firstIn: d?.firstIn,
      });
      if (!seg) return;

      const reqMin = d?.halfDay ? 4 * 60 : 8 * 60;

      if (!d?.ignoreLate && d?.firstIn instanceof Date && Number.isFinite(d.firstIn.getTime())) {
        const mins = Math.floor((d.firstIn.getTime() - seg.segStartMs) / 60000);
        if (mins > 30) sum += mins;
      }
      if (
        !d?.ignoreEarly &&
        d?.lastOut instanceof Date &&
        Number.isFinite(d.lastOut.getTime()) &&
        Number(d?.minutes || 0) > 0 &&
        Number(d?.minutes || 0) < reqMin
      ) {
        const mins = Math.floor((seg.segEndMs - d.lastOut.getTime()) / 60000);
        if (mins > 30) sum += mins;
      }
    });

    return sum;
  }, [isWeekendKey, joinKey, nowTs, shiftByDate, todayKey, workByDay]);

  const thisMonthExpected = useMemo(() => {
    const now = new Date(nowTs || Date.now());
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    let fromKey = `${y}-${m}-01`;
    if (joinKey && joinKey > fromKey) fromKey = joinKey;
    if (fromKey > todayKey) return { days: 0, minutes: 0 };

    const assignedDays = new Set();
    (shiftAssignments || []).forEach((a) => {
      const k = String(a?.work_date || "");
      if (!k || k < fromKey || k > todayKey) return;
      if (k >= todayKey) return;
      if (isWeekendKey(k)) return;
      assignedDays.add(k);
    });

    let days = assignedDays.size;
    if (days === 0) {
      const toDate = new Date(`${todayKey}T00:00:00`);
      toDate.setDate(toDate.getDate() - 1);
      const fromDate = new Date(`${fromKey}T00:00:00`);
      if (Number.isNaN(toDate.getTime()) || Number.isNaN(fromDate.getTime())) return { days: 0, minutes: 0 };
      for (let d = new Date(toDate); d >= fromDate; d.setDate(d.getDate() - 1)) {
        const day = d.getDay();
        if (day !== 0 && day !== 6) days += 1;
      }
    }

    return { days, minutes: days * 8 * 60 };
  }, [isWeekendKey, joinKey, nowTs, shiftAssignments, todayKey]);

  const thisMonthAbsentDays = useMemo(() => {
    const now = new Date(nowTs || Date.now());
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    let fromKey = `${y}-${m}-01`;
    if (joinKey && joinKey > fromKey) fromKey = joinKey;
    if (fromKey > todayKey) return 0;

    const byDay = new Map((workByDay || []).map((r) => [String(r?.date || ""), r]));
    const toDate = new Date(`${todayKey}T00:00:00`);
    const fromDate = new Date(`${fromKey}T00:00:00`);
    if (Number.isNaN(toDate.getTime()) || Number.isNaN(fromDate.getTime())) return 0;

    let absent = 0;
    for (let d = new Date(toDate); d >= fromDate; d.setDate(d.getDate() - 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (isWeekendKey(key)) continue;
      if (key >= todayKey) continue;
      const row = byDay.get(key) || null;
      const isAbsent = !row || (!row.firstIn && !row.lastOut);
      if (isAbsent) absent += 1;
    }
    return absent;
  }, [isWeekendKey, joinKey, nowTs, todayKey, workByDay]);

  const thisMonthPresentDays = useMemo(() => Math.max(0, thisMonthExpected.days - thisMonthAbsentDays), [thisMonthAbsentDays, thisMonthExpected.days]);

  const thisMonthActualWorkingMinutes = useMemo(() => {
    const now = new Date(nowTs || Date.now());
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    let fromKey = `${y}-${m}-01`;
    if (joinKey && joinKey > fromKey) fromKey = joinKey;
    if (fromKey > todayKey) return 0;

    const byDay = new Map((workByDay || []).map((r) => [String(r?.date || ""), r]));
    const toDate = new Date(`${todayKey}T00:00:00`);
    toDate.setDate(toDate.getDate() - 1);
    const fromDate = new Date(`${fromKey}T00:00:00`);
    if (Number.isNaN(toDate.getTime()) || Number.isNaN(fromDate.getTime())) return 0;

    let sum = 0;
    for (let d = new Date(toDate); d >= fromDate; d.setDate(d.getDate() - 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (isWeekendKey(key)) continue;
      const row = byDay.get(key) || null;
      const isAbsent = !row || (!row.firstIn && !row.lastOut);
      if (isAbsent) continue;
      sum += row?.halfDay ? 4 * 60 : 8 * 60;
    }
    if (!isWeekendKey(todayKey)) {
      const todayRow = byDay.get(todayKey) || null;
      const isPresentToday = todayRow && (todayRow.firstIn || todayRow.lastOut);
      if (isPresentToday) sum += todayRow?.halfDay ? 4 * 60 : 8 * 60;
    }
    return sum;
  }, [isWeekendKey, joinKey, nowTs, todayKey, workByDay]);

  const thisMonthOvertimeMinutes = useMemo(() => {
    const now = new Date(nowTs || Date.now());
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    let fromKey = `${y}-${m}-01`;
    if (joinKey && joinKey > fromKey) fromKey = joinKey;
    let sum = 0;
    (workByDay || []).forEach((r) => {
      const k = String(r?.date || "");
      if (!k || k < fromKey || k > todayKey) return;
      if (isWeekendKey(k)) return;
      const requiredMinutes = r?.halfDay ? 4 * 60 : 8 * 60;
      const overtime = Number(r?.minutes || 0) - requiredMinutes;
      if (overtime > 0) sum += overtime;
    });
    return sum;
  }, [isWeekendKey, joinKey, nowTs, todayKey, workByDay]);

  const thisMonthGapMinutes = useMemo(() => thisMonthLateEarlyGapMinutes, [thisMonthLateEarlyGapMinutes]);

  const thisMonthGapAfterPenaltyMinutes = useMemo(() => thisMonthLateEarlyGapMinutes * 3, [thisMonthLateEarlyGapMinutes]);

  const thisMonthTotalWorkingMinutes = useMemo(
    () => thisMonthActualWorkingMinutes + thisMonthGapAfterPenaltyMinutes,
    [thisMonthActualWorkingMinutes, thisMonthGapAfterPenaltyMinutes]
  );

  const thisMonthRemainingMinutes = useMemo(
    () => Math.max(0, thisMonthTotalWorkingMinutes - thisMonthTotalMinutes),
    [thisMonthTotalMinutes, thisMonthTotalWorkingMinutes]
  );

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
  }, [sessions, bounds.from, bounds.to, localDateKey, nowTs]);

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

      <div id="attendance" className="grid grid-cols-1 md:grid-cols-3 gap-4 scroll-mt-24">
        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Worked / Your Total Hours</div>
          <div className="mt-3 text-3xl font-bold">
            {formatMinutesAsHHMM(thisMonthTotalMinutes)} / {formatMinutesAsHHMM(thisMonthTotalWorkingMinutes)}
          </div>
          <div className="mt-2 text-xs text-black/60">You have to work more: {formatMinutesAsHHMM(thisMonthRemainingMinutes)}</div>
        </div>
        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm md:col-span-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="text-sm font-semibold text-heading">Daily Attendance</div>
            <div className="flex items-center gap-3">
              <button className="rounded-md border border-black/10 px-3 py-1 text-sm hover:bg-black/5" onClick={exportAttendanceExcel}>
                Export Excel
              </button>
              <select className="rounded-md border border-black/10 px-2 py-1 text-sm" value={attendanceRange} onChange={(e) => setAttendanceRange(e.target.value)}>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="60">Last 60 days</option>
                <option value="90">Last 90 days</option>
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
              </select>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
            <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
              <div className="text-[11px] text-black/60">Actual Working Hours</div>
              <div className="mt-1 text-sm font-semibold text-heading">{formatMinutesAsHHMM(thisMonthActualWorkingMinutes)}</div>
            </div>
            <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
              <div className="text-[11px] text-black/60">Working Days</div>
              <div className="mt-1 text-sm font-semibold text-heading">{thisMonthExpected.days}</div>
            </div>
            <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
              <div className="text-[11px] text-black/60">Absent Days</div>
              <div className="mt-1 text-sm font-semibold text-heading">{thisMonthAbsentDays}</div>
            </div>
            <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
              <div className="text-[11px] text-black/60">Present Days</div>
              <div className="mt-1 text-sm font-semibold text-heading">{thisMonthPresentDays}</div>
            </div>
            <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
              <div className="text-[11px] text-black/60">Overtime</div>
              <div className="mt-1 text-sm font-semibold text-heading">{formatMinutesAsHHMM(thisMonthOvertimeMinutes)}</div>
            </div>
            <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
              <div className="text-[11px] text-black/60">Gap</div>
              <div className="mt-1 text-sm font-semibold text-heading">{formatMinutesAsHHMM(thisMonthGapMinutes)}</div>
            </div>
            <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
              <div className="text-[11px] text-black/60">Gap (After 3x)</div>
              <div className="mt-1 text-sm font-semibold text-heading">{formatMinutesAsHHMM(thisMonthGapAfterPenaltyMinutes)}</div>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-black/70">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Day</th>
                  <th className="px-3 py-2 text-left">First Login</th>
                  <th className="px-3 py-2 text-left">Last Logout</th>
                  <th className="px-3 py-2 text-right">Hours</th>
                  <th className="px-3 py-2 text-right">Overtime</th>
                  <th className="px-3 py-2 text-right">Late In</th>
                  <th className="px-3 py-2 text-right">Early Out</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {displayWorkByDay.map((d) => (
                  (() => {
                    const sh = shiftByDate.get(d.date) || null;
                    let lateInMin = null;
                    let earlyOutMin = null;
                    const requiredMinutes = d?.halfDay ? 4 * 60 : 8 * 60;
                    if (sh) {
                      const seg = getShiftSegmentMs({
                        dateKey: String(d.date || "").slice(0, 10),
                        shift: sh,
                        isHalfDay: Boolean(d?.halfDay),
                        halfDayPart: d?.halfDayPart,
                        firstIn: d?.firstIn,
                      });
                      if (seg) {
                        if (d.firstIn) lateInMin = Math.max(0, Math.floor((d.firstIn.getTime() - seg.segStartMs) / 60000));
                        if (d.lastOut && Number(d.minutes || 0) > 0 && Number(d.minutes || 0) < requiredMinutes) {
                          earlyOutMin = Math.max(0, Math.floor((seg.segEndMs - d.lastOut.getTime()) / 60000));
                        }
                      }
                    }
                      if (d?.ignoreLate) lateInMin = 0;
                      if (d?.ignoreEarly) earlyOutMin = 0;
                    const formatDelta = (mins) => (Number.isFinite(mins) && mins > 0 ? formatMinutesAsHHMM(mins) : "-");
                    const overtimeMin = Math.max(0, Number(d.minutes || 0) - requiredMinutes);
                    const isAbsent = !d.firstIn && !d.lastOut;
                    const statusParts = [];
                    if (Number.isFinite(lateInMin) && lateInMin > 30) statusParts.push("Late");
                    if (Number(d.minutes || 0) > 0 && Number(d.minutes || 0) < requiredMinutes && d.lastOut) statusParts.push("Early Left");
                    if (d?.halfDay) {
                      statusParts.push("Half Day");
                      const p = normalizeHalfDayPart(d?.halfDayPart);
                      if (p === "second") statusParts.push("Second Half");
                      if (p === "first") statusParts.push("First Half");
                    }
                    const isToday = String(d.date) === todayKey;
                    const status = isAbsent ? (isToday ? "Pending" : "Absent") : statusParts.length ? statusParts.join(" & ") : "-";
                    const dayName = (() => {
                      const dt = new Date(`${String(d.date).slice(0, 10)}T00:00:00`);
                      const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                      const idx = dt.getDay();
                      return names[idx] || "-";
                    })();
                    return (
                      <tr key={d.date} className="border-t">
                        <td className="px-3 py-2">{formatDateCustom(d.date)}</td>
                        <td className="px-3 py-2">{dayName}</td>
                        <td className="px-3 py-2">{d.firstIn ? formatLocalTime12(d.firstIn) : "-"}</td>
                        <td className="px-3 py-2">{d.lastOut ? formatLocalTime12(d.lastOut) : "-"}</td>
                        <td className="px-3 py-2 text-right">{formatMinutesAsHHMM(d.minutes)}</td>
                        <td className="px-3 py-2 text-right">{overtimeMin > 0 ? formatMinutesAsHHMM(overtimeMin) : "-"}</td>
                        <td className="px-3 py-2 text-right">{formatDelta(lateInMin)}</td>
                        <td className="px-3 py-2 text-right">{formatDelta(earlyOutMin)}</td>
                        <td className="px-3 py-2">{status}</td>
                      </tr>
                    );
                  })()
                ))}
                {displayWorkByDay.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-black/60" colSpan={9}>
                      No work sessions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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

      {loading && <div className="text-sm text-black/60">Loading...</div>}
    </div>
  );
}
