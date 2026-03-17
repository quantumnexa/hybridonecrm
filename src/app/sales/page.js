"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";

export default function SalesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/sales/dashboard");
  }, [router]);
  return (
    <AuthGuard allowedRoles={["sales", "user"]}>
      <div className="min-h-screen bg-background px-6 py-8" />
    </AuthGuard>
  );
}
