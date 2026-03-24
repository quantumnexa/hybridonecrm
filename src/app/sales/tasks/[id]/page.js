"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import Link from "next/link";

export default function SalesTaskDetailPage() {
  const { id } = useParams();

  const [task, setTask] = useState(null);
  const [docs, setDocs] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [revisionTasks, setRevisionTasks] = useState([]);
  const [revisionTaskDocsCount, setRevisionTaskDocsCount] = useState({});
  const [profileMap, setProfileMap] = useState({});
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);

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
    if (!uid) {
      setTask(null);
      setUnauthorized(false);
      setDocs([]);
      setUpdates([]);
      setProfileMap({});
      setLoading(false);
      return;
    }

    const { data: t, error: tErr } = await supabase.from("tasks").select("*").eq("id", id).single();
    if (tErr) {
      setError(tErr.message || "Failed to load task");
      setTask(null);
      setUnauthorized(false);
      setDocs([]);
      setUpdates([]);
      setProfileMap({});
      setLoading(false);
      return;
    }

    if (!t?.assignee_id || t.assignee_id !== uid) {
      setTask(null);
      setUnauthorized(true);
      setDocs([]);
      setUpdates([]);
      setProfileMap({});
      setLoading(false);
      return;
    }

    setUnauthorized(false);
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

    const ids = Array.from(
      new Set([t?.created_by, t?.assignee_id, ...(uRes || []).map((x) => x.author_id), ...(d || []).map((x) => x.uploaded_by)].filter(Boolean))
    );
    const extra = Array.from(
      new Set([...(revTasks || []).map((x) => x.created_by), ...(revTasks || []).map((x) => x.assignee_id)].filter(Boolean))
    );
    const allIds = Array.from(new Set([...ids, ...extra]));
    if (allIds.length) {
      const { data: profs } = await supabase.from("profiles").select("user_id, display_name").in("user_id", allIds);
      const map = {};
      (profs || []).forEach((p) => {
        map[p.user_id] = p.display_name || "Unknown";
      });
      setProfileMap(map);
    } else {
      setProfileMap({});
    }

    setLoading(false);
  }, [id]);

  useEffect(() => {
    const init = async () => {
      await loadAll();
    };
    init();
  }, [loadAll]);

  const statusLabel =
    task?.status === "in_progress"
      ? "In Progress"
      : task?.status === "completed"
        ? "Completed"
        : task?.status === "cancelled"
          ? "Cancelled"
          : "Open";

  const canComplete = useMemo(() => {
    return !!task && task.status !== "completed" && task.status !== "cancelled";
  }, [task]);

  const canHold = useMemo(() => {
    return !!task && task.status !== "in_progress" && task.status !== "completed" && task.status !== "cancelled";
  }, [task]);

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

    setRevisionForm({ title: "", description: "", due_at: "" });
    setRevisionFiles([]);
    setSavingRevision(false);
    await loadAll();
  };

  const addUpdate = async () => {
    if (!id || !userId || !noteDraft.trim()) return;
    setError("");
    setSaving(true);
    const note = noteDraft.trim();
    const { data, error: err } = await supabase
      .from("task_updates")
      .insert({ task_id: id, author_id: userId, state: "not_completed", note })
      .select("*")
      .single();
    if (err) {
      setError(err.message || "Failed to add update");
      setSaving(false);
      return;
    }
    if (data) setUpdates((prev) => [data, ...prev]);
    setNoteDraft("");
    setSaving(false);
  };

  const markCompleted = async () => {
    if (!id || !userId || !canComplete) return;
    setError("");
    setSaving(true);
    const { data: t, error: err } = await supabase
      .from("tasks")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (err) {
      setError(err.message || "Failed to mark completed");
      setSaving(false);
      return;
    }
    setTask(t || null);
    const note = noteDraft.trim();
    await supabase.from("task_updates").insert({ task_id: id, author_id: userId, state: "completed", note: note || null });
    setNoteDraft("");
    await loadAll();
    setSaving(false);
  };

  const markOnHold = async () => {
    if (!id || !userId || !canHold) return;
    setError("");
    setSaving(true);
    const { data: t, error: err } = await supabase
      .from("tasks")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (err) {
      setError(err.message || "Failed to set on hold");
      setSaving(false);
      return;
    }
    setTask(t || null);
    const note = noteDraft.trim();
    await supabase.from("task_updates").insert({ task_id: id, author_id: userId, state: "not_completed", note: note || null });
    setNoteDraft("");
    await loadAll();
    setSaving(false);
  };

  const uploadDocFiles = async () => {
    if (!id || uploadFiles.length === 0 || !userId) return;
    setError("");
    setUploading(true);
    const bucket = "project-docs";
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
          .insert({ task_id: id, uploaded_by: userId, filename: file.name, url })
          .select("*")
          .single();
        if (!insErr && ins) setDocs((prev) => [ins, ...prev]);
      }
    }
    setUploadFiles([]);
    setUploading(false);
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
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
  };

  return (
    <AuthGuard allowedRoles={["sales"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/sales/tasks" className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5">
              Back
            </Link>
            <div>
              <div className="text-heading text-2xl font-bold">Task Detail</div>
              {task && <div className="text-xs text-black/60">{statusLabel}</div>}
            </div>
          </div>
          <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={loadAll}>
            Refresh
          </button>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {loading ? (
          <div className="rounded-xl border border-black/10 bg-white p-6">Loading...</div>
        ) : unauthorized ? (
          <div className="rounded-xl border border-black/10 bg-white p-6">You do not have access to this task.</div>
        ) : !task ? (
          <div className="rounded-xl border border-black/10 bg-white p-6">Task not found.</div>
        ) : (
          <>
            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-heading">Task</div>
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
                      <Link href={`/sales/tasks/${task.parent_task_id}`} className="hover:underline">
                        {task.parent_task_id}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-black/60">Assigned By</div>
                  <div className="font-semibold">{task.created_by ? profileMap[task.created_by] || "Unknown" : "Unknown"}</div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs text-black/60">Description</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm">{task.description || "-"}</div>
                </div>
              </div>
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
                        <Link href={`/sales/tasks/${r.id}`} className="font-semibold text-heading hover:underline">
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
              <div className="text-sm font-semibold text-heading">Add Response</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <textarea
                  className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
                  rows={3}
                  placeholder="Write an update / response"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5 disabled:opacity-50"
                  disabled={!noteDraft.trim() || saving}
                  onClick={addUpdate}
                >
                  Add Update
                </button>
                <button
                  className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50"
                  disabled={!canComplete || saving}
                  onClick={markCompleted}
                >
                  Mark Completed
                </button>
                <button
                  className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5 disabled:opacity-50"
                  disabled={!canHold || saving}
                  onClick={markOnHold}
                >
                  On Hold
                </button>
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
