import AuthGuard from "@/components/AuthGuard";

export default function Page() {
  return (
    <AuthGuard allowedRoles={["sales"]}>
      <h1 className="text-heading text-2xl font-bold">Quotation</h1>
    </AuthGuard>
  );
}
