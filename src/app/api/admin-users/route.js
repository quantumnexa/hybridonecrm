import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  try {
    const { data: usersRes, error: listErr } = await supabaseServer.auth.admin.listUsers();
    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
    const users = usersRes?.users || [];
    const ids = users.map((u) => u.id);
    let profiles = [];
    if (ids.length > 0) {
      const { data: profs } = await supabaseServer.from("profiles").select("*").in("user_id", ids);
      profiles = profs || [];
    }
    const profMap = {};
    profiles.forEach((p) => (profMap[p.user_id] = p));
    const combined = users.map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      banned_until: u?.banned_until || null,
      user_metadata: u?.user_metadata || {},
      app_metadata: u?.app_metadata || {},
      profile: profMap[u.id] || null,
    }));
    return NextResponse.json({ users: combined });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed to list users" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { email, password, display_name, role, position, joining_date } = body || {};
    if (!email || !password || !role) return NextResponse.json({ error: "Missing email/password/role" }, { status: 400 });

    const { data: created, error: createErr } = await supabaseServer.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: display_name || null, position: position || null },
      app_metadata: { role },
    });
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
    const user = created.user;
    if (!user) return NextResponse.json({ error: "User creation failed" }, { status: 500 });
    await supabaseServer.from("profiles").upsert({
      user_id: user.id,
      role,
      display_name: display_name || null,
      position: position || null,
      joining_date: typeof joining_date === "string" && joining_date.trim() ? joining_date.trim() : null,
    });
    return NextResponse.json({ user_id: user.id });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed to create user" }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const body = await req.json();
    const { user_id, email, password, role, display_name, position, joining_date, action } = body || {};
    if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

    if (action === "disable") {
      const { error: err } = await supabaseServer.auth.admin.updateUserById(user_id, { ban_duration: "forever" });
      if (err) return NextResponse.json({ error: err.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    if (action === "enable") {
      const { error: err } = await supabaseServer.auth.admin.updateUserById(user_id, { ban_duration: null });
      if (err) return NextResponse.json({ error: err.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    if (action === "reset_password") {
      if (!password) return NextResponse.json({ error: "Missing password" }, { status: 400 });
      const { error: err } = await supabaseServer.auth.admin.updateUserById(user_id, { password });
      if (err) return NextResponse.json({ error: err.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    // default: update profile and optionally email/password/role
    if (email || password) {
      const payload = {};
      if (email) payload.email = email;
      if (password) payload.password = password;
      const { error: updErr } = await supabaseServer.auth.admin.updateUserById(user_id, payload);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
    if (role || display_name !== undefined || position !== undefined || joining_date !== undefined) {
      await supabaseServer.from("profiles").upsert({
        user_id,
        role: role || undefined,
        display_name: display_name === undefined ? undefined : (display_name || null),
        position: position === undefined ? undefined : (position || null),
        joining_date: joining_date === undefined ? undefined : (typeof joining_date === "string" && joining_date.trim() ? joining_date.trim() : null),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed to update user" }, { status: 500 });
  }
}
