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
    const loginAt = parseIso(body?.login_at);
    const logoutAtRaw = parseIso(body?.logout_at);

    if (!userId || !workDate) return NextResponse.json({ error: "Missing user_id/work_date" }, { status: 400 });
    if (!loginAt || !logoutAtRaw) return NextResponse.json({ error: "Missing login_at/logout_at" }, { status: 400 });

    const logoutAt = new Date(logoutAtRaw);
    if (logoutAt.getTime() < loginAt.getTime()) logoutAt.setDate(logoutAt.getDate() + 1);
    const durationMinutes = Math.max(0, Math.floor((logoutAt.getTime() - loginAt.getTime()) / 60000));

    const { data: prof, error: profErr } = await supabaseServer
      .from("profiles")
      .select("org_id, role")
      .eq("user_id", userId)
      .maybeSingle();
    if (profErr) return NextResponse.json({ error: profErr.message || "Failed to load profile" }, { status: 500 });

    if (mode === "replace_day" || mode === "replace") {
      const { error: delErr } = await supabaseServer.from("work_sessions").delete().eq("user_id", userId).eq("work_date", workDate);
      if (delErr) return NextResponse.json({ error: delErr.message || "Failed to replace day sessions" }, { status: 500 });
    }

    const { data: ins, error: insErr } = await supabaseServer
      .from("work_sessions")
      .insert({
        org_id: prof?.org_id || null,
        user_id: userId,
        role: prof?.role || null,
        work_date: workDate,
        login_at: loginAt.toISOString(),
        logout_at: logoutAt.toISOString(),
        duration_minutes: durationMinutes,
        half_day: halfDay,
      })
      .select("*")
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message || "Failed to save work session" }, { status: 500 });

    return NextResponse.json({ session: ins });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Failed to save work session" }, { status: 500 });
  }
}
