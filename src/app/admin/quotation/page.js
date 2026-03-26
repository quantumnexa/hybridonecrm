"use client";
import { useEffect, useState, useCallback } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import { formatDateCustom } from "@/lib/timeFormat";

export default function Page() {
  const [quotes, setQuotes] = useState([]);
  const [leads, setLeads] = useState([]);
  const [projects, setProjects] = useState([]);
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({ title: "", lead_id: "", project_id: "", notes: "", items: [], tax: "0" });
  const [createForm, setCreateForm] = useState({ title: "", lead_id: "", project_id: "", notes: "", items: [], tax: "0" });

  const fetchAll = useCallback(async () => {
    setError("");
    const { data: q } = await supabase.from("quotes").select("*").order("created_at", { ascending: false });
    setQuotes(q || []);
    const { data: l } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
    setLeads(l || []);
    const { data: p } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
    setProjects(p || []);
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

  const calcTotals = (items, taxPctStr) => {
    const subtotal = (items || []).reduce((sum, it) => sum + ((Number(it.qty) || 0) * (Number(it.price) || 0)), 0);
    const taxPct = Number(taxPctStr) || 0;
    const tax = +(subtotal * taxPct / 100).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);
    return { subtotal, tax, total };
  };

  const addItemToCreate = () => {
    setCreateForm((f) => ({ ...f, items: [...(f.items || []), { description: "", qty: "1", price: "0" }] }));
  };
  const updateCreateItem = (idx, key, val) => {
    setCreateForm((f) => {
      const items = [...(f.items || [])];
      items[idx] = { ...items[idx], [key]: val };
      return { ...f, items };
    });
  };
  const removeCreateItem = (idx) => {
    setCreateForm((f) => {
      const items = [...(f.items || [])];
      items.splice(idx, 1);
      return { ...f, items };
    });
  };

  const addItemToEdit = () => {
    setEditForm((f) => ({ ...f, items: [...(f.items || []), { description: "", qty: "1", price: "0" }] }));
  };
  const updateEditItem = (idx, key, val) => {
    setEditForm((f) => {
      const items = [...(f.items || [])];
      items[idx] = { ...items[idx], [key]: val };
      return { ...f, items };
    });
  };
  const removeEditItem = (idx) => {
    setEditForm((f) => {
      const items = [...(f.items || [])];
      items.splice(idx, 1);
      return { ...f, items };
    });
  };

  const createQuote = async () => {
    if (!createForm.title) return;
    setError("");
    setCreating(true);
    const totals = calcTotals(createForm.items, createForm.tax);
    const insert = {
      title: createForm.title.trim(),
      lead_id: createForm.lead_id || null,
      project_id: createForm.project_id || null,
      status: "Sent",
      notes: createForm.notes || null,
      items: createForm.items || [],
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      created_by: userId || null,
    };
    const { data, error: err } = await supabase.from("quotes").insert(insert).select("*").single();
    if (err) {
      setError(err.message || "Failed to create quote");
      setCreating(false);
      return;
    }
    setQuotes((prev) => [data, ...prev]);
    setCreateForm({ title: "", lead_id: "", project_id: "", notes: "", items: [], tax: "0" });
    setCreating(false);
  };


  const saveEdit = async () => {
    if (!editId || !editForm.title) return;
    setError("");
    const totals = calcTotals(editForm.items, editForm.tax);
    const payload = {
      title: editForm.title.trim(),
      lead_id: editForm.lead_id || null,
      project_id: editForm.project_id || null,
      notes: editForm.notes || null,
      items: editForm.items || [],
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
    };
    const { data, error: err } = await supabase.from("quotes").update(payload).eq("id", editId).select("*").single();
    if (err) {
      setError(err.message || "Failed to update quote");
      return;
    }
    setQuotes((prev) => prev.map((q) => (q.id === editId ? data : q)));
    setEditId(null);
    setEditForm({ title: "", lead_id: "", project_id: "", notes: "", items: [], tax: "0" });
  };

  const deleteQuote = async (quoteId) => {
    setError("");
    const { error: err } = await supabase.from("quotes").delete().eq("id", quoteId);
    if (err) {
      setError(err.message || "Failed to delete quote");
      return;
    }
    setQuotes((prev) => prev.filter((q) => q.id !== quoteId));
  };

  const changeStatus = async (quoteId, label) => {
    setError("");
    const status = label;
    const { data, error: err } = await supabase.from("quotes").update({ status }).eq("id", quoteId).select("*").single();
    if (err) {
      setError(err.message || "Failed to change status");
      return;
    }
    setQuotes((prev) => prev.map((q) => (q.id === quoteId ? data : q)));
  };

  const generatePDF = (q) => {
    const lead = leads.find((l) => l.id === q.lead_id);
    const proj = projects.find((p) => p.id === q.project_id);
    const items = Array.isArray(q.items) ? q.items : [];
    const html = `
      <html>
        <head>
          <title>Quote - ${q.title}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1 { font-size: 20px; margin: 0 0 8px; }
            .sub { color: #555; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
            th { background: #f7f7f7; text-align: left; }
            .totals { margin-top: 12px; }
            .totals div { margin: 4px 0; }
            .header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
            .logo { height: 48px; }
          </style>
        </head>
        <body>
          <div class="header">
            <img class="logo" src="/hybrid%20logo.webp" alt="Company Logo" />
            <div>
              <div style="font-size:14px;font-weight:bold;">Quotation</div>
              <div style="color:#555;">${formatDateCustom(new Date())}</div>
            </div>
          </div>
          <h1>Quotation: ${q.title}</h1>
          <div class="sub">Status: ${q.status}</div>
          <div class="sub">Lead: ${lead ? (lead.name || lead.email || lead.phone || lead.id) : "-"}</div>
          <div class="sub">Project: ${proj ? proj.name : "-"}</div>
          <table>
            <thead>
              <tr><th>Description</th><th>Qty</th><th>Price</th><th>Total</th></tr>
            </thead>
            <tbody>
              ${items.map((it) => {
                const qty = Number(it.qty) || 0;
                const price = Number(it.price) || 0;
                const rowTotal = qty * price;
                return `<tr><td>${it.description || ""}</td><td>${qty}</td><td>${price.toFixed(2)}</td><td>${rowTotal.toFixed(2)}</td></tr>`;
              }).join("")}
            </tbody>
          </table>
          <div class="totals">
            <div>Subtotal: ${Number(q.subtotal || 0).toFixed(2)}</div>
            <div>Tax: ${Number(q.tax || 0).toFixed(2)}</div>
            <div><strong>Total: ${Number(q.total || 0).toFixed(2)}</strong></div>
          </div>
          ${q.notes ? `<div style="margin-top:12px;">Notes: ${q.notes}</div>` : ""}
          <script>
            window.onload = () => { window.print(); }
          </script>
        </body>
      </html>
    `;
    const w = window.open("", "_blank");
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
    }
  };

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-heading text-2xl font-bold">Quotation</h1>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Create Quote</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Quote Title" value={createForm.title} onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))} />
            <select className="rounded-md border border-black/10 px-2 py-2" value={createForm.lead_id} onChange={(e) => setCreateForm((f) => ({ ...f, lead_id: e.target.value }))}>
              <option value="">Link Lead (optional)</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>{(l.custom?.assignee_label ? l.custom.assignee_label + " • " : "") + (l.name || l.email || l.phone || l.id)}</option>
              ))}
            </select>
            <select className="rounded-md border border-black/10 px-2 py-2" value={createForm.project_id} onChange={(e) => setCreateForm((f) => ({ ...f, project_id: e.target.value }))}>
              <option value="">Link Project (optional)</option>
              {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
            <textarea className="md:col-span-2 rounded-md border border-black/10 px-2 py-2" rows={2} placeholder="Notes (optional)" value={createForm.notes} onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))} />
            <div className="md:col-span-2">
              <div className="text-xs text-black/60 mb-2">Items</div>
              {(createForm.items || []).map((it, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
                  <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Description" value={it.description} onChange={(e) => updateCreateItem(idx, "description", e.target.value)} />
                  <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Qty" value={it.qty} onChange={(e) => updateCreateItem(idx, "qty", e.target.value)} />
                  <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Price" value={it.price} onChange={(e) => updateCreateItem(idx, "price", e.target.value)} />
                  <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={() => removeCreateItem(idx)}>Remove</button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={addItemToCreate}>Add Item</button>
                <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Tax %" value={createForm.tax} onChange={(e) => setCreateForm((f) => ({ ...f, tax: e.target.value }))} />
              </div>
            </div>
          </div>
          {error && <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="mt-2 flex gap-2">
            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50" disabled={creating || !createForm.title} onClick={createQuote}>Create Quote</button>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Quotes</div>
          <div className="mt-3 space-y-2">
            {quotes.map((q) => {
              const lead = leads.find((l) => l.id === q.lead_id);
              const proj = projects.find((p) => p.id === q.project_id);
              return (
                <div key={q.id} className="rounded-md border border-black/10 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      {editId === q.id ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Quote Title" value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} />
                          <select className="rounded-md border border-black/10 px-2 py-2" value={editForm.lead_id} onChange={(e) => setEditForm((f) => ({ ...f, lead_id: e.target.value }))}>
                            <option value="">Link Lead (optional)</option>
                            {leads.map((l) => (<option key={l.id} value={l.id}>{(l.custom?.assignee_label ? l.custom.assignee_label + " • " : "") + (l.name || l.email || l.phone || l.id)}</option>))}
                          </select>
                          <select className="rounded-md border border-black/10 px-2 py-2" value={editForm.project_id} onChange={(e) => setEditForm((f) => ({ ...f, project_id: e.target.value }))}>
                            <option value="">Link Project (optional)</option>
                            {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                          </select>
                          <textarea className="md:col-span-2 rounded-md border border-black/10 px-2 py-2" rows={2} placeholder="Notes (optional)" value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
                          <div className="md:col-span-2">
                            <div className="text-xs text-black/60 mb-2">Items</div>
                            {(editForm.items || []).map((it, idx) => (
                              <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
                                <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Description" value={it.description} onChange={(e) => updateEditItem(idx, "description", e.target.value)} />
                                <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Qty" value={it.qty} onChange={(e) => updateEditItem(idx, "qty", e.target.value)} />
                                <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Price" value={it.price} onChange={(e) => updateEditItem(idx, "price", e.target.value)} />
                                <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={() => removeEditItem(idx)}>Remove</button>
                              </div>
                            ))}
                            <div className="flex items-center gap-2">
                              <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={addItemToEdit}>Add Item</button>
                              <input className="rounded-md border border-black/10 px-2 py-2" placeholder="Tax %" value={editForm.tax} onChange={(e) => setEditForm((f) => ({ ...f, tax: e.target.value }))} />
                            </div>
                          </div>
                          <div className="md:col-span-2 flex items-center gap-2">
                            <button className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover" onClick={saveEdit}>Save</button>
                            <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={() => { setEditId(null); setEditForm({ title: "", lead_id: "", project_id: "", notes: "", items: [], tax: "0" }); }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-sm font-semibold">{q.title}</div>
                          <div className="text-xs text-black/60">
                            {q.status} • Total: {Number(q.total || 0).toFixed(2)} {q.project_id ? `• Project: ${proj?.name || "-"}` : ""} {q.lead_id ? `• Lead: ${(lead?.name || lead?.email || lead?.phone || lead?.id)}` : ""}
                          </div>
                          {q.notes && <div className="text-sm">{q.notes}</div>}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <select className="rounded-md border border-black/10 px-2 py-2 text-sm" value={q.status} onChange={(e) => changeStatus(q.id, e.target.value)}>
                        <option>Sent</option>
                        <option>Accepted</option>
                        <option>Rejected</option>
                      </select>
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => setEditId(q.id)}>Edit</button>
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => deleteQuote(q.id)}>Delete</button>
                      <button className="rounded-md border border-black/10 px-2 py-1 hover:bg-black/5" onClick={() => generatePDF(q)}>Generate PDF</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {quotes.length === 0 && <div className="text-sm text-black/60">No quotes yet.</div>}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
