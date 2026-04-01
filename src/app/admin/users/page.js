 "use client";
import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import Link from "next/link";
 

function todayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function Page() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ email: "", password: "", display_name: "", role: "sales", position: "", joining_date: todayIsoDate() });
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({ email: "", display_name: "", role: "", position: "", joining_date: "" });

  const roles = [
    { value: "super_admin", label: "Super Admin" },
    { value: "sales", label: "Sales User" },
    { value: "lead_generator", label: "Leads Generator" },
    { value: "general_user", label: "General User" },
  ];

  const fetchUsers = async () => {
    setError("");
    try {
      const res = await fetch("/api/admin-users", { method: "GET" });
      if (!res.ok) {
        setError("Failed to load users");
        return;
      }
      const json = await res.json().catch(() => ({}));
      setUsers(json.users || []);
    } catch (e) {
      setError(e?.message || "Failed to load users");
    }
  };

  useEffect(() => {
    const id = setTimeout(() => { fetchUsers(); }, 0);
    return () => clearTimeout(id);
  }, []);

  const createUser = async () => {
    if (!createForm.email || !createForm.password || !createForm.role) return;
    setError("");
    setCreating(true);
    const payload = {
      email: createForm.email.trim(),
      password: createForm.password,
      display_name: createForm.display_name?.trim() || null,
      role: createForm.role,
      position: createForm.role === "general_user" ? (createForm.position?.trim() || null) : null,
      joining_date: createForm.joining_date || null,
    };
    const res = await fetch("/api/admin-users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Failed to create user");
      setCreating(false);
      return;
    }
    setCreateForm({ email: "", password: "", display_name: "", role: "sales", position: "", joining_date: todayIsoDate() });
    setCreating(false);
    await fetchUsers();
  };

  const startEdit = (u) => {
    setEditId(u.id);
    const role = u.profile?.role || u.app_metadata?.role || "";
    const joiningDate = u.profile?.joining_date || (u.profile?.created_at ? String(u.profile.created_at).slice(0, 10) : "");
    setEditForm({
      email: u.email || "",
      display_name: u.profile?.display_name || u.user_metadata?.display_name || "",
      role,
      position: u.profile?.position || u.user_metadata?.position || "",
      joining_date: joiningDate || "",
    });
  };

  const saveEdit = async () => {
    if (!editId) return;
    setError("");
    const payload = {
      user_id: editId,
      email: editForm.email?.trim() || undefined,
      role: editForm.role || undefined,
      display_name: editForm.display_name?.trim() || undefined,
      position: editForm.role === "general_user" ? (editForm.position?.trim() || undefined) : null,
      joining_date: editForm.joining_date || null,
    };
    const res = await fetch("/api/admin-users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Failed to update user");
      return;
    }
    setEditId(null);
    setEditForm({ email: "", display_name: "", role: "", position: "", joining_date: "" });
    await fetchUsers();
  };

  const resetPassword = async (userId) => {
    const newPass = prompt("Enter new password:");
    if (!newPass) return;
    setError("");
    const res = await fetch("/api/admin-users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, action: "reset_password", password: newPass }) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Failed to reset password");
      return;
    }
    await fetchUsers();
  };

  const disableUser = async (userId) => {
    setError("");
    const res = await fetch("/api/admin-users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, action: "disable" }) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Failed to disable user");
      return;
    }
    await fetchUsers();
  };

  const enableUser = async (userId) => {
    setError("");
    const res = await fetch("/api/admin-users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, action: "enable" }) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Failed to enable user");
      return;
    }
    await fetchUsers();
  };

  const roleLabel = (v) => roles.find((r) => r.value === v)?.label || v || "-";

 

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-heading text-2xl font-bold">User management</h1>
          <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={fetchUsers}>Refresh</button>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Create User</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Email" value={createForm.email} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))} />
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Password" value={createForm.password} onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))} />
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Name" value={createForm.display_name} onChange={(e) => setCreateForm((f) => ({ ...f, display_name: e.target.value }))} />
            <select className="rounded-md border border-black/10 px-2 py-2" value={createForm.role} onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}>
              {roles.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
            </select>
            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-black/60">Joining date</div>
              <input className="w-full rounded-md border border-black/10 px-2 py-2" type="date" value={createForm.joining_date} onChange={(e) => setCreateForm((f) => ({ ...f, joining_date: e.target.value }))} />
            </div>
            {createForm.role === "general_user" && (
              <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Position (for general user)" value={createForm.position} onChange={(e) => setCreateForm((f) => ({ ...f, position: e.target.value }))} />
            )}
          </div>
          {error && <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="mt-2 flex gap-2">
            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={creating || !createForm.email || !createForm.password} onClick={createUser}>Create Sales User</button>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Users</div>
          <div className="mt-3 space-y-2">
            {users.map((u) => {
              const role = u.profile?.role || u.app_metadata?.role || "";
              const name = u.profile?.display_name || u.user_metadata?.display_name || "";
              const position = u.profile?.position || u.user_metadata?.position || "";
              return (
                <div key={u.id} className="rounded-md border border-black/10 p-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      {editId === u.id ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
                          <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Name" value={editForm.display_name} onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))} />
                          <select className="rounded-md border border-black/10 px-2 py-2" value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}>
                            {roles.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
                          </select>
                          <div className="flex flex-col justify-center">
                            <div className="mb-1 text-xs text-black/60">Joining date</div>
                            <input className="rounded-md border border-black/10 px-2 py-2" type="date" value={editForm.joining_date} onChange={(e) => setEditForm((f) => ({ ...f, joining_date: e.target.value }))} />
                          </div>
                          {editForm.role === "general_user" && (
                            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Position (for general user)" value={editForm.position} onChange={(e) => setEditForm((f) => ({ ...f, position: e.target.value }))} />
                          )}
                          <div className="md:col-span-2 flex items-center gap-2">
                            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover" onClick={saveEdit}>Save</button>
                            <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={() => { setEditId(null); setEditForm({ email: "", display_name: "", role: "", position: "", joining_date: "" }); }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-sm font-semibold truncate">{name || u.email}</div>
                          <div className="text-xs text-black/60 truncate">{u.email} • {roleLabel(role)}{position ? ` • ${position}` : ""}</div>
                          <div className="text-xs text-black/60">Created: {new Date(u.created_at).toLocaleString()} {u.banned_until ? "• Disabled" : ""}</div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/users/${u.id}`} className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5">👁️</Link>
                      <Link href={`/admin/users/${u.id}#attendance`} className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5">Attendance</Link>
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => startEdit(u)}>Edit</button>
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => resetPassword(u.id)}>Reset Password</button>
                      {u.banned_until ? (
                        <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => enableUser(u.id)}>Enable</button>
                      ) : (
                        <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => disableUser(u.id)}>Disable User</button>
                      )}
                      <button
                        className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100"
                        onClick={async () => {
                          const ok = typeof window !== "undefined" ? window.confirm("Permanently delete this user? This cannot be undone.") : false;
                          if (!ok) return;
                          setError("");
                          const res = await fetch(`/api/admin-users/${u.id}`, { method: "DELETE" });
                          if (!res.ok) {
                            const j = await res.json().catch(() => ({}));
                            setError(j.error || "Failed to delete user");
                            return;
                          }
                          await fetchUsers();
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {users.length === 0 && <div className="text-sm text-black/60">No users found.</div>}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
