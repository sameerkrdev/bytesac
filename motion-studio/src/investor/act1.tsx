// Act 1 — the problem (shots 1–7 of docs/script-03-investor.md).
import React from "react";
import { AbsoluteFill } from "remotion";
import { color } from "../lib/brand";
import { mono, sans } from "../lib/fonts";
import { clamp, easeInOut, easeOut, mix, ramp, rng, spring, track } from "../lib/motion";
import { lockup, Mark, Wordmark } from "../lib/pieces";
import { Caption, CX, CY, DarkPlate, dk, FloorLight, focusIn, H, Shot, Typewriter, W } from "./kit";
import { BAR, BEAT, S } from "./timeline";

/* ----------------------------------------------------------------------------------- 1 · logo bookend */

/** Logo with a particle line and floor light. Used at the start and (mirrored) at the end. */
export const LogoStage: React.FC<{ lt: number; outAt?: number; url?: boolean }> = ({ lt, outAt = Infinity, url = false }) => {
  const line = ramp(lt, 0, 1.1, easeInOut);
  const mark = ramp(lt, 0.45, 0.6);
  const letters = (i: number) => ramp(lt, 0.85 + i * 0.07, 0.35);
  const light = ramp(lt, 1.0, 1.4, easeOut);
  const out = ramp(lt, outAt, 0.6, easeInOut);
  const push = 1 + 0.1 * ramp(lt, 0, 6, (x) => x);
  const markH = 130;
  const L = lockup(markH);
  const r = rng(3);
  const sparks = Array.from({ length: 26 }, () => ({ x: r() * W, d: r() * 1.2, s: 1 + r() * 2 }));
  return (
    <AbsoluteFill style={{ background: dk.deep, opacity: 1 - out }}>
      {/* Particle line (ref4's opening rule), dims as the light comes up */}
      <div style={{ position: "absolute", left: 0, top: 880, height: 1, width: W * line, background: "linear-gradient(90deg, rgba(138,166,255,0), rgba(234,240,248,0.5))", opacity: 1 - light * 0.8 }} />
      {sparks.map((p, i) => {
        const v = ramp(lt, 0.05 + p.d * 0.8, 0.3) * (1 - ramp(lt, 1.2 + p.d, 0.6));
        return <div key={i} style={{ position: "absolute", left: p.x, top: 878 - p.s, width: p.s * 2, height: p.s * 2, borderRadius: "50%", background: dk.ink, opacity: v * 0.8 }} />;
      })}
      <FloorLight y={CY + 130} p={light * (0.88 + 0.12 * Math.sin(lt * 2.1))} w={1000 + 120 * light + 60 * Math.sin(lt * 1.3)} />
      <div style={{ position: "absolute", left: CX - L.width / 2, top: CY - markH / 2, display: "flex", alignItems: "center", gap: L.gap,
        transform: `scale(${push * (1 - out * 0.08)})`, transformOrigin: `${L.width / 2}px ${markH / 2}px`, filter: out > 0 ? `blur(${out * 12}px)` : undefined }}>
        <div style={{ ...focusIn(mark, 0) }}><Mark h={markH} top={dk.accent} bottom="#FFFFFF" /></div>
        <Wordmark capH={L.capH} fill="#FFFFFF" letters={letters} />
      </div>
      {url && (
        <div style={{ position: "absolute", left: 0, right: 0, top: CY + 120, textAlign: "center" }}>
          <Typewriter lt={lt} text="bytesac.com" at={1.7} cps={16} size={44} color={dk.inkMuted} />
        </div>
      )}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------ 2–3 · dash field → chaos chart */

const COLS = 60;
const ROWS = 30;
/** A jagged, directionless series: crypto as a full-time job. */
const SERIES = (() => {
  const r = rng(21);
  let v = 0.45;
  return Array.from({ length: COLS }, () => { v = clamp(v + (r() - 0.5) * 0.42, 0.08, 0.95); return v; });
})();

const Dashes: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="dashes" t={t} post={BAR}>
    {(lt) => {
      const sx = W / COLS;
      const sy = (H * 0.78) / ROWS;
      const morph = ramp(lt, 1.6, 1.6, easeInOut); // dash field → bars
      const field = 1 - ramp(lt, 1.4, 1.2);
      const capIn = 0.2;
      const capOut = lt > 1.4 ? 1.4 : Infinity;
      const base = H * 0.86;
      const job = t >= S.job;
      const jl = t - S.job;
      // Arrow riding the tops of the bars, zig-zagging (no clear direction).
      const ap = clamp((lt - 2.2) / 5.4);
      const ai = Math.min(COLS - 1, Math.floor(ap * (COLS - 1)));
      const ax = (ai + 0.5) * sx;
      const ay = base - SERIES[ai]! * H * 0.55 * (1 + 0.22 * Math.sin(lt * 3.1 + ai * 1.7) * Math.sin(lt * 1.3 + ai * 0.6)) - 26;
      const dir = ai < COLS - 1 ? Math.atan2(-(SERIES[ai + 1]! - SERIES[ai]!) * H * 0.55, sx) : 0;
      return (
        <AbsoluteFill style={{ background: dk.deep }}>
          <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
            {field > 0 && Array.from({ length: COLS * ROWS }, (_, k) => {
              const c = k % COLS, r = Math.floor(k / COLS);
              const x = (c + 0.5) * sx, y = H * 0.08 + (r + 0.5) * sy;
              const wave = Math.sin(c * 0.22 + r * 0.31 - lt * 2.6) + Math.sin(c * 0.07 - lt * 1.3);
              const a = wave * 50 + morph * 90;
              const len = 10;
              const dx = Math.cos((a * Math.PI) / 180) * len, dy = Math.sin((a * Math.PI) / 180) * len;
              return <line key={k} x1={x - dx} y1={y - dy} x2={x + dx} y2={y + dy} stroke={dk.ink} strokeWidth={2} opacity={0.55 * field} />;
            })}
            {SERIES.map((v, c) => {
              const g = ramp(lt, 1.7 + c * 0.018, 0.7, easeOut);
              const live = 1 + 0.22 * Math.sin(lt * 3.1 + c * 1.7) * Math.sin(lt * 1.3 + c * 0.6);
              const h = v * H * 0.55 * g * live;
              const x = (c + 0.5) * sx;
              return <line key={`b${c}`} x1={x} y1={base} x2={x} y2={base - h} stroke={dk.ink} strokeWidth={3} opacity={(0.25 + 0.55 * g) * (job ? 0.45 : 1)} />;
            })}
          </svg>
          {lt > 2.2 && (
            <div style={{ position: "absolute", left: ax - 14, top: ay - 14, width: 28, height: 28, transform: `rotate(${dir}rad)`, opacity: ramp(lt, 2.2, 0.3) * (job ? 0.5 : 1) }}>
              <svg width={28} height={28} viewBox="0 0 28 28"><path d="M3 14 H23 M16 7 L23 14 L16 21" stroke={dk.ink} strokeWidth={2.4} fill="none" strokeLinecap="round" /></svg>
            </div>
          )}
          <div style={{ position: "absolute", left: 0, right: 0, top: CY - 30 }}>
            <Caption lt={lt} text="Investing in crypto today…" at={capIn} out={capOut} size={68} />
          </div>
          {job && (
            <div style={{ position: "absolute", left: 0, right: 0, top: 150 }}>
              <Caption lt={jl} text="…is a full-time job." at={0.05} size={72} weight={400} />
            </div>
          )}
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ------------------------------------------------------------------------------ 4 · giant scrolling words */

const Giant: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="giant" t={t}>
    {(lt, dur) => {
      const p = lt / dur;
      const main = "6 wallets · 4 bridges · 12 tabs · 0 sleep";
      const mainW = 5600;
      const x = mix(W * 0.55, W - mainW - W * 0.05, easeInOut(p));
      const back = "swap · bridge · approve · sign · repeat · swap · bridge · approve · sign · repeat";
      return (
        <AbsoluteFill style={{ background: dk.paper }}>
          <div style={{ position: "absolute", top: 150, left: mix(-1400, 200, p), fontFamily: sans, fontSize: 64, fontWeight: 300, color: "rgba(15,30,58,0.18)", whiteSpace: "nowrap", letterSpacing: "-0.02em" }}>{back}</div>
          <div style={{ position: "absolute", top: CY - 190, left: x, fontFamily: sans, fontSize: 300, fontWeight: 400, color: dk.paperInk, whiteSpace: "nowrap", letterSpacing: "-0.045em", lineHeight: 1 }}>
            {main.split("").map((ch, i) => {
              const v = ramp(lt, 0.05 + i * 0.012, 0.3);
              return <span key={i} style={{ opacity: mix(0.15, 1, v) }}>{ch}</span>;
            })}
          </div>
          <div style={{ position: "absolute", top: 820, left: mix(200, -1300, p), fontFamily: sans, fontSize: 64, fontWeight: 300, color: "rgba(15,30,58,0.18)", whiteSpace: "nowrap", letterSpacing: "-0.02em" }}>{back}</div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ------------------------------------------------------------------------------- 5 · typewriter on black */

const Shortcut: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="shortcut" t={t} post={BAR}>
    {(lt) => (
      <AbsoluteFill>
        <DarkPlate t={t} />
        <div style={{ position: "absolute", left: CX - 900 + lt * 260, top: CY - 300, width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(138,166,255,0.18), rgba(138,166,255,0) 70%)" }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: CY - 90, textAlign: "center", transform: `scale(${1 + lt * 0.03})` }}>
          <Typewriter lt={lt} text="So you pick a shortcut." at={0.25} cps={17} size={72} />
          <div style={{ margin: "14px auto 0", width: 330 * ramp(lt, 1.9, 0.6, easeOut), height: 3, background: dk.accent, transform: "translateX(160px)", borderRadius: 2 }} />
          <div style={{ marginTop: 34, opacity: 0.6 }}><Typewriter lt={lt} text="Then another." at={2.5} cps={15} size={56} cursor={false} /></div>
        </div>
      </AbsoluteFill>
    )}
  </Shot>
);

/* ------------------------------------------------------------------- 6a · white panel, stacked "Trust us." */

const Trust: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="trust" t={t}>
    {(lt, dur) => {
      const up = ramp(lt, 0, 0.65, easeOut);
      const lines = 6;
      return (
        <AbsoluteFill>
          <div style={{ position: "absolute", left: 0, right: 0, top: mix(H, 0, up), height: H + 60, background: dk.paper, borderRadius: "48px 48px 0 0", boxShadow: "0 -30px 80px rgba(0,0,0,0.5)" }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 130, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              {Array.from({ length: lines }, (_, i) => {
                const p = ramp(lt, 0.45 + i * (dur - 0.8) / lines, 0.3);
                return (
                  <div key={i} style={{ fontFamily: sans, fontSize: 72, fontWeight: i === lines - 1 ? 500 : 400, color: dk.paperInk, letterSpacing: "-0.02em", ...focusIn(p, 12), opacity: clamp(p * 1.4) * (i === lines - 1 ? 1 : 0.55 + i * 0.07) }}>
                    Trust us.
                  </div>
                );
              })}
            </div>
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ------------------------------------------------------------------------- 6 · alternatives carousel */

const OPTIONS = [
  { tag: "OPTION 1", title: "Exchanges", cons: ["They hold your keys", "Can freeze withdrawals", "One failure from zero"] },
  { tag: "OPTION 2", title: "Copy-trading", cons: ["Anonymous leaders", "Nothing verified", "No accountability"] },
  { tag: "OPTION 3", title: "Doing it yourself", cons: ["Many wallets", "Manual bridging", "Rebalance by hand"] },
  { tag: "OPTION 4", title: "Funds & robo-advisors", cons: ["No on-chain assets", "Broker custody", "Closed doors"] },
];

const Cards: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="cards" t={t} post={0.6}>
    {(lt, dur) => {
      const cw = 540, ch = 640, gap = 70;
      const active = Math.min(OPTIONS.length - 1, Math.floor(lt / BAR));
      // Camera centres the active card (one spring per change keeps the move continuous).
      const keys: [number, number][] = OPTIONS.map((_, i) => [i * BAR, i]);
      const cam = track(lt, keys, 90, 17) + 0.12 * Math.sin(lt * 1.4);
      const bend = ramp(lt, dur - BAR + 0.2, BAR - 0.2, easeInOut); // last bar: cards wrap onto a cylinder and dim
      const exit = ramp(lt, dur - 0.1, 0.6);
      return (
        <AbsoluteFill>
          <DarkPlate t={t} tint={1.4} />
          <div style={{ position: "absolute", inset: 0, perspective: 1800, opacity: 1 - exit }}>
            {OPTIONS.map((o, i) => {
              const off = i - cam;
              const isA = i === active;
              const lift = spring(lt - i * BAR, 160, 22) * (isA ? 1 : 0) * (1 - bend);
              const x = CX + off * (cw + gap) * mix(1, 0.78, bend);
              const ry = -off * mix(14, 34, bend);
              const z = -Math.abs(off) * mix(120, 420, bend);
              const enter = ramp(lt, i * 0.12, 0.8);
              return (
                <div key={o.title} style={{ position: "absolute", left: x - cw / 2, top: CY - ch / 2, width: cw, height: ch, borderRadius: 30,
                  background: `linear-gradient(170deg, ${isA ? "#18233A" : "#111A2B"}, #0B1220)`, border: `1px solid rgba(255,255,255,${isA ? 0.16 : 0.07})`,
                  boxShadow: isA ? "0 40px 100px rgba(0,0,0,0.6), 0 0 80px rgba(138,166,255,0.18)" : "0 30px 80px rgba(0,0,0,0.5)",
                  transform: `translateZ(${z + lift * 60}px) rotateY(${ry}deg) translateY(${(1 - enter) * 80 + 10 * Math.sin(lt * 1.8 + i)}px)`, opacity: enter * mix(1, 0.35, bend) * (isA || bend > 0 ? 1 : 0.55),
                  padding: 44, boxSizing: "border-box", fontFamily: sans }}>
                  <div style={{ fontFamily: mono, fontSize: 22, letterSpacing: "0.14em", color: dk.inkMuted }}>{o.tag}</div>
                  <div style={{ marginTop: 18, fontSize: 56, fontWeight: 400, color: dk.ink, letterSpacing: "-0.025em", lineHeight: 1.08 }}>{o.title}</div>
                  <div style={{ marginTop: 60, display: "flex", flexDirection: "column", gap: 26 }}>
                    {o.cons.map((c, k) => {
                      const cp = ramp(lt, i * BAR + 0.25 + k * 0.16, 0.4);
                      return (
                        <div key={c} style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, color: dk.ink, opacity: isA ? mix(0.25, 1, cp) : 0.5 }}>
                          <svg width={26} height={26} viewBox="0 0 26 26" style={{ flex: "none" }}>
                            <circle cx={13} cy={13} r={12} fill="rgba(248,113,113,0.14)" stroke="rgba(248,113,113,0.6)" />
                            <path d="M9 9 L17 17 M17 9 L9 17" stroke="#F87171" strokeWidth={2} strokeLinecap="round" />
                          </svg>
                          {c}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* ---------------------------------------------------------------------------------- 7 · word slot machine */

const PAINS = ["Custody risk", "Unverified “experts”", "Fragmented chains", "Manual rebalancing", "Hidden fees", "Too much work."];

const Slot: React.FC<{ t: number }> = ({ t }) => (
  <Shot k="slot" t={t}>
    {(lt) => {
      const step = BAR / 2;
      const keys: [number, number][] = PAINS.map((_, i) => [i * step, i]);
      const pos = track(lt, keys, 220, 24) + 0.06 * Math.sin(lt * 3);
      const rowH = 150;
      const enter = ramp(lt, 0, 0.35);
      return (
        <AbsoluteFill style={{ background: dk.paper }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, transform: `scale(${1 + lt * 0.01})` }}>
            {PAINS.map((w, i) => {
              const d = i - pos;
              const a = Math.abs(d);
              return (
                <div key={w} style={{ position: "absolute", left: 0, right: 0, top: CY - 50 + d * rowH, textAlign: "center", fontFamily: sans,
                  fontSize: mix(104, 52, Math.min(1, a)), fontWeight: a < 0.5 ? 500 : 400, color: dk.paperInk, letterSpacing: "-0.03em",
                  opacity: enter * clamp(1 - a * 0.62) * (a < 0.5 ? 1 : 0.5), filter: a > 0.2 ? `blur(${Math.min(6, a * 3)}px)` : undefined }}>
                  {w}
                </div>
              );
            })}
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 120, textAlign: "center", fontFamily: mono, fontSize: 20, letterSpacing: "0.16em", color: "rgba(15,30,58,0.5)", opacity: enter }}>
            THE COST OF THE SHORTCUTS
          </div>
        </AbsoluteFill>
      );
    }}
  </Shot>
);

/* --------------------------------------------------------------------------------------------- export */

export const Act1: React.FC<{ t: number }> = ({ t }) => (
  <>
    <Shot k="logo" t={t}>{(lt, dur) => <LogoStage lt={lt} outAt={dur - 0.55} />}</Shot>
    <Dashes t={t} />
    <Giant t={t} />
    <Shortcut t={t} />
    <Trust t={t} />
    <Cards t={t} />
    <Slot t={t} />
  </>
);

