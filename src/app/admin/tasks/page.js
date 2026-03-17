"use client";
import { useEffect, useState, useCallback } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import Link from "next/link";

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", description: "", due_at: "", assignee_id: "" });
  const [createFiles, setCreateFiles] = useState([]);
  const [taskDocs, setTaskDocs] = useState({});

  const fetchAll = useCallback(async () => {
    setError("");
    const { data: t } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
    setTasks(t || []);
    const { data: usersRes } = await supabase.from("profiles").select("user_id, display_name, role").order("created_at", { ascending: false });
    setUsers(usersRes || []);
    const ids = (t || []).map((d) => d.id);
    if (ids.length) {
      const { data: docsRes } = await supabase.from("task_documents").select("*").in("task_id", ids).order("created_at", { ascending: false });
      const grouped = (docsRes || []).reduce((acc, d) => { (acc[d.task_id] ||= []).push(d); return acc; }, {});
      setTaskDocs(grouped);
    } else {
      setTaskDocs({});
    }
  }, []);

  useEffect(() => {
    const run = async () => {
      const u = await getUserCached();
      const uid = u?.id || null;
      setUserId(uid);
      await fetchAll();
    };
    run();
  }, [fetchAll]);

  const createTask = async () => {
    if (!createForm.title) return;
    setError("");
    setCreating(true);
    const due = createForm.due_at ? new Date(createForm.due_at).toISOString() : null;
    const insert = {
      title: createForm.title.trim(),
      description: createForm.description || null,
      due_at: due,
      assignee_id: createForm.assignee_id || null,
      status: "open",
      created_by: userId || null,
    };
    const { data, error: err } = await supabase.from("tasks").insert(insert).select("*").single();
    if (err) {
      setError(err.message || "Failed to create task");
      setCreating(false);
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
          await supabase.from("task_documents").insert({
            task_id: data.id,
            uploaded_by: userId || null,
            filename: file.name,
            url,
          });
        }
      }
    }
    setTasks((prev) => [data, ...prev]);
    setCreateForm({ title: "", description: "", due_at: "", assignee_id: "" });
    setCreateFiles([]);
    setCreating(false);
    await fetchAll();
  };

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-heading text-2xl font-bold">Tasks</h1>
          <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={fetchAll}>Refresh</button>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Create Task</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Title" value={createForm.title} onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))} />
            <input type="datetime-local" className="rounded-md border border-black/10 px-2 py-2" value={createForm.due_at} onChange={(e) => setCreateForm((f) => ({ ...f, due_at: e.target.value }))} />
            <textarea className="md:col-span-2 rounded-md border border-black/10 px-2 py-2" rows={2} placeholder="Description (optional)" value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} />
            <select className="rounded-md border border-black/10 px-2 py-2" value={createForm.assignee_id} onChange={(e) => setCreateForm((f) => ({ ...f, assignee_id: e.target.value }))}>
              <option value="">Assign to (optional)</option>
              {users.map((u) => (<option key={u.user_id} value={u.user_id}>{u.display_name || u.user_id} • {u.role}</option>))}
            </select>
            <input
              className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx"
              multiple
              onChange={(e) => {
                const fs = Array.from(e.target.files || []);
                setCreateFiles(fs);
              }}
            />
          </div>
          {error && <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="mt-2 flex gap-2">
            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={creating || !createForm.title} onClick={createTask}>Create Task</button>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Tasks</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {tasks.map((t) => {
              const assignee = users.find((u) => u.user_id === t.assignee_id);
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
                  href={`/admin/tasks/${t.id}`}
                  className="block rounded-xl border border-black/10 bg-white p-4 shadow-sm hover:bg-black/[0.02]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-heading truncate">{t.title}</div>
                      <div className="mt-1 text-xs text-black/60">
                        {statusLabel} • {dueText}
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
                  <div className="mt-3 text-xs text-black/60 truncate">
                    {assignee ? `Assigned to: ${assignee.display_name || assignee.user_id}` : "Unassigned"}
                  </div>
                </Link>
              );
            })}
            {tasks.length === 0 && <div className="text-sm text-black/60">No tasks yet.</div>}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
