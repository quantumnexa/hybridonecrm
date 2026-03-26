"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";
import ClockWidget from "@/components/ClockWidget";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function Card({ label, value }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="text-xs text-black/60">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-heading">{value}</div>
    </div>
  );
}

function toIsoInputValue(d) {
  if (!d) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
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

function boundsForPreset(preset) {
  const now = new Date();
  if (preset === "today") {
    const from = startOfDay(now);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from, to };
  }
  if (preset === "yesterday") {
    const to = startOfDay(now);
    const from = new Date(to);
    from.setDate(from.getDate() - 1);
    return { from, to };
  }
  if (preset === "week") {
    const to = new Date(now);
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    return { from, to };
  }
  if (preset === "month") {
    const from = startOfMonth(now);
    const to = addMonths(from, 1);
    return { from, to };
  }
  if (preset === "last_month") {
    const thisMonth = startOfMonth(now);
    const from = addMonths(thisMonth, -1);
    const to = thisMonth;
    return { from, to };
  }
  if (preset === "year") {
    const from = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
    return { from, to };
  }
  return null;
}

function FilterBar({ preset, setPreset, customFrom, customTo, setCustomFrom, setCustomTo, applyCustom }) {
  const items = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
    { key: "last_month", label: "Last Month" },
    { key: "year", label: "This Year" },
    { key: "custom", label: "Custom" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((i) => (
        <button
          key={i.key}
          className={
            "rounded-md border px-3 py-2 text-sm " +
            (preset === i.key
              ? "border-blue-600 bg-blue-600 text-white"
              : "border-black/10 bg-white text-black/70 hover:bg-black/5")
          }
          onClick={() => setPreset(i.key)}
        >
          {i.label}
        </button>
      ))}
      <div className="flex items-center gap-2">
        <input
          type="datetime-local"
          className="rounded-md border border-black/10 px-2 py-1 text-sm"
          value={customFrom}
          onChange={(e) => setCustomFrom(e.target.value)}
          disabled={preset !== "custom"}
        />
        <span className="text-sm">to</span>
        <input
          type="datetime-local"
          className="rounded-md border border-black/10 px-2 py-1 text-sm"
          value={customTo}
          onChange={(e) => setCustomTo(e.target.value)}
          disabled={preset !== "custom"}
        />
        <button
          className="rounded-md bg-heading px-3 py-2 text-sm text-background hover:bg-hover disabled:opacity-50"
          onClick={applyCustom}
          disabled={preset !== "custom" || !customFrom || !customTo}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function MiniBarChart({ title, items, valueSuffix = "" }) {
  const max = Math.max(1, ...(items || []).map((i) => Number(i.value || 0)));
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-heading">{title}</div>
      <div className="mt-3 space-y-2">
        {(items || []).slice(0, 12).map((it) => {
          const v = Number(it.value || 0);
          const w = Math.round((v / max) * 100);
          return (
            <div key={it.label} className="flex items-center gap-3">
              <div className="w-20 text-xs text-black/60 truncate">{it.label}</div>
              <div className="flex-1 h-3 rounded-md bg-black/5 overflow-hidden">
                <div className="h-3 bg-heading" style={{ width: `${w}%` }} />
              </div>
              <div className="w-16 text-right text-xs text-black/70">
                {v.toLocaleString()}{valueSuffix}
              </div>
            </div>
          );
        })}
        {(items || []).length === 0 && <div className="text-sm text-black/60">No data.</div>}
      </div>
    </div>
  );
}

