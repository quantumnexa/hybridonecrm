"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import Link from "next/link";
import { formatMinutesAsHHMM, formatLocalDateTime12, formatLocalTime12, formatDateCustom } from "@/lib/timeFormat";

export default function UserDetailPage() {
  const { id } = useParams();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [workSessions, setWorkSessions] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", description: "", due_at: "", status: "open" });
  const [assignFiles, setAssignFiles] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [completeNotes, setCompleteNotes] = useState({});
  const [taskDocs, setTaskDocs] = useState({});
  const [attachFiles, setAttachFiles] = useState({});
  const [nowTs, setNowTs] = useState(0);

  const loadAll = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const res = await fetch("/api/admin-users");
      const j = await res.json().catch(() => ({}));
      const found = Array.isArray(j.users) ? j.users.find((u) => u.id === id) : null;
      setUser(found || null);
    } catch (e) {
      setUser(null);
      setError(e?.message || "Failed to load users");
    }
    const { data: prof } = await supabase.from("profiles").select("*").eq("user_id", id).maybeSingle();
    setProfile(prof || null);
    const { data: ts } = await supabase.from("tasks").select("*").eq("assignee_id", id).order("created_at", { ascending: false });
    setTasks(ts || []);
    const taskIds = (ts || []).map((t) => t.id);
    const { data: ups } = taskIds.length
      ? await supabase.from("task_updates").select("*").in("task_id", taskIds).order("created_at", { ascending: false })
      : { data: [] };
    setUpdates(ups || []);
    if (taskIds.length) {
      const { data: docsRes } = await supabase.from("task_documents").select("*").in("task_id", taskIds).order("created_at", { ascending: false });
      const grouped = (docsRes || []).reduce((acc, d) => { (acc[d.task_id] ||= []).push(d); return acc; }, {});
      setTaskDocs(grouped);
    } else {
      setTaskDocs({});
    }
    const { data: ws } = await supabase
      .from("work_sessions")
      .select("*")
      .eq("user_id", id)
      .order("login_at", { ascending: false })
      .limit(200);
    setWorkSessions(ws || []);
  }, [id]);

  const todayKey = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const workByDay = useMemo(() => {
    const map = {};
    (workSessions || []).forEach((s) => {
      const d = s.work_date || (s.login_at ? String(s.login_at).slice(0, 10) : "");
      if (!d) return;
      if (!map[d]) map[d] = { date: d, minutes: 0, firstIn: null, lastOut: null };
      
      let mins = Number(s.duration_minutes || 0);
      const li = s.login_at ? new Date(s.login_at) : null;
      const lo = s.logout_at ? new Date(s.logout_at) : null;
      
      if (!s.logout_at && li) {
        mins = Math.max(0, Math.floor((nowTs - li.getTime()) / 60000));
      }
      
      map[d].minutes += mins;
      if (li && (!map[d].firstIn || li < map[d].firstIn)) map[d].firstIn = li;
      if (lo && (!map[d].lastOut || lo > map[d].lastOut)) map[d].lastOut = lo;
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [workSessions, nowTs]);

  const todaySummary = useMemo(() => {
    return workByDay.find((x) => x.date === todayKey) || null;
  }, [workByDay, todayKey]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const byStatus = tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});
    const updatesCount = updates.length;
    const lastUpdate = updates[0]?.created_at || null;
    return { total, byStatus, updatesCount, lastUpdate };
  }, [tasks, updates]);

  useEffect(() => {
    const init = async () => {
      const u = await getUserCached();
      setCurrentUserId(u?.id || null);
      await loadAll();
    };
    init();
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [loadAll]);

  const createTask = async () => {
    if (!currentUserId || !id || !createForm.title.trim()) return;
    setError("");
    setCreating(true);
    const payload = {
      org_id: profile?.org_id || null,
      title: createForm.title.trim(),
      description: createForm.description?.trim() || null,
      due_at: createForm.due_at || null,
      status: createForm.status || "open",
      assignee_id: id,
      created_by: currentUserId,
    };
    const { data, error: err } = await supabase.from("tasks").insert(payload).select("*").single();
    if (err) {
      setError(err.message || "Failed to create task");
      setCreating(false);
      return;
    }
    if (assignFiles.length > 0) {
      const bucket = "project-docs";
      for (const file of assignFiles) {
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
            uploaded_by: currentUserId || null,
            filename: file.name,
            url,
          });
        }
      }
    }
    setCreateForm({ title: "", description: "", due_at: "", status: "open" });
    setAssignFiles([]);
    setCreating(false);
    await loadAll();
  };

  const completeTask = async (taskId) => {
    setError("");
    const { error: err } = await supabase.from("tasks").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", taskId);
    if (err) {
      setError(err.message || "Failed to mark completed");
      return;
    }
    const note = completeNotes[taskId] || "";
    if (currentUserId) {
      await supabase.from("task_updates").insert({ task_id: taskId, author_id: currentUserId, state: "completed", note: note || null });
    }
    setCompleteNotes((prev) => ({ ...prev, [taskId]: "" }));
    await loadAll();
  };

  const addNote = async (taskId) => {
    setError("");
    const note = (completeNotes[taskId] || "").trim();
    if (!note || !currentUserId) return;
    const { error: err } = await supabase.from("task_updates").insert({ task_id: taskId, author_id: currentUserId, state: "not_completed", note });
    if (err) {
      setError(err.message || "Failed to add note");
      return;
    }
    setCompleteNotes((prev) => ({ ...prev, [taskId]: "" }));
    await loadAll();
  };

  const uploadTaskFiles = async (taskId) => {
    const files = attachFiles[taskId] || [];
    if (!files.length) return;
    setError("");
    const bucket = "project-docs";
    for (const file of files) {
      const path = `tasks/${taskId}/${Date.now()}_${file.name}`;
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
          .insert({ task_id: taskId, uploaded_by: currentUserId || null, filename: file.name, url })
          .select("*")
          .single();
        if (!insErr && ins) {
          setTaskDocs((prev) => ({ ...prev, [taskId]: [ins, ...(prev[taskId] || [])] }));
        }
      }
    }
    setAttachFiles((prev) => ({ ...prev, [taskId]: [] }));
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
    const { error: delErr } = await supabase.from("task_documents").delete().eq("id", doc.id);
    if (delErr) {
      setError(delErr.message || "Failed to delete document");
      return;
    }
    setTaskDocs((prev) => ({ ...prev, [doc.task_id]: (prev[doc.task_id] || []).filter((d) => d.id !== doc.id) }));
  };

  const renameDoc = async (doc) => {
    const newName = typeof window !== "undefined" ? window.prompt("New filename", doc.filename) : null;
    if (!newName || newName.trim() === "" || newName === doc.filename) return;
    setError("");
    const { data, error: err } = await supabase.from("task_documents").update({ filename: newName.trim() }).eq("id", doc.id).select("*").single();
    if (err) {
      setError(err.message || "Failed to rename document");
      return;
    }
    setTaskDocs((prev) => ({
      ...prev,
      [doc.task_id]: (prev[doc.task_id] || []).map((d) => (d.id === doc.id ? data : d)),
    }));
  };

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-heading text-2xl font-bold">{profile?.display_name || user?.email || "User"}</div>
            <div className="text-xs text-black/60">{user?.email} • {profile?.role}{profile?.position ? ` • ${profile.position}` : ""}</div>
          </div>
          <Link href="/admin/users" className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5">Back</Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Assigned Tasks</div>
            <div className="mt-3 text-3xl font-bold">{stats.total}</div>
            <div className="mt-2 text-xs text-black/60">Open: {stats.byStatus.open || 0} • In Progress: {stats.byStatus.in_progress || 0} • Completed: {stats.byStatus.completed || 0} • Cancelled: {stats.byStatus.cancelled || 0}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Updates</div>
            <div className="mt-3 text-3xl font-bold">{stats.updatesCount}</div>
            <div className="mt-2 text-xs text-black/60">{stats.lastUpdate ? `Last: ${formatLocalDateTime12(stats.lastUpdate)}` : "No updates yet"}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Profile</div>
            <div className="mt-2 text-sm">Name: {profile?.display_name || "-"}</div>
            <div className="text-sm">Email: {user?.email || "-"}</div>
            <div className="text-sm">Role: {profile?.role || "-"}</div>
            {profile?.position && <div className="text-sm">Position: {profile.position}</div>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-heading">Work Hours (Today)</div>
            <div className="mt-3 text-3xl font-bold">{todaySummary ? formatMinutesAsHHMM(todaySummary.minutes) : "00:00"}</div>
            <div className="mt-2 text-xs text-black/60">
              In: {todaySummary?.firstIn ? formatLocalTime12(todaySummary.firstIn) : "-"} • Out:{" "}
              {todaySummary?.lastOut ? formatLocalTime12(todaySummary.lastOut) : "-"}
            </div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm md:col-span-2">
            <div className="text-sm font-semibold text-heading">Daily Work Hours</div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-black/5 text-black/70">
                  <tr>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">First Login</th>
                    <th className="px-3 py-2 text-left">Last Logout</th>
                    <th className="px-3 py-2 text-right">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {workByDay.slice(0, 14).map((d) => (
                    <tr key={d.date} className="border-t">
                      <td className="px-3 py-2">{formatDateCustom(d.date)}</td>
                      <td className="px-3 py-2">{d.firstIn ? formatLocalTime12(d.firstIn) : "-"}</td>
                      <td className="px-3 py-2">{d.lastOut ? formatLocalTime12(d.lastOut) : "-"}</td>
                      <td className="px-3 py-2 text-right">{formatMinutesAsHHMM(d.minutes)}</td>
                    </tr>
                  ))}
                  {workByDay.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-black/60" colSpan={4}>
                        No work sessions yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          {error && <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="text-sm font-semibold text-heading">Assign Task</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Title" value={createForm.title} onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))} />
            <select className="rounded-md border border-black/10 px-2 py-2" value={createForm.status} onChange={(e) => setCreateForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <input type="datetime-local" className="rounded-md border border-black/10 px-2 py-2" value={createForm.due_at} onChange={(e) => setCreateForm((f) => ({ ...f, due_at: e.target.value }))} />
            <textarea className="rounded-md border border-black/10 px-2 py-2 md:col-span-2" rows={2} placeholder="Description" value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} />
            <input
              className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx"
              multiple
              onChange={(e) => {
                const fs = Array.from(e.target.files || []);
                setAssignFiles(fs);
              }}
            />
          </div>
          <div className="mt-2">
            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={creating || !createForm.title.trim()} onClick={createTask}>Assign Task</button>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Tasks</div>
          <div className="mt-3 space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="rounded-md border border-black/10 p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{t.title}</div>
                    <div className="text-xs text-black/60 truncate">{t.status} • {t.due_at ? `Due: ${formatLocalDateTime12(t.due_at)}` : "No deadline"}</div>
                    {t.description && <div className="text-sm">{t.description}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input className="rounded-md border border-black/10 px-2 py-1" placeholder="Note (optional)" value={completeNotes[t.id] || ""} onChange={(e) => setCompleteNotes((prev) => ({ ...prev, [t.id]: e.target.value }))} />
                    <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5 disabled:opacity-50" disabled={!((completeNotes[t.id] || "").trim())} onClick={() => addNote(t.id)}>Add Note</button>
                    <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5 disabled:opacity-50" disabled={t.status === "completed" || t.status === "cancelled"} onClick={() => completeTask(t.id)}>Mark Completed</button>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-xs font-semibold text-heading">Attachments</div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      className="md:col-span-2 rounded-md border border-black/10 px-2 py-2"
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx"
                      multiple
                      onChange={(e) => {
                        const fs = Array.from(e.target.files || []);
                        setAttachFiles((prev) => ({ ...prev, [t.id]: fs }));
                      }}
                    />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={!((attachFiles[t.id] || []).length)} onClick={() => uploadTaskFiles(t.id)}>
                      Upload Files
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {(taskDocs[t.id] || []).map((d) => (
                      <div key={d.id} className="flex items-center justify-between rounded-md border border-black/10 px-3 py-2">
                        <div className="text-sm">
                          <a href={d.url} target="_blank" rel="noreferrer" className="hover:underline">{d.filename}</a>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => renameDoc(d)}>Rename</button>
                          <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => deleteDoc(d)}>Delete</button>
                        </div>
                      </div>
                    ))}
                    {(taskDocs[t.id] || []).length === 0 && <div className="text-sm text-black/60">No attachments yet.</div>}
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {updates.filter((u) => u.task_id === t.id).map((u) => (
                    <div key={u.id} className="rounded border border-black/10 p-2">
                      <div className="text-xs text-black/60">{formatLocalDateTime12(u.created_at)} • {u.state}</div>
                      {u.note && <div className="text-sm">{u.note}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {tasks.length === 0 && <div className="text-sm text-black/60">No tasks assigned.</div>}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
