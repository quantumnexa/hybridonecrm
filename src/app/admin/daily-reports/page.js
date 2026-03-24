"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";

function localDateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
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
  if (p === "week") {
    const from = weekStart(now);
    const to = addDays(from, 7);
    return { from, to };
  }
  if (p === "month") {
    const from = startOfMonth(now);
    const to = addMonths(from, 1);
    return { from, to };
  }
  if (p === "custom") return null;
  return null;
}

export default function Page() {
  const [orgId, setOrgId] = useState(null);
  const [preset, setPreset] = useState("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [bounds, setBounds] = useState({ from: "", to: "" });
  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const init = async () => {
      const u = await getUserCached();
      const uid = u?.id || null;
      if (!uid) return;
      const { data: prof } = await supabase.from("profiles").select("org_id").eq("user_id", uid).maybeSingle();
      setOrgId(prof?.org_id || null);
      const b = boundsForPreset("week");
      const off = b.from.getTimezoneOffset();
      setCustomFrom(new Date(b.from.getTime() - off * 60000).toISOString().slice(0, 16));
      setCustomTo(new Date(b.to.getTime() - off * 60000).toISOString().slice(0, 16));
      setBounds({ from: b.from.toISOString(), to: b.to.toISOString() });
    };
    init();
  }, []);

  const changePreset = (p) => {
    setPreset(p);
    if (p === "custom") return;
    const b = boundsForPreset(p);
    if (!b) return;
    const off = b.from.getTimezoneOffset();
    setCustomFrom(new Date(b.from.getTime() - off * 60000).toISOString().slice(0, 16));
    setCustomTo(new Date(b.to.getTime() - off * 60000).toISOString().slice(0, 16));
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

  const loadAll = useCallback(async () => {
    if (!bounds.from || !bounds.to) return;
    setError("");
    setLoading(true);
    const wantsOrg = !!orgId;
    let pQ = supabase.from("profiles").select("user_id, display_name, role, org_id").order("created_at", { ascending: false });
    if (wantsOrg) pQ = pQ.or(`org_id.is.null,org_id.eq.${orgId}`);
    const { data: profs, error: pErr } = await pQ;
    if (pErr) {
      setError(pErr.message || "Failed to load profiles");
      setLoading(false);
      return;
    }
    const ids = (profs || []).map((p) => p.user_id).filter(Boolean);
    const fromKey = localDateKey(new Date(bounds.from));
    const toKey = localDateKey(new Date(new Date(bounds.to).getTime() - 1));
    let drQ = supabase.from("daily_reports").select("*").gte("report_date", fromKey).lte("report_date", toKey);
    if (wantsOrg) drQ = drQ.or(`org_id.is.null,org_id.eq.${orgId}`);
    if (ids.length) drQ = drQ.in("user_id", ids);
    const { data: dr, error: dErr } = await drQ.order("report_date", { ascending: false });
    if (dErr) {
      setError(dErr.message || "Failed to load daily reports");
      setLoading(false);
      return;
    }
    const mapName = (uid) => (profs || []).find((p) => p.user_id === uid)?.display_name || uid;
    const reportIds = (dr || []).map((r) => r.id);
    let docsGrouped = {};
    if (reportIds.length) {
      const { data: docs } = await supabase
        .from("daily_report_documents")
        .select("*")
        .in("report_id", reportIds)
        .order("created_at", { ascending: false });
      docsGrouped = (docs || []).reduce((acc, d) => {
        (acc[d.report_id] ||= []).push(d);
        return acc;
      }, {});
    }
    setRows((dr || []).map((r) => ({ ...r, name: mapName(r.user_id), docs: docsGrouped[r.id] || [] })));
    setLoading(false);
  }, [bounds.from, bounds.to, orgId]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadAll();
    }, 0);
    return () => clearTimeout(t);
  }, [loadAll]);

  const filtered = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.name || "").toLowerCase().includes(q) || String(r.content || "").toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-heading text-2xl font-bold">Daily Reports</h1>
            <div className="mt-1 text-xs text-black/60">
              Range: {bounds.from ? bounds.from.slice(0, 10) : "-"} → {bounds.to ? bounds.to.slice(0, 10) : "-"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="rounded-md border border-black/10 px-3 py-2 text-sm"
              placeholder="Search name or text…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="rounded-md border border-black/10 bg-white px-3 py-2 text-sm hover:bg-black/5" onClick={loadAll}>
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: "today", label: "Today" },
                { key: "yesterday", label: "Yesterday" },
                { key: "week", label: "This Week" },
                { key: "month", label: "This Month" },
                { key: "custom", label: "Custom" },
              ].map((i) => (
                <button
                  key={i.key}
                  className={
                    "rounded-md border border-black/10 bg-white px-3 py-2 text-sm hover:bg-blue-600 hover:text-white" +
                    (preset === i.key ? " bg-blue-600 text-white" : "")
                  }
                  onClick={() => changePreset(i.key)}
                >
                  {i.label}
                </button>
              ))}
            </div>
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
                <button className="rounded-md bg-heading px-3 py-2 text-sm text-background hover:bg-hover" onClick={applyCustom} disabled={!customFrom || !customTo}>
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-4 text-sm text-black/60">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-sm">
                <thead className="bg-black/5 text-black/70">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Employee</th>
                    <th className="px-4 py-3 text-left">Report</th>
                    <th className="px-4 py-3 text-right">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, idx) => (
                    <tr key={r.id} className={(idx % 2 === 0 ? "bg-white" : "bg-black/[0.015]") + " border-t hover:bg-black/[0.03]"}>
                      <td className="px-4 py-3">{String(r.report_date)}</td>
                      <td className="px-4 py-3 font-medium text-heading">{r.name}</td>
                      <td className="px-4 py-3 whitespace-pre-wrap">{r.content}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2 flex-wrap">
                          {(r.docs || []).slice(0, 3).map((d) => (
                            <a
                              key={d.id}
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs hover:bg-black/5"
                            >
                              {d.filename}
                            </a>
                          ))}
                          {(r.docs || []).length > 3 && (
                            <div className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-black/60">
                              +{(r.docs || []).length - 3}
                            </div>
                          )}
                          {(r.docs || []).length === 0 && <div className="text-xs text-black/50">-</div>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td className="px-4 py-10 text-center text-black/60" colSpan={4}>
                        No reports found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
