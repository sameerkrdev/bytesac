// Act 3 — the feature tour (shots 14–24). Real UI captured in the dark theme on the mock API.
import React from "react";
import { AbsoluteFill } from "remotion";
import { mono, sans } from "../lib/fonts";
import { clamp, easeInOut, easeOut, mix, ramp, spring } from "../lib/motion";
import { Caption, CX, CY, DarkPlate, Disc, dk, focusIn, H, ratio, Shot, Tilt, Ui, UI, W } from "./kit";
import { BAR } from "./timeline";

const Cap: React.FC<{ lt: number; text: string; text2?: string; at?: number; out?: number; top?: number; size?: number }> = ({ lt, text, text2, at = 0.2, out, top = 870, size = 58 }) => (
  <div style={{ position: "absolute", left: 0, right: 0, top }}>
    <Caption lt={lt} text={text} at={at} out={out} size={size} />
    {text2 && <Caption lt={lt} text={text2} at={at + 0.45} out={out} size={size} color={dk.inkMuted} />}
  </div>
);

const exitOf = (lt: number, dur: number) => ramp(lt, dur - 0.22, 0.22, easeInOut);
const exitStyle = (e: number): React.CSSProperties => ({ opacity: 1 - e, filter: e > 0 ? `blur(${e * 12}px)` : undefined });

/* ------------------------------------------------------------------------------- 14 · verified managers */

