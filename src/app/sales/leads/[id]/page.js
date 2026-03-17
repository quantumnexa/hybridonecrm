"use client";
import { useEffect, useState, useCallback } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

export default function LeadDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [lead, setLead] = useState(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");
  const [userId, setUserId] = useState(null);
  const [currentUserLabel, setCurrentUserLabel] = useState("");
  const [authorLabels, setAuthorLabels] = useState({});
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
  const [cancelModal, setCancelModal] = useState({ open: false, apptId: null, reason: "", existingNotes: "" });
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "", service_type: "", source: "" });
  const [assigneeName, setAssigneeName] = useState("");
  const [assigneeLabelsMap, setAssigneeLabelsMap] = useState({});
  const [creatorName, setCreatorName] = useState("");

  const canDelete = !!(lead && userId && (lead.custom?.created_by_user_id === userId) && !lead.sales_person);

  const fetchAll = useCallback(
    async (uid) => {
      if (!id || !uid) return;
      const { data: leadData } = await supabase.from("leads").select("*").eq("id", id).single();
      if (!leadData || (leadData.sales_person && leadData.sales_person !== uid)) {
        setUnauthorized(true);
        setLead(null);
        setNotes([]);
        setActivities([]);
        setAppointments([]);
        return;
      }
      setUnauthorized(false);
      setLead(leadData || null);
      if (leadData?.sales_person) {
        const { data: p } = await supabase
          .from("profiles")
          .select("display_name, role")
          .eq("user_id", leadData.sales_person)
          .single();
        setAssigneeName(p?.display_name || p?.role || "");
      } else {
        setAssigneeName("");
      }
      const creatorId = (leadData?.custom || {}).created_by_user_id || null;
      if (creatorId) {
        const { data: cp } = await supabase
          .from("profiles")
          .select("display_name, role")
          .eq("user_id", creatorId)
          .single();
        setCreatorName(cp?.display_name || cp?.role || "");
      } else {
        setCreatorName("");
      }
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
    },
    [id]
  );

  useEffect(() => {
    const init = async () => {
      const u = await getUserCached();
      setUserId(u?.id || null);
      if (u?.id) {
        const { data: me } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", u.id)
          .single();
        const um = u?.user_metadata || {};
        setCurrentUserLabel(me?.display_name || um.name || um.full_name || u.email || "");
      }
      await fetchAll(u?.id || null);
    };
    init();
  }, [id, fetchAll]);

  const updateLeadStatus = async (patch) => {
    if (!lead?.id || unauthorized || (lead.sales_person && lead.sales_person !== userId)) return;
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
        toInsert.push({
          lead_id: lead.id,
          type: "status_changed",
          meta: { from: prev.status || null, to: patch.status || null, actor_id: userId || null, actor_label: currentUserLabel || null },
        });
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
    if (!noteText.trim() || !lead?.id || unauthorized || (lead.sales_person && lead.sales_person !== userId)) return;
    const { data } = await supabase
      .from("lead_notes")
      .insert({ lead_id: lead.id, author_id: userId, content: noteText.trim() })
      .select("*")
      .single();
    if (data) setNotes((prev) => [data, ...prev]);
    setNoteText("");
  };

  const scheduleAppointment = async () => {
    if (!lead?.id || !apptForm.datetime || unauthorized || (lead.sales_person && lead.sales_person !== userId)) return;
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
    if (unauthorized || (lead?.sales_person && lead.sales_person !== userId)) return;
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

  const openCancelModal = (a) => {
    if (unauthorized || (lead?.sales_person && lead.sales_person !== userId) || a.status !== "scheduled") return;
    setCancelModal({ open: true, apptId: a.id, reason: "", existingNotes: a.notes || "" });
  };

  const confirmCancel = async () => {
    if (!cancelModal.open || !cancelModal.apptId) return;
    const newNotes = [cancelModal.existingNotes, cancelModal.reason ? `Cancel reason: ${cancelModal.reason}` : ""].filter(Boolean).join(" • ");
    setApptError("");
    const { data, error } = await supabase
      .from("appointments")
      .update({ status: "canceled", notes: newNotes || null })
      .eq("id", cancelModal.apptId)
      .select("*")
      .single();
    if (error) {
      setApptError(error.message || "Failed to cancel appointment");
      return;
    }
    if (data) {
      setAppointments((prev) => prev.map((a) => (a.id === cancelModal.apptId ? data : a)));
      const { data: inserted } = await supabase
        .from("lead_activities")
        .insert({
          lead_id: lead.id,
          type: "appointment_status_changed",
          meta: { appointment_id: cancelModal.apptId, status: "canceled", reason: cancelModal.reason || null, actor_id: userId || null, actor_label: currentUserLabel || null },
        })
        .select("*");
      if (inserted) setActivities((a) => [...inserted, ...a]);
    }
    setCancelModal({ open: false, apptId: null, reason: "", existingNotes: "" });
  };

  const startApptEdit = (a) => {
    if (unauthorized || (lead?.sales_person && lead.sales_person !== userId)) return;
    const d = new Date(a.scheduled_at);
    const off = d.getTimezoneOffset();
    const localStr = new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
    setApptEditId(a.id);
    setApptEditForm({ datetime: localStr, title: a.title || "", notes: a.notes || "" });
  };

  const saveApptEdit = async () => {
    if (!apptEditId || !apptEditForm.datetime || unauthorized || (lead?.sales_person && lead.sales_person !== userId)) return;
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

  // Deleting appointments is not allowed for sales; function removed

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
        map[p.user_id] = p.display_name || p.role || "Unknown";
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
        map[p.user_id] = p.display_name || p.role || "Unknown";
      });
      setActivityActorLabels(map);
    };
    run();
  }, [activities]);

  useEffect(() => {
    const run = async () => {
      const ids = Array.from(new Set((activities || []).map((ev) => ev?.meta?.assignee_id).filter(Boolean)));
      if (ids.length === 0) {
        setAssigneeLabelsMap({});
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name, role")
        .in("user_id", ids);
      const map = {};
      (data || []).forEach((p) => {
        map[p.user_id] = p.display_name || p.role || "Unknown";
      });
      setAssigneeLabelsMap(map);
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
      const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", ids);
      const map = {};
      (data || []).forEach((p) => {
        map[p.user_id] = p.display_name || "Unknown";
      });
      setApptActorLabels(map);
    };
    run();
  }, [appointments]);

  return (
    <AuthGuard allowedRoles={["sales"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/sales/leads" className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5">Back</Link>
            <h1 className="text-heading text-2xl font-bold">Lead Detail</h1>
          </div>
        </div>

        {!lead && !unauthorized ? (
          <div className="rounded-xl border border-black/10 bg-white p-6">Loading...</div>
        ) : unauthorized ? (
          <div className="rounded-xl border border-black/10 bg-white p-6">You are not authorized to view this lead.</div>
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
                        updateLeadStatus({ status: v });
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
                  <div className="font-semibold">{lead.priority || "Medium"}</div>
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
                  <div className="text-xs text-black/60">Creator</div>
                  <div className="font-semibold">{creatorName || "Unknown"}</div>
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
                  <div className="font-semibold">{lead.custom?.assignee_label || assigneeName || "Unassigned"}</div>
                </div>
              </div>
              {canDelete && (
                <div className="mt-3 flex justify-end">
                  <button
                    className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-700 hover:bg-red-100"
                    onClick={async () => {
                      if (!lead?.id) return;
                      const ok = window.confirm("Delete this lead? This cannot be undone.");
                      if (!ok) return;
                      await supabase.from("leads").delete().eq("id", lead.id);
                      router.push("/sales/leads");
                    }}
                  >
                    Delete Lead
                  </button>
                </div>
              )}
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
                        await updateLeadStatus({ status: s, custom: { ...(lead?.custom || {}), [key]: followupDraft.note.trim() } });
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
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => openCancelModal(a)}>Cancel</button>
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => startApptEdit(a)}>Edit</button>
                    </div>
                  </div>
                ))}
                {appointments.length === 0 && <div className="text-sm text-black/60">No appointments yet.</div>}
              </div>
            </div>

            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-heading">Custom Fields</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(lead.custom || {})
                  .filter(([k]) => {
                    const excluded = ["assignee_label", "start_plan", "preferred_call_time", "created_by_user_id"];
                    if (excluded.includes(k)) return false;
                    if (k.toLowerCase().endsWith("_id")) return false;
                    return true;
                  })
                  .map(([k, v]) => (
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

            {(lead?.custom?.created_by_user_id && lead.custom.created_by_user_id === userId) && (
              <div className="rounded-xl border border-black/10 p-4 bg-white shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-heading">Edit Lead (Creator Only)</div>
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
                        setEditForm({ name: "", email: "", phone: "", service_type: "", source: "" });
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {editMode && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Name" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                    <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
                    <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Phone" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
                    <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Service Type" value={editForm.service_type} onChange={(e) => setEditForm((f) => ({ ...f, service_type: e.target.value }))} />
                    <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Source" value={editForm.source} onChange={(e) => setEditForm((f) => ({ ...f, source: e.target.value }))} />
                    <div className="md:col-span-2 flex justify-end">
                      <button
                        className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover"
                        onClick={async () => {
                          if (!lead?.id) return;
                          const patch = {
                            name: editForm.name || null,
                            email: editForm.email || null,
                            phone: editForm.phone || null,
                            service_type: editForm.service_type || null,
                            source: editForm.source || null,
                          };
                          const { data } = await supabase.from("leads").update(patch).eq("id", lead.id).select("*").single();
                          if (data) {
                            setLead((prevLead) => ({ ...prevLead, ...data }));
                            await supabase.from("lead_activities").insert({
                              lead_id: data.id,
                              type: "updated_basic",
                              meta: { fields: Object.keys(patch).filter((k) => patch[k] !== (lead[k] || null)), actor_id: userId || null, actor_label: currentUserLabel || null },
                            });
                          }
                          setEditMode(false);
                          setEditForm({ name: "", email: "", phone: "", service_type: "", source: "" });
                        }}
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-black/10 p-4 bg-white shadow-sm">
              <div className="text-sm font-semibold text-heading">Activity Timeline</div>
              <div className="mt-3 space-y-2">
                {activities.map((ev) => {
                  const when = new Date(ev.created_at).toLocaleString();
                  const t = ev.type;
                  const m = ev.meta || {};
                    const isRole = (label) => ["sales","super_admin","lead_generator","appointment_setter","general_user"].includes((label || "").toLowerCase());
                    const preferredLabel = isRole(m.actor_label) ? "" : (m.actor_label || "");
                    const actorName = preferredLabel || activityActorLabels[m.actor_id] || authorLabels[m.actor_id] || "Unknown";
                  let msg = t;
                  if (t === "created") msg = "Lead created";
                  if (t === "status_changed") msg = `Status changed: ${m.from || "-"} → ${m.to || "-"}`;
                  if (t === "priority_changed") msg = `Priority changed: ${m.from || "-"} → ${m.to || "-"}`;
                    if (t === "assigned") msg = `Assigned to: ${m.assignee_label || assigneeLabelsMap[m.assignee_id] || "Unknown"}`;
                  if (t === "start_plan_changed") msg = `Start plan: ${m.from || "-"} → ${m.to || "-"}`;
                  if (t === "preferred_call_time_changed") msg = `Preferred call time: ${m.from || "-"} → ${m.to || "-"}`;
                  if (t === "followup_note") msg = `Followup note (${m.stage || "-" }): ${m.content || "-"}`;
                  if (t === "appointment_scheduled") msg = `Appointment scheduled: ${m.title || "-"} at ${new Date(m.when).toLocaleString()}`;
                    if (t === "appointment_status_changed") msg = `Appointment status: ${m.status || "-"}`;
                    if (t === "appointment_updated") msg = `Appointment updated: ${m.title || "-"} at ${new Date(m.when).toLocaleString()}`;
                    if (t === "appointment_deleted") msg = `Appointment deleted`;
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

            {/* Editing controls are not available for sales */}
            {cancelModal.open && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                <div className="w-full max-w-lg rounded-xl border border-black/10 bg-white p-4 shadow-lg">
                  <div className="text-lg font-semibold text-heading">Cancel Appointment</div>
                  <div className="mt-2 text-sm text-black/70">Please provide a reason for cancellation. It will be visible in the appointment notes.</div>
                  <textarea
                    className="mt-3 w-full rounded-md border border-black/10 p-2"
                    rows={3}
                    placeholder="Reason for cancellation"
                    value={cancelModal.reason}
                    onChange={(e) => setCancelModal((m) => ({ ...m, reason: e.target.value }))}
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={() => setCancelModal({ open: false, apptId: null, reason: "", existingNotes: "" })}>Close</button>
                    <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover" onClick={confirmCancel} disabled={!cancelModal.reason.trim()}>Confirm Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AuthGuard>
  );
}
