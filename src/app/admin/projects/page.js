"use client";
import { useEffect, useState, useCallback } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import Link from "next/link";

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [leads, setLeads] = useState([]);
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    status: "Active",
    value: "",
    lead_id: "",
    client_name: "",
    client_email: "",
    client_phone: "",
    start_date: "",
    end_date: "",
    location: "",
    budget: "",
    files: [],
  });
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", status: "Active", value: "" });

  const fetchAll = useCallback(async () => {
    setError("");
    const { data: projs } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
    setProjects(projs || []);
    const { data: convertedLeads } = await supabase.from("leads").select("*").eq("status", "Converted").order("created_at", { ascending: false });
    setLeads(convertedLeads || []);
  }, []);

  useEffect(() => {
    const run = async () => {
      const u = await getUserCached();
      const uid = u?.id || null;
      setUserId(uid);
      // fetch profile omitted; label not used on this page
      await fetchAll();
    };
    run();
  }, [fetchAll]);

  const createProject = async () => {
    if (!createForm.name) return;
    setError("");
    setCreating(true);
    const valueNum = createForm.value ? Number(createForm.value) : null;
    const budgetNum = createForm.budget ? Number(createForm.budget) : null;
    const insert = {
      name: createForm.name.trim(),
      status: createForm.status,
      value: valueNum,
      lead_id: createForm.lead_id || null,
      custom: {
        client: {
          name: createForm.client_name || null,
          email: createForm.client_email || null,
          phone: createForm.client_phone || null,
        },
        start_date: createForm.start_date || null,
        end_date: createForm.end_date || null,
        location: createForm.location || null,
        budget: budgetNum,
      },
      created_by: userId || null,
    };
    const { data, error: err } = await supabase.from("projects").insert(insert).select("*").single();
    if (err) {
      setError(err.message || "Failed to create project");
      setCreating(false);
      return;
    }
    setProjects((prev) => [data, ...prev]);
    if (createForm.files && createForm.files.length > 0) {
      const bucket = "project-docs";
      for (const file of createForm.files) {
        const path = `${data.id}/${Date.now()}_${file.name}`;
        const up = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
        if (!up.error) {
          const pub = supabase.storage.from(bucket).getPublicUrl(path);
          const url = pub?.data?.publicUrl || null;
          if (url) {
            await supabase.from("project_documents").insert({
              project_id: data.id,
              uploaded_by: userId || null,
              filename: file.name,
              url,
              doc_type: "other",
            });
          }
        }
      }
    }
    setCreateForm({
      name: "",
      status: "Active",
      value: "",
      lead_id: "",
      client_name: "",
      client_email: "",
      client_phone: "",
      start_date: "",
      end_date: "",
      location: "",
      budget: "",
      files: [],
    });
    setCreating(false);
  };


  const startEdit = (p) => {
    setEditId(p.id);
    setEditForm({ name: p.name || "", status: p.status || "Active", value: p.value != null ? String(p.value) : "" });
  };

  const saveEdit = async () => {
    if (!editId || !editForm.name) return;
    setError("");
    const valueNum = editForm.value ? Number(editForm.value) : null;
    const payload = { name: editForm.name.trim(), status: editForm.status, value: valueNum };
    const { data, error: err } = await supabase.from("projects").update(payload).eq("id", editId).select("*").single();
    if (err) {
      setError(err.message || "Failed to update project");
      return;
    }
    setProjects((prev) => prev.map((p) => (p.id === editId ? data : p)));
    setEditId(null);
    setEditForm({ name: "", status: "Active", value: "" });
  };

  const deleteProject = async (projectId) => {
    setError("");
    const { error: err } = await supabase.from("projects").delete().eq("id", projectId);
    if (err) {
      setError(err.message || "Failed to delete project");
      return;
    }
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
  };

  const changeStatus = async (projectId, status) => {
    setError("");
    const { data, error: err } = await supabase.from("projects").update({ status }).eq("id", projectId).select("*").single();
    if (err) {
      setError(err.message || "Failed to change status");
      return;
    }
    setProjects((prev) => prev.map((p) => (p.id === projectId ? data : p)));
  };


  const totals = {
    total: projects.length,
    active: projects.filter((p) => p.status === "Active").length,
    onhold: projects.filter((p) => p.status === "On Hold").length,
    completed: projects.filter((p) => p.status === "Completed").length,
  };

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-heading text-2xl font-bold">Projects</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">Total Projects</div>
            <div className="text-2xl font-bold">{totals.total}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">Active</div>
            <div className="text-2xl font-bold">{totals.active}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">On Hold</div>
            <div className="text-2xl font-bold">{totals.onhold}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">Completed</div>
            <div className="text-2xl font-bold">{totals.completed}</div>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Create Project (Manual)</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Project Name" value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} />
            <select className="rounded-md border border-black/10 px-2 py-2" value={createForm.status} onChange={(e) => setCreateForm((f) => ({ ...f, status: e.target.value }))}>
              <option>Active</option>
              <option>On Hold</option>
              <option>Completed</option>
            </select>
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Project Value (e.g. 100000)" value={createForm.value} onChange={(e) => setCreateForm((f) => ({ ...f, value: e.target.value }))} />
            <select
              className="rounded-md border border-black/10 px-2 py-2"
              value={createForm.lead_id}
              onChange={(e) => {
                const v = e.target.value;
                const lead = leads.find((l) => l.id === v);
                setCreateForm((f) => ({
                  ...f,
                  lead_id: v,
                  client_name: lead?.name || "",
                  client_email: lead?.email || "",
                  client_phone: lead?.phone || "",
                }));
              }}
            >
              <option value="">Link to Converted Lead (optional)</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {(l.custom?.assignee_label ? l.custom.assignee_label + " • " : "") + (l.name || l.email || l.phone || l.id)}
                </option>
              ))}
            </select>
            <div className="md:col-span-2 text-sm font-semibold text-heading">Client Details</div>
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Client Name" value={createForm.client_name} onChange={(e) => setCreateForm((f) => ({ ...f, client_name: e.target.value }))} />
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Client Email" value={createForm.client_email} onChange={(e) => setCreateForm((f) => ({ ...f, client_email: e.target.value }))} />
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Client Phone" value={createForm.client_phone} onChange={(e) => setCreateForm((f) => ({ ...f, client_phone: e.target.value }))} />
            <div className="md:col-span-2 text-sm font-semibold text-heading">Project Details</div>
            <input type="date" className="rounded-md border border-black/10 px-2 py-2" placeholder="Start Date" value={createForm.start_date} onChange={(e) => setCreateForm((f) => ({ ...f, start_date: e.target.value }))} />
            <input type="date" className="rounded-md border border-black/10 px-2 py-2" placeholder="End Date" value={createForm.end_date} onChange={(e) => setCreateForm((f) => ({ ...f, end_date: e.target.value }))} />
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Project Location" value={createForm.location} onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))} />
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Project Budget" value={createForm.budget} onChange={(e) => setCreateForm((f) => ({ ...f, budget: e.target.value }))} />
            <input
              className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                setCreateForm((f) => ({ ...f, files }));
              }}
            />
          </div>
          {error && <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="mt-2 flex gap-2">
            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={creating || !createForm.name} onClick={createProject}>
              Create Project
            </button>
          </div>
        </div>


        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Projects</div>
          <div className="mt-3 space-y-2">
            {projects.map((p) => (
              <div key={p.id} className="rounded-md border border-black/10 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    {editId === p.id ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Project Name" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                        <select className="rounded-md border border-black/10 px-2 py-2" value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}>
                          <option>Active</option>
                          <option>On Hold</option>
                          <option>Completed</option>
                        </select>
                        <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Project Value" value={editForm.value} onChange={(e) => setEditForm((f) => ({ ...f, value: e.target.value }))} />
                        <div className="md:col-span-2 flex items-center gap-2">
                          <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover" onClick={saveEdit}>Save</button>
                          <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={() => { setEditId(null); setEditForm({ name: "", status: "Active", value: "" }); }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Link href={`/admin/projects/${p.id}`} className="text-sm font-semibold hover:underline">{p.name}</Link>
                        <div className="text-xs text-black/60">
                          {p.status} {p.value != null ? `• Value: ${p.value}` : ""} {p.custom?.location ? `• Location: ${p.custom.location}` : ""} {p.custom?.client?.name ? `• Client: ${p.custom.client.name}` : ""}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <select className="rounded-md border border-black/10 px-2 py-2 text-sm" value={p.status} onChange={(e) => changeStatus(p.id, e.target.value)}>
                      <option>Active</option>
                      <option>On Hold</option>
                      <option>Completed</option>
                    </select>
                    <Link href={`/admin/projects/${p.id}`} className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" aria-label="View Project">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M2.25 12c0 0 3.75-7.5 9.75-7.5s9.75 7.5 9.75 7.5-3.75 7.5-9.75 7.5S2.25 12 2.25 12z" />
                        <circle cx="12" cy="12" r="3.75" strokeWidth="1.5" />
                      </svg>
                    </Link>
                    <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => startEdit(p)}>Edit</button>
                    <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => deleteProject(p.id)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
            {projects.length === 0 && <div className="text-sm text-black/60">No projects yet.</div>}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
