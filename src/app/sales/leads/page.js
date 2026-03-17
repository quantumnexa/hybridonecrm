 "use client";
import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import Link from "next/link";

export default function Page() {
  const [leads, setLeads] = useState([]);
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [orgId, setOrgId] = useState(null);
  const [currentUserLabel, setCurrentUserLabel] = useState("");
  const [fieldsConfig, setFieldsConfig] = useState([]);
  const canDelete = (lead) => {
    return !!(lead && userId && (lead.custom?.created_by_user_id === userId) && !lead.sales_person);
  };
  const deleteLead = async (lead) => {
    if (!canDelete(lead)) return;
    const ok = window.confirm("Delete this lead? This cannot be undone.");
    if (!ok) return;
    await supabase.from("leads").delete().eq("id", lead.id);
    setLeads((prev) => prev.filter((l) => l.id !== lead.id));
  };

  const createLead = async (form) => {
    if (!userId) return;
    const preferred = form.callTimeChoice === "Custom" ? (form.callTimeCustom || "") : (form.callTimeChoice || "");
    const payload = {
      org_id: orgId || null,
      website_id: null,
      sales_person: userId,
      name: form.name || null,
      email: form.email || null,
      phone: form.phone || null,
      status: form.status || "New",
      priority: form.priority || "Medium",
      service_type: form.serviceType || null,
      source: form.website || null,
      custom: {
        ...(form.custom || {}),
        start_plan: form.startPlan || null,
        preferred_call_time: preferred || null,
        created_by_user_id: userId,
        assignee_label: currentUserLabel || null,
      },
    };
    const { data, error: err } = await supabase.from("leads").insert(payload).select("*").single();
    if (err) {
      setError(err.message || "Failed to create lead");
      return;
    }
    if (data) {
      setLeads((prev) => [data, ...prev]);
      await supabase.from("lead_activities").insert({ lead_id: data.id, type: "created", meta: { actor_id: userId, actor_label: currentUserLabel || "sales" } });
    }
  };
  useEffect(() => {
    const run = async () => {
      setError("");
      const u = await getUserCached();
      const uid = u?.id || null;
      setUserId(uid);
      if (!uid) return;
      const { data: prof } = await supabase.from("profiles").select("org_id, display_name").eq("user_id", uid).single();
      setOrgId(prof?.org_id || null);
      setCurrentUserLabel(prof?.display_name || u?.user_metadata?.name || u?.email || "");
      const { data } = await supabase.from("leads").select("*").eq("sales_person", uid).order("created_at", { ascending: false });
      setLeads(data || []);
    };
    run();
  }, []);
  return (
    <AuthGuard allowedRoles={["sales"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-heading text-2xl font-bold">My Leads</h1>
          <div className="flex items-center gap-2">
            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover" onClick={() => setShowCreate(true)}>Create Lead</button>
            <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={async () => {
            if (!userId) return;
            const { data } = await supabase.from("leads").select("*").eq("sales_person", userId).order("created_at", { ascending: false });
            setLeads(data || []);
          }}>Refresh</button>
          </div>
        </div>
        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="rounded-xl border border-black/10 bg-white p-3 shadow-sm">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Priority</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr><td className="px-3 py-6 text-center text-black/60" colSpan={6}>No leads assigned.</td></tr>
              ) : leads.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-3 py-2">{l.name || "-"}</td>
                  <td className="px-3 py-2">{l.email || "-"}</td>
                  <td className="px-3 py-2">{l.phone || "-"}</td>
                  <td className="px-3 py-2">{l.status || "-"}</td>
                  <td className="px-3 py-2">{l.priority || "-"}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/sales/leads/${l.id}`} className="rounded-md bg-heading px-3 py-1 text-background hover:bg-hover">View</Link>
                    {canDelete(l) && (
                      <button className="ml-2 rounded-md border border-red-300 bg-red-50 px-3 py-1 text-red-700 hover:bg-red-100" onClick={() => deleteLead(l)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CreateLeadModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreate={async (form) => {
            await createLead(form);
            setShowCreate(false);
          }}
          fieldsConfig={fieldsConfig}
          setFieldsConfig={setFieldsConfig}
        />
      </div>
    </AuthGuard>
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
                        const opts = text.split(",").map((s) => s.trim()).filter(Boolean);
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
                    <select className="rounded-md border border-black/10 px-2 py-2" onChange={(e) => updateCustom(f.key, e.target.value)}>
                      <option value="">Select...</option>
                      {(f.options || []).map((opt) => (
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
              onClick={() => onCreate?.(form)}
            >
              Create Lead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
