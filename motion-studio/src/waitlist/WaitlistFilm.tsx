// Video 2 — Waitlist film, ref1's grammar shot for shot (docs/shotlist-02-waitlist.md), Bytesac's own content.
// Real UI comes from the app on mock fixtures (public/ui, tools/capture-cards.mjs). Every value is a function of t.
import React from "react";
import { AbsoluteFill, Html5Audio, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { color, MARK, markBottom, markTop } from "../lib/brand";
import { loadFonts, mono, sans } from "../lib/fonts";
import { clamp, easeInOut, easeOut, mix, ramp, rng, spring } from "../lib/motion";
import { Card, Figure, lockup, Mark, Phone, shadowSoft, TypeOn, Words, Wordmark } from "../lib/pieces";
import { W } from "./timeline";

loadFonts();

const CX = 960;
const CY = 540;

export const WaitlistFilm: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  return (
    <AbsoluteFill style={{ background: "#F7F9FC", overflow: "hidden", fontFamily: sans, color: color.ink }}>
      <Canvas t={t} />
      {t < W.dark + 0.05 && <Hero t={t} />}
      {t >= W.rebuild - 0.05 && <Hero t={t} />}
      {t >= W.dark - 0.02 && t < W.cut && <Dark t={t} />}
      {t >= W.cut && t < W.stackUp + 0.1 && <Headline t={t} />}
      {t >= W.s2 - 0.1 && t < W.draw + 0.2 && <Basket t={t} />}
      {t >= W.draw - 0.2 && t < W.bar + 0.1 && <Outline t={t} />}
      {t >= W.smear + 0.28 && t < W.wipe2 + 1.3 && <Bars t={t} />}
      {t >= W.wipe2 + 0.62 && t < W.rebuild && <Ghost t={t} />}
      {t >= W.wipe2 && t < W.wipe2 + 1.4 && <DiagonalWipe t={t} />}
      <Html5Audio src={staticFile("audio/waitlist-mix.wav")} />
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------------------------------- Canvas + bloom */

/** Near-white canvas with one soft sky bloom drifting from the corners (ref1's mint bloom, in Bytesac sky). */
const Canvas: React.FC<{ t: number }> = ({ t }) => {
  const grey = ramp(t, W.grey - 0.1, 0.3) * (1 - ramp(t, W.bar - 0.1, 0.4));
  const a = Math.sin(t * 0.21) * 60;
  const b = Math.cos(t * 0.17) * 50;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: color.canvas }} />
      <AbsoluteFill style={{ background: "#EEF1F6", opacity: grey }} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 520px at ${1780 + a}px ${-40 + b}px, rgba(169,203,236,0.75), rgba(169,203,236,0) 70%),
            radial-gradient(1000px 560px at ${80 - a}px ${1120 - b}px, rgba(169,203,236,0.65), rgba(169,203,236,0) 70%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------- 1–3, 20 */

/** Hero cluster of real UI. Also closes the loop: it reassembles at the end and equals frame 0. */
const CLUSTER = {
  pill: { x: 800, y: 240 },
  portfolio: { x: 300, y: 295, w: 1000, r: 2400 / 708 },
  solana: { x: 1340, y: 303, w: 300, r: 640 / 612 },
  baskets: { x: 300, y: 620, w: 640, r: 2400 / 514 },
  attention: { x: 970, y: 620, w: 560, r: 1184 / 470 },
};

const Hero: React.FC<{ t: number }> = ({ t }) => {
  const rebuilding = t >= W.rebuild - 0.05;
  // Focus pull: everything but the pill blurs and dims; the camera pushes in on the pill.
  const pull = rebuilding ? 0 : ramp(t, W.pullStart, W.pullEnd - W.pullStart, easeInOut);
  const enter = (i: number) => (rebuilding ? ramp(t, W.rebuild + 0.25 + i * 0.14, 0.75) : 1);
  const cardStyle = (i: number): React.CSSProperties => {
    const e = enter(i);
    return {
      filter: pull + (1 - e) > 0.01 ? `blur(${pull * 14 + (1 - e) * 12}px)` : undefined,
      opacity: (1 - pull * 0.45) * e,
      transform: `translateY(${(1 - e) * 60}px) scale(${mix(0.96, 1, e)})`,
    };
  };
  const push = 1 + pull * 0.06;
  const c = CLUSTER;
  return (
    <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: `${c.pill.x}px ${c.pill.y}px` }}>
      <Card src="ui/card-portfolio.png" w={c.portfolio.w} ratio={c.portfolio.r} style={{ left: c.portfolio.x, top: c.portfolio.y, ...cardStyle(0) }} />
      <Card src="ui/card-basket-solana.png" w={c.solana.w} ratio={c.solana.r} style={{ left: c.solana.x, top: c.solana.y, ...cardStyle(1) }} />
      <Card src="ui/card-baskets.png" w={c.baskets.w} ratio={c.baskets.r} style={{ left: c.baskets.x, top: c.baskets.y, ...cardStyle(2) }} />
      <Card src="ui/card-attention.png" w={c.attention.w} ratio={c.attention.r} style={{ left: c.attention.x, top: c.attention.y, ...cardStyle(3) }} />
      {!rebuilding || t >= W.rebuild ? <Pill t={t} rebuilding={rebuilding} push={push} /> : null}
    </AbsoluteFill>
  );
};

