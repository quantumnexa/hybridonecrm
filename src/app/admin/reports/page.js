"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached } from "@/lib/supabase";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="text-xs text-black/60">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-heading">{value}</div>
      {sub ? <div className="mt-1 text-xs text-black/60">{sub}</div> : null}
    </div>
  );
}

function BarListCard({ title, items, valueSuffix = "", empty = "No data" }) {
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
              <div className="w-28 text-xs text-black/60 truncate">{it.label}</div>
              <div className="flex-1 h-3 rounded-md bg-black/5 overflow-hidden">
                <div className="h-3 bg-blue-600" style={{ width: `${w}%` }} />
              </div>
              <div className="w-16 text-right text-xs text-black/70 tabular-nums">
                {v.toLocaleString()}
                {valueSuffix}
              </div>
            </div>
          );
        })}
        {(items || []).length === 0 && <div className="text-sm text-black/60">{empty}</div>}
      </div>
    </div>
  );
}

export default function Page() {
  const [orgId, setOrgId] = useState(null);
  const [preset, setPreset] = useState("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [bounds, setBounds] = useState({ from: "", to: "" });
  const [reloadKey, setReloadKey] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [leads, setLeads] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [workSessions, setWorkSessions] = useState([]);
  const [profileMap, setProfileMap] = useState({});

  const toIsoInputValue = (d) => {
    if (!d) return "";
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  };

  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);

  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };

  const addMonths = (d, n) => {
    const x = new Date(d);
    x.setMonth(x.getMonth() + n);
    return x;
  };

  const weekStart = (d) => {
    const x = startOfDay(d);
    const day = x.getDay();
    const diff = (day + 6) % 7;
    x.setDate(x.getDate() - diff);
    return x;
  };

  const boundsForPreset = (p) => {
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
    if (p === "last_month") {
      const thisMonth = startOfMonth(now);
      const from = addMonths(thisMonth, -1);
      const to = thisMonth;
      return { from, to };
    }
    if (p === "year") {
      const from = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      const to = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
      return { from, to };
    }
    return null;
  };

  useEffect(() => {
    const init = async () => {
      const u = await getUserCached();
      const uid = u?.id || null;
      if (!uid) return;
      const { data: prof } = await supabase.from("profiles").select("org_id").eq("user_id", uid).maybeSingle();
      setOrgId(prof?.org_id || null);
      const now = new Date();
      const from = startOfMonth(now);
      const to = addMonths(from, 1);
      setCustomFrom(toIsoInputValue(from));
      setCustomTo(toIsoInputValue(to));
      setBounds({ from: from.toISOString(), to: to.toISOString() });
    };
    init();
  }, []);

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

  useEffect(() => {
    const run = async () => {
      if (!bounds.from || !bounds.to) return;
      setError("");
      setLoading(true);

      const runQuery = async (make) => {
        const wantsOrg = !!orgId;
        const res = await make(wantsOrg);
        if (res?.error && wantsOrg && String(res.error.message || "").toLowerCase().includes("org_id")) {
          return await make(false);
        }
        return res;
      };

      const fromIso = bounds.from;
      const toIso = bounds.to;

      const leadsRes = await runQuery((withOrg) => {
        let q = supabase.from("leads").select("id,status,created_at,source,sales_person").gte("created_at", fromIso).lt("created_at", toIso);
        if (withOrg) q = q.eq("org_id", orgId);
        return q;
      });
      if (leadsRes?.error) {
        setError(leadsRes.error.message || "Failed to load leads");
        setLoading(false);
        return;
      }
      setLeads(leadsRes?.data || []);

      const quotesRes = await runQuery((withOrg) => {
        let q = supabase
          .from("quotes")
          .select("id,total,status,created_at,lead_id,created_by")
          .gte("created_at", fromIso)
          .lt("created_at", toIso);
        if (withOrg) q = q.eq("org_id", orgId);
        return q;
      });
      if (quotesRes?.error) {
        setError(quotesRes.error.message || "Failed to load quotes");
        setLoading(false);
        return;
      }
      setQuotes(quotesRes?.data || []);

      const apptRes = await runQuery((withOrg) => {
        let q = supabase.from("appointments").select("id,status,created_at,created_by").gte("created_at", fromIso).lt("created_at", toIso);
        if (withOrg) q = q.eq("org_id", orgId);
        return q;
      });
      if (apptRes?.error) {
        setError(apptRes.error.message || "Failed to load appointments");
        setLoading(false);
        return;
      }
      setAppointments(apptRes?.data || []);

      const taskRes = await runQuery((withOrg) => {
        let q = supabase.from("tasks").select("id,status,created_at,assignee_id,created_by").gte("created_at", fromIso).lt("created_at", toIso);
        if (withOrg) q = q.eq("org_id", orgId);
        return q;
      });
      if (taskRes?.error) {
        setError(taskRes.error.message || "Failed to load tasks");
        setLoading(false);
        return;
      }
      setTasks(taskRes?.data || []);

      const fromKey = fromIso.slice(0, 10);
      const toKey = new Date(new Date(toIso).getTime() - 1).toISOString().slice(0, 10);
      const wsRes = await runQuery((withOrg) => {
        let q = supabase.from("work_sessions").select("user_id,work_date,duration_minutes,login_at,logout_at,role,org_id").gte("work_date", fromKey).lte("work_date", toKey);
        if (withOrg) q = q.eq("org_id", orgId);
        return q;
      });
      if (wsRes?.error) {
        setError(wsRes.error.message || "Failed to load work sessions");
        setLoading(false);
        return;
      }
      const wsData = wsRes?.data || [];
      setWorkSessions(wsData);

      const ids = Array.from(
        new Set(
          [
            ...(leadsRes?.data || []).map((l) => l.sales_person),
            ...(quotesRes?.data || []).map((q) => q.created_by),
            ...(apptRes?.data || []).map((a) => a.created_by),
            ...(taskRes?.data || []).map((t) => t.assignee_id),
            ...wsData.map((w) => w.user_id),
          ].filter(Boolean)
        )
      );
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("user_id, display_name, role").in("user_id", ids);
        const map = {};
        (profs || []).forEach((p) => {
          map[p.user_id] = p.display_name || p.user_id;
        });
        setProfileMap(map);
      } else {
        setProfileMap({});
      }

      setLoading(false);
    };
    run();
  }, [bounds.from, bounds.to, orgId, reloadKey]);

  const leadsByStatus = useMemo(() => {
    return (leads || []).reduce((acc, l) => {
      const s = l.status || "New";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
  }, [leads]);

  const acceptedRevenue = useMemo(() => {
    return (quotes || []).filter((q) => q.status === "Accepted").reduce((sum, q) => sum + Number(q.total || 0), 0);
  }, [quotes]);

  const apptCounts = useMemo(() => {
    return (appointments || []).reduce((acc, a) => {
      const s = a.status || "scheduled";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
  }, [appointments]);

  const taskCounts = useMemo(() => {
    return (tasks || []).reduce((acc, t) => {
      const s = t.status || "open";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
  }, [tasks]);

  const conversionRate = useMemo(() => {
    const total = leads.length || 0;
    const converted = leadsByStatus.Converted || 0;
    return total ? Math.round((converted / total) * 100) : 0;
  }, [leads.length, leadsByStatus.Converted]);

  const appointmentDoneRate = useMemo(() => {
    const total = appointments.length || 0;
    const done = apptCounts.completed || 0;
    return total ? Math.round((done / total) * 100) : 0;
  }, [appointments.length, apptCounts.completed]);

  const taskDoneRate = useMemo(() => {
    const total = tasks.length || 0;
    const done = taskCounts.completed || 0;
    return total ? Math.round((done / total) * 100) : 0;
  }, [tasks.length, taskCounts.completed]);

  const totalWorkHours = useMemo(() => {
    return (workSessions || []).reduce((sum, s) => sum + Number(s.duration_minutes || 0), 0) / 60;
  }, [workSessions]);

  const activeWorkers = useMemo(() => {
    const set = new Set();
    (workSessions || []).forEach((s) => {
      if (s.user_id) set.add(s.user_id);
    });
    return set.size;
  }, [workSessions]);

  const avgHoursPerWorker = useMemo(() => {
    return activeWorkers ? totalWorkHours / activeWorkers : 0;
  }, [activeWorkers, totalWorkHours]);

  const websiteLeads = useMemo(() => {
    const buckets = (leads || []).reduce((acc, l) => {
      const s = (l.source || "Unknown").trim() || "Unknown";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(buckets)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15);
  }, [leads]);

  const salesPerf = useMemo(() => {
    const perf = new Map();
    (leads || []).forEach((l) => {
      const sp = l.sales_person || "unassigned";
      if (!perf.has(sp)) perf.set(sp, { sales_person: sp, leads: 0, converted: 0, revenue: 0 });
      perf.get(sp).leads += 1;
      if ((l.status || "") === "Converted") perf.get(sp).converted += 1;
    });
    (quotes || []).forEach((q) => {
      if (q.status !== "Accepted") return;
      const sp = q.created_by || "unassigned";
      if (!perf.has(sp)) perf.set(sp, { sales_person: sp, leads: 0, converted: 0, revenue: 0 });
      perf.get(sp).revenue += Number(q.total || 0);
    });
    return Array.from(perf.values())
      .map((r) => ({
        id: r.sales_person,
        name: r.sales_person === "unassigned" ? "Unassigned" : profileMap[r.sales_person] || "Unknown",
        leads: r.leads,
        converted: r.converted,
        revenue: Math.round(r.revenue),
      }))
      .sort((a, b) => b.revenue - a.revenue || b.converted - a.converted || b.leads - a.leads)
      .slice(0, 15);
  }, [leads, quotes, profileMap]);

  const attendanceSummary = useMemo(() => {
    const byUserDay = new Map();
    (workSessions || []).forEach((s) => {
      const key = `${s.user_id}_${s.work_date}`;
      byUserDay.set(key, true);
    });
    const byUser = new Map();
    (workSessions || []).forEach((s) => {
      const uid = s.user_id || "unknown";
      if (!byUser.has(uid)) byUser.set(uid, { user_id: uid, presentDays: 0, minutes: 0 });
      byUser.get(uid).minutes += Number(s.duration_minutes || 0);
    });
    byUserDay.forEach((_v, key) => {
      const uid = key.split("_")[0];
      if (!byUser.has(uid)) byUser.set(uid, { user_id: uid, presentDays: 0, minutes: 0 });
      byUser.get(uid).presentDays += 1;
    });
    return Array.from(byUser.values())
      .map((r) => ({
        user_id: r.user_id,
        name: profileMap[r.user_id] || "Unknown",
        presentDays: r.presentDays,
        hours: (Number(r.minutes || 0) / 60).toFixed(2),
      }))
      .sort((a, b) => Number(b.hours) - Number(a.hours))
      .slice(0, 20);
  }, [workSessions, profileMap]);

  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-heading text-2xl font-bold">Reports & Analytics</h1>
            <div className="mt-1 text-xs text-black/60">Range: {bounds.from ? bounds.from.slice(0, 10) : "-"} → {bounds.to ? bounds.to.slice(0, 10) : "-"}{!orgId ? " • All orgs" : ""}</div>
          </div>
          <button className="rounded-md border border-black/10 bg-white px-3 py-2 text-sm hover:bg-black/5" onClick={() => setReloadKey((k) => k + 1)}>
            Refresh
          </button>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: "today", label: "Today" },
                { key: "yesterday", label: "Yesterday" },
                { key: "week", label: "This Week" },
                { key: "month", label: "This Month" },
                { key: "last_month", label: "Last Month" },
                { key: "year", label: "This Year" },
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
                <button
                  className="rounded-md bg-heading px-3 py-2 text-sm text-background hover:bg-hover disabled:opacity-50"
                  onClick={applyCustom}
                  disabled={!customFrom || !customTo}
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Leads" value={loading ? "…" : String(leads.length)} sub={`Conversion ${conversionRate}% • New ${leadsByStatus.New || 0}`} />
          <StatCard
            label="Revenue (Accepted)"
            value={loading ? "…" : usdFormatter.format(acceptedRevenue)}
            sub={`Accepted ${quotes.filter((q) => q.status === "Accepted").length} • Total ${quotes.length}`}
          />
          <StatCard label="Appointments" value={loading ? "…" : String(appointments.length)} sub={`Done ${appointmentDoneRate}% • Completed ${apptCounts.completed || 0}`} />
          <StatCard label="Tasks" value={loading ? "…" : String(tasks.length)} sub={`Done ${taskDoneRate}% • Completed ${taskCounts.completed || 0}`} />
          <StatCard label="Work Hours" value={loading ? "…" : totalWorkHours.toFixed(2)} sub={`Workers ${activeWorkers} • Avg ${avgHoursPerWorker.toFixed(2)}`} />
          <StatCard label="Work Sessions" value={loading ? "…" : String(workSessions.length)} sub="Rows in range" />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <BarListCard title="Website wise Leads" items={websiteLeads.map((r) => ({ label: r.label, value: r.value }))} />
          <BarListCard title="Sales Revenue (Top 10)" items={salesPerf.slice(0, 10).map((r) => ({ label: r.name, value: r.revenue }))} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-black/10 bg-white shadow-sm overflow-hidden">
            <div className="p-4">
              <div className="text-sm font-semibold text-heading">Sales Performance</div>
              <div className="mt-1 text-xs text-black/60">Leads, conversions and revenue in selected range</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[820px] w-full text-sm">
                <thead className="bg-black/5 text-black/70">
                  <tr>
                    <th className="px-4 py-3 text-left">Sales</th>
                    <th className="px-4 py-3 text-right">Leads</th>
                    <th className="px-4 py-3 text-right">Converted</th>
                    <th className="px-4 py-3 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {salesPerf.map((r, idx) => (
                    <tr
                      key={r.id || r.name}
                      className={(idx % 2 === 0 ? "bg-white" : "bg-black/[0.015]") + " border-t hover:bg-black/[0.03]"}
                    >
                      <td className="px-4 py-3 font-medium text-heading">{r.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.leads}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.converted}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{usdFormatter.format(r.revenue)}</td>
                    </tr>
                  ))}
                  {salesPerf.length === 0 && (
                    <tr>
                      <td className="px-4 py-10 text-center text-black/60" colSpan={4}>
                        No data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-black/10 bg-white shadow-sm overflow-hidden">
            <div className="p-4">
              <div className="text-sm font-semibold text-heading">Attendance Summary</div>
              <div className="mt-1 text-xs text-black/60">Present days and worked hours in selected range</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[620px] w-full text-sm">
                <thead className="bg-black/5 text-black/70">
                  <tr>
                    <th className="px-4 py-3 text-left">Employee</th>
                    <th className="px-4 py-3 text-right">Present Days</th>
                    <th className="px-4 py-3 text-right">Hours Worked</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceSummary.map((r, idx) => (
                    <tr
                      key={r.user_id || r.name}
                      className={(idx % 2 === 0 ? "bg-white" : "bg-black/[0.015]") + " border-t hover:bg-black/[0.03]"}
                    >
                      <td className="px-4 py-3 font-medium text-heading">{r.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.presentDays}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.hours}</td>
                    </tr>
                  ))}
                  {attendanceSummary.length === 0 && (
                    <tr>
                      <td className="px-4 py-10 text-center text-black/60" colSpan={3}>
                        No data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
