"use client";
import { useEffect, useState, useCallback } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import { formatLocalDateTime12 } from "@/lib/timeFormat";

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState([]);
  const [leads, setLeads] = useState([]);
  const [leadsForCreate, setLeadsForCreate] = useState([]);
  const [salesProfiles, setSalesProfiles] = useState([]);
  const [actorLabels, setActorLabels] = useState({});
  const [assigneeLabels, setAssigneeLabels] = useState({});
  const [userId, setUserId] = useState(null);
  const [currentUserLabel, setCurrentUserLabel] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({ datetime: "", title: "", notes: "" });
  const [createForm, setCreateForm] = useState({ lead_id: "", datetime: "", title: "", notes: "" });

  const fetchAll = useCallback(async () => {
    setError("");
    const { data: appts } = await supabase.from("appointments").select("*").order("scheduled_at", { ascending: true });
    setAppointments(appts || []);
    const leadIds = Array.from(new Set((appts || []).map((a) => a.lead_id).filter(Boolean)));
    if (leadIds.length > 0) {
      const { data: apptLeads } = await supabase.from("leads").select("*").in("id", leadIds);
      setLeads(apptLeads || []);
    } else {
      setLeads([]);
    }
    const { data: leadsDataForCreate } = await supabase.from("leads").select("*").eq("status", "Appointment confirmed");
    setLeadsForCreate(leadsDataForCreate || []);
    const actorIds = Array.from(new Set((appts || []).map((a) => a.created_by).filter(Boolean)));
    if (actorIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("user_id, display_name, role").in("user_id", actorIds);
      const map = {};
      (profiles || []).forEach((p) => (map[p.user_id] = p.display_name || p.role || p.user_id));
      setActorLabels(map);
    } else {
      setActorLabels({});
    }
    const { data: sales } = await supabase.from("profiles").select("user_id, display_name, role").eq("role", "sales");
    setSalesProfiles(sales || []);
    const am = {};
    (sales || []).forEach((p) => (am[p.user_id] = p.display_name || p.role || p.user_id));
    setAssigneeLabels(am);
  }, []);

  useEffect(() => {
    const run = async () => {
      const u = await getUserCached();
      const uid = u?.id || null;
      setUserId(uid);
      if (uid) {
        const { data: me } = await supabase.from("profiles").select("display_name, role").eq("user_id", uid).single();
        setCurrentUserLabel(me?.display_name || me?.role || uid);
      }
      await fetchAll();
    };
    run();
  }, [fetchAll]);

  const createAppointment = async () => {
    if (!createForm.lead_id || !createForm.datetime) return;
    setError("");
    setCreating(true);
    const iso = new Date(createForm.datetime).toISOString();
    const insert = {
      lead_id: createForm.lead_id,
      scheduled_at: iso,
      title: createForm.title || null,
      notes: createForm.notes || null,
      status: "scheduled",
      created_by: userId || null,
    };
    const { data, error: err } = await supabase.from("appointments").insert(insert).select("*").single();
    if (err) {
      setError(err.message || "Failed to create appointment");
      setCreating(false);
      return;
    }
    if (data) {
      setAppointments((prev) => [...prev, data].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)));
      setCreateForm({ lead_id: "", datetime: "", title: "", notes: "" });
      await supabase
        .from("lead_activities")
        .insert({
          lead_id: data.lead_id,
          type: "appointment_scheduled",
          meta: { when: iso, title: data.title, actor_id: userId || null, actor_label: currentUserLabel || null },
        });
    }
    setCreating(false);
  };

  const startEdit = (a) => {
    if (a.status !== "scheduled") return;
    const d = new Date(a.scheduled_at);
    const off = d.getTimezoneOffset();
    const localStr = new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
    setEditId(a.id);
    setEditForm({ datetime: localStr, title: a.title || "", notes: a.notes || "" });
  };

  const saveEdit = async () => {
    if (!editId || !editForm.datetime) return;
    setError("");
    const iso = new Date(editForm.datetime).toISOString();
    const payload = { scheduled_at: iso, title: editForm.title || null, notes: editForm.notes || null };
    const { data, error: err } = await supabase.from("appointments").update(payload).eq("id", editId).select("*").single();
    if (err) {
      setError(err.message || "Failed to update appointment");
      return;
    }
    if (data) {
      setAppointments((prev) => prev.map((a) => (a.id === editId ? data : a)).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)));
      setEditId(null);
      setEditForm({ datetime: "", title: "", notes: "" });
      await supabase
        .from("lead_activities")
        .insert({
          lead_id: data.lead_id,
          type: "appointment_updated",
          meta: { appointment_id: data.id, when: iso, title: data.title, actor_id: userId || null, actor_label: currentUserLabel || null },
        });
    }
  };

  const deleteAppointment = async (apptId) => {
    setError("");
    const appt = appointments.find((a) => a.id === apptId);
    if (!appt || appt.status !== "scheduled") return;
    const { error: err } = await supabase.from("appointments").delete().eq("id", apptId);
    if (err) {
      setError(err.message || "Failed to delete appointment");
      return;
    }
    setAppointments((prev) => prev.filter((a) => a.id !== apptId));
    if (appt) {
      await supabase
        .from("lead_activities")
        .insert({ lead_id: appt.lead_id, type: "appointment_deleted", meta: { appointment_id: apptId, actor_id: userId || null, actor_label: currentUserLabel || null } });
    }
  };

  const changeStatus = async (apptId, statusLabel) => {
    setError("");
    const current = appointments.find((a) => a.id === apptId);
    if (!current || current.status !== "scheduled") return;
    const status = statusLabel === "Booked" ? "scheduled" : statusLabel === "Completed" ? "completed" : "canceled";
    const { data, error: err } = await supabase.from("appointments").update({ status }).eq("id", apptId).select("*").single();
    if (err) {
      setError(err.message || "Failed to change status");
      return;
    }
    if (data) {
      setAppointments((prev) => prev.map((a) => (a.id === apptId ? data : a)));
      await supabase
        .from("lead_activities")
        .insert({
          lead_id: data.lead_id,
          type: "appointment_status_changed",
          meta: { appointment_id: apptId, status, actor_id: userId || null, actor_label: currentUserLabel || null },
        });
    }
  };

  const reassignAppointment = async (apptId, salesUserId) => {
    setError("");
    const appt = appointments.find((a) => a.id === apptId);
    if (!appt || appt.status !== "scheduled") return;
    const lead = leads.find((l) => l.id === appt.lead_id);
    const label = assigneeLabels[salesUserId] || null;
    const { data, error: err } = await supabase
      .from("leads")
      .update({ sales_person: salesUserId || null, custom: { ...(lead?.custom || {}), assignee_label: label } })
      .eq("id", appt.lead_id)
      .select("*")
      .single();
    if (err) {
      setError(err.message || "Failed to reassign");
      return;
    }
    if (data) {
      setLeads((prev) => prev.map((l) => (l.id === data.id ? data : l)));
      await supabase
        .from("lead_activities")
        .insert({ lead_id: data.id, type: "assigned", meta: { assignee_id: salesUserId || null, assignee_label: label || null, actor_id: userId || null } });
    }
  };

  const totals = {
    total: appointments.length,
    completed: appointments.filter((a) => a.status === "completed").length,
    canceled: appointments.filter((a) => a.status === "canceled").length,
  };

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-heading text-2xl font-bold">Appointments</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">Total Appointments</div>
            <div className="text-2xl font-bold">{totals.total}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">Completed</div>
            <div className="text-2xl font-bold">{totals.completed}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">Cancelled</div>
            <div className="text-2xl font-bold">{totals.canceled}</div>
          </div>
        </div>
        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Create Appointment</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              className="rounded-md border border-black/10 px-2 py-2"
              value={createForm.lead_id}
              onChange={(e) => setCreateForm((f) => ({ ...f, lead_id: e.target.value }))}
            >
              <option value="">Select Lead (Appointment confirmed)</option>
              {leadsForCreate.map((l) => (
                <option key={l.id} value={l.id}>
                  {(l.custom?.assignee_label ? l.custom.assignee_label + " • " : "") + (l.name || l.email || l.phone || l.id)}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              className="rounded-md border border-black/10 px-2 py-2"
              value={createForm.datetime}
              onChange={(e) => setCreateForm((f) => ({ ...f, datetime: e.target.value }))}
            />
            <input
              className="rounded-md border border-black/10 px-2 py-2"
              placeholder="Title (optional)"
              value={createForm.title}
              onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
            />
            <textarea
              className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
              rows={2}
              placeholder="Notes (optional)"
              value={createForm.notes}
              onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          {error && <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="mt-2 flex gap-2">
            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={creating || !createForm.lead_id || !createForm.datetime} onClick={createAppointment}>
              Create Appointment
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Appointments</div>
          <div className="mt-3 space-y-2">
            {appointments.map((a) => {
              const lead = leads.find((l) => l.id === a.lead_id);
              return (
                <div key={a.id} className="rounded-md border border-black/10 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      {editId === a.id ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input
                            type="datetime-local"
                            className="rounded-md border border-black/10 px-2 py-2"
                            value={editForm.datetime}
                            onChange={(e) => setEditForm((f) => ({ ...f, datetime: e.target.value }))}
                          />
                          <input
                            className="rounded-md border border-black/10 px-2 py-2"
                            placeholder="Title"
                            value={editForm.title}
                            onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                          />
                          <textarea
                            className="md:col-span-2 rounded-md border border-black/10 p-2"
                            rows={2}
                            placeholder="Notes"
                            value={editForm.notes}
                            onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                          />
                          <div className="md:col-span-2 flex items-center gap-2">
                            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover" onClick={saveEdit}>Save</button>
                            <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={() => { setEditId(null); setEditForm({ datetime: "", title: "", notes: "" }); }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-sm font-semibold">{a.title || "Appointment"}</div>
                          <div className="text-xs text-black/60">
                            {formatLocalDateTime12(a.scheduled_at)} • {(actorLabels[a.created_by] || "Unknown")} • {(assigneeLabels[lead?.sales_person] || "Unassigned")}
                          </div>
                          {a.notes && <div className="text-sm">{a.notes}</div>}
                          {lead && (
                            <div className="text-xs text-black/60">
                              Lead: {(lead.name || lead.email || lead.phone || lead.id)}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
              <select className="rounded-md border border-black/10 px-2 py-2 text-sm" value={a.status === "scheduled" ? "Booked" : a.status === "completed" ? "Completed" : "Cancelled"} onChange={(e) => changeStatus(a.id, e.target.value)} disabled={a.status !== "scheduled"}>
                        <option>Booked</option>
                        <option>Completed</option>
                        <option>Cancelled</option>
                      </select>
              <select className="rounded-md border border-black/10 px-2 py-2 text-sm" value={lead?.sales_person || ""} onChange={(e) => reassignAppointment(a.id, e.target.value)} disabled={a.status !== "scheduled"}>
                        <option value="">Unassigned</option>
                        {salesProfiles.map((p) => (
                          <option key={p.user_id} value={p.user_id}>
                            {p.display_name || p.user_id}
                          </option>
                        ))}
                      </select>
              <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5 disabled:opacity-50" onClick={() => startEdit(a)} disabled={a.status !== "scheduled"}>Edit</button>
              <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5 disabled:opacity-50" onClick={() => deleteAppointment(a.id)} disabled={a.status !== "scheduled"}>Delete</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {appointments.length === 0 && <div className="text-sm text-black/60">No appointments found for leads with Appointment confirmed.</div>}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
