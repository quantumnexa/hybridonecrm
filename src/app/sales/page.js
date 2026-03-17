import AuthGuard from "@/components/AuthGuard";

export default function SalesPage() {
  return (
    <AuthGuard allowedRoles={["sales", "user"]}>
      <div className="min-h-screen bg-background px-6 py-8">
        <h1 className="text-heading text-2xl font-bold">Sales Portal</h1>
        <p className="text-foreground mt-2">Welcome, Sales user.</p>
      </div>
    </AuthGuard>
  );
}
