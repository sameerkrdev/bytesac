import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ID, renderApp } from "./invest-fixtures";

const notifications = vi.fn();
const markNotificationsRead = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/api", () => ({ api: { notifications: (q: unknown) => notifications(q), markNotificationsRead: (b: unknown) => markNotificationsRead(b) } }));
import { NotificationsBell } from "@/components/notifications/bell";
import { Inbox } from "@/components/notifications/inbox";

const item = (n: number, readAt: string | null = null) => ({ id: ID(70 + n), kind: "drifted", basketId: null, positionId: null, title: `Title ${n}`, body: `Body ${n}`, link: `/portfolio/x${n}/rebalance`, readAt, createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString() });

beforeEach(() => vi.clearAllMocks());

describe("Notifications", () => {
  it("the bell shows the unread count in its label", async () => {
    notifications.mockResolvedValue({ items: [], unreadCount: 3, nextCursor: null });
    renderApp(<NotificationsBell />);
    expect(await screen.findByRole("link", { name: "Notifications, 3 unread" })).toHaveAttribute("href", "/notifications");
  });

  it("the bell has a plain label when everything is read", async () => {
    notifications.mockResolvedValue({ items: [], unreadCount: 0, nextCursor: null });
    renderApp(<NotificationsBell />);
    expect(await screen.findByRole("link", { name: "Notifications" })).toBeInTheDocument();
  });

  it("the inbox lists notices with an unread marker and loads more with the cursor", async () => {
    notifications.mockResolvedValueOnce({ items: [item(1), item(2, "2026-10-01T00:00:00.000Z")], unreadCount: 1, nextCursor: "c1" }).mockResolvedValueOnce({ items: [item(3)], unreadCount: 1, nextCursor: null });
    renderApp(<Inbox />);
    expect(await screen.findByText("Title 1")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Unread" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Title 1/ })).toHaveAttribute("href", "/portfolio/x1/rebalance");
    expect(screen.getAllByText("3 hours ago")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Title 3")).toBeInTheDocument();
    expect(notifications).toHaveBeenLastCalledWith({ cursor: "c1" });
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("Mark all read calls the API", async () => {
    notifications.mockResolvedValue({ items: [item(1)], unreadCount: 1, nextCursor: null });
    renderApp(<Inbox />);
    await userEvent.click(await screen.findByRole("button", { name: "Mark all read" }));
    expect(markNotificationsRead).toHaveBeenCalledWith({ all: true });
  });
});
