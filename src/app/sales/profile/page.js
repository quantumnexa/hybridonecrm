import AuthGuard from "@/components/AuthGuard";

export default function Page() {
  return (
    <AuthGuard allowedRoles={["sales"]}>
      <h1 className="text-heading text-2xl font-bold">Profile</h1>
    </AuthGuard>
  );
}
