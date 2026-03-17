"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";

export default function AdminPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/dashboard");
  }, [router]);
  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="min-h-screen bg-background px-6 py-8" />
    </AuthGuard>
  );
}

