import { ApiError } from "@repo/api-client";
import type { ManagerProfileView } from "@repo/validator";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManagerProfileEditor } from "@/components/profile/manager-profile-editor";
import { withQuery } from "./discovery-fixtures";

const T = "2026-09-01T00:00:00.000Z";
const profile = (over: Partial<ManagerProfileView> = {}): ManagerProfileView => ({
  handle: "ada-l", displayName: "Ada", headline: null, bio: null, experienceYears: 7, background: null, qualifications: ["CFA"], links: [{ label: "Site", url: "https://ada.dev" }],
  status: "draft", hiddenReason: null, publishedAt: null, updatedAt: T, ...over,
});
const client = (p: ManagerProfileView | null, over: Record<string, unknown> = {}) => ({
  getMyManagerProfile: vi.fn().mockResolvedValue({ profile: p }),
  saveMyManagerProfile: vi.fn().mockResolvedValue({ profile: profile() }),
  publishMyManagerProfile: vi.fn().mockResolvedValue({ profile: profile({ status: "published", publishedAt: T }) }),
  unpublishMyManagerProfile: vi.fn().mockResolvedValue({ profile: profile() }),
  ...over,
});
const open = async (c: ReturnType<typeof client>) => { withQuery(<ManagerProfileEditor client={c} />); await screen.findByLabelText("Handle (your public address)"); };

describe("Manager profile editor", () => {
  it("creates a profile: validates, then sends nulls for empty optional fields and parsed lists", async () => {
    const c = client(null);
    await open(c);
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(c.saveMyManagerProfile).not.toHaveBeenCalled();
    expect(screen.getByText("Use 3 to 30 lowercase letters, numbers or hyphens.")).toBeInTheDocument();
    expect(screen.getByText("Enter 2 to 80 characters.")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Handle (your public address)"), "ada-l");
    await userEvent.type(screen.getByLabelText("Display name"), "Ada");
    await userEvent.type(screen.getByLabelText("Years of experience (self-reported)"), "7");
    await userEvent.type(screen.getByLabelText("Qualifications, one per line (self-reported)"), "CFA{enter}FRM");
    await userEvent.type(screen.getByLabelText("Links, one per line: label | https://url"), "Site | https://ada.dev");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(c.saveMyManagerProfile).toHaveBeenCalledWith({
      handle: "ada-l", displayName: "Ada", headline: null, bio: null, experienceYears: 7, background: null, qualifications: ["CFA", "FRM"], links: [{ label: "Site", url: "https://ada.dev" }],
    });
  });

  it("rejects a reserved handle and a non-https link before calling the API", async () => {
    const c = client(null);
    await open(c);
    await userEvent.type(screen.getByLabelText("Handle (your public address)"), "apply");
    await userEvent.type(screen.getByLabelText("Display name"), "Ada");
    await userEvent.type(screen.getByLabelText("Links, one per line: label | https://url"), "Site | http://ada.dev");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(c.saveMyManagerProfile).not.toHaveBeenCalled();
    expect(screen.getByText("That handle is reserved.")).toBeInTheDocument();
    expect(screen.getByText("Up to 5 lines in the form: label | https://url")).toBeInTheDocument();
  });

  it("shows HANDLE_TAKEN inline on the handle field", async () => {
    const c = client(null, { saveMyManagerProfile: vi.fn().mockRejectedValue(new ApiError("HANDLE_TAKEN", 409, "taken")) });
    await open(c);
    await userEvent.type(screen.getByLabelText("Handle (your public address)"), "ada-l");
    await userEvent.type(screen.getByLabelText("Display name"), "Ada");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    const field = screen.getByLabelText("Handle (your public address)");
    expect(await screen.findByText(/already in use/)).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("publishes a draft and unpublishes a published profile", async () => {
    const c = client(profile());
    await open(c);
    expect(screen.getByText("Draft: not public yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(c.publishMyManagerProfile).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Unpublish" })).toBeInTheDocument();
    expect(screen.getByText("Published at /managers/ada-l")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    expect(c.unpublishMyManagerProfile).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("shows the ops reason for a hidden profile and offers no way to publish", async () => {
    await open(client(profile({ status: "hidden", hiddenReason: "Misleading claims" })));
    expect(screen.getByRole("status")).toHaveTextContent("Reason: Misleading claims");
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
  });

  it("labels experience and qualifications as self-reported and shows other failures", async () => {
    const c = client(profile(), { publishMyManagerProfile: vi.fn().mockRejectedValue(new ApiError("INVALID_TRANSITION", 409, "hidden")) });
    await open(c);
    expect(screen.getByText("Experience and qualifications are shown as self-reported. Plain text only.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
