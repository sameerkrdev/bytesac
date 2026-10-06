// Act 4 — self-custody (the funny part), CTA and the logo bookend (shots 25–28).
import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { mono, sans } from "../lib/fonts";
import { clamp, easeInOut, easeOut, mix, ramp, spring } from "../lib/motion";
import { LogoStage } from "./act1";
import { Caption, CX, CY, DarkPlate, Disc, dk, focusIn, H, Shot, W } from "./kit";

/* ---------------------------------------------------------------------- 25 · orbit: your assets, your wallet */

const ORBIT = ["BTC", "ETH", "SOL", "LINK", "BNB", "USDC", "GOLD", "POL"];

const Orbit: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="orbit" t={t}>
    {(lt, dur) => {
      const ring = ramp(lt, 0, 0.8, easeInOut);
      const out = ramp(lt, dur - 0.35, 0.35, easeInOut);
      const r1 = 430, r2 = 610;
      return (
        <AbsoluteFill>
          <DarkPlate t={t} />
          <div style={{ position: "absolute", inset: 0, opacity: 1 - out, filter: out > 0 ? `blur(${out * 10}px)` : undefined }}>
            <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
              {[r1, r2].map((r, i) => <ellipse key={r} cx={CX} cy={CY} rx={r * ring} ry={r * 0.62 * ring} fill="none" stroke={`rgba(234,240,248,${0.12 - i * 0.04})`} />)}
              <circle cx={CX} cy={CY} r={250} fill="rgba(14,23,38,0.85)" stroke="rgba(234,240,248,0.5)" strokeWidth={1.5} opacity={ring} />
            </svg>
            {ORBIT.map((s, i) => {
              const r = i % 2 ? r2 : r1;
              const a = (i / ORBIT.length) * Math.PI * 2 + lt * (i % 2 ? 0.35 : -0.45);
              const x = CX + Math.cos(a) * r, y = CY + Math.sin(a) * r * 0.62;
              const depth = (Math.sin(a) + 1) / 2;
              const p = ramp(lt, 0.3 + i * 0.07, 0.5);
              return <div key={s} style={{ position: "absolute", left: x - 42, top: y - 42, opacity: p * mix(0.5, 1, depth), transform: `scale(${mix(0.75, 1.15, depth)})`, zIndex: depth > 0.5 ? 2 : 0 }}><Disc sym={s} size={84} /></div>;
            })}
            <div style={{ position: "absolute", left: 0, right: 0, top: CY - 74, zIndex: 3 }}>
              <Caption lt={lt} text="Your assets." at={0.4} size={60} />
              <Caption lt={lt} text="*Your wallet." at={0.9} size={60} />
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 920 }}>
              <Caption lt={lt} text="Always." at={1.6} size={56} color={dk.inkMuted} />
            </div>
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* --------------------------------------------------------------------------- 26 · the "what if" cards */

const WHATIF = [
  { q: "We get hacked?", a: "They can't move what we never held.", x: 90, y: 90, rot: -3 },
  { q: "We go bankrupt?", a: "Your assets don't even notice.", x: 1040, y: 170, rot: 2.5 },
  { q: "We lose the office Wi-Fi?", a: "Still yours. Obviously.", x: 300, y: 680, rot: 1.5 },
];

const Funny: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="funny" t={t}>
    {(lt, dur) => {
      const step = (dur - 0.6) / WHATIF.length;
      const out = ramp(lt, dur - 0.3, 0.3, easeInOut);
      const centre = ramp(lt, 0.15, 0.6);
      return (
        <AbsoluteFill>
          <DarkPlate t={t} tint={1.3} />
          <div style={{ position: "absolute", inset: 0, opacity: 1 - out, filter: out > 0 ? `blur(${out * 10}px)` : undefined, transform: `scale(${1 + lt * 0.012})` }}>
            {WHATIF.map((c, i) => {
              const p = spring(lt - i * step, 220, 19);
              const ans = ramp(lt, i * step + 0.55, 0.4);
              const bob = Math.sin(lt * 1.7 + i * 2) * 6;
              return (
                <div key={c.q} style={{ position: "absolute", left: c.x, top: c.y + bob, width: 780, borderRadius: 30, padding: "36px 42px", boxSizing: "border-box",
                  background: "linear-gradient(170deg, #16233B, #0C1424)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
                  transform: `rotate(${c.rot}deg) scale(${p})`, opacity: clamp(p * 1.5), fontFamily: sans }}>
                  <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: "0.14em", color: dk.inkFaint }}>WHAT IF…</div>
                  <div style={{ marginTop: 10, fontSize: 52, color: dk.ink, letterSpacing: "-0.02em" }}>{c.q}</div>
                  <div style={{ marginTop: 14, fontSize: 38, color: dk.accent, opacity: ans, filter: ans < 1 ? `blur(${(1 - ans) * 8}px)` : undefined }}>{c.a}</div>
                </div>
              );
            })}
            <div style={{ position: "absolute", left: 0, right: 0, top: CY - 40, ...focusIn(centre, 0) }}>
              <div style={{ textAlign: "center", fontFamily: sans, fontSize: 42, color: dk.inkMuted, letterSpacing: "-0.01em" }}>
                We never hold your assets. <span style={{ color: dk.ink }}>Not for a second.</span>
              </div>
            </div>
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* -------------------------------------------------------------------------------- 27 · CTA + echo grid */

const Cta: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="cta" t={t}>
    {(lt, dur) => {
      const join = ramp(lt, 1.25, 0.4);
      const lineOut = 1.15;
      const echo = ramp(lt, 1.45, 0.6);
      const out = ramp(lt, dur - 0.25, 0.25);
      return (
        <AbsoluteFill style={{ background: dk.deep, opacity: 1 - out }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: CY - 34 }}>
            <Caption lt={lt} text="Invest in strategies, not individual trades." at={0.05} out={lineOut} stagger={0.06} size={70} />
          </div>
          {join > 0 && Array.from({ length: 7 * 5 }, (_, k) => {
            const c = (k % 7) - 3, r = Math.floor(k / 7) - 2;
            const centre = c === 0 && r === 0;
            const d = Math.hypot(c, r * 1.4);
            const v = centre ? join : echo * clamp(1 - d * 0.22) * 0.35;
            return (
              <div key={k} style={{ position: "absolute", left: CX + c * 400 - 200, top: CY + r * 150 - 50, width: 400, textAlign: "center", fontFamily: sans,
                fontSize: centre ? 96 : 76, color: dk.ink, opacity: v, filter: centre ? (join < 1 ? `blur(${(1 - join) * 10}px)` : undefined) : "blur(1.5px)", letterSpacing: "-0.03em" }}>
                Join us
              </div>
            );
          })}
        </AbsoluteFill>
      );
    }}
  </Shot>
);

export const Act4: React.FC<{ t: number }> = ({ t }) => (
  <>
    <Orbit t={t} />
    <Funny t={t} />
    <Cta t={t} />
    <Shot k="outro" t={t}>{(lt) => <LogoStage lt={lt} url />}</Shot>
  </>
);

