"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import { formatTimeHM12 } from "@/lib/timeFormat";

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysOfMonth(year, monthIndex) {
  const days = [];
  let d = new Date(year, monthIndex, 1);
  while (d.getMonth() === monthIndex) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export default function AdminShiftsPage() {
  const now = new Date();
  const [orgId, setOrgId] = useState(null);
  const [meId, setMeId] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [newShift, setNewShift] = useState({ name: "", start: "09:00", end: "18:00", is_night: false });

  const [assignUser, setAssignUser] = useState("");
  const [assignMonth, setAssignMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [assignByWeekday, setAssignByWeekday] = useState({
    0: "", 1: "", 2: "", 3: "", 4: "", 5: "", 6: "",
  }); // Sun..Sat shift_id or "" for OFF

  const monthMeta = useMemo(() => {
    const [y, m] = assignMonth.split("-").map((x) => Number(x));
    const year = Number.isFinite(y) ? y : new Date().getFullYear();
    const monthIndex = Number.isFinite(m) ? m - 1 : new Date().getMonth();
    const label = new Date(year, monthIndex, 1).toLocaleString(undefined, { year: "numeric", month: "long" });
    const days = daysOfMonth(year, monthIndex);
    return { year, monthIndex, label, days };
  }, [assignMonth]);

  const load = async () => {
    setError("");
    setLoading(true);
    const u = await getUserCached();
    const uid = u?.id || null;
    setMeId(uid);
    if (!uid) {
      setProfiles([]);
      setShifts([]);
      setOrgId(null);
      setLoading(false);
      return;
    }
    const { data: me } = await supabase.from("profiles").select("org_id").eq("user_id", uid).maybeSingle();
    const org = me?.org_id || null;
    setOrgId(org);
    let pQ = supabase.from("profiles").select("user_id, display_name, role, org_id, created_at").order("created_at", { ascending: false });
    if (org) pQ = pQ.or(`org_id.is.null,org_id.eq.${org}`);
    const { data: ps, error: pErr } = await pQ;
    if (pErr) {
      setError(pErr.message || "Failed to load employees");
      setLoading(false);
      return;
    }
    const people = (ps || []).filter((p) => p.user_id && p.role !== "super_admin");
    setProfiles(people);

    let sQ = supabase.from("shifts").select("*").order("start_time", { ascending: true });
    if (org) sQ = sQ.or(`org_id.is.null,org_id.eq.${org}`);
    const { data: sh, error: sErr } = await sQ;
    if (sErr) {
      setError(sErr.message || "Failed to load shifts");
      setLoading(false);
      return;
    }
    setShifts(sh || []);
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      await load();
    };
    init();
  }, [load]);

  const saveShift = async () => {
    if (!meId || !newShift.name.trim()) return;
    setError("");
    const payload = {
      org_id: orgId || null,
      name: newShift.name.trim(),
      start_time: newShift.start,
      end_time: newShift.end,
      is_night: !!newShift.is_night,
      created_by: meId,
    };
    const { data, error: err } = await supabase.from("shifts").insert(payload).select("*").single();
    if (err) {
      setError(err.message || "Failed to create shift");
      return;
    }
    setShifts((arr) => [...arr, data].sort((a, b) => String(a.start_time).localeCompare(String(b.start_time))));
    setNewShift({ name: "", start: "09:00", end: "18:00", is_night: false });
  };

  const assignMonthShifts = async () => {
    if (!assignUser) return;
    setError("");
    const { year, monthIndex } = monthMeta;
    const days = daysOfMonth(year, monthIndex);
    const prof = profiles.find((p) => p.user_id === assignUser) || null;
    let hireKey = null;
    if (prof?.created_at) {
      const hd = new Date(prof.created_at);
      hireKey = toIsoDate(hd);
    }
    const rows = [];
    for (const d of days) {
      const weekday = d.getDay(); // 0..6
      const shiftId = assignByWeekday[weekday] || "";
      const workDate = toIsoDate(d);
      if (hireKey && workDate < hireKey) {
        continue;
      }
      rows.push({
        org_id: orgId || null,
        user_id: assignUser,
        shift_id: shiftId || null,
        work_date: workDate,
        created_by: meId || null,
      });
    }
    // Upsert by user_id+work_date unique index:
    // Supabase JS supports upsert with onConflict columns.
    const { error: upErr } = await supabase.from("shift_assignments").upsert(rows, { onConflict: "user_id,work_date" });
    if (upErr) {
      setError(upErr.message || "Failed to assign monthly shifts");
      return;
    }
    alert("Shifts assigned for the month. Days before hire date (if any) were skipped.");
  };

  const weekOptions = useMemo(() => {
    return [
      { label: "OFF", value: "" },
      ...shifts.map((s) => ({ label: `${s.name} (${s.start_time}-${s.end_time})`, value: s.id })),
    ];
  }, [shifts]);

  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-heading text-2xl font-bold">Shifts</h1>
          <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={load}>Refresh</button>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Create Shift</div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Name (e.g., Day Shift)" value={newShift.name} onChange={(e) => setNewShift((s) => ({ ...s, name: e.target.value }))} />
              <label className="flex items-center gap-2 rounded-md border border-black/10 px-2 py-2">
                <input type="checkbox" checked={newShift.is_night} onChange={(e) => setNewShift((s) => ({ ...s, is_night: e.target.checked }))} />
                <span className="text-sm text-black/70">Night shift</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-sm w-24 text-black/60">Start</span>
                <input type="time" className="rounded-md border border-black/10 px-2 py-2 flex-1" value={newShift.start} onChange={(e) => setNewShift((s) => ({ ...s, start: e.target.value }))} />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-sm w-24 text-black/60">End</span>
                <input type="time" className="rounded-md border border-black/10 px-2 py-2 flex-1" value={newShift.end} onChange={(e) => setNewShift((s) => ({ ...s, end: e.target.value }))} />
              </label>
            </div>
            <div className="mt-3">
              <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" onClick={saveShift} disabled={!newShift.name.trim()}>Save Shift</button>
            </div>
            <div className="mt-4">
              <div className="text-xs text-black/60">Existing Shifts</div>
              <div className="mt-2 space-y-2">
                {shifts.map((s) => (
                  <div key={s.id} className="rounded-md border border-black/10 px-3 py-2 text-sm flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-heading">{s.name}</div>
                      <div className="text-black/60 text-xs">{formatTimeHM12(s.start_time)} - {formatTimeHM12(s.end_time)} {s.is_night ? "• Night" : ""}</div>
                    </div>
                  </div>
                ))}
                {shifts.length === 0 && <div className="text-sm text-black/60">No shifts created.</div>}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Assign Monthly Shifts</div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <select className="rounded-md border border-black/10 px-2 py-2" value={assignUser} onChange={(e) => setAssignUser(e.target.value)}>
                <option value="">Select employee…</option>
                {profiles.map((p) => (
                  <option key={p.user_id} value={p.user_id}>{p.display_name || p.user_id} ({p.role})</option>
                ))}
              </select>
              <input type="month" className="rounded-md border border-black/10 px-2 py-2" value={assignMonth} onChange={(e) => setAssignMonth(e.target.value)} />
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              {dow.map((label, i) => (
                <label key={i} className="flex items-center gap-2">
                  <span className="w-16 text-sm text-black/60">{label}</span>
                  <select
                    className="flex-1 rounded-md border border-black/10 px-2 py-2"
                    value={assignByWeekday[i]}
                    onChange={(e) => setAssignByWeekday((m) => ({ ...m, [i]: e.target.value }))}
                  >
                    {weekOptions.map((opt) => (
                      <option key={opt.label + opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="mt-3">
              <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" onClick={assignMonthShifts} disabled={!assignUser}>
                Assign Month ({monthMeta.label})
              </button>
            </div>
            <div className="mt-4 text-xs text-black/60">
              This assigns the chosen shift per weekday across all days of the selected month. OFF means no shift on that day.
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
