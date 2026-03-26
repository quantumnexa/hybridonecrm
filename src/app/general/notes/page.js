"use client";
import { useEffect, useState } from "react";
import { supabase, getUserCached, logActivity, notifyAdmins } from "@/lib/supabase";

export default function GeneralNotesPage() {
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const run = async () => {
      setError("");
      const u = await getUserCached();
      const uid = u?.id || null;
      setUserId(uid);
      if (!uid) return;
      const { data: ns } = await supabase.from("user_notes").select("*").eq("user_id", uid).order("created_at", { ascending: false });
      setNotes(ns || []);
    };
    run();
  }, []);

  const addNote = async () => {
    if (!userId || !noteText.trim()) return;
    setError("");
    const { error: err } = await supabase.from("user_notes").insert({ user_id: userId, content: noteText.trim() });
    if (err) { setError(err.message || "Failed to add note"); return; }
    await logActivity({ actorId: userId, action: "note_created", entityType: "user_note", entityId: null, meta: {} });
    await notifyAdmins({ actorId: userId, type: "activity", title: "Note created", message: "", entityType: "user_note", entityId: null, url: `/admin/users/${userId}` });
    setNoteText("");
    const { data: ns } = await supabase.from("user_notes").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    setNotes(ns || []);
  };

  const deleteNote = async (noteId) => {
    setError("");
    const { error: err } = await supabase.from("user_notes").delete().eq("id", noteId);
    if (err) { setError(err.message || "Failed to delete note"); return; }
    await logActivity({ actorId: userId, action: "note_deleted", entityType: "user_note", entityId: noteId, meta: {} });
    await notifyAdmins({ actorId: userId, type: "activity", title: "Note deleted", message: "", entityType: "user_note", entityId: noteId, url: `/admin/users/${userId}` });
    const { data: ns } = await supabase.from("user_notes").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    setNotes(ns || []);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-heading text-2xl font-bold">My Notes</h1>
        <button
          className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5"
          onClick={async () => {
            setError("");
            const { data: ns } = await supabase.from("user_notes").select("*").eq("user_id", userId).order("created_at", { ascending: false });
            setNotes(ns || []);
          }}
        >
          Refresh
        </button>
      </div>
      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        {error && <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="text-sm font-semibold text-heading">Add Note</div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <textarea className="rounded-md border border-black/10 px-2 py-2" rows={2} placeholder="Write a note" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={!noteText.trim()} onClick={addNote}>Add Note</button>
        </div>
      </div>
      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-heading">Notes</div>
        <div className="mt-3 space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="flex items-center justify-between rounded-md border border-black/10 p-3">
              <div>
                <div className="text-xs text-black/60">{new Date(n.created_at).toLocaleString()}</div>
                <div className="text-sm">{n.content}</div>
              </div>
              <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => deleteNote(n.id)}>Delete</button>
            </div>
          ))}
          {notes.length === 0 && <div className="text-sm text-black/60">No notes yet.</div>}
        </div>
      </div>
    </div>
  );
}
