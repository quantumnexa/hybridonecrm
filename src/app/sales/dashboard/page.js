"use client";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import Link from "next/link";
import { formatLocalDateTime12 } from "@/lib/timeFormat";
import { useEffect, useMemo, useState } from "react";
import ClockWidget from "@/components/ClockWidget";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default function Page() {
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState({ type: "today", from: null, to: null });
  const [metrics, setMetrics] = useState({
    assigned: 0,
    contacted: 0,
    converted: 0,
    lost: 0,
    appointments: 0,
    siteVisits: 0,
    revenue: 0,
  });
  const [latestAssigned, setLatestAssigned] = useState([]);

  const bounds = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate() + 1);
    const startOfYesterday = new Date(startOfDay); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const endOfYesterday = new Date(startOfDay);
    const startOfWeek = new Date(startOfDay); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear() + 1, 0, 1);
    switch (range.type) {
      case "today": return { from: startOfDay.toISOString(), to: endOfDay.toISOString() };
      case "yesterday": return { from: startOfYesterday.toISOString(), to: endOfYesterday.toISOString() };
      case "week": return { from: startOfWeek.toISOString(), to: endOfDay.toISOString() };
      case "month": return { from: startOfMonth.toISOString(), to: endOfMonth.toISOString() };
      case "year": return { from: startOfYear.toISOString(), to: endOfYear.toISOString() };
      case "custom": return { from: range.from, to: range.to };
      default: return { from: startOfDay.toISOString(), to: endOfDay.toISOString() };
    }
  }, [range]);

  useEffect(() => {
    const init = async () => {
      setError("");
      const u = await getUserCached();
      const uid = u?.id || null;
      setUserId(uid);
    };
    init();
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!userId || !bounds.from || !bounds.to) return;
      setError("");
      const rangeFilter = (q) => q.gte("created_at", bounds.from).lt("created_at", bounds.to);
      const leadsBase = supabase.from("leads").select("id,status,created_at").eq("sales_person", userId);
      const { data: leadsAssigned } = await rangeFilter(leadsBase);
      const assigned = (leadsAssigned || []).length;
      const contacted = (leadsAssigned || []).filter(l => l.status === "Contacted").length;
      const converted = (leadsAssigned || []).filter(l => l.status === "Converted").length;
      const lost = (leadsAssigned || []).filter(l => l.status === "Lost").length;

      const { data: appts } = await supabase
        .from("appointments")
        .select("id,title,notes,created_at,lead_id")
        .gte("created_at", bounds.from)
        .lt("created_at", bounds.to);
      const apptsForMe = (appts || []).filter(a => (leadsAssigned || []).some(l => l.id === a.lead_id));
      const appointments = apptsForMe.length;
      const siteVisits = apptsForMe.filter(a => (a.title || "").toLowerCase().includes("site") || (a.notes || "").toLowerCase().includes("site")).length;

      const { data: quotes } = await supabase
        .from("quotes")
        .select("id,total,created_at,lead_id,status")
        .eq("status", "Accepted")
        .gte("created_at", bounds.from)
        .lt("created_at", bounds.to);
      const quotesForMe = (quotes || []).filter(q => (leadsAssigned || []).some(l => l.id === q.lead_id));
      const revenue = quotesForMe.reduce((sum, q) => sum + Number(q.total || 0), 0);

      const { data: latest } = await supabase
        .from("leads")
        .select("id,name,status,created_at,source")
        .eq("sales_person", userId)
        .order("created_at", { ascending: false })
        .limit(10);

      setMetrics({ assigned, contacted, converted, lost, appointments, siteVisits, revenue });
      setLatestAssigned(latest || []);
    };
    load();
  }, [userId, bounds]);

  return (
    <AuthGuard allowedRoles={["sales"]}>
      <div className="space-y-6">
        <ClockWidget />
        <div className="flex items-center justify-between">
          <h1 className="text-heading text-2xl font-bold">Dashboard</h1>
          <div className="flex items-center gap-2">
            <select
              className="rounded-md border border-black/10 px-2 py-2"
              value={range.type}
              onChange={(e) => setRange({ type: e.target.value, from: range.from, to: range.to })}
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
              <option value="custom">Custom</option>
            </select>
            {range.type === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  className="rounded-md border border-black/10 px-2 py-2"
                  value={range.from || ""}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                />
                <input
                  type="datetime-local"
                  className="rounded-md border border-black/10 px-2 py-2"
                  value={range.to || ""}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">My Assigned Leads</div>
            <div className="mt-1 text-2xl font-bold">{metrics.assigned}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">My Contacted Leads</div>
            <div className="mt-1 text-2xl font-bold">{metrics.contacted}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">My Converted Leads</div>
            <div className="mt-1 text-2xl font-bold">{metrics.converted}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">My Lost Leads</div>
            <div className="mt-1 text-2xl font-bold">{metrics.lost}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">My Appointments</div>
            <div className="mt-1 text-2xl font-bold">{metrics.appointments}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs text-black/60">My Site Visits</div>
            <div className="mt-1 text-2xl font-bold">{metrics.siteVisits}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="text-xs text-black/60">My Revenue</div>
            <div className="mt-1 text-2xl font-bold">{usdFormatter.format(metrics.revenue)}</div>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-heading">10 Latest Assigned Leads</div>
            <button
              className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5"
              onClick={async () => {
                if (!userId) return;
                const { data: latest } = await supabase
                  .from("leads")
                  .select("id,name,status,created_at,source")
                  .eq("sales_person", userId)
                  .order("created_at", { ascending: false })
                  .limit(10);
                setLatestAssigned(latest || []);
              }}
            >
              Refresh
            </button>
          </div>
          {error && <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="mt-3 space-y-2">
            {latestAssigned.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-md border border-black/10 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{l.name || "Unnamed"}</div>
                  <div className="text-xs text-black/60 truncate">{l.status} • {formatLocalDateTime12(l.created_at)} {l.source ? `• ${l.source}` : ""}</div>
                </div>
                <div className="shrink-0">
                  <Link href={`/sales/leads/${l.id}`} className="rounded-md bg-heading px-3 py-1 text-background hover:bg-hover">View</Link>
                </div>
              </div>
            ))}
            {latestAssigned.length === 0 && <div className="text-sm text-black/60">No leads found.</div>}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
