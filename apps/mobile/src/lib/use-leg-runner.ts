import { initialLegSignerState, legSignerReducer, runLeg, type LegSignerState, type Signer } from "@repo/app-core";
import type { Leg } from "@repo/validator";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useSigner } from "@/lib/wallet/use-signer";
import { webUrl } from "@/lib/web-url";

/**
 * Runs one leg at a time through the shared `runLeg`. `confirmPrice` holds the fresh server figures; the wallet opens only after the user taps `approve`.
 * Bitcoin legs end in `handoffWeb` (the mobile signer has no `signPsbt`).
 */
export function useLegRunner(operationId: string): {
  state: LegSignerState; leg: Leg | null; run(leg: Leg): Promise<void>; approve(): void; decline(): void;
} {
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const current = useSigner(me);
  // Read the signer when each step signs, not when "Review" was tapped: the user may switch account or chain while the fresh quote is shown.
  const signerRef = useRef(current);
  useEffect(() => { signerRef.current = current; }, [current]);
  const signer = useMemo<Signer>(() => ({
    signSolana: (tx) => signerRef.current.signSolana(tx),
    sendEvm: (tx) => signerRef.current.sendEvm(tx),
  }), []);
  const [state, dispatch] = useReducer(legSignerReducer, initialLegSignerState);
  const [leg, setLeg] = useState<Leg | null>(null);
  const waiting = useRef<((ok: boolean) => void) | null>(null);
  const busy = useRef(false);

  useEffect(() => () => waiting.current?.(false), []);

  const run = useCallback(async (next: Leg) => {
    if (busy.current) return;
    busy.current = true;
    setLeg(next);
    try {
      const op = await runLeg(api, signer, operationId, next.id, dispatch, {
        handoffUrl: webUrl(`/portfolio#operation-${operationId}`) ?? "",
        confirm: () => new Promise<boolean>((resolve) => { waiting.current = resolve; }),
      });
      if (op) qc.setQueryData(["operation", operationId], op);
    } catch {
      // the runner already dispatched `failed`; the screen shows it
    } finally {
      busy.current = false;
      waiting.current = null;
      void qc.invalidateQueries({ queryKey: ["operation", operationId] });
      void qc.invalidateQueries({ queryKey: ["portfolio"] });
    }
  }, [signer, operationId, qc]);

  return { state, leg, run, approve: () => waiting.current?.(true), decline: () => waiting.current?.(false) };
}
