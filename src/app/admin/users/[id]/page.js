"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import Link from "next/link";
import { formatMinutesAsHHMM, formatLocalDateTime12, formatLocalTime12, formatDateCustom } from "@/lib/timeFormat";

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

export default function UserDetailPage() {
  const { id } = useParams();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [workSessions, setWorkSessions] = useState([]);
  const [shiftAssignments, setShiftAssignments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", description: "", due_at: "", status: "open" });
  const [assignFiles, setAssignFiles] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [completeNotes, setCompleteNotes] = useState({});
  const [taskDocs, setTaskDocs] = useState({});
  const [attachFiles, setAttachFiles] = useState({});
  const [nowTs, setNowTs] = useState(0);
  const [attendanceRange, setAttendanceRange] = useState("this_month");
  const [manualOverridesByDay, setManualOverridesByDay] = useState({});
  const [showAddSession, setShowAddSession] = useState(false);
  const [addSessionForm, setAddSessionForm] = useState({
    work_date: "",
    login_at: "",
    logout_at: "",
    half_day: false,
    half_day_part: "first",
    ignore_late: false,
    ignore_early: false,
  });
  const [addingSession, setAddingSession] = useState(false);
  const [monthlySalaryInput, setMonthlySalaryInput] = useState("45000");

  const toIsoInputValue = useCallback((d) => {
    if (!d) return "";
    const x = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(x.getTime())) return "";
    const off = x.getTimezoneOffset();
    return new Date(x.getTime() - off * 60000).toISOString().slice(0, 16);
  }, []);

  const isWeekendKey = useCallback((key) => {
    const d = new Date(`${String(key).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return false;
    const day = d.getDay();
    return day === 0 || day === 6;
  }, []);

  const loadAll = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const res = await fetch("/api/admin-users");
      const j = await res.json().catch(() => ({}));
      const found = Array.isArray(j.users) ? j.users.find((u) => u.id === id) : null;
      setUser(found || null);
    } catch (e) {
      setUser(null);
      setError(e?.message || "Failed to load users");
    }
    const { data: prof } = await supabase.from("profiles").select("*").eq("user_id", id).maybeSingle();
    setProfile(prof || null);
    const { data: ts } = await supabase.from("tasks").select("*").eq("assignee_id", id).order("created_at", { ascending: false });
    setTasks(ts || []);
    const taskIds = (ts || []).map((t) => t.id);
    const { data: ups } = taskIds.length
      ? await supabase.from("task_updates").select("*").in("task_id", taskIds).order("created_at", { ascending: false })
      : { data: [] };
    setUpdates(ups || []);
    if (taskIds.length) {
      const { data: docsRes } = await supabase.from("task_documents").select("*").in("task_id", taskIds).order("created_at", { ascending: false });
      const grouped = (docsRes || []).reduce((acc, d) => { (acc[d.task_id] ||= []).push(d); return acc; }, {});
      setTaskDocs(grouped);
    } else {
      setTaskDocs({});
    }
    const toIsoDate = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = new Date(today);
    from.setDate(from.getDate() - 120);
    const fromKey = toIsoDate(from);
    const toKey = toIsoDate(today);

    const { data: ws } = await supabase
      .from("work_sessions")
      .select("*")
      .eq("user_id", id)
      .or(`work_date.gte.${fromKey},logout_at.is.null`)
      .lte("work_date", toKey)
      .order("login_at", { ascending: false });
    setWorkSessions(ws || []);

    const { data: asg } = await supabase
      .from("shift_assignments")
      .select("work_date, shift_id")
      .eq("user_id", id)
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
  }, [id]);

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
    (workSessions || []).forEach((s) => {
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
    Object.keys(manualOverridesByDay || {}).forEach((k) => {
      const key = String(k || "").slice(0, 10);
      if (!key) return;
      if (!map[key]) map[key] = { date: key, minutes: 0, firstIn: null, lastOut: null, halfDay: false, halfDayPart: "", ignoreLate: false, ignoreEarly: false };
      const o = manualOverridesByDay?.[key] || {};
      if (typeof o?.ignoreLate === "boolean") map[key].ignoreLate = o.ignoreLate;
      if (typeof o?.ignoreEarly === "boolean") map[key].ignoreEarly = o.ignoreEarly;
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [manualOverridesByDay, workSessions, nowTs]);

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
          ignoreLate: false,
          ignoreEarly: false,
        }
      );
    }
    return out;
  }, [workByDay, attendanceRange, joinKey, nowTs, isWeekendKey]);

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

  const salarySummary = useMemo(() => {
    const monthlySalary = Math.max(0, Number(monthlySalaryInput || 0) || 0);
    const pad2 = (n) => String(n).padStart(2, "0");
    const toKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const fromKeyToDate = (key) => new Date(`${String(key).slice(0, 10)}T00:00:00`);
    const keyMax = (a, b) => (String(a || "") > String(b || "") ? String(a) : String(b));
    const keyMin = (a, b) => (String(a || "") < String(b || "") ? String(a) : String(b));

    const now = new Date(nowTs || Date.now());
    let monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    if (attendanceRange === "last_month") monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 0, 0, 0, 0);

    const monthStartKey = toKey(monthStart);
    const monthEndKey = toKey(monthEnd);
    const scopeStartKey = joinKey ? keyMax(joinKey, monthStartKey) : monthStartKey;

    const isCurrentMonth = monthStartKey.slice(0, 7) === todayKey.slice(0, 7);
    const yesterday = new Date(`${todayKey}T00:00:00`);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = toKey(yesterday);
    const cutoffKey = isCurrentMonth ? keyMin(yesterdayKey, monthEndKey) : monthEndKey;

    const byDay = new Map((workByDay || []).map((r) => [String(r?.date || ""), r]));

    let workingDaysFullMonth = 0;
    for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
      const k = toKey(d);
      if (isWeekendKey(k)) continue;
      workingDaysFullMonth += 1;
    }

    let workingDaysScope = 0;
    let absentDays = 0;
    let requiredMinutes = 0;
    let workedMinutes = 0;
    let penaltyMinutes = 0;

    const fromDate = fromKeyToDate(scopeStartKey);
    const toDate = fromKeyToDate(cutoffKey);
    if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime()) && cutoffKey >= scopeStartKey) {
      for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
        const k = toKey(d);
        if (isWeekendKey(k)) continue;
        workingDaysScope += 1;

        const row = byDay.get(k) || null;
        const isAbsent = !row || (!row.firstIn && !row.lastOut);
        if (isAbsent) {
          absentDays += 1;
          continue;
        }

        const baseReq = row?.halfDay ? 4 * 60 : 8 * 60;
        requiredMinutes += baseReq;
        workedMinutes += Number(row?.minutes || 0);

        const sh = shiftByDate.get(k) || null;
        if (!sh) continue;
        const seg = getShiftSegmentMs({
          dateKey: k,
          shift: sh,
          isHalfDay: Boolean(row?.halfDay),
          halfDayPart: row?.halfDayPart,
          firstIn: row?.firstIn,
        });
        if (!seg) continue;

        if (row?.firstIn instanceof Date && Number.isFinite(row.firstIn.getTime())) {
          const mins = Math.floor((row.firstIn.getTime() - seg.segStartMs) / 60000);
          if (mins > 30) penaltyMinutes += mins;
        }
        const reqMin = row?.halfDay ? 4 * 60 : 8 * 60;
        if (Number(row?.minutes || 0) > 0 && Number(row?.minutes || 0) < reqMin && row?.lastOut instanceof Date && Number.isFinite(row.lastOut.getTime())) {
          const mins = Math.floor((seg.segEndMs - row.lastOut.getTime()) / 60000);
          if (mins > 30) penaltyMinutes += mins;
        }
      }
    }

    const payableDays = Math.max(0, workingDaysScope - absentDays);
    const dayRate = workingDaysFullMonth > 0 ? monthlySalary / workingDaysFullMonth : 0;
    const baseMinuteRate = workingDaysFullMonth > 0 ? monthlySalary / (workingDaysFullMonth * 8 * 60) : 0;
    const perHourRate = baseMinuteRate * 60;
    const basePayAfterAbsent = payableDays * dayRate;
    const penaltyAfter3x = penaltyMinutes * 3;
    const totalRequired = requiredMinutes + penaltyAfter3x;
    const shortfall = Math.max(0, totalRequired - workedMinutes);
    const lateEarlyDeduction = shortfall * baseMinuteRate;
    const salaryAfterLates = Math.max(0, basePayAfterAbsent - lateEarlyDeduction);
    const extraAfterTarget = Math.max(0, workedMinutes - totalRequired);
    const overtimePay = extraAfterTarget * baseMinuteRate;
    const finalSalary = salaryAfterLates + overtimePay;

    const monthLabel = `${monthStart.getFullYear()}-${pad2(monthStart.getMonth() + 1)}`;
    return {
      monthLabel,
      monthlySalary,
      workingDaysFullMonth,
      workingDaysScope,
      absentDays,
      payableDays,
      perHourRate,
      requiredMinutes,
      workedMinutes,
      penaltyMinutes,
      penaltyAfter3x,
      totalRequired,
      shortfall,
      basePayAfterAbsent,
      lateEarlyDeduction,
      overtimePay,
      finalSalary,
    };
  }, [attendanceRange, isWeekendKey, joinKey, monthlySalaryInput, nowTs, shiftByDate, todayKey, workByDay]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const byStatus = tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});
    const updatesCount = updates.length;
    const lastUpdate = updates[0]?.created_at || null;
    return { total, byStatus, updatesCount, lastUpdate };
  }, [tasks, updates]);

  useEffect(() => {
    const init = async () => {
      const u = await getUserCached();
      setCurrentUserId(u?.id || null);
      await loadAll();
    };
    init();
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [loadAll]);

  const openManualSessionModal = useCallback(
    (row) => {
      const dateKey = row?.date || "";
      const defaultLogin = dateKey ? `${dateKey}T09:00` : "";
      const defaultLogout = dateKey ? `${dateKey}T18:00` : "";
      const isHalfDay = Boolean(row?.halfDay);
      let halfDayPart = normalizeHalfDayPart(row?.halfDayPart);
      if (!halfDayPart && isHalfDay) {
        const sh = shiftByDate.get(dateKey) || null;
        const base = buildShiftStartEndMs(dateKey, sh);
        halfDayPart = resolveHalfDayPart({ explicitPart: "", firstIn: row?.firstIn, midMs: base?.midMs });
      }
      setAddSessionForm({
        work_date: dateKey,
        login_at: row?.firstIn ? toIsoInputValue(row.firstIn) : defaultLogin,
        logout_at: row?.lastOut ? toIsoInputValue(row.lastOut) : defaultLogout,
        half_day: isHalfDay,
        half_day_part: halfDayPart || "first",
        ignore_late: Boolean(row?.ignoreLate),
        ignore_early: Boolean(row?.ignoreEarly),
      });
      setShowAddSession(true);
      setError("");
    },
    [shiftByDate, toIsoInputValue]
  );

  const saveManualSession = useCallback(async () => {
    if (!id) return;
    const workDate = String(addSessionForm.work_date || "").slice(0, 10);
    const loginVal = String(addSessionForm.login_at || "").trim();
    const logoutVal = String(addSessionForm.logout_at || "").trim();
    if (!workDate || !loginVal) {
      setError("Please enter First Login.");
      return;
    }
    const li = new Date(loginVal);
    const lo = logoutVal ? new Date(logoutVal) : null;
    if (Number.isNaN(li.getTime()) || (lo && Number.isNaN(lo.getTime()))) {
      setError("Invalid date/time.");
      return;
    }
    setAddingSession(true);
    setError("");
    try {
      const res = await fetch("/api/admin-work-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: id,
          work_date: workDate,
          login_at: li.toISOString(),
          logout_at: lo ? lo.toISOString() : null,
          half_day: Boolean(addSessionForm.half_day),
          half_day_part: addSessionForm.half_day ? String(addSessionForm.half_day_part || "") : null,
          ignore_late: Boolean(addSessionForm.ignore_late),
          ignore_early: Boolean(addSessionForm.ignore_early),
          mode: "replace_day",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to save manual attendance");
      setManualOverridesByDay((prev) => {
        const next = { ...(prev || {}) };
        const v = { ignoreLate: Boolean(addSessionForm.ignore_late), ignoreEarly: Boolean(addSessionForm.ignore_early) };
        if (!v.ignoreLate && !v.ignoreEarly) {
          delete next[workDate];
          return next;
        }
        next[workDate] = v;
        return next;
      });
      setShowAddSession(false);
      setAddSessionForm({ work_date: "", login_at: "", logout_at: "", half_day: false, half_day_part: "first", ignore_late: false, ignore_early: false });
      await loadAll();
    } catch (e) {
      setError(e?.message || "Failed to save manual attendance");
    } finally {
      setAddingSession(false);
    }
  }, [addSessionForm.half_day, addSessionForm.half_day_part, addSessionForm.ignore_early, addSessionForm.ignore_late, addSessionForm.login_at, addSessionForm.logout_at, addSessionForm.work_date, id, loadAll]);

  const clearManualDay = useCallback(async () => {
    if (!id) return;
    const workDate = String(addSessionForm.work_date || "").slice(0, 10);
    if (!workDate) return;
    setAddingSession(true);
    setError("");
    try {
      const res = await fetch("/api/admin-work-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: id,
          work_date: workDate,
          mode: "delete_day",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to clear day attendance");
      setManualOverridesByDay((prev) => {
        const next = { ...(prev || {}) };
        delete next[workDate];
        return next;
      });
      setShowAddSession(false);
      setAddSessionForm({ work_date: "", login_at: "", logout_at: "", half_day: false, half_day_part: "first", ignore_late: false, ignore_early: false });
      await loadAll();
    } catch (e) {
      setError(e?.message || "Failed to clear day attendance");
    } finally {
      setAddingSession(false);
    }
  }, [addSessionForm.work_date, id, loadAll]);

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

    const baseName = (profile?.display_name || user?.email || "attendance").replace(/[<>:"/\\|?*\x00-\x1F]/g, " ").trim() || "attendance";
    const fileName = `${baseName}_attendance.xlsx`;
    XLSX.writeFile(wb, fileName, { bookType: "xlsx" });
  }, [isWeekendKey, joinKey, nowTs, profile?.display_name, shiftByDate, todayKey, user?.email, workByDay]);

  const createTask = async () => {
    if (!currentUserId || !id || !createForm.title.trim()) return;
    setError("");
    setCreating(true);
    const payload = {
      org_id: profile?.org_id || null,
      title: createForm.title.trim(),
      description: createForm.description?.trim() || null,
      due_at: createForm.due_at || null,
      status: createForm.status || "open",
      assignee_id: id,
      created_by: currentUserId,
    };
    const { data, error: err } = await supabase.from("tasks").insert(payload).select("*").single();
    if (err) {
      setError(err.message || "Failed to create task");
      setCreating(false);
      return;
    }
    if (assignFiles.length > 0) {
      const bucket = "project-docs";
      for (const file of assignFiles) {
        const path = `tasks/${data.id}/${Date.now()}_${file.name}`;
        const up = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
        if (up.error) {
          setError(up.error.message || "Failed to upload file");
          continue;
        }
        const pub = supabase.storage.from(bucket).getPublicUrl(path);
        const url = pub?.data?.publicUrl || null;
        if (url) {
          await supabase.from("task_documents").insert({
            task_id: data.id,
            uploaded_by: currentUserId || null,
            filename: file.name,
            url,
          });
        }
      }
    }
    setCreateForm({ title: "", description: "", due_at: "", status: "open" });
    setAssignFiles([]);
    setCreating(false);
    await loadAll();
  };

  const completeTask = async (taskId) => {
    setError("");
    const { error: err } = await supabase.from("tasks").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", taskId);
    if (err) {
      setError(err.message || "Failed to mark completed");
      return;
    }
    const note = completeNotes[taskId] || "";
    if (currentUserId) {
      await supabase.from("task_updates").insert({ task_id: taskId, author_id: currentUserId, state: "completed", note: note || null });
    }
    setCompleteNotes((prev) => ({ ...prev, [taskId]: "" }));
    await loadAll();
  };

  const addNote = async (taskId) => {
    setError("");
    const note = (completeNotes[taskId] || "").trim();
    if (!note || !currentUserId) return;
    const { error: err } = await supabase.from("task_updates").insert({ task_id: taskId, author_id: currentUserId, state: "not_completed", note });
    if (err) {
      setError(err.message || "Failed to add note");
      return;
    }
    setCompleteNotes((prev) => ({ ...prev, [taskId]: "" }));
    await loadAll();
  };

  const uploadTaskFiles = async (taskId) => {
    const files = attachFiles[taskId] || [];
    if (!files.length) return;
    setError("");
    const bucket = "project-docs";
    for (const file of files) {
      const path = `tasks/${taskId}/${Date.now()}_${file.name}`;
      const up = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
      if (up.error) {
        setError(up.error.message || "Failed to upload file");
        continue;
      }
      const pub = supabase.storage.from(bucket).getPublicUrl(path);
      const url = pub?.data?.publicUrl || null;
      if (url) {
        const { data: ins, error: insErr } = await supabase
          .from("task_documents")
          .insert({ task_id: taskId, uploaded_by: currentUserId || null, filename: file.name, url })
          .select("*")
          .single();
        if (!insErr && ins) {
          setTaskDocs((prev) => ({ ...prev, [taskId]: [ins, ...(prev[taskId] || [])] }));
        }
      }
    }
    setAttachFiles((prev) => ({ ...prev, [taskId]: [] }));
  };

  const deleteDoc = async (doc) => {
    setError("");
    const bucket = "project-docs";
    const prefix = `/storage/v1/object/public/${bucket}/`;
    const idx = (doc.url || "").indexOf(prefix);
    const path = idx >= 0 ? (doc.url || "").substring(idx + prefix.length) : "";
    if (path) {
      await supabase.storage.from(bucket).remove([path]);
    }
    const { error: delErr } = await supabase.from("task_documents").delete().eq("id", doc.id);
    if (delErr) {
      setError(delErr.message || "Failed to delete document");
      return;
    }
    setTaskDocs((prev) => ({ ...prev, [doc.task_id]: (prev[doc.task_id] || []).filter((d) => d.id !== doc.id) }));
  };

  const renameDoc = async (doc) => {
    const newName = typeof window !== "undefined" ? window.prompt("New filename", doc.filename) : null;
    if (!newName || newName.trim() === "" || newName === doc.filename) return;
    setError("");
    const { data, error: err } = await supabase.from("task_documents").update({ filename: newName.trim() }).eq("id", doc.id).select("*").single();
    if (err) {
      setError(err.message || "Failed to rename document");
      return;
    }
    setTaskDocs((prev) => ({
      ...prev,
      [doc.task_id]: (prev[doc.task_id] || []).map((d) => (d.id === doc.id ? data : d)),
    }));
  };

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-heading text-2xl font-bold">{profile?.display_name || user?.email || "User"}</div>
            <div className="text-xs text-black/60">{user?.email} • {profile?.role}{profile?.position ? ` • ${profile.position}` : ""}</div>
          </div>
          <Link href="/admin/users" className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5">Back</Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Assigned Tasks</div>
            <div className="mt-3 text-3xl font-bold">{stats.total}</div>
            <div className="mt-2 text-xs text-black/60">Open: {stats.byStatus.open || 0} • In Progress: {stats.byStatus.in_progress || 0} • Completed: {stats.byStatus.completed || 0} • Cancelled: {stats.byStatus.cancelled || 0}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Updates</div>
            <div className="mt-3 text-3xl font-bold">{stats.updatesCount}</div>
            <div className="mt-2 text-xs text-black/60">{stats.lastUpdate ? `Last: ${formatLocalDateTime12(stats.lastUpdate)}` : "No updates yet"}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Profile</div>
            <div className="mt-2 text-sm">Name: {profile?.display_name || "-"}</div>
            <div className="text-sm">Email: {user?.email || "-"}</div>
            <div className="text-sm">Role: {profile?.role || "-"}</div>
            <div className="text-sm">Joining Date: {profile?.joining_date ? formatDateCustom(profile.joining_date) : "-"}</div>
            {profile?.position && <div className="text-sm">Position: {profile.position}</div>}
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
                <select
                  className="rounded-md border border-black/10 px-2 py-1 text-sm"
                  value={attendanceRange}
                  onChange={(e) => setAttendanceRange(e.target.value)}
                >
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
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
              <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
                <div className="text-[11px] text-black/60">Monthly Salary ({salarySummary.monthLabel})</div>
                <input
                  type="number"
                  className="mt-1 w-full rounded-md border border-black/10 bg-white px-2 py-1 text-sm font-semibold text-heading"
                  value={monthlySalaryInput}
                  onChange={(e) => setMonthlySalaryInput(e.target.value)}
                  min={0}
                />
              </div>
              <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
                <div className="text-[11px] text-black/60">Per Hour Salary</div>
                <div className="mt-1 text-sm font-semibold text-heading">{Number(salarySummary.perHourRate || 0).toFixed(2)}</div>
              </div>
              <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
                <div className="text-[11px] text-black/60">Payable Days</div>
                <div className="mt-1 text-sm font-semibold text-heading">
                  {salarySummary.payableDays} / {salarySummary.workingDaysScope}
                </div>
              </div>
              <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
                <div className="text-[11px] text-black/60">Worked / Required</div>
                <div className="mt-1 text-sm font-semibold text-heading">
                  {formatMinutesAsHHMM(salarySummary.workedMinutes)} / {formatMinutesAsHHMM(salarySummary.totalRequired)}
                </div>
              </div>
              <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
                <div className="text-[11px] text-black/60">Late/Early Deduction</div>
                <div className="mt-1 text-sm font-semibold text-heading">{Math.round(salarySummary.lateEarlyDeduction).toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
                <div className="text-[11px] text-black/60">Overtime Pay (1.0x)</div>
                <div className="mt-1 text-sm font-semibold text-heading">{Math.round(salarySummary.overtimePay).toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2">
                <div className="text-[11px] text-black/60">Final Salary</div>
                <div className="mt-1 text-sm font-semibold text-heading">{Math.round(salarySummary.finalSalary).toLocaleString()}</div>
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
                    <th className="px-3 py-2 text-right">Manual</th>
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
                      <td className="px-3 py-2 text-right">
                        <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => openManualSessionModal(d)}>
                          Set
                        </button>
                      </td>
                    </tr>
                      );
                    })()
                  ))}
                  {displayWorkByDay.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-black/60" colSpan={10}>
                        No work sessions yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {showAddSession && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-heading">Manual Attendance</div>
                <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => setShowAddSession(false)}>
                  Close
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3">
                <div className="text-xs text-black/60">Date: {addSessionForm.work_date ? formatDateCustom(addSessionForm.work_date) : "-"}</div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(addSessionForm.half_day)}
                    onChange={(e) => setAddSessionForm((f) => ({ ...f, half_day: e.target.checked }))}
                  />
                  Half Day
                </label>
                {Boolean(addSessionForm.half_day) && (
                  <label className="grid gap-1">
                    <div className="text-xs text-black/60">Half Day Part</div>
                    <select
                      className="rounded-md border border-black/10 px-2 py-2"
                      value={String(addSessionForm.half_day_part || "first")}
                      onChange={(e) => setAddSessionForm((f) => ({ ...f, half_day_part: e.target.value }))}
                    >
                      <option value="first">First Half</option>
                      <option value="second">Second Half</option>
                    </select>
                  </label>
                )}
                <label className="grid gap-1">
                  <div className="text-xs text-black/60">First Login</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="datetime-local"
                      className="w-full rounded-md border border-black/10 px-2 py-2"
                      value={addSessionForm.login_at}
                      onChange={(e) => setAddSessionForm((f) => ({ ...f, login_at: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-black/10 px-2 py-2 text-xs hover:bg-black/5"
                      onClick={() => setAddSessionForm((f) => ({ ...f, login_at: "" }))}
                    >
                      Clear
                    </button>
                  </div>
                </label>
                <label className="grid gap-1">
                  <div className="text-xs text-black/60">Last Logout</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="datetime-local"
                      className="w-full rounded-md border border-black/10 px-2 py-2"
                      value={addSessionForm.logout_at}
                      onChange={(e) => setAddSessionForm((f) => ({ ...f, logout_at: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-black/10 px-2 py-2 text-xs hover:bg-black/5"
                      onClick={() => setAddSessionForm((f) => ({ ...f, logout_at: "" }))}
                    >
                      Clear
                    </button>
                  </div>
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(addSessionForm.ignore_late)}
                      onChange={(e) => setAddSessionForm((f) => ({ ...f, ignore_late: e.target.checked }))}
                    />
                    Ignore Late
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(addSessionForm.ignore_early)}
                      onChange={(e) => setAddSessionForm((f) => ({ ...f, ignore_early: e.target.checked }))}
                    />
                    Ignore Early
                  </label>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={() => setShowAddSession(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5 disabled:opacity-50"
                  disabled={addingSession}
                  onClick={() => setAddSessionForm((f) => ({ ...f, login_at: "", logout_at: "" }))}
                >
                  Clear Both
                </button>
                <button
                  type="button"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700 hover:bg-red-100 disabled:opacity-50"
                  disabled={addingSession || !addSessionForm.work_date}
                  onClick={clearManualDay}
                >
                  Clear Day
                </button>
                <button
                  className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50"
                  disabled={addingSession || !addSessionForm.work_date || !addSessionForm.login_at}
                  onClick={saveManualSession}
                >
                  {addingSession ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          {error && <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="text-sm font-semibold text-heading">Assign Task</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Title" value={createForm.title} onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))} />
            <select className="rounded-md border border-black/10 px-2 py-2" value={createForm.status} onChange={(e) => setCreateForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <input type="datetime-local" className="rounded-md border border-black/10 px-2 py-2" value={createForm.due_at} onChange={(e) => setCreateForm((f) => ({ ...f, due_at: e.target.value }))} />
            <textarea className="rounded-md border border-black/10 px-2 py-2 md:col-span-2" rows={2} placeholder="Description" value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} />
            <input
              className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx"
              multiple
              onChange={(e) => {
                const fs = Array.from(e.target.files || []);
                setAssignFiles(fs);
              }}
            />
          </div>
          <div className="mt-2">
            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={creating || !createForm.title.trim()} onClick={createTask}>Assign Task</button>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Tasks</div>
          <div className="mt-3 space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="rounded-md border border-black/10 p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{t.title}</div>
                    <div className="text-xs text-black/60 truncate">{t.status} • {t.due_at ? `Due: ${formatLocalDateTime12(t.due_at)}` : "No deadline"}</div>
                    {t.description && <div className="text-sm">{t.description}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input className="rounded-md border border-black/10 px-2 py-1" placeholder="Note (optional)" value={completeNotes[t.id] || ""} onChange={(e) => setCompleteNotes((prev) => ({ ...prev, [t.id]: e.target.value }))} />
                    <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5 disabled:opacity-50" disabled={!((completeNotes[t.id] || "").trim())} onClick={() => addNote(t.id)}>Add Note</button>
                    <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5 disabled:opacity-50" disabled={t.status === "completed" || t.status === "cancelled"} onClick={() => completeTask(t.id)}>Mark Completed</button>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-xs font-semibold text-heading">Attachments</div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx"
                      multiple
                      onChange={(e) => {
                        const fs = Array.from(e.target.files || []);
                        setAttachFiles((prev) => ({ ...prev, [t.id]: fs }));
                      }}
                    />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={!((attachFiles[t.id] || []).length)} onClick={() => uploadTaskFiles(t.id)}>
                      Upload Files
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {(taskDocs[t.id] || []).map((d) => (
                      <div key={d.id} className="flex items-center justify-between rounded-md border border-black/10 px-3 py-2">
                        <div className="text-sm">
                          <a href={d.url} target="_blank" rel="noreferrer" className="hover:underline">{d.filename}</a>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => renameDoc(d)}>Rename</button>
                          <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => deleteDoc(d)}>Delete</button>
                        </div>
                      </div>
                    ))}
                    {(taskDocs[t.id] || []).length === 0 && <div className="text-sm text-black/60">No attachments yet.</div>}
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {updates.filter((u) => u.task_id === t.id).map((u) => (
                    <div key={u.id} className="rounded border border-black/10 p-2">
                      <div className="text-xs text-black/60">{formatLocalDateTime12(u.created_at)} • {u.state}</div>
                      {u.note && <div className="text-sm">{u.note}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {tasks.length === 0 && <div className="text-sm text-black/60">No tasks assigned.</div>}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
