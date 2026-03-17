"use client";
import { useEffect, useState, useCallback } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";

export default function LeadDetail() {
  const router = useRouter();
  const { id } = useParams();
  const [lead, setLead] = useState(null);
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");
  const [userId, setUserId] = useState(null);
  const [currentUserLabel, setCurrentUserLabel] = useState("");
  const [authorLabels, setAuthorLabels] = useState({});
  const [salesProfiles, setSalesProfiles] = useState([]);
  const [activities, setActivities] = useState([]);
  const [activityActorLabels, setActivityActorLabels] = useState({});
  const [followupDraft, setFollowupDraft] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [apptForm, setApptForm] = useState({ datetime: "", title: "", notes: "" });
  const [apptSaving, setApptSaving] = useState(false);
  const [apptError, setApptError] = useState("");
  const [apptActorLabels, setApptActorLabels] = useState({});
  const [apptEditId, setApptEditId] = useState(null);
  const [apptEditForm, setApptEditForm] = useState({ datetime: "", title: "", notes: "" });
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    const { data: leadData } = await supabase.from("leads").select("*").eq("id", id).single();
    setLead(leadData || null);
    const { data: notesData } = await supabase
      .from("lead_notes")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false });
    setNotes(notesData || []);
    const { data: acts } = await supabase
      .from("lead_activities")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false });
    setActivities(acts || []);
    const { data: appts } = await supabase
      .from("appointments")
      .select("*")
      .eq("lead_id", id)
      .order("scheduled_at", { ascending: true });
    setAppointments(appts || []);
  }, [id]);

  useEffect(() => {
    const init = async () => {
      const { data: sessionRes } = await supabase.auth.getSession();
      setUserId(sessionRes?.session?.user?.id || null);
      if (sessionRes?.session?.user?.id) {
        const { data: me } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", sessionRes.session.user.id)
          .single();
        const um = sessionRes?.session?.user?.user_metadata || {};
        setCurrentUserLabel(me?.display_name || um.name || um.full_name || sessionRes.session.user.email || "");
      }
      await fetchAll();
    };
    init();
  }, [id, fetchAll]);

  useEffect(() => {
    const run = async () => {
      if (!lead || !lead.org_id) {
        setSalesProfiles([]);
        return;
      }
      const { data: sales } = await supabase
        .from("profiles")
        .select("user_id, role, org_id, display_name")
        .eq("role", "sales")
        .eq("org_id", lead.org_id);
      setSalesProfiles(sales || []);
    };
    run();
  }, [lead]);

  const updateLead = async (patch) => {
    if (!lead?.id) return;
    const prev = lead;
    const { data } = await supabase
      .from("leads")
      .update(patch)
      .eq("id", lead.id)
      .select("*")
      .single();
    if (data) {
      setLead((prevLead) => ({ ...prevLead, ...data }));
      const toInsert = [];
      if (patch.status && patch.status !== prev.status) {
        toInsert.push({ lead_id: lead.id, type: "status_changed", meta: { from: prev.status || null, to: patch.status || null, actor_id: userId || null, actor_label: currentUserLabel || null } });
      }
      if (patch.priority && patch.priority !== prev.priority) {
        toInsert.push({ lead_id: lead.id, type: "priority_changed", meta: { from: prev.priority || null, to: patch.priority || null, actor_id: userId || null, actor_label: currentUserLabel || null } });
      }
      if (patch.custom && patch.custom.start_plan !== (prev.custom?.start_plan)) {
        toInsert.push({ lead_id: lead.id, type: "start_plan_changed", meta: { from: prev.custom?.start_plan || null, to: patch.custom.start_plan || null, actor_id: userId || null, actor_label: currentUserLabel || null } });
      }
      if (patch.custom && patch.custom.preferred_call_time !== (prev.custom?.preferred_call_time)) {
        toInsert.push({ lead_id: lead.id, type: "preferred_call_time_changed", meta: { from: prev.custom?.preferred_call_time || null, to: patch.custom.preferred_call_time || null, actor_id: userId || null, actor_label: currentUserLabel || null } });
      }
      if (patch.custom) {
        const m = patch.custom;
        const prevC = prev.custom || {};
        if (Object.prototype.hasOwnProperty.call(m, "followup1_notes") && m.followup1_notes !== prevC.followup1_notes) {
          toInsert.push({ lead_id: lead.id, type: "followup_note", meta: { stage: "followup 1", content: m.followup1_notes || null, actor_id: userId || null, actor_label: currentUserLabel || null } });
        }
        if (Object.prototype.hasOwnProperty.call(m, "followup2_notes") && m.followup2_notes !== prevC.followup2_notes) {
          toInsert.push({ lead_id: lead.id, type: "followup_note", meta: { stage: "followup 2", content: m.followup2_notes || null, actor_id: userId || null, actor_label: currentUserLabel || null } });
        }
        if (Object.prototype.hasOwnProperty.call(m, "followup3_notes") && m.followup3_notes !== prevC.followup3_notes) {
          toInsert.push({ lead_id: lead.id, type: "followup_note", meta: { stage: "followup 3", content: m.followup3_notes || null, actor_id: userId || null, actor_label: currentUserLabel || null } });
        }
      }
      if (toInsert.length > 0) {
        const { data: inserted } = await supabase.from("lead_activities").insert(toInsert).select("*");
        if (inserted) setActivities((a) => [...inserted, ...a]);
      }
    }
  };

  const addNote = async () => {
    if (!noteText.trim() || !lead?.id) return;
    const { data } = await supabase
      .from("lead_notes")
      .insert({ lead_id: lead.id, author_id: userId, content: noteText.trim() })
      .select("*")
      .single();
    if (data) setNotes((prev) => [data, ...prev]);
    setNoteText("");
  };

  const deleteLead = async () => {
    if (!lead?.id) return;
    await supabase.from("leads").delete().eq("id", lead.id);
    router.push("/admin/leads");
  };

  const assignLead = async (userIdValue) => {
    if (!lead?.id) return;
    const profile = salesProfiles.find((p) => p.user_id === userIdValue);
    const label = profile?.display_name || null;
    const { data } = await supabase
      .from("leads")
      .update({ sales_person: userIdValue || null, custom: { ...(lead?.custom || {}), assignee_label: label } })
      .eq("id", lead.id)
      .select("*")
      .single();
    if (data) {
      setLead(data);
      const { data: inserted } = await supabase
        .from("lead_activities")
        .insert({ lead_id: lead.id, type: "assigned", meta: { assignee_id: userIdValue || null, assignee_label: label || null, actor_id: userId || null } })
        .select("*");
      if (inserted) setActivities((a) => [...inserted, ...a]);
    }
  };

  const scheduleAppointment = async () => {
    if (!lead?.id || !apptForm.datetime) return;
    setApptError("");
    setApptSaving(true);
    const iso = new Date(apptForm.datetime).toISOString();
    const insert = {
      lead_id: lead.id,
      scheduled_at: iso,
      title: apptForm.title || null,
      notes: apptForm.notes || null,
      status: "scheduled",
      created_by: userId || null,
    };
    const { data, error } = await supabase.from("appointments").insert(insert).select("*").single();
    if (error) {
      setApptError(error.message || "Failed to schedule appointment");
      setApptSaving(false);
      return;
    }
    if (data) {
      setAppointments((prev) => [...prev, data].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)));
      setApptForm({ datetime: "", title: "", notes: "" });
      const { data: inserted } = await supabase
        .from("lead_activities")
        .insert({
          lead_id: lead.id,
          type: "appointment_scheduled",
          meta: { when: iso, title: insert.title, actor_id: userId || null, actor_label: currentUserLabel || null },
        })
        .select("*");
      if (inserted) setActivities((a) => [...inserted, ...a]);
      setApptSaving(false);
    }
  };

  const updateAppointmentStatus = async (apptId, status) => {
    setApptError("");
    const { data, error } = await supabase.from("appointments").update({ status }).eq("id", apptId).select("*").single();
    if (error) {
      setApptError(error.message || "Failed to update appointment");
      return;
    }
    if (data) {
      setAppointments((prev) => prev.map((a) => (a.id === apptId ? data : a)));
      const { data: inserted } = await supabase
        .from("lead_activities")
        .insert({
          lead_id: lead.id,
          type: "appointment_status_changed",
          meta: { appointment_id: apptId, status, actor_id: userId || null, actor_label: currentUserLabel || null },
        })
        .select("*");
      if (inserted) setActivities((a) => [...inserted, ...a]);
    }
  };

  const startApptEdit = (a) => {
    const d = new Date(a.scheduled_at);
    const off = d.getTimezoneOffset();
    const localStr = new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
    setApptEditId(a.id);
    setApptEditForm({ datetime: localStr, title: a.title || "", notes: a.notes || "" });
  };

  const saveApptEdit = async () => {
    if (!apptEditId || !apptEditForm.datetime) return;
    setApptError("");
    setApptSaving(true);
    const iso = new Date(apptEditForm.datetime).toISOString();
    const payload = { scheduled_at: iso, title: apptEditForm.title || null, notes: apptEditForm.notes || null };
    const { data, error } = await supabase.from("appointments").update(payload).eq("id", apptEditId).select("*").single();
    if (error) {
      setApptError(error.message || "Failed to update appointment");
      setApptSaving(false);
      return;
    }
    if (data) {
      setAppointments((prev) => prev.map((a) => (a.id === apptEditId ? data : a)).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)));
      setApptEditId(null);
      setApptEditForm({ datetime: "", title: "", notes: "" });
      const { data: inserted } = await supabase
        .from("lead_activities")
        .insert({
          lead_id: lead.id,
          type: "appointment_updated",
          meta: { appointment_id: data.id, when: iso, title: data.title, actor_id: userId || null, actor_label: currentUserLabel || null },
        })
        .select("*");
      if (inserted) setActivities((a) => [...inserted, ...a]);
      setApptSaving(false);
    }
  };

  const deleteAppointment = async (apptId) => {
    setApptError("");
    const { error } = await supabase.from("appointments").delete().eq("id", apptId);
    if (error) {
      setApptError(error.message || "Failed to delete appointment");
      return;
    }
    setAppointments((prev) => prev.filter((a) => a.id !== apptId));
    const { data: inserted } = await supabase
      .from("lead_activities")
      .insert({
        lead_id: lead.id,
        type: "appointment_deleted",
        meta: { appointment_id: apptId, actor_id: userId || null, actor_label: currentUserLabel || null },
      })
      .select("*");
    if (inserted) setActivities((a) => [...inserted, ...a]);
  };

  useEffect(() => {
    const run = async () => {
      const ids = Array.from(new Set((notes || []).map((n) => n.author_id).filter(Boolean)));
      if (ids.length === 0) {
        setAuthorLabels({});
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name, role")
        .in("user_id", ids);
      const map = {};
      (data || []).forEach((p) => {
        map[p.user_id] = p.display_name || p.role || p.user_id;
      });
      setAuthorLabels(map);
    };
    run();
  }, [notes]);

  useEffect(() => {
    const run = async () => {
      const ids = Array.from(new Set((activities || []).map((ev) => ev?.meta?.actor_id).filter(Boolean)));
      if (ids.length === 0) {
        setActivityActorLabels({});
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name, role")
        .in("user_id", ids);
      const map = {};
      (data || []).forEach((p) => {
        map[p.user_id] = p.display_name || p.role || p.user_id;
      });
      setActivityActorLabels(map);
    };
    run();
  }, [activities]);

  useEffect(() => {
    const run = async () => {
      const ids = Array.from(new Set((appointments || []).map((a) => a.created_by).filter(Boolean)));
      if (ids.length === 0) {
        setApptActorLabels({});
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name, role")
        .in("user_id", ids);
      const map = {};
      (data || []).forEach((p) => {
        map[p.user_id] = p.display_name || p.role || p.user_id;
      });
      setApptActorLabels(map);
    };
    run();
  }, [appointments]);
  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin/leads" className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5">Back</Link>
            <h1 className="text-heading text-2xl font-bold">Lead Detail</h1>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={deleteLead}>Delete</button>
          </div>
        </div>

        {!lead ? (
          <div className="rounded-xl border border-black/10 bg-white p-6">Loading...</div>
        ) : (
          <>
            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-black/60">Name</div>
                  <div className="font-semibold">{lead.name || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-black/60">Email</div>
                  <div className="font-semibold">{lead.email || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-black/60">Phone</div>
                  <div className="font-semibold">{lead.phone || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-black/60">Status</div>
                  <select
                    className="mt-1 rounded-md border border-black/10 px-2 py-2 text-sm"
                    value={lead.status || "New"}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("followup ")) {
                        setFollowupDraft({ status: v, note: "" });
                      } else {
                        updateLead({ status: v });
                      }
                    }}
                  >
                    <option>New</option>
                    <option>Contacted</option>
                    <option>Qualified</option>
                    <option>Lost</option>
                    <option>Converted</option>
                   <option>followup 1</option>
                   <option>followup 2</option>
                   <option>followup 3</option>
                   <option>Appointment confirmed</option>
                   <option>Not converted</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs text-black/60">Priority</div>
                  <select
                    className="mt-1 rounded-md border border-black/10 px-2 py-2 text-sm"
                    value={lead.priority || "Medium"}
                    onChange={(e) => updateLead({ priority: e.target.value })}
                  >
                    <option>Low</option>
                    <option>Medium</option>
                    <option>High</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs text-black/60">Service Type</div>
                  <div className="font-semibold">{lead.service_type || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-black/60">Website Source</div>
                  <div className="font-semibold">{lead.source || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-black/60">When are you looking to start?</div>
                  <div className="font-semibold">{lead.custom?.start_plan || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-black/60">Preferred time to call</div>
                  <div className="font-semibold">{lead.custom?.preferred_call_time || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-black/60">Assigned Sales</div>
                  <select
                    className="mt-1 rounded-md border border-black/10 px-2 py-2 text-sm"
                    value={lead.sales_person || ""}
                    onChange={(e) => assignLead(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {salesProfiles.map((p) => (
                      <option key={p.user_id} value={p.user_id}>
                        {p.display_name || p.user_id}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {followupDraft && (
                <div className="mt-3 space-y-2">
                  <div className="text-sm font-semibold text-heading">Add {followupDraft.status} details</div>
                  <textarea
                    className="w-full rounded-md border border-black/10 p-2"
                    rows={3}
                    placeholder="Write what happened in this followup..."
                    value={followupDraft.note}
                    onChange={(e) => setFollowupDraft((d) => ({ ...d, note: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <button
                      className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50"
                      disabled={!followupDraft.note.trim()}
                      onClick={async () => {
                        const s = followupDraft.status;
                        const key = s === "followup 1" ? "followup1_notes" : s === "followup 2" ? "followup2_notes" : "followup3_notes";
                        await updateLead({ status: s, custom: { ...(lead?.custom || {}), [key]: followupDraft.note.trim() } });
                        setFollowupDraft(null);
                      }}
                    >
                      Save Followup
                    </button>
                    <button
                      className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5"
                      onClick={() => setFollowupDraft(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-black/10 p-4 bg-white shadow-sm">
              <div className="text-sm font-semibold text-heading">Appointment</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="datetime-local"
                  className="rounded-md border border-black/10 px-2 py-2"
                  value={apptForm.datetime}
                  onChange={(e) => setApptForm((f) => ({ ...f, datetime: e.target.value }))}
                />
                <input
                  className="rounded-md border border-black/10 px-2 py-2"
                  placeholder="Title (optional)"
                  value={apptForm.title}
                  onChange={(e) => setApptForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <textarea
                className="mt-3 w-full rounded-md border border-black/10 p-2"
                rows={3}
                placeholder="Notes (optional)"
                value={apptForm.notes}
                onChange={(e) => setApptForm((f) => ({ ...f, notes: e.target.value }))}
              />
              {apptError && <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{apptError}</div>}
              <div className="mt-2 flex gap-2">
                <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={apptSaving || !apptForm.datetime} onClick={scheduleAppointment}>
                  Schedule Appointment
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {appointments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-md border border-black/10 p-2">
                    <div>
                      {apptEditId === a.id ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input
                            type="datetime-local"
                            className="rounded-md border border-black/10 px-2 py-2"
                            value={apptEditForm.datetime}
                            onChange={(e) => setApptEditForm((f) => ({ ...f, datetime: e.target.value }))}
                          />
                          <input
                            className="rounded-md border border-black/10 px-2 py-2"
                            placeholder="Title"
                            value={apptEditForm.title}
                            onChange={(e) => setApptEditForm((f) => ({ ...f, title: e.target.value }))}
                          />
                          <textarea
                            className="md:col-span-2 rounded-md border border-black/10 p-2"
                            rows={2}
                            placeholder="Notes"
                            value={apptEditForm.notes}
                            onChange={(e) => setApptEditForm((f) => ({ ...f, notes: e.target.value }))}
                          />
                          <div className="md:col-span-2 flex items-center gap-2">
                            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={apptSaving || !apptEditForm.datetime} onClick={saveApptEdit}>Save</button>
                            <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={() => { setApptEditId(null); setApptEditForm({ datetime: "", title: "", notes: "" }); }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-sm font-semibold">{a.title || "Appointment"}</div>
                          <div className="text-xs text-black/60">{new Date(a.scheduled_at).toLocaleString()} • {a.status} • {apptActorLabels[a.created_by] || "Unknown"}</div>
                          {a.notes && <div className="text-sm">{a.notes}</div>}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => updateAppointmentStatus(a.id, "completed")}>Mark Completed</button>
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => updateAppointmentStatus(a.id, "canceled")}>Cancel</button>
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => startApptEdit(a)}>Edit</button>
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => deleteAppointment(a.id)}>Delete</button>
                    </div>
                  </div>
                ))}
                {appointments.length === 0 && <div className="text-sm text-black/60">No appointments yet.</div>}
              </div>
            </div>

            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-heading">Custom Fields</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(lead.custom || {}).filter(([k]) => !["assignee_label","start_plan","preferred_call_time"].includes(k)).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-xs text-black/60">{k}</div>
                    <div className="font-semibold">{String(v)}</div>
                  </div>
                ))}
                {(!lead.custom || Object.keys(lead.custom).length === 0) && (
                  <div className="text-sm text-black/60">No custom fields.</div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-black/10 p-4 bg-white shadow-sm">
              <div className="text-sm font-semibold text-heading">Activity Timeline</div>
              <div className="mt-3 space-y-2">
                {activities.map((ev) => {
                  const when = new Date(ev.created_at).toLocaleString();
                  const t = ev.type;
                  const m = ev.meta || {};
                  const actorName = m.actor_label || activityActorLabels[m.actor_id] || (m.actor_id === userId ? (/* inline fallback */ (() => {
                    // we don't import currentUserLabel here; fallback to notes label if same user
                    return authorLabels[m.actor_id] || "Unknown";
                  })()) : "Unknown");
                  let msg = t;
                  if (t === "created") msg = "Lead created";
                  if (t === "status_changed") msg = `Status changed: ${m.from || "-"} → ${m.to || "-"}`;
                  if (t === "priority_changed") msg = `Priority changed: ${m.from || "-"} → ${m.to || "-"}`;
                  if (t === "assigned") msg = `Assigned to: ${m.assignee_label || m.assignee_id || "-"}`;
                  if (t === "start_plan_changed") msg = `Start plan: ${m.from || "-"} → ${m.to || "-"}`;
                  if (t === "preferred_call_time_changed") msg = `Preferred call time: ${m.from || "-"} → ${m.to || "-"}`;
                  if (t === "followup_note") msg = `Followup note (${m.stage || "-" }): ${m.content || "-"}`;
                  if (t === "appointment_scheduled") msg = `Appointment scheduled: ${m.title || "-"} at ${new Date(m.when).toLocaleString()}`;
                  if (t === "appointment_status_changed") msg = `Appointment ${m.appointment_id || ""} status: ${m.status || "-"}`;
                  if (t === "appointment_updated") msg = `Appointment updated: ${m.title || "-"} at ${new Date(m.when).toLocaleString()}`;
                  if (t === "appointment_deleted") msg = `Appointment ${m.appointment_id || ""} deleted`;
                  return (
                    <div key={ev.id} className="rounded-md border border-black/10 p-2">
                      <div className="text-xs text-black/60">{when} • {actorName}</div>
                      <div className="text-sm">{msg}</div>
                    </div>
                  );
                })}
                {activities.length === 0 && <div className="text-sm text-black/60">No activity yet.</div>}
              </div>
            </div>

            <div className="rounded-xl border border-black/10 p-4 bg-white shadow-sm">
              <div className="text-sm font-semibold text-heading">Notes</div>
              <textarea
                className="mt-2 w-full rounded-md border border-black/10 p-2"
                rows={3}
                placeholder="Add a note..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <button className="mt-2 rounded-md bg-heading px-3 py-2 text-background hover:bg-hover" onClick={addNote}>Add Note</button>
              <div className="mt-3 space-y-2">
                {notes.map((n) => (
                  <div key={n.id} className="rounded-md border border-black/10 p-2">
                    <div className="text-xs text-black/60">
                      {new Date(n.created_at).toLocaleString()} • {authorLabels[n.author_id] || "Unknown"}
                    </div>
                    <div className="text-sm">{n.content}</div>
                  </div>
                ))}
                {notes.length === 0 && <div className="text-sm text-black/60">No notes yet.</div>}
              </div>
            </div>

            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-heading">Edit Lead</div>
                {!editMode ? (
                  <button
                    className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover"
                    onClick={() => {
                      setEditMode(true);
                      setEditForm({
                        name: lead.name || "",
                        email: lead.email || "",
                        phone: lead.phone || "",
                        service_type: lead.service_type || "",
                        source: lead.source || "",
                        status: lead.status || "New",
                        priority: lead.priority || "Medium",
                        custom: { ...(lead.custom || {}) },
                      });
                    }}
                  >
                    Start Editing
                  </button>
                ) : (
                  <button
                    className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5"
                    onClick={() => {
                      setEditMode(false);
                      setEditForm(null);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
              {editMode && editForm && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Name" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                    <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
                    <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Phone" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
                    <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Service Type" value={editForm.service_type} onChange={(e) => setEditForm((f) => ({ ...f, service_type: e.target.value }))} />
                    <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Source" value={editForm.source} onChange={(e) => setEditForm((f) => ({ ...f, source: e.target.value }))} />
                    <select className="rounded-md border border-black/10 px-2 py-2" value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}>
                      <option>New</option><option>Contacted</option><option>Qualified</option><option>Lost</option><option>Converted</option><option>followup 1</option><option>followup 2</option><option>followup 3</option><option>Appointment confirmed</option><option>Not converted</option>
                    </select>
                    <select className="rounded-md border border-black/10 px-2 py-2" value={editForm.priority} onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}>
                      <option>Low</option><option>Medium</option><option>High</option>
                    </select>
                    <select
                      className="rounded-md border border-black/10 px-2 py-2"
                      value={(editForm.custom?.start_plan || "")}
                      onChange={(e) => setEditForm((f) => ({ ...f, custom: { ...(f.custom || {}), start_plan: e.target.value || null } }))}
                    >
                      <option value="">When are you looking to start?</option>
                      <option value="Immediately">Immediately</option>
                      <option value="Next week">Next week</option>
                      <option value="This month">This month</option>
                      <option value="Just exploring">Just exploring</option>
                    </select>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const presetOptions = [
                          "9 am to 10 am",
                          "10 am to 11 am",
                          "11 am to 12 pm",
                          "2 pm to 3 pm",
                          "3 pm to 4 pm",
                          "4 pm to 5 pm",
                        ];
                        const current = editForm.custom?.preferred_call_time || "";
                        const isPreset = presetOptions.includes(current);
                        const choiceValue = current && isPreset ? current : current ? "Custom" : "";
                        return (
                          <>
                            <select
                              className="rounded-md border border-black/10 px-2 py-2 flex-1"
                              value={choiceValue}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "" || presetOptions.includes(val)) {
                                  setEditForm((f) => ({ ...f, custom: { ...(f.custom || {}), preferred_call_time: val || null } }));
                                } else {
                                  setEditForm((f) => ({ ...f, custom: { ...(f.custom || {}), preferred_call_time: "" } }));
                                }
                              }}
                            >
                              <option value="">Preferred time to call</option>
                              <option value="9 am to 10 am">9 am to 10am</option>
                              <option value="10 am to 11 am">10am to 11am</option>
                              <option value="11 am to 12 pm">11am to 12pm</option>
                              <option value="2 pm to 3 pm">2pm to 3pm</option>
                              <option value="3 pm to 4 pm">3pm to 4pm</option>
                              <option value="4 pm to 5 pm">4pm to 5pm</option>
                              <option value="Custom">Custom</option>
                            </select>
                            {(choiceValue === "Custom") && (
                              <input
                                className="rounded-md border border-black/10 px-2 py-2 flex-1"
                                placeholder="Enter preferred time"
                                value={current === "Custom" ? "" : current}
                                onChange={(e) =>
                                  setEditForm((f) => ({ ...f, custom: { ...(f.custom || {}), preferred_call_time: e.target.value || "" } }))
                                }
                              />
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="rounded-xl border border-black/10 p-3">
                    <div className="text-sm font-semibold text-heading">Custom Fields</div>
                    <div className="mt-3 space-y-2">
                      {Object.entries(editForm.custom || {}).filter(([k]) => !["assignee_label","start_plan","preferred_call_time"].includes(k)).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-3 gap-2">
                          <input className="rounded-md border border-black/10 px-2 py-2" value={k} readOnly />
                          <input className="col-span-2 rounded-md border border-black/10 px-2 py-2" value={v} onChange={(e) => setEditForm((f) => ({ ...f, custom: { ...f.custom, [k]: e.target.value } }))} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover"
                      onClick={async () => {
                        await updateLead({ ...editForm });
                        setEditMode(false);
                        setEditForm(null);
                      }}
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5">Upload Document</button>
              <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover">Convert to Project</button>
            </div>
          </>
        )}
      </div>
    </AuthGuard>
  );
}