const Managers: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="managers" t={t}>
    {(lt, dur) => {
      const p = ramp(lt, 0, dur, (x) => easeOut(x));
      const enter = ramp(lt, 0, 0.8);
      const e = exitOf(lt, dur);
      const w = 1320;
      const chip = spring(lt - 1.3, 260, 18);
      return (
        <AbsoluteFill>
          <DarkPlate t={t} />
          <div style={{ ...exitStyle(e), position: "absolute", inset: 0 }}>
            <Tilt p={p} from={[22, -16, 0.86]} to={[7, -4, 1]}>
              <Ui src="basket-hero" w={w} ratio={ratio("basketHero")} clip={0.8} style={{ left: CX - w / 2, top: 120, ...focusIn(enter, 60) }} />
              <div style={{ position: "absolute", left: CX + w / 2 - 330, top: 90, transform: `scale(${chip})`, transformOrigin: "100% 50%", display: "flex", alignItems: "center", gap: 10,
                padding: "12px 20px", borderRadius: 999, background: "rgba(14,23,38,0.92)", border: "1px solid rgba(138,166,255,0.5)", color: dk.ink, fontFamily: sans, fontSize: 24,
                boxShadow: `0 0 ${40 + 20 * Math.sin(lt * 3)}px rgba(138,166,255,${0.35 + 0.15 * Math.sin(lt * 3)})` }}>
                <span style={{ width: 26, height: 26, borderRadius: 13, background: dk.accentStrong, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>✓</span>
                Verified by Bytesac
              </div>
            </Tilt>
            <Cap lt={lt} text="Baskets built by *experienced *managers." text2="Verified by Bytesac." at={0.35} top={800} />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ------------------------------------------------------------------------- 15 · the journey, label by label */

const STEPS = ["Sign in with your wallet", "Discover baskets", "Invest from USDC", "Track every holding"];

const Journey: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="tour" t={t}>
    {(lt, dur) => {
      const step = dur / STEPS.length;
      const idx = Math.min(STEPS.length - 1, Math.floor(lt / step));
      const e = exitOf(lt, dur);
      const stage = (i: number, node: React.ReactNode) => {
        const local = lt - i * step;
        const inP = ramp(local, 0, 0.55, easeOut);
        const outP = ramp(local, step - 0.25, 0.3, easeInOut);
        if (local < -0.1 || local > step + 0.1) return null;
        return (
          <div key={i} style={{ position: "absolute", inset: 0, perspective: 1800 }}>
            <div style={{ position: "absolute", inset: 0, transform: `translateX(${(1 - inP) * 160 - outP * 160}px) rotateY(${(1 - inP) * -28 + outP * 28}deg) scale(${1 + local * 0.012})`,
              opacity: clamp(inP * 1.3) * (1 - outP), filter: inP < 1 || outP > 0 ? `blur(${(1 - inP + outP) * 10}px)` : undefined }}>
              {node}
            </div>
          </div>
        );
      };
      const cardW = 440;
      return (
        <AbsoluteFill>
          <DarkPlate t={t} />
          <div style={{ ...exitStyle(e), position: "absolute", inset: 0 }}>
            {/* Left rail: one label lights at a time (ref4's sidebar tour) */}
            <div style={{ position: "absolute", left: 110, top: CY - 190, display: "flex", flexDirection: "column", gap: 40 }}>
              {STEPS.map((s, i) => {
                const on = i === idx;
                const shown = ramp(lt, i * 0.08, 0.5);
                return (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 18, fontFamily: sans, fontSize: on ? 54 : 38, color: on ? dk.ink : dk.inkFaint, opacity: shown * (on ? 1 : 0.6), letterSpacing: "-0.02em" }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: on ? dk.accent : dk.lineStrong, boxShadow: on ? "0 0 20px rgba(138,166,255,0.9)" : undefined }} />
                    {s}
                  </div>
                );
              })}
            </div>
            <div style={{ position: "absolute", left: 700, right: 0, top: 0, bottom: 0 }}>
              {stage(0, <Ui src="signin" w={640} ratio={ratio("signin")} style={{ left: 300, top: CY - 360 }} />)}
              {stage(1, <>
                <Ui src="discover-card-balanced" w={cardW} ratio={ratio("discoverCard")} style={{ left: 20, top: CY - 190, transform: "rotate(-3deg)" }} />
                <Ui src="discover-card-solana" w={cardW} ratio={ratio("discoverCard")} style={{ left: 430, top: CY - 230 }} />
                <div style={{ position: "absolute", left: 30, top: CY + 220, width: 760, height: 80, borderRadius: 40, background: dk.surface, border: "1px solid rgba(255,255,255,0.1)",
                  display: "flex", alignItems: "center", padding: "0 30px", fontFamily: sans, fontSize: 26, color: dk.inkMuted, boxSizing: "border-box" }}>
                  Describe what you want…
                </div>
              </>)}
              {stage(2, <Ui src="invest-split" w={980} ratio={ratio("investSplit")} style={{ left: 60, top: CY - 330 }} />)}
              {stage(3, <Ui src="portfolio-value" w={1120} ratio={ratio("portfolioValue")} style={{ left: 0, top: CY - 165 }} />)}
            </div>
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* --------------------------------------------------------------------------------------- 16 · 7 chains */

const CHAINS = [
  { sym: "ETH", name: "Ethereum" }, { sym: "BASE", name: "Base" }, { sym: "BNB", name: "BNB Chain" },
  { sym: "ARB", name: "Arbitrum" }, { sym: "POL", name: "Polygon" }, { sym: "BTC", name: "Bitcoin" },
];

const Chains: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="chains" t={t}>
    {(lt, dur) => {
      const e = exitOf(lt, dur);
      const hub = spring(lt - 0.05, 200, 20);
      const rot = lt * 7;
      const cy = CY - 110;
      return (
        <AbsoluteFill>
          <DarkPlate t={t} />
          <div style={{ ...exitStyle(e), position: "absolute", inset: 0, transform: `scale(${1.04 - lt * 0.012})` }}>
            <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
              {CHAINS.map((c, i) => {
                const a = ((i / CHAINS.length) * 360 + rot - 90) * (Math.PI / 180);
                const x = CX + Math.cos(a) * 660, y = cy + Math.sin(a) * 270;
                const d = ramp(lt, 0.3 + i * 0.12, 0.6, easeOut);
                const pulse = ((lt * 0.8 + i * 0.17) % 1);
                return (
                  <g key={c.sym}>
                    <line x1={CX} y1={cy} x2={mix(CX, x, d)} y2={mix(cy, y, d)} stroke="rgba(138,166,255,0.7)" strokeWidth={2.4} />
                    {d >= 1 && <circle cx={mix(CX, x, pulse)} cy={mix(cy, y, pulse)} r={7} fill="#DCE6FF" opacity={Math.sin(pulse * Math.PI)} />}
                  </g>
                );
              })}
            </svg>
            {CHAINS.map((c, i) => {
              const a = ((i / CHAINS.length) * 360 + rot - 90) * (Math.PI / 180);
              const x = CX + Math.cos(a) * 660, y = cy + Math.sin(a) * 270;
              const p = ramp(lt, 0.7 + i * 0.12, 0.45);
              return (
                <div key={c.sym} style={{ position: "absolute", left: x - 90, top: y - 44, width: 180, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, ...focusIn(p, 10) }}>
                  <Disc sym={c.sym} size={76} />
                  <div style={{ fontFamily: sans, fontSize: 30, color: dk.inkMuted, whiteSpace: "nowrap" }}>{c.name}</div>
                </div>
              );
            })}
            <div style={{ position: "absolute", left: CX - 90, top: cy - 90, width: 180, height: 180, borderRadius: 90, background: "radial-gradient(circle, #16243F, #0B1426)",
              border: "1px solid rgba(138,166,255,0.6)", boxShadow: "0 0 80px rgba(138,166,255,0.35)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, transform: `scale(${hub})` }}>
              <Disc sym="USDC" size={64} />
              <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: "0.1em", color: dk.ink }}>SOLANA</div>
            </div>
            <Cap lt={lt} text="Fund with *USDC." text2="Own assets on 7 chains." at={0.5} top={880} />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ------------------------------------------------------------------------------ 17 · swaps and bridges */

const LEGS = [
  { kind: "Fees", from: "USDC", to: "USDC", chain: "Solana" },
  { kind: "Swap", from: "USDC", to: "SOL", chain: "Solana" },
  { kind: "Cross-chain", from: "USDC", to: "BTC", chain: "Bitcoin" },
  { kind: "Cross-chain", from: "USDC", to: "ETH", chain: "Base" },
  { kind: "Cross-chain", from: "USDC", to: "LINK", chain: "Arbitrum" },
];

const Legs: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="legs" t={t}>
    {(lt, dur) => {
      const e = exitOf(lt, dur);
      const p = ramp(lt, 0, dur);
      return (
        <AbsoluteFill>
          <DarkPlate t={t} />
          <div style={{ ...exitStyle(e), position: "absolute", inset: 0 }}>
            <Tilt p={p} from={[10, 22, 0.92]} to={[4, 12, 0.98]}>
              <Ui src="invest-split" w={720} ratio={ratio("investSplit")} style={{ left: 150, top: 170, ...focusIn(ramp(lt, 0, 0.6), 40) }} />
            </Tilt>
            <div style={{ position: "absolute", left: 1020, top: 150, display: "flex", flexDirection: "column", gap: 16 }}>
              {LEGS.map((l, i) => {
                const inP = ramp(lt, 0.25 + i * 0.22, 0.45, easeOut);
                const done = ramp(lt, 0.9 + i * 0.32, 0.25);
                return (
                  <div key={i} style={{ width: 720, height: 96, borderRadius: 20, background: "linear-gradient(170deg, #142037, #0C1424)", border: `1px solid rgba(255,255,255,${0.07 + done * 0.06})`,
                    display: "flex", alignItems: "center", gap: 20, padding: "0 26px", boxSizing: "border-box", fontFamily: sans,
                    transform: `translateX(${(1 - inP) * 220}px)`, opacity: clamp(inP * 1.4), filter: inP < 1 ? `blur(${(1 - inP) * 8}px)` : undefined }}>
                    <div style={{ fontFamily: mono, fontSize: 18, color: dk.inkFaint, width: 26 }}>{i + 1}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Disc sym={l.from} size={34} />
                      <span style={{ color: dk.inkFaint, fontSize: 22 }}>→</span>
                      <Disc sym={l.to} size={34} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 26, color: dk.ink }}>{l.kind === "Fees" ? "All fees, in one transfer" : `${l.kind} · ${l.from} → ${l.to}`}</div>
                      <div style={{ fontSize: 19, color: dk.inkMuted, marginTop: 2 }}>on {l.chain}</div>
                    </div>
                    <div style={{ fontSize: 19, padding: "8px 14px", borderRadius: 999, color: done > 0.5 ? "#7EE2A8" : dk.inkMuted, background: done > 0.5 ? "rgba(126,226,168,0.12)" : "rgba(255,255,255,0.05)" }}>
                      {done > 0.5 ? "✓ Signed by you" : "Ready to sign"}
                    </div>
                  </div>
                );
              })}
            </div>
            <Cap lt={lt} text="Every swap and bridge," text2="routed for you." at={0.4} top={800} />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ------------------------------------------------------------------------- 18 · donut: crypto + tokenized */

const SLICES = [
  { sym: "BTC", label: "Bitcoin", pct: 30, fill: "#EAF0F8" },
  { sym: "ETH", label: "Ether", pct: 25, fill: "#B9C8F2" },
  { sym: "SOL", label: "Solana", pct: 10, fill: "#8AA6FF" },
  { sym: "TBILL", label: "Tokenized T-bills", pct: 25, fill: "#5A7BE0" },
  { sym: "GOLD", label: "Tokenized gold", pct: 10, fill: "#3D63D9" },
];

const Donut: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="donut" t={t}>
    {(lt, dur) => {
      const e = exitOf(lt, dur);
      const R = 250, th = 64, cx = CX, cy = CY - 50;
      const spin = lt * 9;
      let acc = 0;
      const arcs = SLICES.map((s, i) => {
        const a0 = acc, a1 = acc + s.pct;
        acc = a1;
        const grow = ramp(lt, 0.1 + i * 0.16, 0.5, easeOut);
        const end = a0 + (a1 - a0) * grow;
        const toXY = (pct: number, r: number) => {
          const ang = ((pct / 100) * 360 + spin - 90) * (Math.PI / 180);
          return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r] as const;
        };
        const gap = 0.5;
        const [x0, y0] = toXY(a0 + gap, R), [x1, y1] = toXY(end - gap, R);
        const large = end - a0 > 50 ? 1 : 0;
        const mid = (a0 + a1) / 2;
        const [lx, ly] = toXY(mid, R + 50);
        const [ex, ey] = toXY(mid, R + 110);
        const right = ex > cx;
        return { s, i, grow, d: grow > 0.01 ? `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}` : "", lx, ly, ex, ey, right };
      });
      return (
        <AbsoluteFill>
          <DarkPlate t={t} />
          <div style={{ ...exitStyle(e), position: "absolute", inset: 0 }}>
            <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
              <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={th} />
              {arcs.map((a) => <path key={a.s.sym} d={a.d} fill="none" stroke={a.s.fill} strokeWidth={th} />)}
              {arcs.map((a) => {
                const p = ramp(lt, 0.6 + a.i * 0.16, 0.4);
                return <polyline key={`l${a.s.sym}`} points={`${a.lx},${a.ly} ${a.ex},${a.ey} ${a.ex + (a.right ? 120 : -120)},${a.ey}`} fill="none" stroke="rgba(234,240,248,0.45)" strokeWidth={1.2} opacity={p} />;
              })}
            </svg>
            {arcs.map((a) => {
              const p = ramp(lt, 0.75 + a.i * 0.16, 0.4);
              return (
                <div key={`t${a.s.sym}`} style={{ position: "absolute", top: a.ey - 44, left: a.right ? a.ex + 130 : undefined, right: a.right ? undefined : W - (a.ex - 130),
                  textAlign: a.right ? "left" : "right", fontFamily: sans, ...focusIn(p, 0) }}>
                  <div style={{ fontFamily: mono, fontSize: 38, color: dk.ink }}>{a.s.pct}%</div>
                  <div style={{ fontSize: 30, color: dk.inkMuted, whiteSpace: "nowrap" }}>{a.s.label}</div>
                </div>
              );
            })}
            <div style={{ position: "absolute", left: cx - 180, top: cy - 50, width: 360, textAlign: "center", fontFamily: sans, ...focusIn(ramp(lt, 0.4, 0.5), 0) }}>
              <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: "0.14em", color: dk.inkFaint }}>EXAMPLE BASKET</div>
              <div style={{ fontSize: 28, color: dk.ink, marginTop: 10, lineHeight: 1.15 }}>Balanced Digital<br />&amp; Real-World</div>
            </div>
            <Cap lt={lt} text="Crypto *and tokenized" text2="stocks, funds and gold." at={0.5} top={845} />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ------------------------------------------------------------------------------------- 19 · one plan */

const Plan: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="plan" t={t}>
    {(lt, dur) => {
      const e = exitOf(lt, dur);
      const p = ramp(lt, 0, dur);
      const w = 1400;
      const h = w / ratio("position");
      const scan = ramp(lt, 0.6, 2.4, easeInOut);
      return (
        <AbsoluteFill>
          <DarkPlate t={t} />
          <div style={{ ...exitStyle(e), position: "absolute", inset: 0 }}>
            <Tilt p={p} from={[26, 0, 0.82]} to={[12, 0, 0.9]}>
              <Ui src="position-core" w={w} ratio={ratio("position")} style={{ left: CX - w / 2, top: 30, ...focusIn(ramp(lt, 0, 0.7), 80) }} />
              {/* A light bar sweeps the holdings rows */}
              <div style={{ position: "absolute", left: CX - w / 2, top: 30 + h * mix(0.22, 0.86, scan), width: w, height: 60, background: "linear-gradient(90deg, rgba(138,166,255,0), rgba(138,166,255,0.16), rgba(138,166,255,0))", opacity: Math.sin(scan * Math.PI) }} />
            </Tilt>
            <Cap lt={lt} text="One basket. Many assets." text2="One plan, signed by you." at={0.35} top={860} />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ------------------------------------------------------------------------------- 20 · light wedge */

const NotAll: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="notAll" t={t}>
    {(lt, dur) => {
      const a = mix(-20, 150, ramp(lt, 0, dur + 0.3, easeInOut));
      const on = ramp(lt, 0, 0.25) * (1 - ramp(lt, dur - 0.3, 0.3));
      return (
        <AbsoluteFill style={{ background: dk.deep }}>
          <div style={{ position: "absolute", left: 1010 - 2000, top: CY + 10 - 2000, width: 4000, height: 4000, opacity: on,
            background: `conic-gradient(from ${a}deg at 50% 50%, rgba(234,240,248,0.0) 0deg, rgba(234,240,248,0.85) 4deg, rgba(234,240,248,0.25) 26deg, rgba(234,240,248,0) 34deg, rgba(234,240,248,0) 360deg)` }} />
          <div style={{ position: "absolute", left: 360, top: CY - 30 }}>
            <Caption lt={lt} text="And that's not all." at={0.15} stagger={0.12} size={64} align="left" />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ------------------------------------------------------------------------- 21 · manager update: apply or skip */

const Rebalance: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="rebalance" t={t}>
    {(lt, dur) => {
      const e = exitOf(lt, dur);
      const notice = ramp(lt, 0, 0.5) * (1 - ramp(lt, 1.15, 0.4));
      const ver = ramp(lt, 1.2, 0.6, easeOut);
      const dec = ramp(lt, 1.45, 0.6, easeOut);
      const press = lt > 2.9 && lt < 3.05 ? 0.96 : 1;
      return (
        <AbsoluteFill>
          <DarkPlate t={t} />
          <div style={{ ...exitStyle(e), position: "absolute", inset: 0 }}>
            <Ui src="attention-update" w={900} ratio={ratio("attention")} style={{ left: CX - 450, top: 210, opacity: notice, transform: `scale(${mix(0.94, 1.02, notice)})`, filter: notice < 1 ? `blur(${(1 - notice) * 10}px)` : undefined }} />
            {ver > 0 && <Ui src="rebalance-version" w={1000} ratio={ratio("rebalanceVersion")} style={{ left: 110, top: 110, ...focusIn(ver, 50), transform: `translateX(${(1 - ver) * -120}px)` }} />}
            {dec > 0 && <Ui src="rebalance-decide" w={600} ratio={ratio("rebalanceDecide")} style={{ left: 1180, top: 200, ...focusIn(dec, 50), transform: `translateX(${(1 - dec) * 120}px) scale(${press})` }} />}
            <Cap lt={lt} text="Manager publishes an update?" text2="You apply it — or skip it." at={0.3} top={820} />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ----------------------------------------------------------------------------------------- 22 · drift */

const Drift: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="drift" t={t}>
    {(lt, dur) => {
      const e = exitOf(lt, dur);
      const inP = ramp(lt, 0, 0.5, easeOut);
      const w = 1300;
      return (
        <AbsoluteFill>
          <DarkPlate t={t} />
          <div style={{ ...exitStyle(e), position: "absolute", inset: 0 }}>
            <Ui src="attention-drift" w={w} ratio={ratio("attention")} glow={1.6} style={{ left: CX - w / 2, top: 180, ...focusIn(inP, 40), transform: `scale(${1 + lt * 0.02})` }} />
            <Cap lt={lt} text="Drifted? Rebalance to target," text2="or keep it custom." at={0.15} top={800} />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ------------------------------------------------------------------------------------- 23 · repair */

const Repair: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="repair" t={t}>
    {(lt, dur) => {
      const e = exitOf(lt, dur);
      const inP = ramp(lt, 0, 0.45, easeOut);
      const choose = ramp(lt, 0.9, 0.3);
      return (
        <AbsoluteFill>
          <DarkPlate t={t} />
          <div style={{ ...exitStyle(e), position: "absolute", inset: 0 }}>
            {/* Rebuilt from the repair page's copy (no repair fixture in the mock API) */}
            <div style={{ position: "absolute", left: CX - 470, top: 170, width: 940, borderRadius: 28, background: dk.surface, border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.55)", padding: 40, boxSizing: "border-box", fontFamily: sans, ...focusIn(inP, 40), transform: `scale(${1 + lt * 0.02})` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <Disc sym="SOL" size={46} />
                <div style={{ fontSize: 34, color: dk.ink }}>SOL on Solana</div>
                <div style={{ marginLeft: "auto", fontSize: 20, padding: "8px 14px", borderRadius: 999, color: "#F5C26B", background: "rgba(245,194,107,0.12)" }}>Needs repair</div>
              </div>
              <div style={{ marginTop: 18, fontSize: 24, color: dk.inkMuted }}>Your wallet holds less than your baskets record.</div>
              <div style={{ marginTop: 34, display: "flex", gap: 18 }}>
                {["Buy back", "Sync"].map((b, i) => (
                  <div key={b} style={{ padding: "18px 34px", borderRadius: 999, fontSize: 26, color: i === 0 ? dk.paperInk : dk.ink, background: i === 0 ? dk.ink : "transparent",
                    border: i === 0 ? undefined : "1px solid rgba(255,255,255,0.2)", boxShadow: choose > 0 && i === Math.floor(lt * 1.8) % 2 ? "0 0 0 4px rgba(138,166,255,0.45)" : undefined }}>{b}</div>
                ))}
              </div>
            </div>
            <Cap lt={lt} text="Something moved?" text2="Buy it back, or sync your records." at={0.1} top={800} />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* -------------------------------------------------------------------------------- 24 · notifications */

const Notify: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="notify" t={t}>
    {(lt, dur) => {
      const e = exitOf(lt, dur);
      const w = 1080;
      const tiles = [
        { label: "Inbox", glyph: "🔔" }, { label: "Email", glyph: "✉" }, { label: "Push", glyph: "◉" },
      ];
      return (
        <AbsoluteFill>
          <DarkPlate t={t} />
          <div style={{ ...exitStyle(e), position: "absolute", inset: 0 }}>
            <Ui src="notifications-list" w={w} ratio={ratio("notifications")} style={{ left: CX - w / 2, top: 160, ...focusIn(ramp(lt, 0, 0.5), 40), transform: `scale(${1 + lt * 0.015})` }} />
            <div style={{ position: "absolute", left: 0, right: 0, top: 500, display: "flex", justifyContent: "center", gap: 48 }}>
              {tiles.map((tl, i) => {
                const p = spring(lt - 0.5 - i * 0.18, 240, 18);
                return (
                  <div key={tl.label} style={{ width: 270, height: 190, borderRadius: 28, background: "linear-gradient(170deg, #142037, #0C1424)", border: "1px solid rgba(255,255,255,0.08)",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, transform: `scale(${p}) translateY(${Math.sin(lt * 2 + i) * 5}px)`, fontFamily: sans }}>
                    <div style={{ fontSize: 54, color: dk.accent }}>{tl.glyph}</div>
                    <div style={{ fontSize: 32, color: dk.ink }}>{tl.label}</div>
                  </div>
                );
              })}
            </div>
            <Cap lt={lt} text="Inbox, email and push." text2="Never miss a change." at={0.2} top={790} />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

export const Act3: React.FC<{ t: number }> = ({ t }) => (
  <>
    <Managers t={t} />
    <Journey t={t} />
    <Chains t={t} />
    <Legs t={t} />
    <Donut t={t} />
    <Plan t={t} />
    <NotAll t={t} />
    <Rebalance t={t} />
    <Drift t={t} />
    <Repair t={t} />
    <Notify t={t} />
  </>
);

