// Video 1 — Bytesac brand film (docs/shotlist-01-brand.md). Every value is a pure function of t (seconds).
import React from "react";
import { AbsoluteFill, Html5Audio, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { color, fitPath, MARK, markBottom, markTop, WORDMARK, wordmarkLetters } from "../lib/brand";
import { loadFonts, mono, sans } from "../lib/fonts";
import { clamp, easeInOut, ramp, track } from "../lib/motion";
import beats from "./beats.json";

loadFonts();

// Bars of the measured track (4 beats each). Bar 0 is where the music enters.
const B = beats.beats;
const bar = (n: number) => B[n * 4] ?? B[0]! + n * 4 * 0.6034;
const beat = (n: number) => B[n] ?? B[0]! + n * 0.6034;

export const BRAND_DURATION = 29.8;

const T = {
  lineStart: 0.25,
  lineEnd: 3.2,
  bloom: bar(0) - 0.25, // the sky opens as the music enters
  bottomSlab: bar(0) + 0.9,
  topSlab: bar(1),
  land: bar(2),
  s1: bar(3),
  s1Out: bar(5) - 0.5,
  s2: bar(5),
  s2Out: bar(6) - 0.45,
  morph: bar(6),
  type: bar(7),
  eyebrow: bar(8),
};

type Layout = {
  W: number;
  H: number;
  vertical: boolean;
  horizon: number;
  obj: { cx: number; cy: number; h: number };
  text: { x: number; y: number; size: number; width: number };
  lockup: { cy: number; markH: number };
};

function layout(W: number, H: number): Layout {
  const vertical = H > W;
  return vertical
    ? {
        W, H, vertical,
        horizon: H * 0.6,
        obj: { cx: W * 0.5, cy: H * 0.33, h: 560 },
        text: { x: 96, y: H * 0.62, size: 88, width: W - 192 },
        lockup: { cy: H * 0.46, markH: 170 },
      }
    : {
        W, H, vertical,
        horizon: H * 0.64,
        obj: { cx: W * 0.755, cy: H * 0.47, h: 500 },
        text: { x: 140, y: H * 0.47, size: 96, width: 1000 },
        lockup: { cy: H * 0.46, markH: 190 },
      };
}

export const BrandFilm: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const L = layout(width, height);

  return (
    <AbsoluteFill style={{ background: color.night, overflow: "hidden", fontFamily: sans }}>
      <Sky t={t} L={L} />
      <HorizonLine t={t} L={L} />
      <GlassMark t={t} L={L} />
      <Statements t={t} L={L} />
      <Wordmark t={t} L={L} />
      <Eyebrow t={t} L={L} />
      <Html5Audio src={staticFile("audio/brand-mix.wav")} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ Sky */

const Sky: React.FC<{ t: number; L: Layout }> = ({ t, L }) => {
  const { W, H, horizon } = L;
  // Dusk opens first and wider, the day sky follows inside it: night → deep blue → pale sky.
  const dusk = ramp(t, T.bloom - 0.15, 2.4);
  const day = ramp(t, T.bloom + 0.15, 2.9);
  // Soft-edged reveal (a hard clip-path ellipse reads as a cheap iris wipe).
  const reveal = (p: number): React.CSSProperties => {
    if (p >= 0.999) return {};
    const m = `radial-gradient(ellipse ${Math.max(1, p * W * 1.6)}px ${Math.max(1, p * H * 1.9)}px at 50% ${horizon}px, #000 0%, #000 45%, transparent 100%)`;
    return { WebkitMaskImage: m, maskImage: m };
  };
  const clouds = ramp(t, T.bloom + 0.3, 3.2);
  // Calm the sky behind the lockup so the navy slab reads.
  const calm = ramp(t, T.morph, 2.2, easeInOut);

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{ background: `linear-gradient(180deg, ${color.night} 0%, #0A1428 ${(horizon / H) * 100}%, #0D1A33 100%)` }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${color.duskTop} 0%, ${color.duskMid} 40%, ${color.duskLow} 80%, #2A4677 100%)`,
          ...reveal(dusk),
          opacity: dusk > 0 ? 1 : 0,
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${color.skyTop} 0%, ${color.skyMid} 45%, ${color.skyLow} 78%, ${color.canvas} 100%)`,
          ...reveal(day),
          opacity: day > 0 ? 1 : 0,
        }}
      >
        <Clouds t={t} L={L} p={clouds} />
        <AbsoluteFill
          style={{
            background: `linear-gradient(180deg, rgba(246,248,251,0) 0%, rgba(246,248,251,0.55) 55%, ${color.canvas} 100%)`,
            opacity: calm * 0.85,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Clouds: React.FC<{ t: number; L: Layout; p: number }> = ({ t, L, p }) => {
  const { W, H, vertical } = L;
  const bankW = vertical ? W * 2.6 : W * 1.5;
  const bankH = (bankW * 853) / 2560;
  const strip = (src: string, w: number, h: number, y: number, speed: number, opacity: number) => {
    // Mirror-tiled strip drifting left; wraps without a seam.
    const off = -((t * speed) % w);
    return (
      <div style={{ position: "absolute", left: off - w * 0.25, top: y, width: w * 3, height: h, opacity, display: "flex" }}>
        {[0, 1, 2].map((i) => (
          <Img
            key={i}
            src={staticFile(src)}
            style={{ width: w, height: h, transform: i % 2 ? "scaleX(-1)" : undefined, flex: "none" }}
          />
        ))}
      </div>
    );
  };
  const rise = (1 - p) * 120;
  return (
    <AbsoluteFill>
      {strip("visuals/clouds-wisps-2560.webp", bankW * 0.9, bankH * 0.9, H * 0.02 + rise * 0.4, 7, 0.55 * p)}
      {strip("visuals/clouds-bank-2560.webp", bankW, bankH, H - bankH * 0.78 + rise, 14, 0.95 * p)}
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------------------------------- Horizon line */

const HorizonLine: React.FC<{ t: number; L: Layout }> = ({ t, L }) => {
  const { W, horizon } = L;
  const p = ramp(t, T.lineStart, T.lineEnd - T.lineStart, easeInOut);
  // After the line completes, the horizon charges up until the music lands.
  const charge = ramp(t, T.lineEnd - 0.2, T.bloom - T.lineEnd + 0.45, (x) => x * x);
  const fade = 1 - ramp(t, T.bloom, 0.7, easeInOut);
  if (fade <= 0) return null;
  const head = p * W;
  const headOn = p > 0 && p < 1 ? 1 : 1 - charge;
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      {/* Dusk light leaking from the drawn part of the line (mostly upward, a little below so there is no seam) */}
      <div
        style={{
          position: "absolute", left: 0, top: horizon - 420, height: 560, width: head,
          background: "linear-gradient(0deg, rgba(61,99,217,0) 0%, rgba(61,99,217,0.32) 25%, rgba(61,99,217,0.08) 55%, rgba(61,99,217,0) 100%)",
          WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 30%, #000 100%)",
          opacity: 0.7 + charge * 0.3,
        }}
      />
      <div
        style={{
          position: "absolute", left: 0, top: horizon - 1.5, height: 3, width: head,
          background: `linear-gradient(90deg, rgba(138,166,255,0) 0%, ${color.accentDark} 30%, #EEF3FF 100%)`,
          boxShadow: `0 0 ${14 + charge * 40}px rgba(138,166,255,${0.7 + charge * 0.3})`,
        }}
      />
      {/* Light at the head of the line, with an anamorphic streak */}
      <div
        style={{
          position: "absolute", left: head - 260, top: horizon - 260, width: 520, height: 520, borderRadius: "50%",
          background: "radial-gradient(circle, #fff 0%, rgba(220,230,255,0.9) 4%, rgba(138,166,255,0.3) 20%, rgba(138,166,255,0) 60%)",
          opacity: headOn,
        }}
      />
      <div
        style={{
          position: "absolute", left: head - 700, top: horizon - 18, width: 1400, height: 36,
          background: "radial-gradient(ellipse 50% 50% at 50% 50%, rgba(200,215,255,0.75), rgba(138,166,255,0) 70%)",
          opacity: headOn * 0.9,
        }}
      />
      {/* Horizon charge when the line completes */}
      <div
        style={{
          position: "absolute", left: 0, right: 0, top: horizon - 300, height: 600,
          background: "radial-gradient(ellipse 70% 50% at 50% 50%, rgba(138,166,255,0.5), rgba(138,166,255,0) 70%)",
          opacity: charge,
        }}
      />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------ Glass mark */

/** Where the mark sits in the final lockup (left edge), so the glass object can travel there. */
function lockupGeometry(L: Layout) {
  const markH = L.lockup.markH;
  const markW = markH * (MARK.w / MARK.h);
  const capH = markH * 0.56;
  const wmScale = capH / 710; // cap height of the outlined wordmark is 710 units
  const wmW = WORDMARK.w * wmScale;
  const gap = markH * 0.3;
  const total = markW + gap + wmW;
  const left = (L.W - total) / 2;
  return { markH, markW, wmScale, wmW, gap, left, markCx: left + markW / 2, wmLeft: left + markW + gap };
}

const GlassMark: React.FC<{ t: number; L: Layout }> = ({ t, L }) => {
  const g = lockupGeometry(L);
  const glass = 1 - ramp(t, T.morph + 0.5, 1.6, easeInOut); // 1 = frosted glass, 0 = flat brand colours
  if (t < T.bottomSlab - 0.05) return null;

  // Mark travels from the hero position to the lockup: first centred alone, then aside as the wordmark types on.
  const cx = track(t, [[0, L.obj.cx], [T.morph, L.W / 2], [T.type - 0.1, g.markCx]], 60, 15.5);
  const cy = track(t, [[0, L.obj.cy], [T.morph, L.lockup.cy]], 60, 15.5);
  const h = track(t, [[0, L.obj.h], [T.morph, g.markH]], 60, 15.5);
  const s = h / MARK.h;
  const w = MARK.w * s;

  // Entrances: bottom slab rises from below, top slab descends and lands on the bar.
  const pb = ramp(t, T.bottomSlab, T.land - T.bottomSlab - 0.2);
  const pt = ramp(t, T.topSlab, T.land - T.topSlab);
  const bottomDy = (1 - pb) * 300;
  const topDy = -(1 - pt) * 420;

  // Idle: slow tilt and parallax between the layers while it is glass.
  const idle = glass * ramp(t, T.land - 0.6, 1.5);
  const rotY = Math.sin(t * 0.55) * 7 * idle;
  const rotX = Math.cos(t * 0.42) * 4 * idle;
  const par = Math.sin(t * 0.55) * 10 * idle;
  const floatY = Math.sin(t * 0.8) * 8 * idle;

  return (
    <div
      style={{
        position: "absolute", left: cx - w / 2, top: cy - h / 2 + floatY, width: w, height: h,
        transform: `perspective(1600px) rotateX(${rotX}deg) rotateY(${rotY}deg)`,
      }}
    >
      {/* Soft contact shadow on the sky */}
      <div
        style={{
          position: "absolute", left: w * 0.1, width: w * 0.8, top: h * 1.02, height: h * 0.12, borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(15,30,58,0.28), rgba(15,30,58,0) 70%)",
          filter: "blur(12px)", opacity: glass * pb,
        }}
      />
      <Slab d={markBottom} s={s} w={w} h={h} tint="navy" glass={glass} p={pb} dx={-par * 0.4} dy={bottomDy} />
      <Slab d={markTop} s={s} w={w} h={h} tint="accent" glass={glass} p={pt} dx={par} dy={topDy} />
    </div>
  );
};

