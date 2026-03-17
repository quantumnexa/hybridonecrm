"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthGuard({ allowedRoles, children }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
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
        router.replace(role === "super_admin" ? "/admin" : "/sales");
        return;
      }
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [router, allowedRoles]);

  if (!ready) {
    return <div className="px-6 py-8 text-foreground">Loading...</div>;
  }
  return children;
}
