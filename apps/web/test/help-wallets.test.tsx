import { render, screen } from "@testing-library/react";
import { WALLET_HELP } from "@repo/app-core";
import { describe, expect, it } from "vitest";
import WalletHelpPage from "@/app/(app)/help/wallets/page";

describe("wallet help page", () => {
  it("renders all eight questions as disclosures and opens the one in the URL hash", () => {
    window.location.hash = "#move-chain";
    const { container } = render(<WalletHelpPage />);
    expect(screen.getByRole("heading", { name: "How wallets work" })).toBeInTheDocument();
    for (const h of WALLET_HELP) expect(screen.getByText(h.question)).toBeInTheDocument();
    expect(container.querySelectorAll("details")).toHaveLength(8);
    expect(container.querySelector("#move-chain")).toHaveAttribute("open");
  });
});