const Slab: React.FC<{
  d: string; s: number; w: number; h: number; tint: "accent" | "navy";
  glass: number; p: number; dx: number; dy: number;
}> = ({ d, s, w, h, tint, glass, p, dx, dy }) => {
  const path = fitPath(d, s);
  const id = `${tint}-${Math.round(s * 1000)}`;
  const flat = tint === "accent" ? color.accent : color.navy;
  // Glass tints: the accent slab is luminous cobalt, the navy slab is deep navy with an ice-white top edge.
  // Translucent enough that the clouds read through the frost.
  const tintStops =
    tint === "accent"
      ? ["rgba(140,175,255,0.42)", "rgba(61,99,217,0.62)", "rgba(36,66,175,0.80)"]
      : ["rgba(60,85,140,0.55)", "rgba(15,30,58,0.80)", "rgba(6,13,30,0.92)"];
  const focus = (1 - p) * 26;
  return (
    <div
      style={{
        position: "absolute", inset: 0, transform: `translate(${dx}px, ${dy}px)`,
        opacity: clamp(p * 1.6), filter: focus > 0.2 ? `blur(${focus}px)` : undefined,
      }}
    >
      {/* Frost: blurs whatever is behind the slab */}
      <div
        style={{
          position: "absolute", inset: 0, clipPath: `path("${path}")`,
          backdropFilter: `blur(${24 * glass}px) saturate(${1 + 0.5 * glass}) brightness(${1 + 0.08 * glass})`,
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: flat, opacity: 1 - glass }} />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(160deg, ${tintStops.join(", ")})`, opacity: glass }} />
      </div>
      <svg width={w} height={h} style={{ position: "absolute", inset: 0, overflow: "visible", opacity: glass }}>
        <defs>
          <linearGradient id={`edge-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0.25" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.6" />
          </linearGradient>
          <radialGradient id={`spec-${id}`} cx="0.3" cy="0.15" r="0.6">
            <stop offset="0" stopColor="#fff" stopOpacity={tint === "accent" ? 0.55 : 0.35} />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <clipPath id={`clip-${id}`}>
            <path d={path} />
          </clipPath>
        </defs>
        <g clipPath={`url(#clip-${id})`}>
          <rect width={w} height={h} fill={`url(#spec-${id})`} />
          {/* Bright inner rim along the top edge (light entering the glass) */}
          <path d={path} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={8 * (w / 400)} transform={`translate(0 ${3 * (w / 400)})`} style={{ filter: "blur(3px)" }} />
          {/* Inner bottom shade gives the slab thickness */}
          <path d={path} fill="none" stroke="rgba(5,12,28,0.45)" strokeWidth={10 * (w / 400)} transform={`translate(0 ${4 * (w / 400)})`} style={{ filter: "blur(4px)" }} />
          {/* Refracted light gathering along the bottom inner edge (caustic) */}
          <path d={path} fill="none" stroke={tint === "accent" ? "rgba(190,210,255,0.7)" : "rgba(120,160,255,0.45)"} strokeWidth={5 * (w / 400)} transform={`translate(0 ${-5 * (w / 400)})`} style={{ filter: "blur(5px)" }} />
        </g>
        <path d={path} fill="none" stroke={`url(#edge-${id})`} strokeWidth={2.2} />
      </svg>
    </div>
  );
};

