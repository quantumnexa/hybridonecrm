"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession();
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setError(err.message);
    } else {
      setInfo("Password updated. You can now sign in.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <h1 className="text-heading text-2xl font-bold">Reset Password</h1>
      <form onSubmit={onSubmit} className="mt-6 max-w-md space-y-4">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-black/10 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-heading"
          placeholder="New password"
          required
        />
        {error && <div className="text-red-600 text-sm">{error}</div>}
        {info && <div className="text-green-600 text-sm">{info}</div>}
        <button
          type="submit"
          className="rounded-md bg-heading px-4 py-2 text-background hover:bg-hover disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Updating..." : "Update Password"}
        </button>
      </form>
    </div>
  );
}
