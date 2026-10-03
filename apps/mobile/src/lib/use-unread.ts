import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/** The unread count of the notifications inbox (the tab badge's query; the inbox invalidates it). */
export const useUnreadCount = (): number =>
  useQuery({ queryKey: ["notifications", "unread"], queryFn: () => api.notifications({ limit: 1 }), select: (p) => p.unreadCount }).data ?? 0;
