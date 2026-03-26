"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached, logActivity, notifyAdmins, notifyUser, taskUrlForUser } from "@/lib/supabase";
import Link from "next/link";

export default function AdminTaskDetailPage() {
  const { id } = useParams();
  const router = useRouter();

  const [task, setTask] = useState(null);
  const [docs, setDocs] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [revisionTasks, setRevisionTasks] = useState([]);
  const [revisionTaskDocsCount, setRevisionTaskDocsCount] = useState({});
  const [users, setUsers] = useState([]);
  const [profileMap, setProfileMap] = useState({});
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({ title: "", description: "", due_at: "", assignee_id: "", status: "open" });

  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [revisionForm, setRevisionForm] = useState({ title: "", description: "", due_at: "" });
  const [revisionFiles, setRevisionFiles] = useState([]);
  const [savingRevision, setSavingRevision] = useState(false);

  const loadAll = useCallback(async () => {
    if (!id) return;
    setError("");
    setLoading(true);
    const u = await getUserCached();
    const uid = u?.id || null;
    setUserId(uid);

    const { data: t, error: tErr } = await supabase.from("tasks").select("*").eq("id", id).single();
    if (tErr) {
      setError(tErr.message || "Failed to load task");
      setTask(null);
      setDocs([]);
      setUpdates([]);
      setProfileMap({});
      setLoading(false);
      return;
    }
    setTask(t || null);

    const { data: d } = await supabase
      .from("task_documents")
      .select("*")
      .eq("task_id", id)
      .order("created_at", { ascending: false });
    setDocs(d || []);

    const { data: uRes } = await supabase
      .from("task_updates")
      .select("*")
      .eq("task_id", id)
      .order("created_at", { ascending: false });
    setUpdates(uRes || []);

    const { data: revTasks } = await supabase
      .from("tasks")
      .select("id,title,description,due_at,status,assignee_id,created_by,created_at,parent_task_id")
      .eq("parent_task_id", id)
      .order("created_at", { ascending: false });
    setRevisionTasks(revTasks || []);
    const revTaskIds = (revTasks || []).map((x) => x.id);
    if (revTaskIds.length) {
      const { data: revTaskDocs } = await supabase.from("task_documents").select("id,task_id").in("task_id", revTaskIds);
      const counts = (revTaskDocs || []).reduce((acc, d2) => {
        acc[d2.task_id] = (acc[d2.task_id] || 0) + 1;
        return acc;
      }, {});
      setRevisionTaskDocsCount(counts);
    } else {
      setRevisionTaskDocsCount({});
    }

    const { data: usersRes } = await supabase
      .from("profiles")
      .select("user_id, display_name, role")
      .order("created_at", { ascending: false });
    setUsers(usersRes || []);
    const map = {};
    (usersRes || []).forEach((p) => {
      map[p.user_id] = p.display_name || "Unknown";
    });
    setProfileMap(map);

    setLoading(false);
  }, [id]);

  useEffect(() => {
    const init = async () => {
      await loadAll();
    };
    init();
  }, [loadAll]);

  const usersForAssign = useMemo(() => {
    return (users || []).map((u) => ({
      user_id: u.user_id,
      display_name: u.display_name || u.user_id,
    }));
  }, [users]);

  const startEdit = () => {
    if (!task) return;
    const dstr = task.due_at ? new Date(task.due_at) : null;
    const off = dstr ? dstr.getTimezoneOffset() : 0;
    const localStr = dstr ? new Date(dstr.getTime() - off * 60000).toISOString().slice(0, 16) : "";
    setEditForm({
      title: task.title || "",
      description: task.description || "",
      due_at: localStr,
      assignee_id: task.assignee_id || "",
      status: task.status || "open",
    });
    setEditMode(true);
  };

  const saveEdit = async () => {
    if (!id || !editForm.title.trim()) return;
    setError("");
    setSaving(true);
    const due = editForm.due_at ? new Date(editForm.due_at).toISOString() : null;
    const payload = {
      title: editForm.title.trim(),
      description: editForm.description?.trim() ? editForm.description.trim() : null,
      due_at: due,
      assignee_id: editForm.assignee_id || null,
      status: editForm.status || "open",
      updated_at: new Date().toISOString(),
    };
    const { data, error: err } = await supabase.from("tasks").update(payload).eq("id", id).select("*").single();
    if (err) {
      setError(err.message || "Failed to update task");
      setSaving(false);
      return;
    }
    await logActivity({
      actorId: userId || null,
      action: "task_updated",
      entityType: "task",
      entityId: id,
      meta: { title: data?.title || null, status: data?.status || null, due_at: data?.due_at || null, assignee_id: data?.assignee_id || null },
    });
    await notifyAdmins({
      actorId: userId || null,
      type: "activity",
      title: "Task updated",
      message: data?.title || "",
      entityType: "task",
      entityId: id,
      url: `/admin/tasks/${id}`,
    });
    if (task?.assignee_id !== data?.assignee_id && data?.assignee_id) {
      const assigneeUrl = await taskUrlForUser(id, data.assignee_id);
      await notifyUser({
        userId: data.assignee_id,
        actorId: userId || null,
        type: "task_assigned",
        title: "Task assigned to you",
        message: data.title,
        entityType: "task",
        entityId: id,
        url: assigneeUrl,
      });
    }
    setTask(data || null);
    setEditMode(false);
    setSaving(false);
  };

  const deleteTask = async () => {
    if (!id) return;
    const ok = typeof window !== "undefined" ? window.confirm("Delete this task?") : false;
    if (!ok) return;
    setError("");
    const { error: err } = await supabase.from("tasks").delete().eq("id", id);
    if (err) {
      setError(err.message || "Failed to delete task");
      return;
    }
    await logActivity({ actorId: userId || null, action: "task_deleted", entityType: "task", entityId: id, meta: { title: task?.title || null } });
    await notifyAdmins({ actorId: userId || null, type: "activity", title: "Task deleted", message: task?.title || "", entityType: "task", entityId: id, url: "/admin/tasks" });
    router.push("/admin/tasks");
  };

  const uploadDocFiles = async () => {
    if (!id || uploadFiles.length === 0) return;
    setError("");
    setUploading(true);
    const bucket = "project-docs";
    let uploadedCount = 0;
    for (const file of uploadFiles) {
      const path = `tasks/${id}/${Date.now()}_${file.name}`;
      const up = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
      if (up.error) {
        setError(up.error.message || "Failed to upload file");
        continue;
      }
      const pub = supabase.storage.from(bucket).getPublicUrl(path);
      const url = pub?.data?.publicUrl || null;
      if (url) {
        const { data: ins, error: insErr } = await supabase
          .from("task_documents")
          .insert({ task_id: id, uploaded_by: userId || null, filename: file.name, url })
          .select("*")
          .single();
        if (!insErr && ins) {
          uploadedCount += 1;
          setDocs((prev) => [ins, ...prev]);
        }
      }
    }
    setUploadFiles([]);
    setUploading(false);
    if (uploadedCount > 0) {
      await logActivity({ actorId: userId || null, action: "task_documents_uploaded", entityType: "task", entityId: id, meta: { count: uploadedCount } });
      await notifyAdmins({ actorId: userId || null, type: "activity", title: "Task attachments uploaded", message: task?.title || "", entityType: "task", entityId: id, url: `/admin/tasks/${id}` });
    }
  };

  const renameDoc = async (doc) => {
    const newName = typeof window !== "undefined" ? window.prompt("New filename", doc.filename) : null;
    if (!newName || newName.trim() === "" || newName === doc.filename) return;
    setError("");
    const { data, error: err } = await supabase
      .from("task_documents")
      .update({ filename: newName.trim() })
      .eq("id", doc.id)
      .select("*")
      .single();
    if (err) {
      setError(err.message || "Failed to rename document");
      return;
    }
    await logActivity({ actorId: userId || null, action: "task_document_renamed", entityType: "task_document", entityId: doc.id, meta: { filename: newName.trim() } });
    await notifyAdmins({ actorId: userId || null, type: "activity", title: "Task attachment renamed", message: newName.trim(), entityType: "task_document", entityId: doc.id, url: `/admin/tasks/${id}` });
    if (data) setDocs((prev) => prev.map((d) => (d.id === doc.id ? data : d)));
  };

  const deleteDoc = async (doc) => {
    setError("");
    const bucket = "project-docs";
    const prefix = `/storage/v1/object/public/${bucket}/`;
    const idx = (doc.url || "").indexOf(prefix);
    const path = idx >= 0 ? (doc.url || "").substring(idx + prefix.length) : "";
    if (path) await supabase.storage.from(bucket).remove([path]);
    const { error: delErr } = await supabase.from("task_documents").delete().eq("id", doc.id);
    if (delErr) {
      setError(delErr.message || "Failed to delete document");
      return;
    }
    await logActivity({ actorId: userId || null, action: "task_document_deleted", entityType: "task_document", entityId: doc.id, meta: { filename: doc.filename || null } });
    await notifyAdmins({ actorId: userId || null, type: "activity", title: "Task attachment deleted", message: doc.filename || "", entityType: "task_document", entityId: doc.id, url: `/admin/tasks/${id}` });
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
  };

  const createRevision = async () => {
    if (!id || !userId || !task || !revisionForm.title.trim()) return;
    setError("");
    setSavingRevision(true);
    const due = revisionForm.due_at ? new Date(revisionForm.due_at).toISOString() : null;
    const payload = {
      org_id: task.org_id || null,
      parent_task_id: id,
      title: revisionForm.title.trim(),
      description: revisionForm.description?.trim() ? revisionForm.description.trim() : null,
      due_at: due,
      status: "open",
      assignee_id: task.assignee_id || null,
      created_by: userId,
    };
    const { data: rev, error: rErr } = await supabase.from("tasks").insert(payload).select("*").single();
    if (rErr) {
      setError(rErr.message || "Failed to create revision");
      setSavingRevision(false);
      return;
    }
    await logActivity({
      actorId: userId || null,
      action: "task_revision_created",
      entityType: "task",
      entityId: rev?.id || null,
      meta: { parent_task_id: id, title: rev?.title || null, due_at: rev?.due_at || null },
    });
    await notifyAdmins({
      actorId: userId || null,
      type: "activity",
      title: "Task revision created",
      message: rev?.title || "",
      entityType: "task",
      entityId: rev?.id || null,
      url: `/admin/tasks/${id}`,
    });
    if (rev?.assignee_id) {
      const assigneeUrl = await taskUrlForUser(rev.id, rev.assignee_id);
      await notifyUser({
        userId: rev.assignee_id,
        actorId: userId || null,
        type: "task_assigned",
        title: "New revision task assigned",
        message: rev.title,
        entityType: "task",
        entityId: rev.id,
        url: assigneeUrl,
      });
    }

    if (rev?.id && revisionFiles.length) {
      const bucket = "project-docs";
      for (const file of revisionFiles) {
        const path = `tasks/${rev.id}/${Date.now()}_${file.name}`;
        const up = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
        if (up.error) {
          setError(up.error.message || "Failed to upload file");
          continue;
        }
        const pub = supabase.storage.from(bucket).getPublicUrl(path);
        const url = pub?.data?.publicUrl || null;
        if (url) {
          await supabase.from("task_documents").insert({ task_id: rev.id, uploaded_by: userId, filename: file.name, url });
        }
      }
    }

    await supabase.from("tasks").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", id);
    await supabase.from("task_updates").insert({
      task_id: id,
      author_id: userId,
      state: "completed",
      note: `Revision created: ${rev.title}`,
    });
    await logActivity({
      actorId: userId || null,
      action: "task_completed_by_revision",
      entityType: "task",
      entityId: id,
      meta: { revision_task_id: rev?.id || null },
    });
    await notifyAdmins({
      actorId: userId || null,
      type: "activity",
      title: "Task completed (revision created)",
      message: task?.title || "",
      entityType: "task",
      entityId: id,
      url: `/admin/tasks/${id}`,
    });

    setRevisionForm({ title: "", description: "", due_at: "" });
    setRevisionFiles([]);
    setSavingRevision(false);
    await loadAll();
  };

  const statusLabel =
    task?.status === "in_progress"
      ? "In Progress"
      : task?.status === "completed"
        ? "Completed"
        : task?.status === "cancelled"
          ? "Cancelled"
          : "Open";

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin/tasks" className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5">
              Back
            </Link>
            <div>
              <div className="text-heading text-2xl font-bold">Task Detail</div>
              {task && <div className="text-xs text-black/60">{statusLabel}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={loadAll}>
              Refresh
            </button>
            {!editMode ? (
              <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={!task} onClick={startEdit}>
                Edit
              </button>
            ) : (
              <>
                <button
                  className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50"
                  disabled={saving || !editForm.title.trim()}
                  onClick={saveEdit}
                >
                  Save
                </button>
                <button
                  className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5 disabled:opacity-50"
                  disabled={saving}
                  onClick={() => setEditMode(false)}
                >
                  Cancel
                </button>
              </>
            )}
            <button className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-700 hover:bg-red-100 disabled:opacity-50" disabled={!task} onClick={deleteTask}>
              Delete
            </button>
          </div>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {loading ? (
          <div className="rounded-xl border border-black/10 bg-white p-6">Loading...</div>
        ) : !task ? (
          <div className="rounded-xl border border-black/10 bg-white p-6">Task not found.</div>
        ) : (
          <>
            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-heading">Task</div>
              {!editMode ? (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-black/60">Title</div>
                    <div className="font-semibold">{task.title}</div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">Status</div>
                    <div className="font-semibold">{statusLabel}</div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">Due</div>
                    <div className="font-semibold">{task.due_at ? new Date(task.due_at).toLocaleString() : "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">Parent Task</div>
                    <div className="font-semibold">
                      {task.parent_task_id ? (
                        <Link href={`/admin/tasks/${task.parent_task_id}`} className="hover:underline">
                          {task.parent_task_id}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">Assignee</div>
                    <div className="font-semibold">{task.assignee_id ? profileMap[task.assignee_id] || "Unknown" : "Unassigned"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">Created By</div>
                    <div className="font-semibold">{task.created_by ? profileMap[task.created_by] || "Unknown" : "Unknown"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">Created At</div>
                    <div className="font-semibold">{task.created_at ? new Date(task.created_at).toLocaleString() : "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-black/60">Updated At</div>
                    <div className="font-semibold">{task.updated_at ? new Date(task.updated_at).toLocaleString() : "-"}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-black/60">Description</div>
                    <div className="mt-1 whitespace-pre-wrap text-sm">{task.description || "-"}</div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
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
                    value={editForm.assignee_id}
                    onChange={(e) => setEditForm((f) => ({ ...f, assignee_id: e.target.value }))}
                  >
                    <option value="">Unassigned</option>
                    {usersForAssign.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.display_name}
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
                </div>
              )}
            </div>

            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-heading">Revisions</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="rounded-md border border-black/10 px-2 py-2"
                  placeholder="Revision title"
                  value={revisionForm.title}
                  onChange={(e) => setRevisionForm((f) => ({ ...f, title: e.target.value }))}
                />
                <input
                  type="datetime-local"
                  className="rounded-md border border-black/10 px-2 py-2"
                  value={revisionForm.due_at}
                  onChange={(e) => setRevisionForm((f) => ({ ...f, due_at: e.target.value }))}
                />
                <textarea
                  className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
                  rows={3}
                  placeholder="Revision details"
                  value={revisionForm.description}
                  onChange={(e) => setRevisionForm((f) => ({ ...f, description: e.target.value }))}
                />
                <input
                  className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx"
                  multiple
                  onChange={(e) => setRevisionFiles(Array.from(e.target.files || []))}
                />
              </div>
              <div className="mt-2">
                <button
                  className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50"
                  disabled={savingRevision || !revisionForm.title.trim()}
                  onClick={createRevision}
                >
                  Add Revision
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {revisionTasks.map((r) => {
                  const rStatus =
                    r.status === "in_progress"
                      ? "In Progress"
                      : r.status === "completed"
                        ? "Completed"
                        : r.status === "cancelled"
                          ? "Cancelled"
                          : "Open";
                  return (
                    <div key={r.id} className="rounded-md border border-black/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/admin/tasks/${r.id}`} className="font-semibold text-heading hover:underline">
                            {r.title}
                          </Link>
                          <div className="text-xs text-black/60">
                            {rStatus}
                            {r.due_at ? ` • Due ${new Date(r.due_at).toLocaleString()}` : ""}
                            {r.created_by ? ` • By ${profileMap[r.created_by] || "Unknown"}` : ""}
                            {" • "}
                            {revisionTaskDocsCount[r.id] ? `${revisionTaskDocsCount[r.id]} files` : "0 files"}
                          </div>
                        </div>
                        <div className="text-xs text-black/60">{r.created_at ? new Date(r.created_at).toLocaleString() : ""}</div>
                      </div>
                      {r.description ? <div className="mt-2 whitespace-pre-wrap text-sm">{r.description}</div> : null}
                    </div>
                  );
                })}
                {revisionTasks.length === 0 && <div className="text-sm text-black/60">No revisions yet.</div>}
              </div>
            </div>

            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-heading">Responses / Updates</div>
              <div className="mt-3 space-y-2">
                {updates.map((u) => (
                  <div key={u.id} className="rounded-md border border-black/10 p-3">
                    <div className="text-xs text-black/60">
                      {new Date(u.created_at).toLocaleString()} • {u.author_id ? profileMap[u.author_id] || "Unknown" : "Unknown"} •{" "}
                      {u.state === "completed" ? "Completed" : "Update"}
                    </div>
                    <div className="mt-1 text-sm whitespace-pre-wrap">{u.note || "-"}</div>
                  </div>
                ))}
                {updates.length === 0 && <div className="text-sm text-black/60">No responses yet.</div>}
              </div>
            </div>

            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-heading">Attachments</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx"
                  multiple
                  onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                />
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50"
                  disabled={uploading || uploadFiles.length === 0}
                  onClick={uploadDocFiles}
                >
                  Upload Files
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {docs.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-md border border-black/10 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm truncate">
                        <a href={d.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {d.filename}
                        </a>
                      </div>
                      <div className="text-xs text-black/60 truncate">
                        {d.created_at ? new Date(d.created_at).toLocaleString() : ""}{" "}
                        {d.uploaded_by ? `• ${profileMap[d.uploaded_by] || "Unknown"}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => renameDoc(d)}>
                        Rename
                      </button>
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => deleteDoc(d)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {docs.length === 0 && <div className="text-sm text-black/60">No attachments yet.</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </AuthGuard>
  );
}
