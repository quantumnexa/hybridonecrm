"use client";
import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState(null);
  const [docs, setDocs] = useState([]);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    const run = async () => {
      if (!id) return;
      setError("");
      const u = await getUserCached();
      const uid = u?.id || null;
      setUserId(uid);
      const { data } = await supabase.from("projects").select("*").eq("id", id).single();
      setProject(data || null);
      const { data: docRes } = await supabase.from("project_documents").select("*").eq("project_id", id).order("created_at", { ascending: false });
      setDocs(docRes || []);
    };
    run();
  }, [id]);

  const startEdit = () => {
    if (!project) return;
    setEditMode(true);
    setForm({
      name: project.name || "",
      status: project.status || "Active",
      value: project.value != null ? String(project.value) : "",
      client_name: project.custom?.client?.name || "",
      client_email: project.custom?.client?.email || "",
      client_phone: project.custom?.client?.phone || "",
      start_date: project.custom?.start_date || "",
      end_date: project.custom?.end_date || "",
      location: project.custom?.location || "",
      budget: project.custom?.budget != null ? String(project.custom?.budget) : "",
    });
  };

  const saveEdit = async () => {
    if (!form || !project) return;
    setError("");
    const valueNum = form.value ? Number(form.value) : null;
    const budgetNum = form.budget ? Number(form.budget) : null;
    const payload = {
      name: form.name.trim(),
      status: form.status,
      value: valueNum,
      custom: {
        client: {
          name: form.client_name || null,
          email: form.client_email || null,
          phone: form.client_phone || null,
        },
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        location: form.location || null,
        budget: budgetNum,
      },
    };
    const { data, error: err } = await supabase.from("projects").update(payload).eq("id", project.id).select("*").single();
    if (err) {
      setError(err.message || "Failed to update project");
      return;
    }
    setProject(data);
    setEditMode(false);
    setForm(null);
  };

  const uploadDocs = async () => {
    if (!project || files.length === 0) return;
    setError("");
    setUploading(true);
    const bucket = "project-docs";
    for (const file of files) {
      const path = `${project.id}/${Date.now()}_${file.name}`;
      const up = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
      if (up.error) {
        setError(up.error.message || "Failed to upload file");
        continue;
      }
      const pub = supabase.storage.from(bucket).getPublicUrl(path);
      const url = pub?.data?.publicUrl || null;
      if (url) {
        const { data: ins, error: insErr } = await supabase
          .from("project_documents")
          .insert({
            project_id: project.id,
            uploaded_by: userId || null,
            filename: file.name,
            url,
            doc_type: "other",
          })
          .select("*")
          .single();
        if (!insErr && ins) {
          setDocs((prev) => [ins, ...prev]);
        }
      }
    }
    setFiles([]);
    setUploading(false);
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
    const { error: delErr } = await supabase.from("project_documents").delete().eq("id", doc.id);
    if (delErr) {
      setError(delErr.message || "Failed to delete document");
      return;
    }
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
  };

  const deleteProject = async () => {
    if (!project) return;
    setError("");
    const { error: err } = await supabase.from("projects").delete().eq("id", project.id);
    if (err) {
      setError(err.message || "Failed to delete project");
      return;
    }
    router.push("/admin/projects");
  };

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin/projects" className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5">Back</Link>
            <h1 className="text-heading text-2xl font-bold">Project Detail</h1>
          </div>
        </div>
        {!project ? (
          <div className="rounded-xl border border-black/10 bg-white p-6">Loading...</div>
        ) : (
          <>
            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              {!editMode ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-black/60">Name</div>
                    <div className="font-semibold">{project.name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">Status</div>
                    <div className="font-semibold">{project.status}</div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">Value</div>
                    <div className="font-semibold">{project.value != null ? project.value : "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">Location</div>
                    <div className="font-semibold">{project.custom?.location || "-"}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-black/60">Client</div>
                    <div className="font-semibold">{project.custom?.client?.name || "-"}</div>
                    <div className="text-sm">{project.custom?.client?.email || "-"}</div>
                    <div className="text-sm">{project.custom?.client?.phone || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">Start Date</div>
                    <div className="font-semibold">{project.custom?.start_date || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">End Date</div>
                    <div className="font-semibold">{project.custom?.end_date || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">Budget</div>
                    <div className="font-semibold">{project.custom?.budget != null ? project.custom?.budget : "-"}</div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Project Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                  <select className="rounded-md border border-black/10 px-2 py-2" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                    <option>Active</option>
                    <option>On Hold</option>
                    <option>Completed</option>
                  </select>
                  <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Project Value" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
                  <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Client Name" value={form.client_name} onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))} />
                  <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Client Email" value={form.client_email} onChange={(e) => setForm((f) => ({ ...f, client_email: e.target.value }))} />
                  <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Client Phone" value={form.client_phone} onChange={(e) => setForm((f) => ({ ...f, client_phone: e.target.value }))} />
                  <input type="date" className="rounded-md border border-black/10 px-2 py-2" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
                  <input type="date" className="rounded-md border border-black/10 px-2 py-2" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
                  <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Project Location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
                  <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Project Budget" value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} />
                  <div className="md:col-span-2 flex items-center gap-2">
                    <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover" onClick={saveEdit}>Save</button>
                    <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={() => { setEditMode(false); setForm(null); }}>Cancel</button>
                  </div>
                </div>
              )}
              {!editMode && (
                <div className="mt-3 flex items-center gap-2">
                  <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover" onClick={startEdit}>Edit Project</button>
                  <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={deleteProject}>Delete Project</button>
                </div>
              )}
              {error && <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            </div>
            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-heading">Documents</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  multiple
                  onChange={(e) => {
                    const fs = Array.from(e.target.files || []);
                    setFiles(fs);
                  }}
                />
              </div>
              <div className="mt-2 flex gap-2">
                <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={uploading || files.length === 0} onClick={uploadDocs}>
                  Upload
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {docs.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-md border border-black/10 px-3 py-2">
                    <div className="text-sm">
                      <a href={d.url} target="_blank" rel="noreferrer" className="hover:underline">{d.filename}</a>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => deleteDoc(d)}>Delete</button>
                    </div>
                  </div>
                ))}
                {docs.length === 0 && <div className="text-sm text-black/60">No documents yet.</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </AuthGuard>
  );
}
