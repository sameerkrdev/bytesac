import type { Leg, OperationView } from "@repo/validator";

/** Whether a leg buys its asset with USDC (invest, repair, the buy side of a rebalance) or sells it back to USDC. */
export const legBuys = (kind: OperationView["kind"], leg: Pick<Leg, "toDeploymentId">): boolean =>
  kind === "invest" || kind === "repair" || (kind === "rebalance" && leg.toDeploymentId !== null);