export default function Page() {
  const initialMonthBounds = useMemo(() => boundsForPreset("month"), []);
  const [preset, setPreset] = useState("month");
  const [customFrom, setCustomFrom] = useState(toIsoInputValue(initialMonthBounds?.from));
  const [customTo, setCustomTo] = useState(toIsoInputValue(initialMonthBounds?.to));
  const [bounds, setBounds] = useState(() => ({
    from: initialMonthBounds.from.toISOString(),
    to: initialMonthBounds.to.toISOString(),
  }));

  const [orgId, setOrgId] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [cards, setCards] = useState({
    totalLeads: 0,
    newLeads: 0,
    contactedLeads: 0,
    qualifiedLeads: 0,
    lostLeads: 0,
    convertedLeads: 0,
    totalRevenue: 0,
    monthlyRevenue: 0,
    totalProjects: 0,
    activeProjects: 0,
    completedProjects: 0,
    totalAppointments: 0,
    completedAppointments: 0,
    siteVisits: 0,
  });

  const [leadsPerMonth, setLeadsPerMonth] = useState([]);
  const [revenuePerMonth, setRevenuePerMonth] = useState([]);
  const [conversionPerMonth, setConversionPerMonth] = useState([]);
  const [websiteLeads, setWebsiteLeads] = useState([]);
  const [salesPerf, setSalesPerf] = useState([]);

  useEffect(() => {
    const run = async () => {
      const u = await getUserCached();
      const uid = u?.id || null;
      if (!uid) return;
      const { data: prof } = await supabase.from("profiles").select("org_id").eq("user_id", uid).maybeSingle();
      setOrgId(prof?.org_id || null);
    };
    run();
  }, []);

  const changePreset = (next) => {
    setPreset(next);
    if (next === "custom") return;
    const b = boundsForPreset(next);
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
    setBounds({ from: from.toISOString(), to: to.toISOString() });
  };

  useEffect(() => {
    const run = async () => {
      setError("");
      setLoading(true);
      const fromIso = bounds.from;
      const toIso = bounds.to;

      const runQuery = async (make) => {
        const wantsOrg = !!orgId;
        const res = await make(wantsOrg);
        if (res?.error && wantsOrg && String(res.error.message || "").toLowerCase().includes("org_id")) {
          return await make(false);
        }
        return res;
      };

      const leadsRes = await runQuery((withOrg) => {
        let q = supabase
          .from("leads")
          .select("id,status,created_at,source,sales_person")
          .gte("created_at", fromIso)
          .lt("created_at", toIso);
        if (withOrg) q = q.eq("org_id", orgId);
        return q;
      });
      if (leadsRes?.error) {
        setError(leadsRes.error.message || "Failed to load leads");
        setLoading(false);
        return;
      }
      const leadsArr = leadsRes?.data || [];
      const totalLeads = leadsArr.length;
      const byStatus = leadsArr.reduce((acc, l) => {
        const s = l.status || "New";
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {});

      const apptRes = await runQuery((withOrg) => {
        let q = supabase
          .from("appointments")
          .select("id,title,notes,status,created_at")
          .gte("created_at", fromIso)
          .lt("created_at", toIso);
        if (withOrg) q = q.eq("org_id", orgId);
        return q;
      });
      if (apptRes?.error) {
        setError(apptRes.error.message || "Failed to load appointments");
        setLoading(false);
        return;
      }
      const apptsArr = apptRes?.data || [];
      const totalAppointments = apptsArr.length;
      const completedAppointments = apptsArr.filter((a) => a.status === "completed").length;
      const siteVisits = apptsArr.filter((a) => {
        const t = (a.title || "").toLowerCase();
        const n = (a.notes || "").toLowerCase();
        return t.includes("site") || n.includes("site");
      }).length;

      const quoteRangeRes = await runQuery((withOrg) => {
        let q = supabase
          .from("quotes")
          .select("id,total,status,created_at,lead_id")
          .eq("status", "Accepted")
          .gte("created_at", fromIso)
          .lt("created_at", toIso);
        if (withOrg) q = q.eq("org_id", orgId);
        return q;
      });
      if (quoteRangeRes?.error) {
        setError(quoteRangeRes.error.message || "Failed to load revenue");
        setLoading(false);
        return;
      }
      const quotesRange = quoteRangeRes?.data || [];
      const totalRevenue = quotesRange.reduce((sum, q) => sum + Number(q.total || 0), 0);

      const monthB = boundsForPreset("month");
      const monthFrom = monthB.from.toISOString();
      const monthTo = monthB.to.toISOString();
      const quoteMonthRes = await runQuery((withOrg) => {
        let q = supabase
          .from("quotes")
          .select("id,total,status,created_at")
          .eq("status", "Accepted")
          .gte("created_at", monthFrom)
          .lt("created_at", monthTo);
        if (withOrg) q = q.eq("org_id", orgId);
        return q;
      });
      const quotesMonth = quoteMonthRes?.data || [];
      const monthlyRevenue = quotesMonth.reduce((sum, q) => sum + Number(q.total || 0), 0);

      const projectsRes = await runQuery((withOrg) => {
        let q = supabase.from("projects").select("id,status,created_at");
        if (withOrg) q = q.eq("org_id", orgId);
        return q;
      });
      const projectsArr = projectsRes?.data || [];
      const totalProjects = projectsArr.length;
      const activeProjects = projectsArr.filter((p) => (p.status || "") === "Active").length;
      const completedProjects = projectsArr.filter((p) => (p.status || "") === "Completed").length;

      const sixStart = startOfMonth(addMonths(new Date(), -5));
      const sixEnd = addMonths(startOfMonth(new Date()), 1);

      const leads6Res = await runQuery((withOrg) => {
        let q = supabase
          .from("leads")
          .select("id,status,created_at")
          .gte("created_at", sixStart.toISOString())
          .lt("created_at", sixEnd.toISOString());
        if (withOrg) q = q.eq("org_id", orgId);
        return q;
      });
      const leads6 = leads6Res?.data || [];
      const leadMonthBuckets = {};
      const convMonthBuckets = {};
      for (let i = 0; i < 6; i++) {
        const m = addMonths(sixStart, i);
        const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
        leadMonthBuckets[key] = 0;
        convMonthBuckets[key] = { total: 0, converted: 0 };
      }
      leads6.forEach((l) => {
        const d = new Date(l.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (leadMonthBuckets[key] == null) return;
        leadMonthBuckets[key] += 1;
        convMonthBuckets[key].total += 1;
        if ((l.status || "") === "Converted") convMonthBuckets[key].converted += 1;
      });
      setLeadsPerMonth(Object.keys(leadMonthBuckets).map((k) => ({ label: k, value: leadMonthBuckets[k] })));
      setConversionPerMonth(
        Object.keys(convMonthBuckets).map((k) => {
          const b = convMonthBuckets[k];
          const pct = b.total ? Math.round((b.converted / b.total) * 100) : 0;
          return { label: k, value: pct };
        })
      );

      const quotes6Res = await runQuery((withOrg) => {
        let q = supabase
          .from("quotes")
          .select("id,total,status,created_at")
          .eq("status", "Accepted")
          .gte("created_at", sixStart.toISOString())
          .lt("created_at", sixEnd.toISOString());
        if (withOrg) q = q.eq("org_id", orgId);
        return q;
      });
      const quotes6 = quotes6Res?.data || [];
      const revBuckets = {};
      for (let i = 0; i < 6; i++) {
        const m = addMonths(sixStart, i);
        const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
        revBuckets[key] = 0;
      }
      quotes6.forEach((q) => {
        const d = new Date(q.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (revBuckets[key] == null) return;
        revBuckets[key] += Number(q.total || 0);
      });
      setRevenuePerMonth(Object.keys(revBuckets).map((k) => ({ label: k, value: Math.round(revBuckets[k]) })));

      const sourceBuckets = leadsArr.reduce((acc, l) => {
        const s = (l.source || "Unknown").trim() || "Unknown";
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {});
      setWebsiteLeads(
        Object.entries(sourceBuckets)
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10)
      );

      const quoteLeadIds = Array.from(new Set(quotesRange.map((q) => q.lead_id).filter(Boolean)));
      const leadIdToSales = new Map(leadsArr.map((l) => [l.id, l.sales_person || null]));
      const missingLeadIds = quoteLeadIds.filter((lid) => !leadIdToSales.has(lid));
      if (missingLeadIds.length) {
        const leadForQuotesRes = await runQuery((withOrg) => {
          let q = supabase.from("leads").select("id,sales_person").in("id", missingLeadIds);
          if (withOrg) q = q.eq("org_id", orgId);
          return q;
        });
        (leadForQuotesRes?.data || []).forEach((l) => leadIdToSales.set(l.id, l.sales_person || null));
      }

      const perf = new Map();
      leadsArr.forEach((l) => {
        const sp = l.sales_person || "unassigned";
        if (!perf.has(sp)) perf.set(sp, { sales_person: sp, assigned: 0, converted: 0, revenue: 0 });
        const row = perf.get(sp);
        row.assigned += 1;
        if ((l.status || "") === "Converted") row.converted += 1;
      });
      quotesRange.forEach((q) => {
        const sp = leadIdToSales.get(q.lead_id) || "unassigned";
        if (!perf.has(sp)) perf.set(sp, { sales_person: sp, assigned: 0, converted: 0, revenue: 0 });
        perf.get(sp).revenue += Number(q.total || 0);
      });
      const salesIds = Array.from(new Set([...perf.keys()].filter((k) => k !== "unassigned")));
      let nameMap = {};
      if (salesIds.length) {
        const { data: profs } = await supabase.from("profiles").select("user_id, display_name").in("user_id", salesIds);
        nameMap = (profs || []).reduce((acc, p) => {
          acc[p.user_id] = p.display_name || "Unknown";
          return acc;
        }, {});
      }
      setSalesPerf(
        Array.from(perf.values())
          .map((r) => ({
            label: r.sales_person === "unassigned" ? "Unassigned" : nameMap[r.sales_person] || "Unknown",
            value: r.assigned,
            converted: r.converted,
            revenue: Math.round(r.revenue),
          }))
          .sort((a, b) => b.revenue - a.revenue || b.value - a.value)
          .slice(0, 10)
      );

      setCards({
        totalLeads,
        newLeads: byStatus.New || 0,
        contactedLeads: byStatus.Contacted || 0,
        qualifiedLeads: byStatus.Qualified || 0,
        lostLeads: byStatus.Lost || 0,
        convertedLeads: byStatus.Converted || 0,
        totalRevenue: Math.round(totalRevenue),
        monthlyRevenue: Math.round(monthlyRevenue),
        totalProjects,
        activeProjects,
        completedProjects,
        totalAppointments,
        completedAppointments,
        siteVisits,
      });

      setLoading(false);
    };

    run();
  }, [bounds.from, bounds.to, orgId]);

  const salesPerfChart = useMemo(() => {
    return (salesPerf || []).map((r) => ({ label: r.label, value: r.revenue }));
  }, [salesPerf]);

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <ClockWidget />
        <h1 className="text-heading text-2xl font-bold">Dashboard</h1>

        <section className="space-y-3">
          <FilterBar
            preset={preset}
            setPreset={changePreset}
            customFrom={customFrom}
            customTo={customTo}
            setCustomFrom={setCustomFrom}
            setCustomTo={setCustomTo}
            applyCustom={applyCustom}
          />
          {!orgId && (
            <div className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
              Viewing all data. Assign an organization to your profile to scope results.
            </div>
          )}
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Card label="Total Leads (Range)" value={loading ? "…" : String(cards.totalLeads)} />
          <Card label="New Leads (Range)" value={loading ? "…" : String(cards.newLeads)} />
          <Card label="Contacted Leads (Range)" value={loading ? "…" : String(cards.contactedLeads)} />
          <Card label="Qualified Leads (Range)" value={loading ? "…" : String(cards.qualifiedLeads)} />
          <Card label="Lost Leads (Range)" value={loading ? "…" : String(cards.lostLeads)} />
          <Card label="Converted Leads (Range)" value={loading ? "…" : String(cards.convertedLeads)} />
          <Card label="Revenue (Range)" value={loading ? "…" : usdFormatter.format(cards.totalRevenue)} />
          <Card label="Revenue (This Month)" value={loading ? "…" : usdFormatter.format(cards.monthlyRevenue)} />
          <Card label="Total Projects" value={loading ? "…" : String(cards.totalProjects)} />
          <Card label="Active Projects" value={loading ? "…" : String(cards.activeProjects)} />
          <Card label="Completed Projects" value={loading ? "…" : String(cards.completedProjects)} />
          <Card label="Total Appointments (Range)" value={loading ? "…" : String(cards.totalAppointments)} />
          <Card label="Completed Appointments (Range)" value={loading ? "…" : String(cards.completedAppointments)} />
          <Card label="Site Visits Done (Range)" value={loading ? "…" : String(cards.siteVisits)} />
        </section>

        <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <MiniBarChart title="Leads per Month (Last 6 months)" items={leadsPerMonth} />
          <MiniBarChart title="Revenue per Month (Last 6 months)" items={revenuePerMonth} />
          <MiniBarChart title="Conversion Rate % (Last 6 months)" items={conversionPerMonth} valueSuffix="%" />
          <MiniBarChart title="Website wise Leads (Range)" items={websiteLeads} />
          <MiniBarChart title="Sales Person Revenue (Range)" items={salesPerfChart} />
        </section>
      </div>
    </AuthGuard>
  );
}
