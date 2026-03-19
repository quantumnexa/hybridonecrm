"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseConfigured } from "@/lib/supabase";

export default function AuthGuard({ allowedRoles, children }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    if (!supabaseConfigured) {
      const t = setTimeout(() => {
        if (!mounted) return;
        setError("Missing Supabase environment variables.");
        setReady(true);
      }, 0);
      return () => {
        mounted = false;
        clearTimeout(t);
      };
    }
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        const session = data.session;
        if (!session) {
          router.replace("/");
          return;
        }
        const role =
          session.user?.app_metadata?.role ||
          session.user?.user_metadata?.role ||
          "sales";
        if (Array.isArray(allowedRoles) && !allowedRoles.includes(role)) {
          router.replace(
            role === "super_admin"
              ? "/admin/dashboard"
              : role === "general_user"
                ? "/general"
                : "/sales/dashboard"
          );
          return;
        }
        setReady(true);
      })
      .catch((e) => {
        if (!mounted) return;
        setError(e?.message || "Failed to load session");
        setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, [router, allowedRoles]);

  if (!ready) {
    return <div className="px-6 py-8 text-foreground">Loading...</div>;
  }
  if (error) {
    return (
      <div className="px-6 py-8">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }
  return children;
}