/** The logo pill: travels to centre, fills navy and expands into the full-bleed dark frame. */
const Pill: React.FC<{ t: number; rebuilding: boolean; push: number }> = ({ t, rebuilding, push }) => {
  const c = CLUSTER.pill;
  const go = rebuilding ? 0 : ramp(t, W.pullStart + 0.2, W.pullEnd - W.pullStart);
  const fill = rebuilding ? 0 : ramp(t, W.pillFill, 0.26, easeInOut);
  const grow = rebuilding ? 0 : ramp(t, W.pillExpand, W.dark - W.pillExpand + 0.02, (x) => x * x * x);
  const appear = rebuilding ? ramp(t, W.rebuild, 0.6) : 1;
  // Undo the hero push-in for the pill so it moves in screen space.
  const x = mix(c.x, CX, go);
  const y = mix(c.y, CY, go);
  const s = mix(1, 1.4, go) / push;
  const w = mix(184, 2400, grow);
  const h = mix(52, 1400, grow);
  const bg = `rgb(${mix(255, 15, fill)}, ${mix(255, 30, fill)}, ${mix(255, 58, fill)})`;
  const markH = 24;
  const L = lockup(markH);
  return (
    <div
      style={{
        position: "absolute", left: c.x, top: c.y, width: 0, height: 0,
        transform: `translate(${(x - c.x) / push}px, ${(y - c.y) / push}px) scale(${s})`,
        opacity: appear,
      }}
    >
      <div
        style={{
          position: "absolute", left: -w / 2, top: -h / 2, width: w, height: h, borderRadius: mix(26, 0, grow),
          background: bg, boxShadow: grow > 0 ? undefined : shadowSoft, border: `1px solid rgba(226,231,239,${1 - fill})`,
          display: "flex", alignItems: "center", justifyContent: "center", gap: L.gap,
        }}
      >
        <Mark h={markH} top={fill > 0.5 ? color.accentDark : color.accent} bottom={fill > 0.5 ? "#FFFFFF" : color.navy} />
        <Wordmark capH={L.capH} fill={fill > 0.5 ? "#FFFFFF" : color.ink} />
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------------------------------------- 4–5 */

const Dark: React.FC<{ t: number }> = ({ t }) => {
  const markH = 120;
  const L = lockup(markH);
  const left = CX - L.width / 2;
  const drift = 1 + ramp(t, W.dark, 1.6) * 0.03;
  const merge = ramp(t, W.merge, 0.4, easeInOut);
  const wipe = ramp(t, W.wipe, W.cut - W.wipe - 0.05, (x) => x * x);
  // The blue slab travels right through the wordmark, erasing it.
  const slabX = wipe * (L.wmW + 900);
  const erased = clamp((slabX - L.gap) / L.wmW) * 100;
  return (
    <AbsoluteFill style={{ background: color.night }}>
      <AbsoluteFill style={{ background: "radial-gradient(1100px 520px at 18% 112%, rgba(61,99,217,0.55), rgba(61,99,217,0) 70%)" }} />
      <div style={{ position: "absolute", left, top: CY - markH / 2, display: "flex", alignItems: "center", gap: L.gap, transform: `scale(${drift})`, transformOrigin: `${L.width / 2}px ${markH / 2}px` }}>
        <Mark
          h={markH} top={color.accentDark} bottom="#FFFFFF"
          bottomStyle={{ transform: `translateY(${-merge * 40}%) scale(${1 - merge * 0.3})`, opacity: 1 - merge }}
          topStyle={{ transform: `translateX(${slabX * (MARK.h / markH)}px) translateY(${merge * 25}%) scaleX(${1 + wipe * 0.6})`, filter: wipe > 0 ? `blur(${wipe * 6}px)` : undefined }}
        />
        <div style={{ clipPath: `inset(0 0 0 ${erased}%)` }}>
          <Wordmark capH={L.capH} fill="#FFFFFF" />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------------------------------------- 6–8 */

const PHONE_H = 1040;

const Headline: React.FC<{ t: number }> = ({ t }) => {
  // Headline: per-character, then whole words; starts big and settles to 1×, then steps aside for the phone.
  const settle = ramp(t, W.shrink, 0.45, easeInOut);
  const aside = ramp(t, W.aside, 0.55);
  const scale = mix(1.55, 1, settle);
  const x = mix(CX, 560, aside);
  const out = W.textOut;
  const outP = ramp(t, out, 0.5);

  // Phone: rises from below, counts up, centres, then dissolves into statement two.
  const up = ramp(t, W.phoneUp, 0.95);
  const centre = ramp(t, W.phoneCentre, 0.6, easeInOut);
  const away = ramp(t, W.phoneAway, W.s2b - W.phoneAway + 0.3, easeInOut);
  const phoneX = mix(1330, CX, centre);
  const phoneTop = mix(1180, 330, up) + away * 80;
  const phoneScale = mix(1, 0.9, centre) * mix(1, 0.42, away);
  const count = ramp(t, W.count, 1.05, easeOut);
  const value = mix(3104.18, 3911.64, count);
  const pw = (PHONE_H * 900) / 1877;
  // CSS px of the phone screen → frame px (the screen is 390 CSS px wide).
  const k = (pw * 0.9) / 390;
  return (
    <AbsoluteFill>
      {t < out + 1 && (
        <div style={{ position: "absolute", left: x, top: CY, transform: `translate(-50%, -50%) scale(${scale})`, textAlign: "center", lineHeight: 1.12, opacity: 1 - outP, filter: outP > 0 ? `blur(${outP * 10}px)` : undefined }}>
          <div><TypeOn t={t} text="Invest in strategies," at={W.type1} perChar={0.045} size={64} weight={400} /></div>
          <Words t={t} size={64} lines={[{ text: "not individual trades.", at: W.type2 }]} stagger={0.1} />
        </div>
      )}
      {t >= W.phoneUp - 0.05 && t < W.s2Up + 0.3 && (
        <div
          style={{
            position: "absolute", left: phoneX - pw / 2, top: phoneTop, transform: `scale(${phoneScale})`, transformOrigin: "50% 30%",
            filter: away > 0.01 ? `blur(${away * 14}px)` : undefined, opacity: 1 - ramp(t, W.s2b - 0.1, 0.6),
          }}
        >
          <Phone h={PHONE_H}>
            <Img src={staticFile("ui/phone-home.png")} style={{ width: "100%", display: "block" }} />
            {/* Live figure over the captured one (measured: x 41, y 218, Geist 300 60px, −1.8px, tabular). */}
            <div style={{ position: "absolute", left: 30 * k, top: 222 * k, width: 330 * k, height: 70 * k, background: "#FFFFFF" }} />
            <div style={{ position: "absolute", left: 41 * k, top: 218.17 * k, height: 78 * k, lineHeight: `${78 * k}px`, whiteSpace: "nowrap" }}>
              <Figure value={value} size={60 * k} />
            </div>
          </Phone>
        </div>
      )}
      {t >= W.s2 - 0.1 && (
        <div style={{ position: "absolute", left: CX, top: mix(CY, 250, ramp(t, W.s2Up, 0.6)), transform: "translate(-50%, -50%)", opacity: 1 - ramp(t, W.travel, 0.5) }}>
          <Words t={t} size={50} weight={400} stagger={0.07}
            lines={[{ text: "Baskets built by verified managers,", at: W.s2 }, { text: "rebalanced only when you approve.", at: W.s2b }]} />
        </div>
      )}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------- 9 */

const ISO = { cos: Math.cos(Math.PI / 6), sin: Math.sin(Math.PI / 6) };
const LAYERS = ["usdc", "bnb", "link", "sol", "eth", "btc"]; // bottom → top

/** Isometric basket: one layer per asset on a USDC base, a light beam through it; explodes on the hit. */
const Basket: React.FC<{ t: number }> = ({ t }) => {
  if (t < W.stackUp - 0.05) return null;
  const rise = ramp(t, W.stackUp, 0.7);
  const beam = ramp(t, W.beam, 0.6);
  const explode = ramp(t, W.explode, 0.55) ;
  const travel = ramp(t, W.travel, W.draw - W.travel, (x) => x * x);
  const a = 120; // half side of a layer
  const th = 22; // thickness
  const gap = mix(30, 88, explode);
  const baseY = 880 + (1 - rise) * 520 - travel * 1100;
  const pts = (u: number, v: number, z: number, y0: number) => [CX + (u - v) * ISO.cos, y0 + (u + v) * ISO.sin - z] as const;
  return (
    <AbsoluteFill>
      {/* Beam: rises through the stack, stays behind as a single line when everything else leaves */}
      <div style={{ position: "absolute", left: CX - 34, width: 68, top: 0, height: baseY - 40, opacity: beam * (1 - travel * 0.6),
        background: "linear-gradient(0deg, rgba(61,99,217,0.55), rgba(61,99,217,0.12) 70%, rgba(61,99,217,0))" }} />
      <div style={{ position: "absolute", left: CX - 3, width: 6, top: 0, height: baseY, opacity: beam,
        background: "linear-gradient(0deg, #3D63D9, rgba(61,99,217,0.4) 80%, rgba(61,99,217,0))" }} />
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {LAYERS.map((asset, i) => {
          const z = i * gap;
          const top = (u: number, v: number) => pts(u, v, z + th, baseY);
          const bot = (u: number, v: number) => pts(u, v, z, baseY);
          const poly = (p: (readonly [number, number])[]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
          const isTop = i === LAYERS.length - 1;
          const faceFill = isTop ? "url(#isoTop)" : "#FFFFFF";
          const [cx, cy] = top(0, 0);
          const logo = 92;
          return (
            <g key={asset}>
              <polygon points={poly([top(-a, a), top(a, a), bot(a, a), bot(-a, a)])} fill={isTop ? "#2E4FB8" : color.accent} stroke={color.navy} strokeWidth={3} strokeLinejoin="round" />
              <polygon points={poly([top(a, -a), top(a, a), bot(a, a), bot(a, -a)])} fill={isTop ? "#24409A" : "#2E4FB8"} stroke={color.navy} strokeWidth={3} strokeLinejoin="round" />
              <polygon points={poly([top(-a, -a), top(a, -a), top(a, a), top(-a, a)])} fill={faceFill} stroke={color.navy} strokeWidth={3} strokeLinejoin="round" />
              <g transform={`translate(${cx} ${cy}) matrix(${ISO.cos} ${ISO.sin} ${-ISO.cos} ${ISO.sin} 0 0)`} opacity={isTop ? 1 : explode}>
                <image href={staticFile(`crypto/${asset}.svg`)} x={-logo / 2} y={-logo / 2} width={logo} height={logo} />
              </g>
            </g>
          );
        })}
        <defs>
          <linearGradient id="isoTop" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#E8EEFC" />
            <stop offset="1" stopColor="#BFD0F6" />
          </linearGradient>
        </defs>
      </svg>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ 10–12 */

/** The beam becomes a stroke that draws the mark's outline; nested strokes; fill; exit; collide; wordmark; smear. */
const Outline: React.FC<{ t: number }> = ({ t }) => {
  const markH = 520;
  const s = markH / MARK.h;
  const mw = MARK.w * s;
  // Camera: starts tight on the slab's left edge (where the beam was), pulls back.
  const zoom = mix(3.4, 1, ramp(t, W.draw, W.drawBottom - W.draw + 0.2, easeInOut));
  const drawTop = ramp(t, W.draw, W.nest - W.draw, easeInOut);
  const nest = ramp(t, W.nest, 0.6);
  const drawBot = ramp(t, W.drawBottom, 0.8, easeInOut);
  const fill = ramp(t, W.fill, 0.3);
  const exit = ramp(t, W.exit, 0.9, (x) => x * x * x);
  const zp = ramp(t, W.draw, W.drawBottom - W.draw + 0.2, easeInOut);
  const markX = mix(CX, CX - mw / 2, zp); // left edge starts where the beam was (frame centre)
  const markY = CY - markH / 2;
  const focusX = CX;
  const line = ramp(t, W.draw - 0.1, 0.45, easeOut);
  const lineFade = 1 - ramp(t, W.draw + 0.5, 0.5);

  // After the exit: one small slab waits; then both fly in, collide and settle into the logo.
  const logoH = 110;
  const L = lockup(logoH);
  const lockLeft = CX - L.width / 2;
  const fly = ramp(t, W.fly, W.collide - W.fly + 0.05, (x) => x * x);
  const settle = spring(t - W.collide, 220, 16);
  const showLogo = t >= W.grey;
  const letters = (i: number) => ramp(t, W.word + i * 0.075, 0.4);
  const stretch = ramp(t, W.stretch, 0.4, easeInOut) * (1 - ramp(t, W.smear, 0.2));
  const smear = ramp(t, W.smear, W.bar - W.smear + 0.05, (x) => x * x);

  const nested = (k: number, op: number) => (
    <path d={markTop} fill="none" stroke={color.accent} strokeWidth={4 / s} opacity={op * nest * (1 - fill)}
      style={{ transformBox: "fill-box", transformOrigin: "center", transform: `scale(${1 + k * 0.07})` }} />
  );

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(0deg, rgba(232,238,252,0.9), rgba(232,238,252,0) 45%)", opacity: 1 - ramp(t, W.grey - 0.2, 0.3) }} />
      {!showLogo && (
        <div style={{ position: "absolute", inset: 0, transform: `translateX(${exit * 1500}px) scale(${zoom})`, transformOrigin: `${focusX}px ${CY}px`, filter: exit > 0.02 ? `blur(${exit * 10}px)` : undefined }}>
          <div style={{ position: "absolute", left: CX - 3, width: 6, top: mix(1080, markY + markH * 0.12, line), bottom: 0, background: color.accent, borderRadius: 3, opacity: lineFade }} />
          <svg width={mw} height={markH} viewBox={`${MARK.x} ${MARK.y} ${MARK.w} ${MARK.h}`} style={{ position: "absolute", left: markX, top: markY, overflow: "visible" }}>
            {nested(1, 0.55)}
            {nested(2, 0.3)}
            <path d={markTop} fill={color.accent} fillOpacity={fill} stroke={color.accent} strokeWidth={6 / s} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - drawTop} strokeLinecap="round" />
            <path d={markBottom} fill={color.navy} fillOpacity={fill} stroke={color.navy} strokeWidth={6 / s} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - drawBot} strokeLinecap="round"
              style={{ transformBox: "fill-box", transformOrigin: "center", transform: `translateY(${exit * 40}px)` }} />
          </svg>
        </div>
      )}
      {showLogo && t < W.bar + 0.1 && (
        <div style={{ position: "absolute", left: lockLeft, top: CY - logoH / 2, display: "flex", alignItems: "center", gap: L.gap }}>
          <div style={{ position: "relative", width: L.markW, height: logoH }}>
            {/* Bottom slab flies in from the left */}
            <svg width={L.markW} height={logoH} viewBox={`${MARK.x} ${MARK.y} ${MARK.w} ${MARK.h}`} style={{ position: "absolute", inset: 0, overflow: "visible",
              transform: `translateX(${mix(-900, 0, fly) + (1 - settle) * -20 * (t > W.collide ? 1 : 0)}px) translateY(${(1 - fly) * 30}px)`, opacity: ramp(t, W.fly, 0.08) * (1 - ramp(t, W.smear + 0.1, 0.3)) }}>
              <path d={markBottom} fill={color.navy} />
            </svg>
            {/* Top slab: waits on the right, flies to the mark, then stretches and smears into the first bar */}
            <svg width={L.markW} height={logoH} viewBox={`${MARK.x} ${MARK.y} ${MARK.w} ${MARK.h}`} style={{ position: "absolute", inset: 0, overflow: "visible",
              transform: `translateX(${mix(CX + 520 - lockLeft, 0, fly) + smear * 2300}px) scale(${t < W.fly ? 0.55 * ramp(t, W.grey, 0.4) : 1}) scaleX(${1 + stretch * 0.25 + smear * 2.2}) rotate(${(1 - settle) * 8 * (t > W.collide ? 1 : 0)}deg)`,
              transformOrigin: "0% 50%", filter: smear > 0.02 ? `blur(${smear * 14}px)` : undefined }}>
              <path d={markTop} fill={color.accent} />
            </svg>
          </div>
          <div style={{ clipPath: `inset(0 0 0 ${clamp((smear * 2300 + L.markW * (1 + smear * 2.2) - L.markW - L.gap) / L.wmW) * 100}%)` }}>
            <Wordmark capH={L.capH} letters={letters} />
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------- 13 */

const WEIGHTS = [
  { sym: "btc", name: "Bitcoin (BTC)", pct: 35, fill: color.accent },
  { sym: "eth", name: "Ether (ETH)", pct: 30, fill: color.navy },
  { sym: "sol", name: "Solana (SOL)", pct: 20, fill: "#5A7BE0" },
  { sym: "link", name: "Chainlink (LINK)", pct: 8, fill: "#9DB3EE" },
  { sym: "bnb", name: "BNB (BNB)", pct: 7, fill: "#C9D6F5" },
];

const Bars: React.FC<{ t: number }> = ({ t }) => {
  const pull = ramp(t, W.bars, 0.7, easeInOut);
  const zoom = mix(1.5, 1, pull);
  const left = 300;
  const unit = 1180 / 35;
  const rowTop = 250;
  const row = 132;
  const first = ramp(t, W.smear + 0.3, 0.6); // the smear exits right and the first bar follows from the left
  return (
    <AbsoluteFill style={{ transform: `translateY(${(1 - pull) * (CY - (rowTop + 74))}px) scale(${zoom})`, transformOrigin: `0px ${rowTop + 74}px`, opacity: 1 - ramp(t, W.wipe2 + 0.55, 0.12) }}>
      <div style={{ position: "absolute", left, top: rowTop - 90, fontFamily: mono, fontWeight: 500, fontSize: 18, letterSpacing: "0.14em", color: color.inkMuted, opacity: ramp(t, W.bars + 0.2, 0.5) }}>
        EXAMPLE BASKET · TARGET WEIGHTS
      </div>
      {WEIGHTS.map((w, i) => {
        const p = i === 0 ? first : ramp(t, W.bars + 0.15 + i * 0.16, 0.65);
        const label = ramp(t, (i === 0 ? W.bars : W.bars + 0.15 + i * 0.16) + 0.25, 0.4);
        const width = w.pct * unit * p + (i === 0 ? (1 - first) * 0 : 0);
        const dark = i === 1 || i === 0;
        return (
          <div key={w.sym} style={{ position: "absolute", left: i === 0 ? mix(-200, left, first) : left, top: rowTop + i * row }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, height: 40, opacity: label, filter: label < 1 ? `blur(${(1 - label) * 6}px)` : undefined }}>
              <Img src={staticFile(`crypto/${w.sym}.svg`)} style={{ width: 28, height: 28 }} />
              <span style={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.01em" }}>{w.name}</span>
            </div>
            <div style={{ marginTop: 10, height: 48, width: Math.max(0, width), opacity: p > 0.02 ? 1 : 0, background: w.fill, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 16, boxSizing: "border-box" }}>
              <span style={{ fontFamily: mono, fontSize: 20, fontWeight: 500, color: dark ? "#fff" : color.ink, opacity: label }}>{w.pct}%</span>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------- 14 */

const DiagonalWipe: React.FC<{ t: number }> = ({ t }) => {
  const p = ramp(t, W.wipe2, 1.3, easeInOut);
  const x = mix(2600, -2600, p);
  return (
    <div style={{ position: "absolute", left: CX - 2000 + x, top: CY - 1400, width: 4000, height: 2800, transform: "rotate(-35deg)",
      background: `linear-gradient(90deg, rgba(246,248,251,0) 0%, ${color.skyLow} 14%, ${color.skyMid} 24%, #6E93E8 38%, ${color.accent} 50%, #6E93E8 62%, ${color.skyMid} 76%, ${color.skyLow} 86%, rgba(246,248,251,0) 100%)` }} />
  );
};

/* ---------------------------------------------------------------------------------------------- 15–20 */

const GHOST = { w: 420, h: 700, top: 96 };

/** Ghost phone whose contents swap: verified holdings → review → wallet; then it becomes the real phone + CTA. */
const Ghost: React.FC<{ t: number }> = ({ t }) => {
  const appear = ramp(t, W.ghost - 0.5, 0.6);
  const real = ramp(t, W.real, 0.9, easeInOut);
  const tilt = Math.sin(real * Math.PI) * -16;
  const aside = ramp(t, W.aside2, 0.6);
  const fly = ramp(t, W.fly2, 0.45, (x) => x * x);
  const phoneX = mix(CX, 640, aside);
  const g = GHOST;
  const captionOut = (at: number) => at;

  // Real phone sized to match the ghost.
  const realH = 820;
  const realW = (realH * 900) / 1877;
  return (
    <AbsoluteFill>
      {/* Ghost phone shell */}
      <div style={{ position: "absolute", left: phoneX - g.w / 2, top: g.top - fly * 1300, width: g.w, height: g.h, transform: `perspective(1400px) rotateY(${tilt}deg)`,
        opacity: appear * (1 - real), borderRadius: 64, background: "rgba(255,255,255,0.72)", border: "1.5px solid rgba(15,30,58,0.07)", boxShadow: "0 30px 80px rgba(15,30,58,0.06)",
        WebkitMaskImage: "linear-gradient(180deg, #000 70%, transparent 100%)" }}>
        <div style={{ position: "absolute", left: g.w / 2 - 56, top: 22, width: 112, height: 30, borderRadius: 15, background: "#EEF1F6" }} />
        <Holdings t={t} />
        <Review t={t} />
        <WalletPop t={t} />
      </div>
      {/* Real phone resolves out of the ghost */}
      {real > 0 && (
        <div style={{ position: "absolute", left: phoneX - realW / 2, top: g.top - 10 - fly * 1300, transform: `perspective(1400px) rotateY(${tilt}deg) scale(${mix(0.96, 1, real)})`, opacity: real }}>
          <Phone h={realH}>
            <Img src={staticFile("ui/phone-basket-alloc.png")} style={{ width: "100%", display: "block", transform: `translateY(${(1 - real) * 40}px)` }} />
          </Phone>
        </div>
      )}
      {/* Captions under the ghost phone */}
      <div style={{ position: "absolute", left: CX, top: 845, transform: "translate(-50%, 0)" }}>
        {t < W.holdOut + 0.6 && <Words t={t} size={46} weight={500} outAt={captionOut(W.holdOut)} lines={[{ text: "Every holding,", at: W.ghost + 0.1 }, { text: "verified on-chain.", at: W.ghost + 0.45 }]} />}
        {t >= W.review - 0.1 && t < W.reviewOut + 0.6 && <Words t={t} size={46} weight={500} outAt={W.reviewOut} lines={[{ text: "Review every change.", at: W.review }, { text: "Nothing moves without you.", at: W.review + 0.35 }]} />}
        {t >= W.wallet && t < W.walletOut + 0.6 && <Words t={t} size={46} weight={500} outAt={W.walletOut} lines={[{ text: "Your wallet.", at: W.wallet + 0.2 }, { text: "Your signature.", at: W.wallet + 0.55 }]} />}
      </div>
      {/* CTA */}
      {t >= W.cta - 0.1 && (
        <div style={{ position: "absolute", left: 1010, top: 380, opacity: 1 - ramp(t, W.ctaOut + 0.25, 0.3) }}>
          <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 20, letterSpacing: "0.14em", color: color.accent, marginBottom: 22, opacity: ramp(t, W.cta + 0.5, 0.5) * (1 - ramp(t, W.ctaOut, 0.3)) }}>
            EARLY ACCESS
          </div>
          <Words t={t} size={104} weight={400} align="left" tracking="-0.04em" lineHeight={1.02} outAt={W.ctaOut} stagger={0.12}
            lines={[{ text: "Join the", at: W.cta }, { text: "waitlist", at: W.cta + 0.3 }]} />
        </div>
      )}
    </AbsoluteFill>
  );
};

const innerCard: React.CSSProperties = { position: "absolute", left: 28, right: 28, borderRadius: 22, background: "#fff", boxShadow: shadowSoft, border: "1px solid #E2E7EF" };

const Holdings: React.FC<{ t: number }> = ({ t }) => {
  if (t > W.review + 0.2) return null;
  const inP = ramp(t, W.ghost - 0.1, 0.6);
  const out = ramp(t, W.holdOut, 0.45);
  const count = ramp(t, W.ghost, 1.1, easeOut);
  const row = ramp(t, W.ghost + 0.5, 0.5);
  return (
    <div style={{ ...innerCard, top: 90, padding: "26px 26px 22px", opacity: inP * (1 - out), transform: `translateY(${(1 - inP) * 20 - out * 10}px)`, filter: out > 0 ? `blur(${out * 8}px)` : undefined }}>
      <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 500, letterSpacing: "0.12em", color: color.inkMuted }}>CORE CRYPTO INDEX</div>
      <div style={{ marginTop: 8, lineHeight: 1 }}><Figure value={mix(1604.52, 2417.24, count)} size={52} /></div>
      <div style={{ marginTop: 6, fontSize: 14, color: color.inkMuted }}>Opened 12 Jun 2026 · drift band ±5%</div>
      <div style={{ marginTop: 22, borderTop: "1px solid #E9EEF5", paddingTop: 16, display: "flex", alignItems: "center", gap: 12, opacity: row, transform: `translateY(${(1 - row) * 8}px)` }}>
        <Img src={staticFile("crypto/btc.svg")} style={{ width: 30, height: 30 }} />
        <div style={{ flex: 1, fontSize: 15 }}>BTC <span style={{ color: color.inkMuted }}>on Bitcoin</span></div>
        <div style={{ textAlign: "right", fontSize: 14 }}>
          <div style={{ fontVariantNumeric: "tabular-nums" }}>0.007618 BTC · $742.10</div>
          <div style={{ color: "#1F8A55", fontSize: 13, marginTop: 3 }}>✓ Verified in wallet</div>
        </div>
      </div>
    </div>
  );
};

const Review: React.FC<{ t: number }> = ({ t }) => {
  if (t < W.review - 0.3 || t > W.wallet + 0.3) return null;
  const inP = ramp(t, W.review - 0.15, 0.55);
  const out = ramp(t, W.reviewOut, 0.4);
  // Crop of the real review screen: "Version 2 to version 3" card (CSS y 175–470 of the 390-wide screen).
  const w = GHOST.w - 56;
  const k = w / 390;
  return (
    <div style={{ ...innerCard, top: 84, height: 410 * k, overflow: "hidden", padding: 0, opacity: inP * (1 - out), transform: `translateY(${(1 - inP) * 20}px) scale(${mix(1, 0.92, out)})`, filter: out > 0 ? `blur(${out * 8}px)` : undefined }}>
      <Img src={staticFile("ui/phone-rebalance.png")} style={{ position: "absolute", left: 0, top: -255 * k, width: w, display: "block" }} />
    </div>
  );
};

const WalletPop: React.FC<{ t: number }> = ({ t }) => {
  if (t < W.wallet - 0.1 || t > W.real + 0.4) return null;
  const pop = spring(t - W.wallet - 0.1, 260, 18);
  const shrink = ramp(t, W.walletOut, 0.45, easeInOut);
  const s = pop * (1 - shrink);
  const check = ramp(t, W.wallet + 0.35, 0.4);
  const r = rng(11);
  const nodes = Array.from({ length: 7 }, (_, i) => {
    const ang = (i / 7) * Math.PI * 2 + r() * 0.5;
    const rad = 150 + r() * 40;
    return { x: GHOST.w / 2 + Math.cos(ang) * rad, y: 250 + Math.sin(ang) * rad * 0.8, d: r() * 0.4 };
  });
  return (
    <>
      <svg width={GHOST.w} height={GHOST.h} style={{ position: "absolute", inset: 0 }}>
        {nodes.map((n, i) => {
          const p = ramp(t, W.wallet + 0.3 + n.d, 0.6) * (1 - shrink);
          const m = nodes[(i + 2) % nodes.length]!;
          return (
            <g key={i} opacity={p}>
              <line x1={n.x} y1={n.y} x2={mix(n.x, m.x, p)} y2={mix(n.y, m.y, p)} stroke="rgba(15,30,58,0.18)" strokeWidth={1} />
              <circle cx={n.x} cy={n.y} r={3} fill={color.navy} />
            </g>
          );
        })}
      </svg>
      <Img src={staticFile("visuals/glass-wallet-1200.webp")} style={{ position: "absolute", left: GHOST.w / 2 - 150, top: 250 - 114, width: 300, transform: `scale(${s})`, opacity: clamp(s * 3) }} />
      <div style={{ ...innerCard, top: 440, height: 64, display: "flex", alignItems: "center", gap: 12, padding: "0 18px", opacity: check * (1 - shrink) }}>
        <div style={{ width: 28, height: 28, borderRadius: 14, background: color.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, transform: `scale(${spring(t - W.wallet - 0.35, 300, 18)})` }}>✓</div>
        <div style={{ fontSize: 15 }}>You sign every transaction</div>
      </div>
    </>
  );
};

