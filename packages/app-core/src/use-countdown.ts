import { useEffect, useState } from "react";

/** Whole seconds left until `untilIso`, ticking once a second; 0 when null or reached. */
export function useCountdown(untilIso: string | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!untilIso) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((new Date(untilIso).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [untilIso]);
  return left;
}
