"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";

/** Unread count in the header. React Query refetches it on mount and when the tab becomes visible again. */
export function NotificationsBell() {
  const { data } = useQuery({ queryKey: ["notifications", "unread"], queryFn: () => api.notifications({ limit: 1 }), select: (p) => p.unreadCount });
  const n = data ?? 0;
  return (
    <Link href="/notifications" aria-label={n > 0 ? `Notifications, ${n} unread` : "Notifications"} className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-ink-muted hover:text-ink">
      <Bell aria-hidden className="size-5" />
      {n > 0 && <span aria-hidden className="absolute right-1 top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-primary-ink">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}
