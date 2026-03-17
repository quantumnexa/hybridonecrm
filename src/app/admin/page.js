import AuthGuard from "@/components/AuthGuard";

export default function AdminPage() {
  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="min-h-screen bg-background px-6 py-8">
        <h1 className="text-heading text-2xl font-bold">Admin Portal</h1>
        <p className="text-foreground mt-2">Welcome, Super Admin.</p>
      </div>
    </AuthGuard>
  );
}
