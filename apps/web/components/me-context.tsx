"use client";
import type { MeResponse } from "@repo/contracts";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { api } from "@/lib/api";

const InitialMe = createContext<MeResponse | null>(null);

export function MeProvider({ initial, children }: { initial: MeResponse; children: ReactNode }) {
  return <InitialMe.Provider value={initial}>{children}</InitialMe.Provider>;
}

export function useMe() {
  const initial = useContext(InitialMe);
  return useQuery({ queryKey: ["me"], queryFn: () => api.me(), initialData: initial ?? undefined });
}
