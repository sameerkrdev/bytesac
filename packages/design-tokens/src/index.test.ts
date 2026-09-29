import { describe, expect, it } from "vitest";
import { fonts, palette, radii, semantic, surfaces } from "./index";

describe("design tokens match docs/BYTESAC_Design_System.md", () => {
  it("brand palette", () => {
    expect(palette).toEqual({
      space: "#0B1117", slate: "#1F2937", stone: "#6B7280", sage: "#10B981",
      mint: "#6EE7B7", sand: "#EEDCC8", ivory: "#FAFAF8",
    });
  });
  it("semantic colors", () => {
    expect(semantic).toEqual({
      success: "#22C55E", warning: "#F59E0B", danger: "#F87171", info: "#60A5FA",
      borderDark: "#26323D", overlay: "rgba(5, 9, 13, 0.72)",
    });
  });
  it("surfaces, radii and fonts", () => {
    expect(surfaces).toEqual({ card: "#111B24", mutedForeground: "#A1AAB5" });
    expect(radii).toEqual({ sm: 8, md: 12, lg: 16, xl: 20, "2xl": 24, pill: 999 });
    expect(fonts).toEqual({ display: "Manrope", body: "Inter" });
  });
});
