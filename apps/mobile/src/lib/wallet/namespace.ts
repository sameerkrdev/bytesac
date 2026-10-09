/** AppKit RN connects one wallet per namespace; a chain family maps to its namespace (Bitcoin is not connectable on mobile). */
export const namespaceOfFamily = (family: "evm" | "solana" | "bitcoin"): "eip155" | "solana" | undefined =>
  family === "evm" ? "eip155" : family === "solana" ? "solana" : undefined;