/* ---------------------------------------------------------------------------------------- Statements */

type Line = { text: string; at: number };

const Statements: React.FC<{ t: number; L: Layout }> = ({ t, L }) => (
  <>
    <Statement t={t} L={L} out={T.s1Out}
      lines={[{ text: "Invest in strategies,", at: T.s1 }, { text: "not individual trades.", at: T.s1 + beat(1) - beat(0) }]} />
    <Statement t={t} L={L} out={T.s2Out}
      lines={[{ text: "Built by managers.", at: T.s2 }, { text: "Approved by you.", at: T.s2 + beat(1) - beat(0) }]} />
  </>
);

const Statement: React.FC<{ t: number; L: Layout; lines: Line[]; out: number }> = ({ t, L, lines, out }) => {
  if (t < lines[0]!.at - 0.05 || t > out + 1.4) return null;
  const { x, y, size, width } = L.text;
  const lh = size * 1.08;
  let wordIndex = 0;
  return (
    <div style={{ position: "absolute", left: x, top: y - (lines.length * lh) / 2, width, color: color.ink }}>
      {lines.map((line, li) => {
        const p = ramp(t, line.at, 0.9);
        return (
          <div key={li} style={{ overflow: "hidden", height: lh, paddingBottom: size * 0.1, marginBottom: -size * 0.1 }}>
            <div
              style={{
                transform: `translateY(${(1 - p) * 125}%)`, filter: `blur(${(1 - p) * 8}px)`, opacity: clamp(p * 4),
                fontSize: size, fontWeight: 300, letterSpacing: "-0.035em", lineHeight: `${lh}px`, whiteSpace: "nowrap",
              }}
            >
              {line.text.split(" ").map((word, wi) => {
                const e = ramp(t, out + wordIndex++ * 0.055, 0.42);
                return (
                  <span key={wi} style={{ display: "inline-block", opacity: 1 - e, filter: `blur(${e * 12}px)`, transform: `translateX(${-e * 14}px)` }}>
                    {word}
                    {wi < line.text.split(" ").length - 1 ? " " : ""}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------------------------------- Lockup */

const Wordmark: React.FC<{ t: number; L: Layout }> = ({ t, L }) => {
  if (t < T.type - 0.05) return null;
  const g = lockupGeometry(L);
  // Baseline: capitals are centred on the mark.
  const capH = g.markH * 0.56;
  const top = L.lockup.cy - capH / 2;
  return (
    <svg
      width={g.wmW} height={WORDMARK.h * g.wmScale}
      viewBox={`${WORDMARK.x} ${-710} ${WORDMARK.w} ${WORDMARK.h}`}
      style={{ position: "absolute", left: g.wmLeft, top, overflow: "visible" }}
    >
      {wordmarkLetters.map((d, i) => {
        const p = ramp(t, T.type + 0.25 + i * 0.075, 0.5);
        return (
          <path key={i} d={d} fill={color.ink} opacity={p}
            style={{ filter: `blur(${(1 - p) * 6}px)`, transform: `translateX(${(1 - p) * 90}px)` }} />
        );
      })}
    </svg>
  );
};

const Eyebrow: React.FC<{ t: number; L: Layout }> = ({ t, L }) => {
  const p = ramp(t, T.eyebrow, 0.9);
  if (p <= 0) return null;
  const g = lockupGeometry(L);
  return (
    <div
      style={{
        position: "absolute", left: 0, right: 0, top: L.lockup.cy + g.markH * 0.5 + (L.vertical ? 70 : 64),
        textAlign: "center", fontFamily: mono, fontWeight: 500, fontSize: L.vertical ? 30 : 26, letterSpacing: "0.14em",
        color: color.ink, opacity: p * 0.78, transform: `translateY(${(1 - p) * 16}px)`, filter: `blur(${(1 - p) * 6}px)`,
      }}
    >
      {L.vertical ? (
        <>
          INVESTMENT BASKETS
          <br />
          SETTLED IN USDC ON SOLANA
        </>
      ) : (
        "INVESTMENT BASKETS  ·  SETTLED IN USDC ON SOLANA"
      )}
    </div>
  );
};

/** Shot times, shared with the sound cue sheet (tools/brand-cues.mjs mirrors them). */
export const BRAND_TIMES = T;
