// Shared visual pieces for the films: logo parts, real-UI cards, the phone, kinetic words.
import React from "react";
import { Img, staticFile } from "remotion";
import { color, MARK, markBottom, markTop, WORDMARK, wordmarkLetters } from "./brand";
import { clamp, ramp } from "./motion";
import { sans } from "./fonts";

export const shadowSoft = "0 1px 2px rgba(15,30,58,0.04), 0 10px 30px rgba(15,30,58,0.07)";
export const shadowFloat = "0 2px 6px rgba(15,30,58,0.06), 0 24px 60px rgba(15,30,58,0.12)";

/** The mark as SVG; each slab can be moved/scaled/recoloured on its own. */
export const Mark: React.FC<{
  h: number; top?: string; bottom?: string; topStyle?: React.CSSProperties; bottomStyle?: React.CSSProperties;
  style?: React.CSSProperties;
}> = ({ h, top = color.accent, bottom = color.navy, topStyle, bottomStyle, style }) => (
  <svg width={(h * MARK.w) / MARK.h} height={h} viewBox={`${MARK.x} ${MARK.y} ${MARK.w} ${MARK.h}`} style={{ overflow: "visible", ...style }}>
    <path d={markBottom} fill={bottom} style={{ transformBox: "fill-box", transformOrigin: "center", ...bottomStyle }} />
    <path d={markTop} fill={top} style={{ transformBox: "fill-box", transformOrigin: "center", ...topStyle }} />
  </svg>
);

/** Outlined wordmark; `letters(i)` returns the 0..1 visibility of letter i (type-on). Height = cap height. */
export const Wordmark: React.FC<{ capH: number; fill?: string; letters?: (i: number) => number; style?: React.CSSProperties }> = ({
  capH, fill = color.ink, letters, style,
}) => {
  const s = capH / 710;
  return (
    <svg width={WORDMARK.w * s} height={WORDMARK.h * s} viewBox={`${WORDMARK.x} -710 ${WORDMARK.w} ${WORDMARK.h}`} style={{ overflow: "visible", ...style }}>
      {wordmarkLetters.map((d, i) => {
        const p = letters ? letters(i) : 1;
        return <path key={i} d={d} fill={fill} opacity={p} style={{ filter: p < 1 ? `blur(${(1 - p) * 5}px)` : undefined, transform: `translateX(${(1 - p) * 80}px)` }} />;
      })}
    </svg>
  );
};

/** Logo lockup geometry for a mark height (design-system rule: caps 0.56 of the mark, gap 0.3). */
export function lockup(markH: number) {
  const markW = (markH * MARK.w) / MARK.h;
  const capH = markH * 0.56;
  const wmW = (WORDMARK.w * capH) / 710;
  const gap = markH * 0.3;
  return { markW, capH, wmW, gap, width: markW + gap + wmW };
}

/** A captured real-UI card image, clipped to its radius. */
export const Card: React.FC<{ src: string; w: number; ratio: number; radius?: number; style?: React.CSSProperties }> = ({
  src, w, ratio, radius = 20, style,
}) => (
  <div style={{ position: "absolute", width: w, height: w / ratio, borderRadius: radius, overflow: "hidden", boxShadow: shadowSoft, background: "#fff", ...style }}>
    <Img src={staticFile(src)} style={{ width: "100%", height: "100%", display: "block" }} />
  </div>
);

/** iPhone frame (screen punched out) with real UI behind the bezel. Frame 900×1877; screen rect from MANIFEST.md. */
export const Phone: React.FC<{ h: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ h, children, style }) => {
  const w = (h * 900) / 1877;
  return (
    <div style={{ position: "absolute", width: w, height: h, ...style }}>
      <div style={{ position: "absolute", left: "5%", top: "1.8%", width: "90%", height: "96.3%", borderRadius: w * 0.11, overflow: "hidden", background: "#F6F8FB" }}>
        {children}
      </div>
      <Img src={staticFile("visuals/iphone-front-900.webp")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
    </div>
  );
};

/**
 * Words that blur in one after another and blur out left to right (ref1's caption grammar).
 * `inAt` per line; `outAt` starts the exit.
 */
export const Words: React.FC<{
  t: number; lines: { text: string; at: number }[]; outAt?: number; size: number; weight?: number;
  align?: "left" | "center"; stagger?: number; color?: string; tracking?: string; lineHeight?: number;
}> = ({ t, lines, outAt = Infinity, size, weight = 400, align = "center", stagger = 0.08, color: c = color.ink, tracking = "-0.025em", lineHeight = 1.12 }) => {
  let k = 0;
  return (
    <div style={{ fontFamily: sans, fontSize: size, fontWeight: weight, letterSpacing: tracking, lineHeight, color: c, textAlign: align, whiteSpace: "nowrap" }}>
      {lines.map((line, li) => (
        <div key={li}>
          {line.text.split(" ").map((word, wi, arr) => {
            const p = ramp(t, line.at + wi * stagger, 0.5);
            const e = ramp(t, outAt + k++ * 0.05, 0.35);
            const v = p * (1 - e);
            return (
              <span key={wi} style={{ display: "inline-block", opacity: clamp(v * 1.2), filter: v < 1 ? `blur(${(1 - v) * 10}px)` : undefined, transform: `translateY(${(1 - p) * 10}px)` }}>
                {word}
                {wi < arr.length - 1 ? " " : ""}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** Per-character blur type-on (ref1's headline entrance). */
export const TypeOn: React.FC<{ t: number; text: string; at: number; perChar?: number; size: number; weight?: number }> = ({
  t, text, at, perChar = 0.05, size, weight = 400,
}) => (
  <span style={{ fontFamily: sans, fontSize: size, fontWeight: weight, letterSpacing: "-0.03em", whiteSpace: "pre" }}>
    {[...text].map((ch, i) => {
      const p = ramp(t, at + i * perChar, 0.35);
      return (
        <span key={i} style={{ opacity: p, filter: p < 1 ? `blur(${(1 - p) * 8}px)` : undefined }}>
          {ch}
        </span>
      );
    })}
  </span>
);

/** Money with muted cents, Geist 300 tabular, like the app's Figure component. */
export const Figure: React.FC<{ value: number; size: number; prefix?: string }> = ({ value, size, prefix = "$" }) => {
  const [whole, cents] = value.toFixed(2).split(".");
  return (
    <span style={{ fontFamily: sans, fontWeight: 300, fontSize: size, letterSpacing: `${-0.03 * size}px`, fontVariantNumeric: "tabular-nums", color: color.ink }}>
      {prefix}
      {Number(whole).toLocaleString("en-US")}
      <span style={{ color: "#68728A" }}>.{cents}</span>
    </span>
  );
};
