// Dark-theme building blocks for the investor film (ref4 grammar, Bytesac night tokens).
import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { sans } from "../lib/fonts";
import { clamp, easeOut, mix, ramp, rng } from "../lib/motion";
import { S, shotEnd, type ShotKey } from "./timeline";

export const W = 1920;
export const H = 1080;
export const CX = W / 2;
export const CY = H / 2;

/** Dark theme tokens (packages/design-tokens `themes.dark`). */
export const dk = {
  night: "#070D18",
  deep: "#04080F",
  surface: "#0E1726",
  surfaceMuted: "#131E31",
  line: "#1E2A3F",
  lineStrong: "#2C3A52",
  ink: "#EAF0F8",
  inkMuted: "#9AA7BC",
  inkFaint: "#8390A6",
  accent: "#8AA6FF",
  accentStrong: "#3D63D9",
  paper: "#F6F8FB",
  paperInk: "#0F1E3A",
} as const;

/** Renders children only inside the shot window (with entry/exit overlap); passes local time. */
export const Shot: React.FC<{
  k: ShotKey; t: number; pre?: number; post?: number;
  children: (lt: number, dur: number) => React.ReactNode;
}> = ({ k, t, pre = 0, post = 0, children }) => {
  const start = S[k];
  const end = shotEnd(k);
  if (t < start - pre || t >= end + post) return null;
  return <>{children(t - start, end - start)}</>;
};

/** Soft stage light under a subject (ref4's floor light), in Bytesac blue-white. */
export const FloorLight: React.FC<{ y: number; p: number; w?: number; tint?: string }> = ({ y, p, w = 1100, tint = "138,166,255" }) => (
  <>
    <div style={{ position: "absolute", left: CX - (w * p) / 2, top: y - 26, width: w * p, height: 52, borderRadius: "50%",
      background: `radial-gradient(ellipse at 50% 50%, rgba(255,255,255,${0.95 * p}), rgba(${tint},${0.55 * p}) 40%, rgba(${tint},0) 72%)`, filter: "blur(6px)" }} />
    <div style={{ position: "absolute", left: CX - w * 0.9, top: y, width: w * 1.8, height: 640,
      background: `radial-gradient(ellipse 50% 60% at 50% 0%, rgba(${tint},${0.32 * p}), rgba(${tint},0) 70%)` }} />
  </>
);

/** Ambient dark backdrop with a slow diagonal sheen (ref4's dark plates are never flat). */
const DUST = (() => {
  const r = rng(77);
  return Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H, v: 8 + r() * 26, s: 1 + r() * 2.4, ph: r() * 6.28, a: 0.15 + r() * 0.4 }));
})();

export const DarkPlate: React.FC<{ t: number; tint?: number }> = ({ t, tint = 1 }) => {
  const x = 20 + 40 * ((t * 0.045) % 1);
  const gx = 50 + 18 * Math.sin(t * 0.33);
  return (
    <AbsoluteFill style={{ background: dk.night }}>
      <AbsoluteFill style={{ background: `linear-gradient(${118 + 10 * Math.sin(t * 0.25)}deg, rgba(255,255,255,0) ${x}%, rgba(138,166,255,${0.09 * tint}) ${x + 12}%, rgba(255,255,255,0) ${x + 30}%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(1400px 700px at ${gx}% 120%, rgba(61,99,217,${0.18 + 0.06 * Math.sin(t * 0.8)}), rgba(61,99,217,0) 70%)` }} />
      {DUST.map((d, i) => {
        const y = (((d.y - t * d.v) % H) + H) % H;
        const tw = 0.5 + 0.5 * Math.sin(t * 2.2 + d.ph);
        return <div key={i} style={{ position: "absolute", left: d.x + 14 * Math.sin(t * 0.4 + d.ph), top: y, width: d.s, height: d.s, borderRadius: "50%", background: dk.ink, opacity: d.a * tw }} />;
      })}
    </AbsoluteFill>
  );
};

