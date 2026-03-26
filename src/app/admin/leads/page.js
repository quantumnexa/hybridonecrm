"use client";
import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { formatLocalDateTime12 } from "@/lib/timeFormat";

function Filters({ onChange, salesProfiles = [] }) {
  const [state, setState] = useState({
    dateFrom: "",
    dateTo: "",
    priority: "",
    status: "",
    serviceType: "",
    assignedUserId: "",
  });
  const update = (k, v) => {
    const next = { ...state, [k]: v };
    setState(next);
    onChange?.(next);
  };
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="flex items-center gap-2">
          <input type="date" className="rounded-md border border-black/10 px-2 py-1 text-sm flex-1" value={state.dateFrom} onChange={(e) => update("dateFrom", e.target.value)} />
          <span className="text-sm">to</span>
          <input type="date" className="rounded-md border border-black/10 px-2 py-1 text-sm flex-1" value={state.dateTo} onChange={(e) => update("dateTo", e.target.value)} />
        </div>
        <select className="rounded-md border border-black/10 px-2 py-2 text-sm" value={state.priority} onChange={(e) => update("priority", e.target.value)}>
          <option value="">Priority</option>
          <option>Low</option>
          <option>Medium</option>
          <option>High</option>
        </select>
        <select className="rounded-md border border-black/10 px-2 py-2 text-sm" value={state.status} onChange={(e) => update("status", e.target.value)}>
          <option value="">Status</option>
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
        <input className="rounded-md border border-black/10 px-2 py-2 text-sm" placeholder="Service Type" value={state.serviceType} onChange={(e) => update("serviceType", e.target.value)} />
        <select className="rounded-md border border-black/10 px-2 py-2 text-sm" value={state.assignedUserId} onChange={(e) => update("assignedUserId", e.target.value)}>
          <option value="">Assigned Sales</option>
          {salesProfiles.map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.display_name || p.user_id}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function LeadRow({ lead, onSelect, onDelete, onUpdate, salesProfiles = [], onAssign, selected, onToggle }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-2">
        <input type="checkbox" className="h-4 w-4" checked={!!selected} onChange={() => onToggle(lead.id)} />
      </td>
      <td className="px-3 py-2">{lead.name}</td>
      <td className="px-3 py-2">{lead.email}</td>
      <td className="px-3 py-2">{lead.phone}</td>
      <td className="px-3 py-2">
        <select
          className="rounded-md border border-black/10 px-2 py-1 text-sm"
          value={lead.status || "New"}
          onChange={(e) => onUpdate(lead.id, { status: e.target.value })}
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
      </td>
      <td className="px-3 py-2">
        <select
          className="rounded-md border border-black/10 px-2 py-1 text-sm"
          value={lead.priority || "Medium"}
          onChange={(e) => onUpdate(lead.id, { priority: e.target.value })}
        >
          <option>Low</option>
          <option>Medium</option>
          <option>High</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <select
          className="rounded-md border border-black/10 px-2 py-1 text-sm min-w-40"
          value={lead.sales_person || ""}
          onChange={(e) => onAssign(lead.id, e.target.value)}
        >
          <option value="">Unassigned</option>
          {salesProfiles.map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.display_name || p.user_id}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-right">
        <Link href={`/admin/leads/${lead.id}`} className="rounded-md bg-heading px-3 py-1 text-background hover:bg-hover mr-2">View</Link>
        <button className="rounded-md bg-heading px-3 py-1 text-background hover:bg-hover mr-2" onClick={() => onSelect({ ...lead, _edit: true })}>Edit</button>
        <button className="rounded-md border border-black/10 px-3 py-1 hover:bg-black/5" onClick={() => onDelete(lead)}>Delete</button>
      </td>
    </tr>
  );
}

