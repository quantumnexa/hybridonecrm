"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Image from "next/image";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const user = data.user;
    let role =
      user?.app_metadata?.role ||
      user?.user_metadata?.role ||
      null;
    if (!role) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      role = prof?.role || "sales";
    }
    router.push(role === "super_admin" ? "/admin" : role === "general_user" ? "/general" : "/sales");
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="fixed left-6 top-4">
        <Image src="/hybrid%20logo.webp" alt="HybridOne" width={80} height={80} />
      </header>
      <main className="grid min-h-screen grid-cols-1 md:grid-cols-2">
        <section className="flex items-center justify-center px-8 py-16">
          <div className="w-full max-w-md">
            <div className="text-heading text-3xl font-bold">HybridOne CRM System</div>
            <p className="text-foreground mt-2">Sign in as Super Admin or Sales</p>
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1 block text-sm text-foreground">Your email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-black/10 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-heading"
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-foreground">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-black/10 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-heading"
                  placeholder="••••••••"
                  required
                />
              </div>
              {error && <div className="text-red-600 text-sm">{error}</div>}
              <button
                type="submit"
                className="mt-2 w-full rounded-lg bg-heading px-4 py-3 text-background shadow-md transition hover:bg-hover disabled:opacity-60 cursor-pointer"
                disabled={loading}
              >
                {loading ? "Signing in..." : "Login"}
              </button>
            </form>
          </div>
        </section>
        <section className="relative hidden md:block">
          <div className="absolute inset-0 bg-gradient-to-br from-heading via-[#7c5cff] to-hover"></div>
          <div className="absolute inset-0 p-8 text-white">
            <div className="text-6xl">✱</div>
            <div className="absolute bottom-8 left-8 right-8">
              <p className="text-sm opacity-80">You can easily</p>
              <h2 className="mt-2 text-2xl font-semibold">
                Get access your personal hub for clarity and productivity
              </h2>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
