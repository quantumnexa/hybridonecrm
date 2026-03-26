"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import LogoutButton from "./LogoutButton";
import { supabase, getUserCached } from "@/lib/supabase";

const icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
    </svg>
  ),
  leads: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7h18M3 12h18M3 17h18" />
    </svg>
  ),
  appointments: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 2v4M17 2v4M3 10h18M5 14h14M5 18h10" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
    </svg>
  ),
  projects: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3h18v6H3zM3 13h10v8H3zM15 13h6v8h-6z" />
    </svg>
  ),
  quotation: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h12l4 4v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M8 13h8M8 17h8M8 9h4" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3h18v18H3z" />
      <path d="M7 13l3 3 7-7" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M19.4 15a7.8 7.8 0 0 0 .1-6l2-3.4-2.8-2.8-3.4 2a7.8 7.8 0 0 0-6-.1l-2-3.4-2.8 2.8 2 3.4a7.8 7.8 0 0 0-.1 6l-2 3.4 2.8 2.8 3.4-2a7.8 7.8 0 0 0 6 .1l2 3.4 2.8-2.8-2-3.4z" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  tasks: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h10M7 12h10M7 16h6" />
    </svg>
  ),
  notifications: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  ),
};

export default function Sidebar({ items = [], title = "", logo = true }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const width = collapsed ? "w-16" : "w-64";
  const [notifUserId, setNotifUserId] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadUnreadCount = useCallback(async (uid) => {
    if (!uid) return;
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .eq("is_read", false);
    setUnreadCount(Number(count || 0));
  }, []);

  useEffect(() => {
    const run = async () => {
      const u = await getUserCached();
      const uid = u?.id || null;
      setNotifUserId(uid);
      if (uid) await loadUnreadCount(uid);
    };
    run();
  }, [loadUnreadCount]);

  useEffect(() => {
    if (!notifUserId) return;
    const ch = supabase
      .channel(`notifications:${notifUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${notifUserId}` },
        async () => {
          await loadUnreadCount(notifUserId);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [notifUserId, loadUnreadCount]);

  return (
    <aside
      className={`${width} sticky top-3 m-3 rounded-xl shadow-lg border border-black/10 bg-white transition-all duration-200 flex flex-col overflow-hidden`}
      style={{ height: "calc(100vh - 24px)" }}
    >
      <div className="flex h-14 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          {logo && <Image src="/hybrid%20logo.webp" alt="HybridOne" width={28} height={28} />}
          {!collapsed && <span className="text-heading font-semibold">{title}</span>}
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="rounded p-2 text-foreground hover:bg-heading hover:text-background"
          aria-label="Toggle sidebar"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h10M4 18h16" />
          </svg>
        </button>
      </div>
      <nav className="mt-2 space-y-1 px-1 flex-1 overflow-y-auto pb-16">
        {items.map((item) => {
          const active = pathname?.startsWith(item.href);
          const showBadge = item.icon === "notifications" && unreadCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mx-2 flex items-center rounded text-sm transition h-10 ${
                collapsed ? "justify-center px-0" : "gap-3 px-3"
              } ${active ? "bg-hover text-background" : "text-foreground hover:bg-heading hover:text-background"}`}
            >
              <span className="relative flex h-6 w-6 items-center justify-center">
                {icons[item.icon] || icons.dashboard}
                {collapsed && showBadge && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </span>
              {!collapsed && (
                <span className="flex-1 truncate">
                  {item.label}
                </span>
              )}
              {!collapsed && showBadge && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="pb-3 mt-auto">
        <LogoutButton collapsed={collapsed} />
      </div>
    </aside>
  );
}
