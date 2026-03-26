"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase, getUserCached } from "@/lib/supabase";
import Link from "next/link";
import { formatLocalDateTime12 } from "@/lib/timeFormat";
import ClockWidget from "@/components/ClockWidget";

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function weekStart(d) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

function boundsForPreset(p) {
  const now = new Date();
  if (p === "today") {
    const from = startOfDay(now);
    const to = addDays(from, 1);
    return { from, to };
  }
  if (p === "yesterday") {
    const to = startOfDay(now);
    const from = addDays(to, -1);
    return { from, to };
  }
  if (p === "this_week") {
    const from = weekStart(now);
    const to = addDays(from, 7);
    return { from, to };
  }
  if (p === "last_week") {
    const to = weekStart(now);
    const from = addDays(to, -7);
    return { from, to };
  }
  if (p === "custom") return null;
  return null;
}

function toIsoInputValue(d) {
  if (!d) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

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
  const [preset, setPreset] = useState("this_week");
  const [customFrom, setCustomFrom] = useState(() => {
    const b = boundsForPreset("this_week");
    return b ? toIsoInputValue(b.from) : "";
  });
  const [customTo, setCustomTo] = useState(() => {
    const b = boundsForPreset("this_week");
    return b ? toIsoInputValue(b.to) : "";
  });
  const [bounds, setBounds] = useState(() => {
    const b = boundsForPreset("this_week");
    return b ? { from: b.from.toISOString(), to: b.to.toISOString() } : { from: "", to: "" };
  });
  const [query, setQuery] = useState("");

  const loadAll = useCallback(async () => {
    setError("");
    const u = await getUserCached();
    const uid = u?.id || null;
    setUserId(uid);
    if (!uid) return;
    let myQ = supabase.from("tasks").select("*").eq("assignee_id", uid);
    if (bounds.from && bounds.to) myQ = myQ.gte("due_at", bounds.from).lt("due_at", bounds.to);
    const { data: ts } = await myQ.order("created_at", { ascending: false });
    setTasks(ts || []);
    let byMeQ = supabase.from("tasks").select("*").eq("created_by", uid);
    if (bounds.from && bounds.to) byMeQ = byMeQ.gte("due_at", bounds.from).lt("due_at", bounds.to);
    const { data: myAssigned } = await byMeQ.order("created_at", { ascending: false });
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
  }, [bounds.from, bounds.to]);

  useEffect(() => {
    const init = async () => {
      await loadAll();
    };
    init();
  }, [loadAll]);

  const changePreset = (p) => {
    setPreset(p);
    if (p === "custom") return;
    const b = boundsForPreset(p);
    if (!b) return;
    setCustomFrom(toIsoInputValue(b.from));
    setCustomTo(toIsoInputValue(b.to));
    setBounds({ from: b.from.toISOString(), to: b.to.toISOString() });
  };

  const applyCustom = () => {
    if (!customFrom || !customTo) return;
    const from = new Date(customFrom);
    const to = new Date(customTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return;
    if (to <= from) return;
    setBounds({ from: from.toISOString(), to: to.toISOString() });
  };

  const profileMap = useMemo(() => {
    const map = {};
    (profiles || []).forEach((p) => {
      map[p.user_id] = p.display_name || p.user_id;
    });
    return map;
  }, [profiles]);

  const filteredAssignedToMe = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return tasks;
    return (tasks || []).filter((t) => {
      const title = String(t.title || "").toLowerCase();
      const desc = String(t.description || "").toLowerCase();
      const assigner = String(profileMap[t.created_by] || "").toLowerCase();
      return title.includes(q) || desc.includes(q) || assigner.includes(q);
    });
  }, [tasks, query, profileMap]);

  const filteredAssignedByMe = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return assignedByMe;
    return (assignedByMe || []).filter((t) => {
      const title = String(t.title || "").toLowerCase();
      const desc = String(t.description || "").toLowerCase();
      const assignee = String(profileMap[t.assignee_id] || "").toLowerCase();
      return title.includes(q) || desc.includes(q) || assignee.includes(q);
    });
  }, [assignedByMe, query, profileMap]);

  const createTask = async () => {
    if (!userId || !createForm.title.trim()) return;
    setError("");
    const due = createForm.due_at ? new Date(createForm.due_at).toISOString() : null;
    const payload = {
      title: createForm.title.trim(),
      description: createForm.description?.trim() || null,
      due_at: due,
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
    const due = editForm.due_at ? new Date(editForm.due_at).toISOString() : null;
    const payload = {
      title: editForm.title.trim(),
      description: editForm.description?.trim() || null,
      due_at: due,
      status: editForm.status || "open",
      assignee_id: editForm.assignee_id || null,
      updated_at: new Date().toISOString(),
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
      <ClockWidget />
      <div className="flex items-center justify-between">
        <h1 className="text-heading text-2xl font-bold">Tasks</h1>
        <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={loadAll}>Refresh</button>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: "today", label: "Today" },
              { key: "yesterday", label: "Yesterday" },
              { key: "this_week", label: "This Week" },
              { key: "last_week", label: "Last Week" },
              { key: "custom", label: "Custom" },
            ].map((i) => (
              <button
                key={i.key}
                className={
                  "rounded-md border px-3 py-2 text-sm " +
                  (preset === i.key
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-black/10 bg-white text-black/70 hover:bg-black/5")
                }
                onClick={() => changePreset(i.key)}
              >
                {i.label}
              </button>
            ))}
            {preset === "custom" && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="datetime-local"
                  className="rounded-md border border-black/10 px-2 py-2 text-sm"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
                <span className="text-sm text-black/60">to</span>
                <input
                  type="datetime-local"
                  className="rounded-md border border-black/10 px-2 py-2 text-sm"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
                <button
                  className="rounded-md bg-heading px-3 py-2 text-sm text-background hover:bg-hover disabled:opacity-50"
                  disabled={!customFrom || !customTo}
                  onClick={applyCustom}
                >
                  Apply
                </button>
              </div>
            )}
          </div>
          <input
            className="rounded-md border border-black/10 px-3 py-2 text-sm"
            placeholder="Search by user name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="mt-2 text-xs text-black/60">
          Filter by deadline • {bounds.from ? bounds.from.slice(0, 10) : "-"} → {bounds.to ? bounds.to.slice(0, 10) : "-"}
        </div>
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
          {filteredAssignedToMe.map((t) => {
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
            const dueText = t.due_at ? formatLocalDateTime12(t.due_at) : "No deadline";
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
          {filteredAssignedToMe.length === 0 && <div className="text-sm text-black/60">No tasks assigned.</div>}
        </div>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-heading">Assigned By Me</div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredAssignedByMe.map((t) => {
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
            const dueText = t.due_at ? formatLocalDateTime12(t.due_at) : "No deadline";
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
          {filteredAssignedByMe.length === 0 && <div className="text-sm text-black/60">No tasks assigned by you.</div>}
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