/** Words that blur in one by one and blur out left to right. */
export const Caption: React.FC<{
  lt: number; text: string; at?: number; out?: number; size?: number; weight?: number; color?: string;
  stagger?: number; align?: "left" | "center"; style?: React.CSSProperties; tracking?: string;
}> = ({ lt, text, at = 0, out = Infinity, size = 56, weight = 400, color = dk.ink, stagger = 0.07, align = "center", style, tracking = "-0.02em" }) => {
  const words = text.split(" ");
  return (
    <div style={{ fontFamily: sans, fontSize: size, fontWeight: weight, color, letterSpacing: tracking, textAlign: align, whiteSpace: "nowrap", lineHeight: 1.15, ...style }}>
      {words.map((w, i) => {
        const p = ramp(lt, at + i * stagger, 0.45);
        const e = ramp(lt, out + i * 0.045, 0.3);
        const v = p * (1 - e);
        return (
          <span key={i} style={{ display: "inline-block", opacity: clamp(v * 1.3), filter: v < 1 ? `blur(${(1 - v) * 9}px)` : undefined, transform: `translateY(${(1 - p) * 8}px)` }}>
            {w.startsWith("*") ? <b style={{ fontWeight: Math.min(600, weight + 200) }}>{w.slice(1)}</b> : w}
            {i < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </div>
  );
};

/** Per-character type-on with an optional blinking bar cursor (ref4's typewriter). */
export const Typewriter: React.FC<{ lt: number; text: string; at?: number; cps?: number; size?: number; cursor?: boolean; color?: string; weight?: number }> = ({
  lt, text, at = 0, cps = 22, size = 34, cursor = true, color = dk.ink, weight = 400,
}) => {
  const n = Math.max(0, Math.min(text.length, Math.floor((lt - at) * cps)));
  const done = n >= text.length;
  const blink = Math.floor(lt * 2.4) % 2 === 0;
  return (
    <span style={{ fontFamily: sans, fontSize: size, fontWeight: weight, color, letterSpacing: "-0.015em", whiteSpace: "pre" }}>
      {text.slice(0, n)}
      {cursor && lt >= at - 0.4 && <span style={{ display: "inline-block", width: Math.max(2, size * 0.06), height: size * 1.05, marginLeft: 4, verticalAlign: "-0.15em", background: color, opacity: !done || blink ? 0.9 : 0 }} />}
    </span>
  );
};

/** A captured real-UI card (dark theme) with a rim light; `clip` keeps only the top fraction. */
export const Ui: React.FC<{ src: string; w: number; ratio: number; clip?: number; radius?: number; glow?: number; style?: React.CSSProperties }> = ({
  src, w, ratio, clip = 1, radius = 22, glow = 1, style,
}) => {
  const h = (w / ratio) * clip;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ft = frame / fps;
  const ph = src.length * 0.7;
  return (
    <div style={{ position: "absolute", width: w, height: h, borderRadius: radius, overflow: "hidden", background: dk.surface, translate: `${6 * Math.sin(ft * 0.9 + ph)}px ${9 * Math.sin(ft * 1.15 + ph)}px`, rotate: `${0.5 * Math.sin(ft * 0.7 + ph)}deg`,
      boxShadow: `0 0 0 1px rgba(255,255,255,0.07), 0 30px 80px rgba(0,0,0,0.55), 0 0 ${60 * glow}px rgba(138,166,255,${0.12 * glow})`, ...style }}>
      <Img src={staticFile(`ui-dark/${src}.png`)} style={{ width: w, height: w / ratio, display: "block" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: radius, background: "linear-gradient(160deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 35%)", pointerEvents: "none" }} />
    </div>
  );
};

/** CSS-px sizes of the captured UI (tools/capture-dark-cards.mjs). */
export const UI = {
  basketHero: { w: 1200, h: 484 },
  discoverCard: { w: 320, h: 305 },
  discoverAi: { w: 1200, h: 388 },
  portfolioValue: { w: 1200, h: 353 },
  attention: { w: 592, h: 234 },
  position: { w: 1200, h: 727 },
  rebalanceVersion: { w: 816, h: 466 },
  rebalanceDecide: { w: 352, h: 251 },
  rebalanceWeights: { w: 816, h: 316 },
  notifications: { w: 864, h: 195 },
  investSplit: { w: 576, h: 388 },
  investSummary: { w: 270, h: 118 },
  signin: { w: 448, h: 503 },
} as const;
export const ratio = (k: keyof typeof UI) => UI[k].w / UI[k].h;

/** 3D tilt wrapper: rotates from (rx0, ry0) to (rx1, ry1) over the shot, perspective camera. */
export const Tilt: React.FC<{ p: number; from: [number, number, number]; to: [number, number, number]; children: React.ReactNode; style?: React.CSSProperties }> = ({ p, from, to, children, style }) => (
  <div style={{ position: "absolute", inset: 0, perspective: 2200, ...style }}>
    <div style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d",
      transform: `rotateX(${mix(from[0], to[0], p)}deg) rotateY(${mix(from[1], to[1], p)}deg) scale(${mix(from[2], to[2], p)})` }}>
      {children}
    </div>
  </div>
);

/** A chain or asset disc: the vendored CC0 icon when there is one, else a monogram (as ChainBadge does). */
const ICON: Record<string, string> = { BTC: "btc", ETH: "eth", SOL: "sol", LINK: "link", BNB: "bnb", USDC: "usdc", POL: "matic", GOLD: "gold" };
export const Disc: React.FC<{ sym: string; size?: number; style?: React.CSSProperties }> = ({ sym, size = 44, style }) => (
  ICON[sym] ? (
    <Img src={staticFile(`crypto/${ICON[sym]}.svg`)} style={{ width: size, height: size, borderRadius: "50%", ...style }} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: "50%", background: dk.surfaceMuted, border: `1px solid ${dk.lineStrong}`, color: dk.ink,
      fontFamily: sans, fontWeight: 600, fontSize: size * (sym.length > 3 ? 0.24 : 0.3), display: "flex", alignItems: "center", justifyContent: "center", ...style }}>
      {sym}
    </div>
  )
);

/** Blur → sharp entrance helper: returns style for p in 0..1. */
export const focusIn = (p: number, dist = 40): React.CSSProperties => ({
  opacity: clamp(p * 1.4), filter: p < 1 ? `blur(${(1 - p) * 14}px)` : undefined, transform: `translateY(${(1 - p) * dist}px)`,
});

export { easeOut };
