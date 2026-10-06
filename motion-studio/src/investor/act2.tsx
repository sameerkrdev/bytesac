// Act 2 — the turn and the reveal (shots 9–13).
import React from "react";
import { AbsoluteFill } from "remotion";
import { sans } from "../lib/fonts";
import { clamp, easeInOut, easeOut, mix, ramp, spring } from "../lib/motion";
import { lockup, Mark, Wordmark } from "../lib/pieces";
import { Caption, CX, CY, dk, H, Shot, W } from "./kit";
import { BAR } from "./timeline";

/* ------------------------------------------------------------------- 9 · what if (white fades to black) */

const WhatIf: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="whatIf" t={t}>
    {(lt, dur) => {
      const dark = ramp(lt, dur * 0.45, dur * 0.55, easeInOut);
      const c = Math.round(mix(246, 7, dark));
      const ink = dark > 0.5 ? dk.ink : dk.paperInk;
      return (
        <AbsoluteFill style={{ background: `rgb(${c}, ${Math.round(mix(248, 13, dark))}, ${Math.round(mix(251, 24, dark))})` }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: CY - 34, transform: `scale(${1.04 - lt * 0.015})` }}>
            <Caption lt={lt} text="What if experts built the strategy…" at={0.1} stagger={0.12} size={80} color={ink} />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ----------------------------------------------------------------------------- 10 · …and you kept the keys? */

const Keys: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="keys" t={t}>
    {(lt) => {
      const ring = ramp(lt, 0.05, 0.9, easeInOut);
      const r = 300 + Math.sin(lt * 3) * 5;
      const circ = 2 * Math.PI * r;
      return (
        <AbsoluteFill style={{ background: dk.night }}>
          <AbsoluteFill style={{ background: "radial-gradient(600px 600px at 50% 50%, rgba(138,166,255,0.12), rgba(138,166,255,0) 70%)", opacity: ring }} />
          <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
            <circle cx={CX} cy={CY} r={r + 70} fill="none" stroke="rgba(234,240,248,0.18)" strokeDasharray="4 14" transform={`rotate(${lt * 24} ${CX} ${CY})`} />
            <circle cx={CX} cy={CY} r={r + 150} fill="none" stroke="rgba(234,240,248,0.08)" strokeDasharray="2 22" transform={`rotate(${-lt * 14} ${CX} ${CY})`} />
            <circle cx={CX} cy={CY} r={r} fill="rgba(14,23,38,0.6)" stroke="rgba(234,240,248,0.55)" strokeWidth={2}
              strokeDasharray={`${circ * ring} ${circ}`} transform={`rotate(-90 ${CX} ${CY})`} />
          </svg>
          <div style={{ position: "absolute", left: 0, right: 0, top: CY - 80, display: "flex", flexDirection: "column", gap: 8 }}>
            <Caption lt={lt} text="…and *you" at={0.25} size={64} />
            <Caption lt={lt} text="kept the keys?" at={0.55} size={64} />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ------------------------------------------------------------------- 11 · concentric rings + counting pill */

const LABELS = ["one basket", "7 chains", "every asset in your wallet"];

const Rings: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="rings" t={t}>
    {(lt) => {
      const enter = ramp(lt, 0, 0.9, easeOut);
      const zoom = 1 + 0.025 * lt;
      const idx = Math.min(LABELS.length - 1, Math.floor(lt / BAR));
      const local = lt - idx * BAR;
      // Pill width follows the label; one spring per change.
      const widths = [390, 320, 680];
      const pw = widths.slice(0, idx + 1).reduce((acc, w, i) => acc + (w - (widths[i - 1] ?? 0)) * spring(lt - i * BAR, 200, 22), 0);
      const swap = ramp(local, 0, 0.3);
      const chains = Math.max(1, Math.min(7, Math.round(mix(1, 7, ramp(local, 0.15, 1.2, easeOut)))));
      const label = idx === 1 ? `${chains} chain${chains > 1 ? "s" : ""}` : LABELS[idx]!;
      return (
        <AbsoluteFill style={{ background: dk.paper, transform: `scale(${zoom})` }}>
          {Array.from({ length: 7 }, (_, i) => {
            const k = 7 - i;
            const breathe = Math.sin(lt * 2.2 - i * 0.6) * 22;
            const w = (pw + 120 + k * 210) * mix(0.6, 1, enter) + breathe;
            const h = (130 + k * 115) * mix(0.6, 1, enter) + breathe;
            const g = Math.round(mix(205, 244, k / 7));
            return <div key={i} style={{ position: "absolute", left: CX - w / 2, top: CY - h / 2, width: w, height: h, borderRadius: h / 2, background: `rgb(${g}, ${g + 3}, ${g + 8})`, opacity: enter }} />;
          })}
          <div style={{ position: "absolute", left: CX - pw / 2, top: CY - 54, width: pw, height: 108, borderRadius: 54, background: dk.paperInk,
            display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: sans, fontSize: 46, letterSpacing: "-0.015em",
            boxShadow: "0 20px 50px rgba(15,30,58,0.25)", transform: `scale(${mix(0.6, 1, enter)})` }}>
            <span style={{ opacity: swap, filter: swap < 1 ? `blur(${(1 - swap) * 8}px)` : undefined, fontVariantNumeric: "tabular-nums" }}>{label}</span>
            <div style={{ position: "absolute", inset: 0, borderRadius: 54, overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, bottom: 0, width: 120, left: `${((lt * 0.55) % 1) * 160 - 30}%`, background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.22), rgba(255,255,255,0))" }} />
            </div>
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ------------------------------------------------------------------------- 12 · pill → black, the question */

const Want: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="want" t={t}>
    {(lt, dur) => {
      const grow = ramp(lt, 0, 0.75, (x) => x * x * x);
      const w = mix(680, 2600, grow), h = mix(108, 1500, grow);
      const out = ramp(lt, dur - 0.5, 0.5, easeInOut);
      return (
        <AbsoluteFill style={{ background: dk.paper, transform: `scale(${1 + 0.025 * (lt + 5.7)})` }}>
          {Array.from({ length: 7 }, (_, i) => {
            const k = 7 - i;
            const blow = mix(1, 2.6, grow);
            const rw = (680 + 120 + k * 210) * blow, rh = (130 + k * 115) * blow;
            const g = Math.round(mix(205, 244, k / 7));
            return <div key={i} style={{ position: "absolute", left: CX - rw / 2, top: CY - rh / 2, width: rw, height: rh, borderRadius: rh / 2, background: `rgb(${g}, ${g + 3}, ${g + 8})`, opacity: 1 - grow }} />;
          })}
          <div style={{ position: "absolute", left: CX - w / 2, top: CY - h / 2, width: w, height: h, borderRadius: mix(54, 0, grow), background: dk.deep }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: CY - 30, opacity: 1 - out, transform: `scale(${1 + lt * 0.035})`, letterSpacing: `${lt * 0.4}px` }}>
            <Caption lt={lt} text="Want to know how?" at={0.6} stagger={0.22} size={80} />
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* --------------------------------------------------------------------------- 13 · horizon: Introducing Bytesac */

const Intro: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="intro" t={t} post={0.5}>
    {(lt, dur) => {
      const rise = ramp(lt, 0, 1.6, easeOut);
      const R = 2600;
      const cy = mix(H + R + 40, H + R - 260, rise);
      const glow = ramp(lt, 0.1, 1.2);
      const markH = 120;
      const L = lockup(markH);
      const intro = ramp(lt, 0.7, 0.6);
      const logo = ramp(lt, 1.25, 0.7);
      const out = ramp(lt, dur - 0.2, 0.7, easeInOut);
      return (
        <AbsoluteFill style={{ background: dk.deep, opacity: 1 - out }}>
          {/* Planet edge: a huge circle whose rim catches the light */}
          <div style={{ position: "absolute", left: CX - R, top: cy - R, width: R * 2, height: R * 2, borderRadius: "50%",
            background: `radial-gradient(circle at 50% 50%, #04080F 0%, #04080F 97.4%, rgba(138,166,255,${0.55 * glow}) 99.2%, rgba(255,255,255,${0.95 * glow}) 99.75%, rgba(138,166,255,0) 100%)`,
            boxShadow: `0 0 ${140 * glow}px ${30 * glow}px rgba(138,166,255,${0.35 * glow})` }} />
          <div style={{ position: "absolute", left: mix(-200, W + 200, ((lt * 0.28) % 1)) - 260, top: cy - R - 40 + Math.pow((mix(-200, W + 200, ((lt * 0.28) % 1)) - CX) / R, 2) * R * 0.5, width: 520, height: 80, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(255,255,255,0.55), rgba(138,166,255,0) 70%)", opacity: glow }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: cy - R - 700, height: 700, background: `radial-gradient(ellipse 45% 70% at 50% 100%, rgba(138,166,255,${0.22 * glow}), rgba(138,166,255,0) 70%)` }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: CY - 190, display: "flex", flexDirection: "column", alignItems: "center", gap: 40,
            transform: `scale(${1 + lt * 0.03})` }}>
            <div style={{ fontFamily: sans, fontSize: 50, color: dk.inkMuted, letterSpacing: "-0.01em", opacity: intro, filter: intro < 1 ? `blur(${(1 - intro) * 8}px)` : undefined }}>Introducing</div>
            <div style={{ display: "flex", alignItems: "center", gap: L.gap, opacity: clamp(logo * 1.3), filter: logo < 1 ? `blur(${(1 - logo) * 12}px)` : undefined, transform: `translateY(${(1 - logo) * 20}px)` }}>
              <Mark h={markH} top={dk.accent} bottom="#FFFFFF" />
              <Wordmark capH={L.capH} fill="#FFFFFF" />
            </div>
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

export const Act2: React.FC<{ t: number }> = ({ t }) => (
  <>
    <WhatIf t={t} />
    <Keys t={t} />
    <Rings t={t} />
    <Want t={t} />
    <Intro t={t} />
  </>
);
