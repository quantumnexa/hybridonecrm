import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function normalizeDateKey(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseIso(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id || "").trim();
    const workDate = normalizeDateKey(body?.work_date);
    const mode = String(body?.mode || "replace_day");
    const halfDay = Boolean(body?.half_day);
    const halfDayPartRaw = String(body?.half_day_part || "").trim().toLowerCase();
    const halfDayPart = halfDayPartRaw === "second" ? "second" : halfDayPartRaw === "first" ? "first" : null;
    const ignoreLate = Boolean(body?.ignore_late);
    const ignoreEarly = Boolean(body?.ignore_early);
    const loginAt = parseIso(body?.login_at);
    const logoutAtRaw = parseIso(body?.logout_at);

    if (!userId || !workDate) return NextResponse.json({ error: "Missing user_id/work_date" }, { status: 400 });
    if (mode === "delete_day") {
      const { error: delErr } = await supabaseServer.from("work_sessions").delete().eq("user_id", userId).eq("work_date", workDate);
      if (delErr) return NextResponse.json({ error: delErr.message || "Failed to delete day sessions" }, { status: 500 });
      return NextResponse.json({ deleted: true });
    }
    if (!loginAt) return NextResponse.json({ error: "Missing login_at" }, { status: 400 });

    const todayKey = normalizeDateKey(new Date().toISOString());
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yKey = normalizeDateKey(y.toISOString());
    const isRecentDay = workDate === todayKey || workDate === yKey;
    if (!logoutAtRaw && !isRecentDay) {
      return NextResponse.json({ error: "For past dates, please set logout time." }, { status: 400 });
    }

    let logoutAt = null;
    let durationMinutes = 0;
    if (logoutAtRaw) {
      logoutAt = new Date(logoutAtRaw);
      if (logoutAt.getTime() < loginAt.getTime()) logoutAt.setDate(logoutAt.getDate() + 1);
      durationMinutes = Math.max(0, Math.floor((logoutAt.getTime() - loginAt.getTime()) / 60000));
    }

    const { data: prof, error: profErr } = await supabaseServer
      .from("profiles")
      .select("org_id, role")
      .eq("user_id", userId)
      .maybeSingle();
    if (profErr) return NextResponse.json({ error: profErr.message || "Failed to load profile" }, { status: 500 });

    const payload = {
      org_id: prof?.org_id || null,
      user_id: userId,
      role: prof?.role || null,
      work_date: workDate,
      login_at: loginAt.toISOString(),
      logout_at: logoutAt ? logoutAt.toISOString() : null,
      duration_minutes: durationMinutes,
      half_day: halfDay,
      ...(halfDay && halfDayPart ? { half_day_part: halfDayPart } : {}),
      ...(ignoreLate ? { ignore_late: true } : {}),
      ...(ignoreEarly ? { ignore_early: true } : {}),
    };

    let ins = null;
    let insErr = null;
    const firstTry = await supabaseServer.from("work_sessions").insert(payload).select("*").single();
    ins = firstTry?.data || null;
    insErr = firstTry?.error || null;

    const insMsg = String(insErr?.message || "").toLowerCase();
    const missingColumns =
      insErr && (insMsg.includes("column") || insMsg.includes("half_day_part") || insMsg.includes("ignore_late") || insMsg.includes("ignore_early"))
        ? {
            half_day_part: insMsg.includes("half_day_part"),
            ignore_late: insMsg.includes("ignore_late"),
            ignore_early: insMsg.includes("ignore_early"),
          }
        : null;

    if (insErr && missingColumns && (halfDay || ignoreLate || ignoreEarly)) {
      const needed = [];
      if (halfDay && missingColumns.half_day_part) needed.push("half_day_part");
      if (ignoreLate && missingColumns.ignore_late) needed.push("ignore_late");
      if (ignoreEarly && missingColumns.ignore_early) needed.push("ignore_early");
      if (needed.length) {
        return NextResponse.json(
          {
            error:
              "Database columns missing for this feature. Run this SQL in Supabase:\n" +
              "alter table public.work_sessions add column if not exists half_day_part text;\n" +
              "alter table public.work_sessions add column if not exists ignore_late boolean default false;\n" +
              "alter table public.work_sessions add column if not exists ignore_early boolean default false;\n" +
              "update public.work_sessions set ignore_late = coalesce(ignore_late, false), ignore_early = coalesce(ignore_early, false);\n",
            missing: needed,
          },
          { status: 500 }
        );
      }
    }

    if (insErr && missingColumns) {
      const retryPayload = { ...payload };
      delete retryPayload.half_day_part;
      delete retryPayload.ignore_late;
      delete retryPayload.ignore_early;
      const secondTry = await supabaseServer.from("work_sessions").insert(retryPayload).select("*").single();
      ins = secondTry?.data || null;
      insErr = secondTry?.error || null;
    }
    if (insErr) return NextResponse.json({ error: insErr.message || "Failed to save work session" }, { status: 500 });

    if ((mode === "replace_day" || mode === "replace") && ins?.id) {
      const { error: delErr } = await supabaseServer
        .from("work_sessions")
        .delete()
        .eq("user_id", userId)
        .eq("work_date", workDate)
        .neq("id", ins.id);
      if (delErr) {
        return NextResponse.json({ session: ins, cleanup_error: delErr.message || "Failed to cleanup old sessions" });
      }
    }

    return NextResponse.json({ session: ins });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Failed to save work session" }, { status: 500 });
  }
}
