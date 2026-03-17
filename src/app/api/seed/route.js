import { supabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  const orgName = "HybridOne CRM";
  let orgId = null;

  const { data: orgs } = await supabaseServer
    .from("organizations")
    .select("id")
    .eq("name", orgName)
    .limit(1);
  if (orgs && orgs.length > 0) {
    orgId = orgs[0].id;
  } else {
    const { data: insertedOrg } = await supabaseServer
      .from("organizations")
      .insert({ name: orgName })
      .select("id")
      .single();
    orgId = insertedOrg?.id || null;
  }

  const createOrGetUser = async (email, password, role) => {
    const { data: list } = await supabaseServer.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const existing = list?.users?.find((u) => u.email === email);
    if (existing) return existing;
    const { data } = await supabaseServer.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role, org_id: orgId },
    });
    return data.user;
  };

  const adminUser = await createOrGetUser(
    "admin@hybridonecrm.com",
    "Admin123",
    "super_admin"
  );
  const salesUser = await createOrGetUser(
    "sale@hybridonecrm.com",
    "Sale123",
    "sales"
  );

  const upsertProfile = async (user, role) => {
    if (!user?.id) return null;
    return supabaseServer
      .from("profiles")
      .upsert({
        user_id: user.id,
        org_id: orgId,
        role,
      })
      .select("*");
  };

  await upsertProfile(adminUser, "super_admin");
  await upsertProfile(salesUser, "sales");

  return new Response(
    JSON.stringify({
      ok: true,
      orgId,
      adminUserId: adminUser?.id || null,
      salesUserId: salesUser?.id || null,
    }),
    { headers: { "content-type": "application/json" } }
  );
}
