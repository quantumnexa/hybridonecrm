"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function SupabaseStatus() {
  const initialMissing =
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const [status, setStatus] = useState(initialMissing ? "missing" : "checking");
  const [message, setMessage] = useState(
    initialMissing ? "Missing env variables" : ""
  );

  useEffect(() => {
    if (initialMissing) return;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) {
        setStatus("error");
        setMessage(error.message);
      } else {
        try {
          const probe = await supabase.from("___connectivity_probe___").select("*").limit(1);
          const networkOk = probe.error && typeof probe.error.message === "string";
          setStatus(networkOk ? "ok" : "network_error");
          setMessage(data.session ? "Authenticated" : "No session");
        } catch {
          setStatus("network_error");
          setMessage("Network or key error");
        }
      }
    });
  }, [initialMissing]);

  return (
    <div className="rounded-md border p-3 text-sm">
      <div>Supabase: {status}</div>
      <div>{message}</div>
    </div>
  );
}
