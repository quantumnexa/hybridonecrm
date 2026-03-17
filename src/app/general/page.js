"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase, getUserCached } from "@/lib/supabase";
import Link from "next/link";

export default function GeneralTasksPage() {
  const [tasks, setTasks] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState("");
  const [taskDocs, setTaskDocs] = useState({});
  const [createForm, setCreateForm] = useState({ title: "", description: "", due_at: "" });
  const [createFiles, setCreateFiles] = useState([]);

  const loadAll = useCallback(async () => {
    setError("");
    const u = await getUserCached();
    const uid = u?.id || null;
    setUserId(uid);
    if (!uid) return;
    const { data: ts } = await supabase.from("tasks").select("*").eq("assignee_id", uid).order("created_at", { ascending: false });
    setTasks(ts || []);
    const { data: profs } = await supabase.from("profiles").select("user_id, display_name, role").order("created_at", { ascending: false });
    setProfiles(profs || []);
    const ids = (ts || []).map((t) => t.id);
    if (ids.length) {
      const { data: docsRes } = await supabase.from("task_documents").select("*").in("task_id", ids).order("created_at", { ascending: false });
      const grouped = (docsRes || []).reduce((acc, d) => { (acc[d.task_id] ||= []).push(d); return acc; }, {});
      setTaskDocs(grouped);
    } else {
      setTaskDocs({});
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await loadAll();
    };
    init();
  }, [loadAll]);

  const createTask = async () => {
    if (!userId || !createForm.title.trim()) return;
    setError("");
    const payload = {
      title: createForm.title.trim(),
      description: createForm.description?.trim() || null,
      due_at: createForm.due_at || null,
      status: "open",
      assignee_id: userId,
      created_by: userId,
    };
    const { data, error: err } = await supabase.from("tasks").insert(payload).select("*").single();
    if (err) {
      setError(err.message || "Failed to create task");
      return;
    }
    if (createFiles.length > 0) {
      const bucket = "project-docs";
      for (const file of createFiles) {
        const path = `tasks/${data.id}/${Date.now()}_${file.name}`;
        const up = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
        if (up.error) {
          setError(up.error.message || "Failed to upload file");
          continue;
        }
        const pub = supabase.storage.from(bucket).getPublicUrl(path);
        const url = pub?.data?.publicUrl || null;
        if (url) {
          await supabase.from("task_documents").insert({ task_id: data.id, uploaded_by: userId, filename: file.name, url });
        }
      }
    }
    setCreateForm({ title: "", description: "", due_at: "" });
    setCreateFiles([]);
    await loadAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-heading text-2xl font-bold">Tasks</h1>
        <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={loadAll}>Refresh</button>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-heading">Create My Task</div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Title" value={createForm.title} onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))} />
          <input type="datetime-local" className="rounded-md border border-black/10 px-2 py-2" value={createForm.due_at} onChange={(e) => setCreateForm((f) => ({ ...f, due_at: e.target.value }))} />
          <textarea className="md:col-span-2 rounded-md border border-black/10 px-2 py-2" rows={2} placeholder="Description (optional)" value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} />
          <input className="md:col-span-2 rounded-md border border-black/10 px-2 py-2" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx" multiple onChange={(e) => setCreateFiles(Array.from(e.target.files || []))} />
        </div>
        {error && <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="mt-2">
          <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={!createForm.title.trim()} onClick={createTask}>Create Task</button>
        </div>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-heading">Assigned To Me</div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {tasks.map((t) => {
            const assigner = profiles.find((p) => p.user_id === t.created_by);
            const attachmentsCount = (taskDocs[t.id] || []).length;
            const statusLabel =
              t.status === "in_progress"
                ? "In Progress"
                : t.status === "completed"
                  ? "Completed"
                  : t.status === "cancelled"
                    ? "Cancelled"
                    : "Open";
            const dueText = t.due_at ? new Date(t.due_at).toLocaleString() : "No deadline";
            return (
              <Link
                key={t.id}
                href={`/general/tasks/${t.id}`}
                className="block rounded-xl border border-black/10 bg-white p-4 shadow-sm hover:bg-black/[0.02]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-heading truncate">{t.title}</div>
                    <div className="mt-1 text-xs text-black/60">
                      {statusLabel} • {dueText}
                      {assigner ? ` • Assigned by: ${assigner.display_name || assigner.user_id}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 rounded-md border border-black/10 px-2 py-1 text-xs text-black/70">
                    {attachmentsCount} files
                  </div>
                </div>
                <div className="mt-3 text-sm text-black/80">
                  {(t.description || "").trim() ? (
                    <div className="line-clamp-3">{t.description}</div>
                  ) : (
                    <div className="text-black/60">No description.</div>
                  )}
                </div>
              </Link>
            );
          })}
          {tasks.length === 0 && <div className="text-sm text-black/60">No tasks assigned.</div>}
        </div>
      </div>
    </div>
  );
}