function CreateLeadModal({ open, onClose, onCreate, fieldsConfig, setFieldsConfig }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    status: "New",
    priority: "Medium",
    serviceType: "",
    website: "",
    assignee: "",
    startPlan: "",
    callTimeChoice: "",
    callTimeCustom: "",
    custom: {},
  });
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const updateCustom = (key, value) => setForm((f) => ({ ...f, custom: { ...f.custom, [key]: value } }));
  const addField = () => setFieldsConfig((cfg) => [...cfg, { key: "", label: "", type: "text", options: [], optionsText: "" }]);
  const updateField = (idx, patch) => setFieldsConfig((cfg) => cfg.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const removeField = (idx) => setFieldsConfig((cfg) => cfg.filter((_, i) => i !== idx));
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/30">
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 shrink-0">
          <div className="text-heading font-semibold">Create Lead</div>
          <button className="rounded-md px-3 py-2 hover:bg-black/5" onClick={onClose}>Close</button>
        </div>
        <div className="space-y-4 p-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Name" value={form.name} onChange={(e) => update("name", e.target.value)} />
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Email" value={form.email} onChange={(e) => update("email", e.target.value)} />
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Service Type" value={form.serviceType} onChange={(e) => update("serviceType", e.target.value)} />
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Website Source" value={form.website} onChange={(e) => update("website", e.target.value)} />
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Assigned Sales" value={form.assignee} onChange={(e) => update("assignee", e.target.value)} />
            <select className="rounded-md border border-black/10 px-2 py-2" value={form.status} onChange={(e) => update("status", e.target.value)}>
              <option>New</option><option>Contacted</option><option>Qualified</option><option>Lost</option><option>Converted</option><option>followup 1</option><option>followup 2</option><option>followup 3</option><option>Appointment confirmed</option><option>Not converted</option>
            </select>
            <select className="rounded-md border border-black/10 px-2 py-2" value={form.priority} onChange={(e) => update("priority", e.target.value)}>
              <option>Low</option><option>Medium</option><option>High</option>
            </select>
            <select className="rounded-md border border-black/10 px-2 py-2" value={form.startPlan} onChange={(e) => update("startPlan", e.target.value)}>
              <option value="">When are you looking to start?</option>
              <option value="Immediately">Immediately</option>
              <option value="Next week">Next week</option>
              <option value="This month">This month</option>
              <option value="Just exploring">Just exploring</option>
            </select>
            <div className="flex items-center gap-2">
              <select className="rounded-md border border-black/10 px-2 py-2 flex-1" value={form.callTimeChoice} onChange={(e) => update("callTimeChoice", e.target.value)}>
                <option value="">Preferred time to call</option>
                <option value="9 am to 10 am">9 am to 10am</option>
                <option value="10 am to 11 am">10am to 11am</option>
                <option value="11 am to 12 pm">11am to 12pm</option>
                <option value="2 pm to 3 pm">2pm to 3pm</option>
                <option value="3 pm to 4 pm">3pm to 4pm</option>
                <option value="4 pm to 5 pm">4pm to 5pm</option>
                <option value="Custom">Custom</option>
              </select>
              {form.callTimeChoice === "Custom" && (
                <input
                  className="rounded-md border border-black/10 px-2 py-2 flex-1"
                  placeholder="Enter preferred time"
                  value={form.callTimeCustom}
                  onChange={(e) => update("callTimeCustom", e.target.value)}
                />
              )}
            </div>
          </div>

          <div className="rounded-xl border border-black/10 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-heading">Custom Fields</div>
              <button className="rounded-md bg-heading px-3 py-1 text-background hover:bg-hover" onClick={addField}>Add Field</button>
            </div>
            <div className="mt-3 space-y-2">
              {fieldsConfig.map((f, idx) => (
                <div key={idx} className="grid grid-cols-3 gap-2">
                  <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Key" value={f.key} onChange={(e) => updateField(idx, { key: e.target.value })} />
                  <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Label" value={f.label} onChange={(e) => updateField(idx, { label: e.target.value })} />
                  <select className="rounded-md border border-black/10 px-2 py-2" value={f.type} onChange={(e) => updateField(idx, { type: e.target.value })}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="select">Select</option>
                  </select>
                  {f.type === "select" && (
                    <input
                      className="col-span-3 rounded-md border border-black/10 px-2 py-2"
                      placeholder="Options (comma-separated)"
                      value={f.optionsText || ""}
                      onChange={(e) => {
                        const text = e.target.value;
                        const opts = text
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean);
                        updateField(idx, { optionsText: text, options: opts });
                      }}
                    />
                  )}
                  <button className="col-span-3 rounded-md border border-black/10 px-2 py-2 hover:bg-black/5" onClick={() => removeField(idx)}>Remove</button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-sm font-semibold text-heading">Custom Values</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {fieldsConfig.map((f, idx) => (
                <div key={idx} className="flex flex-col">
                  <label className="text-xs text-black/60">{f.label || f.key}</label>
                  {f.type === "select" && (f.options?.length || 0) > 0 ? (
                    <select
                      className="rounded-md border border-black/10 px-2 py-2"
                      onChange={(e) => updateCustom(f.key, e.target.value)}
                    >
                      <option value="">Select...</option>
                      {f.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                      className="rounded-md border border-black/10 px-2 py-2"
                      onChange={(e) => updateCustom(f.key, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              className="rounded-md bg-heading px-4 py-2 text-background hover:bg-hover"
              onClick={() => {
                const preferred = form.callTimeChoice === "Custom" ? (form.callTimeCustom || "") : (form.callTimeChoice || "");
                const nextForm = {
                  ...form,
                  custom: {
                    ...form.custom,
                    start_plan: form.startPlan || null,
                    preferred_call_time: preferred || null,
                  },
                };
                onCreate?.(nextForm);
                onClose?.();
              }}
            >
              Create Lead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailDrawer({ lead, onClose, userId }) {
  const [noteText, setNoteText] = useState("");
  const [notes, setNotes] = useState([]);
  const [activities, setActivities] = useState([]);
  const [actorLabels, setActorLabels] = useState({});
  const [assigneeLabels, setAssigneeLabels] = useState({});
  const [assigneeName, setAssigneeName] = useState("");
  const [creatorName, setCreatorName] = useState("");

  useEffect(() => {
    const run = async () => {
      const id = lead?.id;
      if (!id) return;
      const { data } = await supabase
        .from("lead_notes")
        .select("*")
        .eq("lead_id", id)
        .order("created_at", { ascending: false });
      setNotes(data || []);
    };
    run();
  }, [lead?.id]);

  useEffect(() => {
    const run = async () => {
      const id = lead?.id;
      if (!id) return;
      const { data: acts } = await supabase
        .from("lead_activities")
        .select("*")
        .eq("lead_id", id)
        .order("created_at", { ascending: false });
      setActivities(acts || []);
      if (lead?.sales_person) {
        const { data: p } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", lead.sales_person)
          .single();
        setAssigneeName(p?.display_name || "");
      } else {
        setAssigneeName("");
      }
      const creatorId = (lead?.custom || {}).created_by_user_id || null;
      if (creatorId) {
        const { data: cp } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", creatorId)
          .single();
        setCreatorName(cp?.display_name || "");
      } else {
        setCreatorName("");
      }
    };
    run();
  }, [lead?.id]);

  useEffect(() => {
    const run = async () => {
      const ids = Array.from(new Set((activities || []).map((a) => a?.meta?.actor_id).filter(Boolean)));
      if (ids.length === 0) {
        setActorLabels({});
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids);
      const map = {};
      (data || []).forEach((p) => {
        map[p.user_id] = p.display_name || "Unknown";
      });
      setActorLabels(map);
    };
    run();
  }, [activities]);

  useEffect(() => {
    const run = async () => {
      const ids = Array.from(new Set((activities || []).map((a) => a?.meta?.assignee_id).filter(Boolean)));
      if (ids.length === 0) {
        setAssigneeLabels({});
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids);
      const map = {};
      (data || []).forEach((p) => {
        map[p.user_id] = p.display_name || "Unknown";
      });
      setAssigneeLabels(map);
    };
    run();
  }, [activities]);

  if (!lead) return null;

  const addNote = async () => {
    if (!noteText.trim()) return;
    const { data } = await supabase
      .from("lead_notes")
      .insert({
        lead_id: lead.id,
        author_id: userId,
        content: noteText.trim(),
      })
      .select("*")
      .single();
    if (data) setNotes((prev) => [data, ...prev]);
    setNoteText("");
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/30">
      <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
          <div className="text-heading font-semibold">Lead Details</div>
          <button className="rounded-md px-3 py-2 hover:bg-black/5" onClick={onClose}>Close</button>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2">
            <div><div className="text-xs text-black/60">Name</div><div className="font-semibold">{lead.name}</div></div>
            <div><div className="text-xs text-black/60">Email</div><div className="font-semibold">{lead.email}</div></div>
            <div><div className="text-xs text-black/60">Phone</div><div className="font-semibold">{lead.phone}</div></div>
            <div><div className="text-xs text-black/60">Status</div><div className="font-semibold">{lead.status}</div></div>
            <div><div className="text-xs text-black/60">Priority</div><div className="font-semibold">{lead.priority}</div></div>
            <div><div className="text-xs text-black/60">Creator</div><div className="font-semibold">{creatorName || "Unknown"}</div></div>
            <div><div className="text-xs text-black/60">Assigned Sales</div><div className="font-semibold">{lead.custom?.assignee_label || assigneeName || "Unassigned"}</div></div>
            <div><div className="text-xs text-black/60">When are you looking to start?</div><div className="font-semibold">{lead.custom?.start_plan || "-"}</div></div>
            <div><div className="text-xs text-black/60">Preferred time to call</div><div className="font-semibold">{lead.custom?.preferred_call_time || "-"}</div></div>
          </div>
          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-sm font-semibold text-heading">Activity Timeline</div>
            <div className="mt-3 space-y-2">
              {activities.map((ev) => {
                const when = formatLocalDateTime12(ev.created_at);
                const t = ev.type;
                const m = ev.meta || {};
                const roleWords = ["sales","super_admin","lead_generator","appointment_setter","general_user"];
                const preferred = roleWords.includes((m.actor_label || "").toLowerCase()) ? "" : (m.actor_label || "");
                const actorName = preferred || actorLabels[m.actor_id] || "Unknown";
                let msg = t;
                if (t === "created") msg = "Lead created";
                if (t === "status_changed") msg = `Status changed: ${m.from || "-"} → ${m.to || "-"}`;
                if (t === "priority_changed") msg = `Priority changed: ${m.from || "-"} → ${m.to || "-"}`;
                if (t === "assigned") msg = `Assigned to: ${m.assignee_label || assigneeLabels[m.assignee_id] || "Unknown"}`;
                if (t === "followup_note") msg = `Followup note (${m.stage || "-" }): ${m.content || "-"}`;
                if (t === "appointment_scheduled") msg = `Appointment scheduled: ${m.title || "-"} at ${formatLocalDateTime12(m.when)}`;
                if (t === "appointment_status_changed") msg = `Appointment status: ${m.status || "-"}`;
                if (t === "appointment_updated") msg = `Appointment updated: ${m.title || "-"} at ${formatLocalDateTime12(m.when)}`;
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
          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-sm font-semibold text-heading">Custom Fields</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
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
              {(!lead.custom || Object.keys(lead.custom).length === 0) && <div className="text-sm text-black/60">No custom fields.</div>}
            </div>
          </div>
          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-sm font-semibold text-heading">Notes</div>
            <textarea className="mt-2 w-full rounded-md border border-black/10 p-2" rows={3} placeholder="Add a note..." value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            <button className="mt-2 rounded-md bg-heading px-3 py-2 text-background hover:bg-hover" onClick={addNote}>Add Note</button>
            <div className="mt-3 space-y-2">
              {notes.map((n) => (
                <div key={n.id} className="rounded-md border border-black/10 p-2">
                  <div className="text-xs text-black/60">{formatLocalDateTime12(n.created_at)}</div>
                  <div className="text-sm">{n.content}</div>
                </div>
              ))}
              {notes.length === 0 && <div className="text-sm text-black/60">No notes yet.</div>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-black/10 p-3">
              <div className="text-sm font-semibold text-heading">Appointment History</div>
              <div className="mt-2 text-sm text-black/60">None</div>
            </div>
            <div className="rounded-xl border border-black/10 p-3">
              <div className="text-sm font-semibold text-heading">Quotation History</div>
              <div className="mt-2 text-sm text-black/60">None</div>
            </div>
          </div>
          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-sm font-semibold text-heading">Status Change History</div>
            <div className="mt-2 text-sm text-black/60">None</div>
          </div>
          <div className="flex justify-end gap-2">
            <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5">Upload Document</button>
            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover">Convert to Project</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [filters, setFilters] = useState({});
  const [leads, setLeads] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState(null);
  const [fieldsConfig, setFieldsConfig] = useState([
    { key: "company", label: "Company", type: "text" },
    { key: "budget", label: "Budget", type: "number" },
  ]);
  const [orgId, setOrgId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [currentUserLabel, setCurrentUserLabel] = useState("");
  const [salesProfiles, setSalesProfiles] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAssignUserId, setBulkAssignUserId] = useState("");

  const fetchLeads = async (org) => {
    let query = supabase.from("leads").select("*").order("created_at", { ascending: false });
    if (org) query = query.eq("org_id", org);
    const { data } = await query;
    setLeads(data || []);
  };

  const fetchSalesProfiles = async (org) => {
    let q = supabase.from("profiles").select("user_id, role, org_id, display_name").eq("role", "sales");
    if (org) {
      q = q.or(`org_id.is.null,org_id.eq.${org}`);
    }
    const { data } = await q;
    setSalesProfiles(data || []);
  };

  const ensureOrg = async () => {
    const name = "Default Org";
    const { data: existingList } = await supabase
      .from("organizations")
      .select("id")
      .eq("name", name)
      .limit(1);
    const existing = existingList?.[0];
    let newOrgId = existing?.id;
    if (!newOrgId) {
      const { data: created } = await supabase
        .from("organizations")
        .insert({ name })
        .select("id")
        .single();
      newOrgId = created?.id || null;
    }
    if (newOrgId && userId) {
      await supabase
        .from("profiles")
        .update({ org_id: newOrgId })
        .eq("user_id", userId);
      setOrgId(newOrgId);
    }
    return newOrgId;
  };

  useEffect(() => {
    const init = async () => {
      const { data: sessionRes } = await supabase.auth.getSession();
      const uid = sessionRes?.session?.user?.id || null;
      setUserId(uid);
      if (!uid) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id, role, display_name")
        .eq("user_id", uid)
        .single();
      const org = profile?.org_id || null;
      setOrgId(org);
      const um = sessionRes?.session?.user?.user_metadata || {};
      setCurrentUserLabel(
        profile?.display_name ||
          um.name ||
          um.full_name ||
          sessionRes?.session?.user?.email ||
          ""
      );
      await fetchLeads(org);
      await fetchSalesProfiles(org);
    };
    init();
  }, []);

  const ensureWebsite = async (org, name) => {
    const label = (name || "").trim();
    if (!label) return null;
    const { data: existing } = await supabase
      .from("websites")
      .select("id")
      .eq("org_id", org)
      .eq("name", label)
      .maybeSingle();
    if (existing?.id) return existing.id;
    const { data: created } = await supabase
      .from("websites")
      .insert({ org_id: org, name: label })
      .select("id")
      .single();
    return created?.id || null;
  };

  const createLead = (payload) => {
    const run = async () => {
      let org = orgId;
      if (!org) {
        org = await ensureOrg();
        if (!org) return;
      }
      const websiteId = await ensureWebsite(org, payload.website);
      const { data } = await supabase
        .from("leads")
        .insert({
          org_id: org,
          website_id: websiteId,
          sales_person: null,
          name: payload.name || null,
          email: payload.email || null,
          phone: payload.phone || null,
          status: payload.status || "New",
          priority: payload.priority || "Medium",
          service_type: payload.serviceType || null,
          source: payload.website || null,
          custom: {
            ...payload.custom,
            assignee_label: payload.assignee || null,
          },
        })
        .select("*")
        .single();
      if (data) {
        setLeads((prev) => [data, ...prev]);
        await supabase.from("lead_activities").insert({ lead_id: data.id, type: "created", meta: { actor_id: userId || null, actor_label: currentUserLabel || null } });
      }
    };
    run();
  };
  const deleteLead = (lead) => {
    const run = async () => {
      await supabase.from("leads").delete().eq("id", lead.id);
      setLeads((prev) => prev.filter((l) => l.id !== lead.id));
      if (selected?.id === lead.id) setSelected(null);
    };
    run();
  };
  const updateLead = (id, patch) => {
    const run = async () => {
      const prev = leads.find((l) => l.id === id) || {};
      const { data } = await supabase
        .from("leads")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (!data) return;
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...data } : l)));
      if (selected?.id === id) setSelected((s) => ({ ...s, ...data }));
      const toInsert = [];
      if (patch.status && patch.status !== prev.status) {
        toInsert.push({ lead_id: id, type: "status_changed", meta: { from: prev.status || null, to: patch.status || null, actor_id: userId || null, actor_label: currentUserLabel || null } });
      }
      if (patch.priority && patch.priority !== prev.priority) {
        toInsert.push({ lead_id: id, type: "priority_changed", meta: { from: prev.priority || null, to: patch.priority || null, actor_id: userId || null, actor_label: currentUserLabel || null } });
      }
      if (toInsert.length > 0) {
        await supabase.from("lead_activities").insert(toInsert);
      }
    };
    run();
  };
  const assignLead = (id, userIdValue) => {
    const profile = salesProfiles.find((p) => p.user_id === userIdValue);
    const label = profile?.display_name || null;
    const prev = leads.find((l) => l.id === id);
    const custom = { ...(prev?.custom || {}), assignee_label: label };
    const run = async () => {
      const { data } = await supabase
        .from("leads")
        .update({ sales_person: userIdValue || null, custom })
        .eq("id", id)
        .select("*")
        .single();
      if (!data) return;
      setLeads((p) => p.map((l) => (l.id === id ? { ...l, ...data } : l)));
      if (selected?.id === id) setSelected((s) => ({ ...s, ...data }));
      await supabase.from("lead_activities").insert({ lead_id: id, type: "assigned", meta: { assignee_id: userIdValue || null, assignee_label: label || null, actor_id: userId || null, actor_label: currentUserLabel || null } });
    };
    run();
  };
  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const bulkAssign = async () => {
    if (!bulkAssignUserId || selectedIds.length === 0) return;
    const profile = salesProfiles.find((p) => p.user_id === bulkAssignUserId);
    const label = profile?.display_name || null;
    const updates = await Promise.all(
      selectedIds.map(async (id) => {
        const prev = leads.find((l) => l.id === id);
        const custom = { ...(prev?.custom || {}), assignee_label: label };
        const { data } = await supabase
          .from("leads")
          .update({ sales_person: bulkAssignUserId, custom })
          .eq("id", id)
          .select("*")
          .single();
        if (data) {
          await supabase.from("lead_activities").insert({ lead_id: id, type: "assigned", meta: { assignee_id: bulkAssignUserId, assignee_label: label || null, actor_id: userId || null, actor_label: currentUserLabel || null } });
        }
        return data;
      })
    );
    setLeads((prev) => {
      const map = new Map(prev.map((l) => [l.id, l]));
      updates.filter(Boolean).forEach((u) => map.set(u.id, { ...map.get(u.id), ...u }));
      return Array.from(map.values());
    });
    setSelectedIds([]);
  };
  const refreshAll = async () => {
    const { data: sessionRes } = await supabase.auth.getSession();
    const uid = sessionRes?.session?.user?.id || null;
    if (!uid) {
      await fetchLeads(null);
      await fetchSalesProfiles(null);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("user_id", uid)
      .single();
    const org = profile?.org_id || null;
    setOrgId(org);
    setSelectedIds([]);
    await fetchLeads(org);
    await fetchSalesProfiles(org);
  };

  function EditLeadModal({ lead, onClose }) {
    const [form, setForm] = useState({
      name: (lead || {}).name || "",
      email: (lead || {}).email || "",
      phone: (lead || {}).phone || "",
      status: (lead || {}).status || "New",
      priority: (lead || {}).priority || "Medium",
      serviceType: (lead || {}).service_type || "",
      source: (lead || {}).source || "",
      custom: { ...((lead || {}).custom || {}) },
    });
    useEffect(() => {
      if (!lead?._edit) return;
      setForm({
        name: lead.name || "",
        email: lead.email || "",
        phone: lead.phone || "",
        status: lead.status || "New",
        priority: lead.priority || "Medium",
        serviceType: lead.service_type || "",
        source: lead.source || "",
        custom: { ...(lead.custom || {}) },
      });
    }, [lead]);
    if (!lead?._edit) return null;
    const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const updateCustom = (k, v) => setForm((f) => ({ ...f, custom: { ...f.custom, [k]: v } }));
    const addCustom = () => setForm((f) => ({ ...f, custom: { ...f.custom, ["new_key_" + Object.keys(f.custom).length]: "" } }));
    return (
      <div className="fixed inset-0 z-50 bg-black/30">
        <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl flex flex-col">
          <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 shrink-0">
            <div className="text-heading font-semibold">Edit Lead</div>
            <button className="rounded-md px-3 py-2 hover:bg-black/5" onClick={onClose}>Close</button>
          </div>
          <div className="space-y-4 p-4 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-3">
              <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Name" value={form.name} onChange={(e) => update("name", e.target.value)} />
              <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Email" value={form.email} onChange={(e) => update("email", e.target.value)} />
              <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
              <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Service Type" value={form.serviceType} onChange={(e) => update("serviceType", e.target.value)} />
              <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Source" value={form.source} onChange={(e) => update("source", e.target.value)} />
              <select className="rounded-md border border-black/10 px-2 py-2" value={form.status} onChange={(e) => update("status", e.target.value)}>
                <option>New</option><option>Contacted</option><option>Qualified</option><option>Lost</option><option>Converted</option>
              </select>
              <select className="rounded-md border border-black/10 px-2 py-2" value={form.priority} onChange={(e) => update("priority", e.target.value)}>
                <option>Low</option><option>Medium</option><option>High</option>
              </select>
            </div>
            <div className="rounded-xl border border-black/10 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-heading">Custom Fields</div>
                <button className="rounded-md bg-heading px-3 py-1 text-background hover:bg-hover" onClick={addCustom}>Add Key</button>
              </div>
              <div className="mt-3 space-y-2">
                {Object.entries(form.custom).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-3 gap-2">
                    <input className="rounded-md border border-black/10 px-2 py-2" value={k} readOnly />
                    <input className="col-span-2 rounded-md border border-black/10 px-2 py-2" value={v} onChange={(e) => updateCustom(k, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                className="rounded-md bg-heading px-4 py-2 text-background hover:bg-hover"
                onClick={async () => {
                  const patch = {
                    name: form.name,
                    email: form.email,
                    phone: form.phone,
                    service_type: form.serviceType,
                    source: form.source,
                    status: form.status,
                    priority: form.priority,
                    custom: form.custom,
                  };
                  await updateLead(lead.id, patch);
                  onClose();
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-heading text-2xl font-bold">Leads</h1>
          <div className="flex items-center gap-2">
            <button className="rounded-md bg-heading px-4 py-2 text-background hover:bg-hover" onClick={() => setShowCreate(true)}>Create Lead</button>
              <button className="rounded-md border border-black/10 px-4 py-2 hover:bg-black/5" onClick={refreshAll}>Refresh</button>
          </div>
        </div>

        {!orgId && (
          <div className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
            Viewing all leads. Assign an organization to your profile to scope results.
          </div>
        )}

        <div className="rounded-xl border border-black/10 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-3">
            <select
              className="rounded-md border border-black/10 px-2 py-2 text-sm"
              value={bulkAssignUserId}
              onChange={(e) => setBulkAssignUserId(e.target.value)}
            >
              <option value="">Bulk Assign: Select Sales</option>
              {salesProfiles.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.display_name || p.user_id}
                </option>
              ))}
            </select>
            <button
              className="rounded-md bg-heading px-4 py-2 text-background hover:bg-hover disabled:opacity-50"
              disabled={!bulkAssignUserId || selectedIds.length === 0}
              onClick={bulkAssign}
            >
              Assign Selected
            </button>
            <div className="text-sm text-black/60">Selected: {selectedIds.length}</div>
          </div>
        </div>

        <Filters onChange={setFilters} salesProfiles={salesProfiles} />

        <div className="rounded-xl border border-black/10 bg-white p-0 shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-black/70">
              <tr>
                <th className="px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    onChange={(e) => {
                      const visibleIds = leads
                        .filter((l) => {
                          if (filters.status && l.status !== filters.status) return false;
                          if (filters.priority && l.priority !== filters.priority) return false;
                          if (filters.assignedUserId && (l.sales_person || "") !== filters.assignedUserId) return false;
                          return true;
                        })
                        .map((l) => l.id);
                      if (e.target.checked) setSelectedIds(visibleIds);
                      else setSelectedIds([]);
                    }}
                    checked={
                      leads.filter((l) => {
                        if (filters.status && l.status !== filters.status) return false;
                        if (filters.priority && l.priority !== filters.priority) return false;
                        if (filters.assignedUserId && (l.sales_person || "") !== filters.assignedUserId) return false;
                        return true;
                      }).every((l) => selectedIds.includes(l.id)) && leads.length > 0
                    }
                  />
                </th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Priority</th>
                <th className="px-3 py-2 text-left">Assignee</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(leads.filter((l) => {
                if (filters.status && l.status !== filters.status) return false;
                if (filters.priority && l.priority !== filters.priority) return false;
                if (filters.assignedUserId && (l.sales_person || "") !== filters.assignedUserId) return false;
                return true;
              })).length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-black/60" colSpan={8}>No leads yet. Use Create Lead to add one.</td>
                </tr>
              ) : (
                leads
                  .filter((l) => {
                    if (filters.status && l.status !== filters.status) return false;
                    if (filters.priority && l.priority !== filters.priority) return false;
                    if (filters.assignedUserId && (l.sales_person || "") !== filters.assignedUserId) return false;
                    return true;
                  })
                  .map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    onSelect={setSelected}
                    onDelete={deleteLead}
                    onUpdate={updateLead}
                    salesProfiles={salesProfiles}
                    onAssign={assignLead}
                    selected={selectedIds.includes(lead.id)}
                    onToggle={toggleSelect}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        <CreateLeadModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreate={createLead}
          fieldsConfig={fieldsConfig}
          setFieldsConfig={setFieldsConfig}
        />
        <DetailDrawer lead={selected} onClose={() => setSelected(null)} userId={userId} />
        <EditLeadModal lead={selected} onClose={() => setSelected(null)} />
      </div>
    </AuthGuard>
  );
}
