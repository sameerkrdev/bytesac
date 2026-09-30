import { ApiError } from "@repo/api-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationDocuments } from "@/components/organization/organization-documents";
import { orgDetail, version } from "./org-fixtures";

const DOC = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70";
const client = (over: Record<string, unknown> = {}) => ({
  presignOrganizationDocument: vi.fn().mockResolvedValue({ documentId: DOC, uploadUrl: "https://r2.example/put", headers: { "Content-Type": "application/pdf" } }),
  confirmOrganizationDocument: vi.fn().mockResolvedValue(orgDetail()),
  unlinkOrganizationDocument: vi.fn().mockResolvedValue(orgDetail()),
  ...over,
});
const pdf = () => new File(["%PDF-1.4"], "id.pdf", { type: "application/pdf" });
afterEach(() => vi.unstubAllGlobals());

describe("OrganizationDocuments", () => {
  it("lists one row per required type plus the optional licence", () => {
    render(<OrganizationDocuments org={orgDetail()} version={version()} readOnly={false} onChange={vi.fn()} client={client()} />);
    expect(screen.getByText("Government ID")).toBeInTheDocument();
    expect(screen.getByText("Proof of address")).toBeInTheDocument();
    expect(screen.getByText("Licence or registration (optional)")).toBeInTheDocument();
  });

  it("uploads: presign, PUT with signed headers, then confirm", async () => {
    const put = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", put);
    const c = client();
    const onChange = vi.fn();
    render(<OrganizationDocuments org={orgDetail()} version={version()} readOnly={false} onChange={onChange} client={c} />);
    const file = pdf();
    await userEvent.upload(screen.getByLabelText("Choose file for Government ID"), file);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(c.presignOrganizationDocument).toHaveBeenCalledWith(orgDetail().id, { documentType: "government_id", contentType: "application/pdf", sizeBytes: file.size });
    expect(put).toHaveBeenCalledWith("https://r2.example/put", { method: "PUT", body: file, headers: { "Content-Type": "application/pdf" } });
    expect(c.confirmOrganizationDocument).toHaveBeenCalledWith(orgDetail().id, DOC);
  });

  it("shows the rejected state when confirm refuses the file", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const c = client({ confirmOrganizationDocument: vi.fn().mockRejectedValue(new ApiError("DOCUMENT_REJECTED", 422, "no")) });
    render(<OrganizationDocuments org={orgDetail()} version={version()} readOnly={false} onChange={vi.fn()} client={c} />);
    await userEvent.upload(screen.getByLabelText("Choose file for Government ID"), pdf());
    expect(await screen.findByText("Not accepted")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("File not accepted");
  });

  it("rejects a wrong type client-side without calling the API", async () => {
    const c = client();
    render(<OrganizationDocuments org={orgDetail()} version={version()} readOnly={false} onChange={vi.fn()} client={c} />);
    await userEvent.upload(screen.getByLabelText("Choose file for Government ID"), new File(["x"], "a.exe", { type: "application/x-msdownload" }), { applyAccept: false });
    expect(await screen.findByText("Upload a PDF, JPEG or PNG file.")).toBeInTheDocument();
    expect(c.presignOrganizationDocument).not.toHaveBeenCalled();
  });

  it("shows an uploaded document and removes it from the draft", async () => {
    const v = version({ documents: [{ id: DOC, documentType: "government_id", contentType: "application/pdf", sizeBytes: 2048, status: "uploaded", uploadedAt: "2026-09-29T00:00:00.000Z" }] });
    const c = client();
    render(<OrganizationDocuments org={orgDetail()} version={v} readOnly={false} onChange={vi.fn()} client={c} />);
    expect(screen.getByText("Uploaded")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove from draft" }));
    expect(c.unlinkOrganizationDocument).toHaveBeenCalledWith(orgDetail().id, DOC);
  });
});
