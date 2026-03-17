import AuthGuard from "@/components/AuthGuard";

export default function Page() {
  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <h1 className="text-heading text-2xl font-bold">Reports & Analytics</h1>
    </AuthGuard>
  );
}
