"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LogoutButton({ className = "", collapsed = false }) {
  const router = useRouter();
  const onClick = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };
  return (
    <button
      onClick={onClick}
      className={`mx-2 flex items-center rounded text-sm transition h-10 ${
        collapsed ? "justify-center px-0" : "gap-3 px-3"
      } text-foreground hover:bg-heading hover:text-background ${className}`}
    >
      <span className="flex h-6 w-6 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-8" />
          <path d="M15 12H3m4-4-4 4 4 4" />
        </svg>
      </span>
      {!collapsed && <span>Logout</span>}
    </button>
  );
}
