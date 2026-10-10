"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

type Surface = "app" | "marketing";

const SurfaceContext = createContext<Surface>("app");

/** "marketing" on the apex host (set by proxy.ts) and on the waitlist page: calls to action become "Join the waitlist". */
export function SurfaceProvider({ value, children }: { value: Surface; children: ReactNode }) {
  return <SurfaceContext.Provider value={value}>{children}</SurfaceContext.Provider>;
}

export const useMarketing = () => useContext(SurfaceContext) === "marketing";

/** The waitlist form sits on the waitlist page (served at "/" on the apex); elsewhere jump there. */
export function useJoinHref() {
  const path = usePathname();
  return path === "/" || path === "/waitlist" ? "#join" : "/#join";
}
