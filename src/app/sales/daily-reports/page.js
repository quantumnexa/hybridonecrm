"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { supabase, getUserCached, logActivity, notifyAdmins } from "@/lib/supabase";

function localDateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayKey() {
  return localDateKey(new Date());
}

export default function Page() {
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);

  const [reportDate, setReportDate] = useState(todayKey());
  const [content, setContent] = useState("");
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  const [reports, setReports] = useState([]);
  const [docsByReport, setDocsByReport] = useState({});
  const [activeReportId, setActiveReportId] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAll = useCallback(async () => {
    setError("");
    setLoading(true);
    const u = await getUserCached();
    const uid = u?.id || null;
    setUserId(uid);
    if (!uid) {
      setProfile(null);
      setReports([]);
      setDocsByReport({});
      setActiveReportId("");
      setLoading(false);
      return;
    }

    const { data: prof } = await supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle();
    setProfile(prof || null);

    const { data: dr, error: dErr } = await supabase
      .from("daily_reports")
      .select("*")
      .eq("user_id", uid)
      .order("report_date", { ascending: false })
      .limit(60);
    if (dErr) {
      setError(dErr.message || "Failed to load reports");
      setReports([]);
      setDocsByReport({});
      setActiveReportId("");
      setLoading(false);
      return;
    }
    const list = dr || [];
    setReports(list);

    const ids = list.map((r) => r.id);
    if (ids.length) {
      const { data: docs } = await supabase
        .from("daily_report_documents")
        .select("*")
        .in("report_id", ids)
        .order("created_at", { ascending: false });
      const grouped = (docs || []).reduce((acc, d) => {
        (acc[d.report_id] ||= []).push(d);
        return acc;
      }, {});
      setDocsByReport(grouped);
    } else {
      setDocsByReport({});
    }

    const existing = list.find((r) => String(r.report_date) === reportDate) || null;
    if (existing) {
      setActiveReportId(existing.id);
      setContent(existing.content || "");
    } else {
      setActiveReportId("");
      setContent("");
    }

    setLoading(false);
  }, [reportDate]);

  useEffect(() => {
    const init = async () => {
      await loadAll();
    };
    init();
  }, [loadAll]);

  const selectDate = async (d) => {
    setReportDate(d);
    const existing = (reports || []).find((r) => String(r.report_date) === d) || null;
    if (existing) {
      setActiveReportId(existing.id);
      setContent(existing.content || "");
    } else {
      setActiveReportId("");
      setContent("");
    }
    setFiles([]);
  };

  const saveReport = async () => {
    if (!userId) return;
    if (!reportDate) return;
    if (!content.trim()) return;
    setError("");
    setSaving(true);

    const { data: existing } = await supabase
      .from("daily_reports")
      .select("*")
      .eq("user_id", userId)
      .eq("report_date", reportDate)
      .maybeSingle();

    let report = existing || null;
    if (report?.id) {
      const { data: updated, error: uErr } = await supabase
        .from("daily_reports")
        .update({ content: content.trim() })
        .eq("id", report.id)
        .select("*")
        .single();
      if (uErr) {
        setError(uErr.message || "Failed to update report");
        setSaving(false);
        return;
      }
      report = updated;
      await logActivity({
        actorId: userId,
        action: "daily_report_updated",
        entityType: "daily_report",
        entityId: report?.id || null,
        meta: { report_date: reportDate },
      });
      await notifyAdmins({
        actorId: userId,
        type: "activity",
        title: "Daily report updated",
        message: `Date: ${reportDate}`,
        entityType: "daily_report",
        entityId: report?.id || null,
        url: "/admin/daily-reports",
      });
    } else {
      const { data: created, error: cErr } = await supabase
        .from("daily_reports")
        .insert({
          org_id: profile?.org_id || null,
          user_id: userId,
          report_date: reportDate,
          content: content.trim(),
        })
        .select("*")
        .single();
      if (cErr) {
        setError(cErr.message || "Failed to create report");
        setSaving(false);
        return;
      }
      report = created;
      await logActivity({
        actorId: userId,
        action: "daily_report_created",
        entityType: "daily_report",
        entityId: report?.id || null,
        meta: { report_date: reportDate },
      });
      await notifyAdmins({
        actorId: userId,
        type: "activity",
        title: "Daily report submitted",
        message: `Date: ${reportDate}`,
        entityType: "daily_report",
        entityId: report?.id || null,
        url: "/admin/daily-reports",
      });
    }

    if (files.length && report?.id) {
      const bucket = "project-docs";
      let uploadedCount = 0;
      for (const file of files) {
        const path = `daily_reports/${userId}/${reportDate}/${Date.now()}_${file.name}`;
        const up = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
        if (up.error) {
          setError(up.error.message || "Failed to upload file");
          continue;
        }
        const pub = supabase.storage.from(bucket).getPublicUrl(path);
        const url = pub?.data?.publicUrl || null;
        if (url) {
          const { data: ins, error: insErr } = await supabase
            .from("daily_report_documents")
            .insert({ report_id: report.id, uploaded_by: userId, filename: file.name, url })
            .select("*")
            .single();
          if (!insErr && ins) {
            uploadedCount += 1;
            setDocsByReport((prev) => ({ ...prev, [report.id]: [ins, ...(prev[report.id] || [])] }));
          }
        }
      }
      if (uploadedCount > 0) {
        await logActivity({
          actorId: userId,
          action: "daily_report_documents_uploaded",
          entityType: "daily_report",
          entityId: report.id,
          meta: { report_date: reportDate, count: uploadedCount },
        });
        await notifyAdmins({
          actorId: userId,
          type: "activity",
          title: "Daily report attachments uploaded",
          message: `Date: ${reportDate} • ${uploadedCount} file(s)`,
          entityType: "daily_report",
          entityId: report.id,
          url: "/admin/daily-reports",
        });
      }
    }

    setFiles([]);
    setSaving(false);
    await loadAll();
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
    const { error: delErr } = await supabase.from("daily_report_documents").delete().eq("id", doc.id);
    if (delErr) {
      setError(delErr.message || "Failed to delete document");
      return;
    }
    await logActivity({
      actorId: userId,
      action: "daily_report_document_deleted",
      entityType: "daily_report_document",
      entityId: doc.id,
      meta: { report_id: doc.report_id, filename: doc.filename || null },
    });
    await notifyAdmins({
      actorId: userId,
      type: "activity",
      title: "Daily report attachment deleted",
      message: doc.filename || "",
      entityType: "daily_report_document",
      entityId: doc.id,
      url: "/admin/daily-reports",
    });
    setDocsByReport((prev) => ({ ...prev, [doc.report_id]: (prev[doc.report_id] || []).filter((d) => d.id !== doc.id) }));
  };

  const activeDocs = useMemo(() => (activeReportId ? docsByReport[activeReportId] || [] : []), [docsByReport, activeReportId]);

  return (
    <AuthGuard allowedRoles={["sales"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-heading text-2xl font-bold">Daily Reports</h1>
            <div className="mt-1 text-xs text-black/60">Submit what you did for a selected date</div>
          </div>
          <button className="rounded-md border border-black/10 px-3 py-2 hover:bg-black/5" onClick={loadAll}>
            Refresh
          </button>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-heading">Add / Update Report</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-black/60">Select date</div>
              <input
                type="date"
                className="mt-1 w-full rounded-md border border-black/10 px-3 py-2"
                value={reportDate}
                onChange={(e) => selectDate(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <div className="text-xs text-black/60">Report</div>
              <textarea
                className="mt-1 w-full rounded-md border border-black/10 px-3 py-2 h-28"
                placeholder="Write what you have done..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <div className="text-xs text-black/60">Attachments (optional)</div>
              <input
                className="mt-1 w-full rounded-md border border-black/10 px-3 py-2"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                className="rounded-md bg-heading px-3 py-2 text-background hover:bg-hover disabled:opacity-50"
                disabled={saving || !content.trim() || !reportDate}
                onClick={saveReport}
              >
                {saving ? "Saving..." : "Save Report"}
              </button>
            </div>
          </div>

          {activeReportId && (
            <div className="mt-4">
              <div className="text-xs text-black/60 mb-2">Attachments for {reportDate}</div>
              <div className="space-y-2">
                {activeDocs.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-black/10 bg-black/[0.02] px-3 py-2">
                    <a className="text-sm text-heading hover:underline" href={d.url} target="_blank" rel="noreferrer">
                      {d.filename}
                    </a>
                    <button className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100" onClick={() => deleteDoc(d)}>
                      Delete
                    </button>
                  </div>
                ))}
                {activeDocs.length === 0 && <div className="text-sm text-black/60">No attachments yet.</div>}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-black/10 bg-white shadow-sm overflow-hidden">
          <div className="p-4 flex items-center justify-between">
            <div className="text-sm font-semibold text-heading">My Reports</div>
            <div className="text-xs text-black/60">{reports.length} total</div>
          </div>
          {loading ? (
            <div className="p-4 text-sm text-black/60">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-sm">
                <thead className="bg-black/5 text-black/70">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Report</th>
                    <th className="px-4 py-3 text-right">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r, idx) => {
                    const docs = docsByReport[r.id] || [];
                    return (
                      <tr
                        key={r.id}
                        className={(idx % 2 === 0 ? "bg-white" : "bg-black/[0.015]") + " border-t hover:bg-black/[0.03] cursor-pointer"}
                        onClick={() => selectDate(String(r.report_date))}
                      >
                        <td className="px-4 py-3">{String(r.report_date)}</td>
                        <td className="px-4 py-3">
                          <div className="line-clamp-2 whitespace-pre-wrap">{r.content}</div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{docs.length}</td>
                      </tr>
                    );
                  })}
                  {reports.length === 0 && (
                    <tr>
                      <td className="px-4 py-10 text-center text-black/60" colSpan={3}>
                        No reports yet.
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

