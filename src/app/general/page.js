"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase, getUserCached } from "@/lib/supabase";
import Link from "next/link";

export default function GeneralTasksPage() {
  const [tasks, setTasks] = useState([]);
  const [assignedByMe, setAssignedByMe] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [generalProfiles, setGeneralProfiles] = useState([]);
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState("");
  const [taskDocs, setTaskDocs] = useState({});
  const [createForm, setCreateForm] = useState({ title: "", description: "", due_at: "", assignee_id: "" });
  const [createFiles, setCreateFiles] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  const [editForm, setEditForm] = useState({ title: "", description: "", due_at: "", assignee_id: "", status: "open" });
  const [editFiles, setEditFiles] = useState([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const loadAll = useCallback(async () => {
    setError("");
    const u = await getUserCached();
    const uid = u?.id || null;
    setUserId(uid);
    if (!uid) return;
    const { data: ts } = await supabase.from("tasks").select("*").eq("assignee_id", uid).order("created_at", { ascending: false });
    setTasks(ts || []);
    const { data: myAssigned } = await supabase.from("tasks").select("*").eq("created_by", uid).order("created_at", { ascending: false });
    setAssignedByMe(myAssigned || []);
    const { data: profs } = await supabase.from("profiles").select("user_id, display_name, role").order("created_at", { ascending: false });
    setProfiles(profs || []);
    setGeneralProfiles((profs || []).filter((p) => p.role === "general_user"));
    const ids = Array.from(new Set([...(ts || []).map((t) => t.id), ...(myAssigned || []).map((t) => t.id)]));
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
      assignee_id: createForm.assignee_id || userId,
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
    setCreateForm({ title: "", description: "", due_at: "", assignee_id: "" });
    setCreateFiles([]);
    await loadAll();
  };

  const toIsoInputValue = (d) => {
    if (!d) return "";
    const x = d instanceof Date ? d : new Date(d);
    const off = x.getTimezoneOffset();
    return new Date(x.getTime() - off * 60000).toISOString().slice(0, 16);
  };

  const openEdit = (t) => {
    setError("");
    setEditingTask(t);
    setEditFiles([]);
    setEditForm({
      title: t.title || "",
      description: t.description || "",
      due_at: t.due_at ? toIsoInputValue(t.due_at) : "",
      assignee_id: t.assignee_id || "",
      status: t.status || "open",
    });
  };

  const closeEdit = () => {
    setEditingTask(null);
    setEditFiles([]);
  };

  const saveEdit = async () => {
    if (!userId || !editingTask?.id) return;
    if (!editForm.title.trim()) return;
    setError("");
    setSavingEdit(true);
    const payload = {
      title: editForm.title.trim(),
      description: editForm.description?.trim() || null,
      due_at: editForm.due_at || null,
      status: editForm.status || "open",
      assignee_id: editForm.assignee_id || null,
    };
    const { data: updated, error: uErr } = await supabase
      .from("tasks")
      .update(payload)
      .eq("id", editingTask.id)
      .eq("created_by", userId)
      .select("*")
      .single();
    if (uErr) {
      setError(uErr.message || "Failed to update task");
      setSavingEdit(false);
      return;
    }

    if (editFiles.length > 0) {
      const bucket = "project-docs";
      for (const file of editFiles) {
        const path = `tasks/${updated.id}/${Date.now()}_${file.name}`;
        const up = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
        if (up.error) {
          setError(up.error.message || "Failed to upload file");
          continue;
        }
        const pub = supabase.storage.from(bucket).getPublicUrl(path);
        const url = pub?.data?.publicUrl || null;
        if (url) {
          await supabase.from("task_documents").insert({ task_id: updated.id, uploaded_by: userId, filename: file.name, url });
        }
      }
    }

    setSavingEdit(false);
    closeEdit();
    await loadAll();
  };

  const deleteTask = async (t) => {
    if (!userId || !t?.id) return;
    const ok = typeof window !== "undefined" ? window.confirm("Delete this task permanently?") : false;
    if (!ok) return;
    setError("");

    const bucket = "project-docs";
    const docs = taskDocs[t.id] || [];
    const prefix = `/storage/v1/object/public/${bucket}/`;
    const paths = docs
      .map((d) => {
        const url = d?.url || "";
        const idx = url.indexOf(prefix);
        if (idx < 0) return "";
        return url.substring(idx + prefix.length);
      })
      .filter(Boolean);
    if (paths.length) {
      await supabase.storage.from(bucket).remove(paths);
    }
    await supabase.from("task_documents").delete().eq("task_id", t.id);

    const { error: dErr } = await supabase.from("tasks").delete().eq("id", t.id).eq("created_by", userId);
    if (dErr) {
      setError(dErr.message || "Failed to delete task");
      return;
    }
    await loadAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-heading text-2xl font-bold">Tasks</h1>
        <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={loadAll}>Refresh</button>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-heading">Create Task</div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Title" value={createForm.title} onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))} />
          <input type="datetime-local" className="rounded-md border border-black/10 px-2 py-2" value={createForm.due_at} onChange={(e) => setCreateForm((f) => ({ ...f, due_at: e.target.value }))} />
          <select
            className="rounded-md border border-black/10 px-2 py-2"
            value={createForm.assignee_id}
            onChange={(e) => setCreateForm((f) => ({ ...f, assignee_id: e.target.value }))}
          >
            <option value="">Assign to (default: me)</option>
            {generalProfiles.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.display_name || p.user_id}
              </option>
            ))}
          </select>
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

      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-heading">Assigned By Me</div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {assignedByMe.map((t) => {
            const assignee = profiles.find((p) => p.user_id === t.assignee_id);
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
                      {assignee ? ` • Assigned to: ${assignee.display_name || assignee.user_id}` : ""}
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
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    className="rounded-md border border-black/10 px-3 py-1 text-sm hover:bg-black/5"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openEdit(t);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded-md border border-red-300 bg-red-50 px-3 py-1 text-sm text-red-700 hover:bg-red-100"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteTask(t);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </Link>
            );
          })}
          {assignedByMe.length === 0 && <div className="text-sm text-black/60">No tasks assigned by you.</div>}
        </div>
      </div>

      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-semibold text-heading">Edit Task</div>
              <button className="rounded-md border border-black/10 px-3 py-1 hover:bg-black/5" onClick={closeEdit}>
                Close
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="rounded-md border border-black/10 px-2 py-2"
                  placeholder="Title"
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                />
                <select
                  className="rounded-md border border-black/10 px-2 py-2"
                  value={editForm.status}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <input
                  type="datetime-local"
                  className="rounded-md border border-black/10 px-2 py-2"
                  value={editForm.due_at}
                  onChange={(e) => setEditForm((f) => ({ ...f, due_at: e.target.value }))}
                />
                <select
                  className="rounded-md border border-black/10 px-2 py-2"
                  value={editForm.assignee_id || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, assignee_id: e.target.value }))}
                >
                  <option value="">Unassigned</option>
                  {generalProfiles.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.display_name || p.user_id}
                    </option>
                  ))}
                </select>
                <textarea
                  className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
                  rows={3}
                  placeholder="Description"
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                />
                <input
                  className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx"
                  multiple
                  onChange={(e) => setEditFiles(Array.from(e.target.files || []))}
                />
              </div>
              {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
              <div className="flex justify-end gap-2">
                <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={closeEdit} disabled={savingEdit}>
                  Cancel
                </button>
                <button
                  className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50"
                  onClick={saveEdit}
                  disabled={savingEdit || !editForm.title.trim()}
                >
                  {savingEdit ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
