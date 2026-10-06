// Video 5 — Product film (docs/script-05-product.md), grammar from ref5 (docs/style-guide-ref5.md), Bytesac dark theme.
// Timed to the measured Lyria beats (87.6 BPM): intro to 18.9 s, a stop, the groove drops at 22.33 s.
import React from "react";
import { AbsoluteFill, Html5Audio, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFonts, mono, sans } from "../lib/fonts";
import { clamp, easeInOut, easeOut, mix, ramp, rng, spring } from "../lib/motion";
import { lockup, Mark, Wordmark } from "../lib/pieces";
import { Caption, CX, CY, Disc, dk, H, ratio, Typewriter, Ui, W } from "../investor/kit";

loadFonts();

/**
 * Voice-led timeline. The music (tools/product-audio.mjs) is the Lyria track with three intro bars and one groove bar
 * spliced in on measured downbeats, so its drop lands at 30.616 s and its final hit at 66.4 s. VO line starts are in
 * vo.json (shared with the audio mix); phrase times inside lines were measured with silencedetect.
 */
const DROP = 30.616;
export const PRODUCT_DURATION = 68;

const T = {
  cards: 0, wealth: 9.3, isnt: 9.75, built: 10.1, overnight: 10.5, echo: 11.25, strategy: 12.45, icon: 14.9, prompt: 15.7,
  chaos: 24.3, hype: 25.2, words: 27.4, logo: DROP, baskets: 33.6, task: 39.2, legs: 41.8, review: 47.1, drift: 51.6,
  tokenized: 56.0, end: 60.6,
};

export const ProductFilm: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cam = `translate(${10 * Math.sin(t * 0.7) + 4 * Math.sin(t * 1.9)}px, ${7 * Math.sin(t * 0.55 + 1)}px) scale(${1.03 + 0.008 * Math.sin(t * 0.33)})`;
  const fade = ramp(t, PRODUCT_DURATION - 1.0, 1.0);
  const seg = (a: number, z: number) => t >= a && t < z;
  return (
    <AbsoluteFill style={{ background: dk.deep, overflow: "hidden", fontFamily: sans, color: dk.ink }}>
      <AbsoluteFill style={{ transform: cam }}>
        {seg(T.cards, T.overnight) && <Cards lt={t - T.cards} t={t} />}
        {seg(T.overnight, T.echo) && <Happen lt={t - T.overnight} />}
        {seg(T.echo, T.strategy) && <Echo lt={t - T.echo} />}
        {seg(T.strategy, T.icon) && <Strategy lt={t - T.strategy} />}
        {seg(T.icon, T.prompt) && <Icon lt={t - T.icon} />}
        {seg(T.prompt, T.chaos) && <Prompt lt={t - T.prompt} />}
        {seg(T.chaos, T.hype) && <Chaos lt={t - T.chaos} />}
        {seg(T.hype, T.words) && <Hype lt={t - T.hype} />}
        {seg(T.words, T.logo) && <Words lt={t - T.words} />}
        {seg(T.logo, T.baskets) && <LogoBuild lt={t - T.logo} outAt={T.baskets - T.logo - 0.4} />}
        {seg(T.baskets, T.task) && <Baskets lt={t - T.baskets} dur={T.task - T.baskets} />}
        {seg(T.task, T.legs) && <NewTask lt={t - T.task} amount="500" basket="Core Crypto Index" />}
        {seg(T.legs, T.review) && <Legs lt={t - T.legs} dur={T.review - T.legs} />}
        {seg(T.review, T.drift) && <Review lt={t - T.review} dur={T.drift - T.review} />}
        {seg(T.drift, T.tokenized) && <Drift lt={t - T.drift} dur={T.tokenized - T.drift} />}
        {seg(T.tokenized, T.end) && <Tokenized lt={t - T.tokenized} />}
        {t >= T.end && <LogoBuild lt={t - T.end} tagline />}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#000", opacity: fade }} />
      <Html5Audio src={staticFile("audio/product-mix.wav")} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------- helpers */

const Photo: React.FC<{ src: string; style?: React.CSSProperties; fit?: "cover" | "contain" }> = ({ src, style, fit = "cover" }) => (
  <Img src={staticFile(`product/${src}.jpg`)} style={{ width: "100%", height: "100%", objectFit: fit, display: "block", ...style }} />
);

/** White hand pointer (ref5's cursor), pressing scales it down. */
const Cursor: React.FC<{ x: number; y: number; press?: number; opacity?: number }> = ({ x, y, press = 0, opacity = 1 }) => (
  <svg width={40} height={46} viewBox="0 0 30 34" style={{ position: "absolute", left: x - 10, top: y - 4, opacity, transform: `scale(${1 - 0.12 * press})`, filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.6))" }}>
    <path d="M10 2.5c1.4 0 2.5 1.1 2.5 2.5v9l1-.2c1.1-.2 2.2.4 2.6 1.4l.1.3.4-.1c1.2-.3 2.4.4 2.8 1.6l.6-.1c1.3-.2 2.6.7 2.8 2l.7 5.2c.3 2.1-.2 4.2-1.4 5.9l-1.3 1.8H10.6l-4.7-7.3c-.7-1.1-.4-2.6.7-3.3 1-.6 2.2-.4 3 .4V5c0-1.4 1.1-2.5 2.5-2.5z" fill="#fff" stroke="#0B0B0C" strokeWidth={1.2} strokeLinejoin="round" transform="translate(-2 0)" />
  </svg>
);

const Big: React.FC<{ children: React.ReactNode; size: number; style?: React.CSSProperties }> = ({ children, size, style }) => (
  <div style={{ position: "absolute", fontFamily: sans, fontWeight: 600, fontSize: size, letterSpacing: "-0.045em", lineHeight: 1, color: "#fff", whiteSpace: "nowrap", ...style }}>{children}</div>
);

/* ------------------------------------------------------------------- 1–2 · stacking photo cards + thesis */

/**
 * Fintech history → crypto. Each card appears on the VO ("Money keeps moving forward. Cards. Screens. Phones. And now…
 * crypto."), growing out of a small thumbnail at its own corner of the stack (ref5), faster and faster.
 */
const CARDS = [
  { src: "h1900", tag: "1900 · Trading floors", at: 0.25 },
  { src: "h1920", tag: "1920 · Ticker tape", at: 1.7 },
  { src: "f1950", tag: "1950 · Charge cards", at: 3.35 },
  { src: "f1967", tag: "1967 · Cash machines", at: 3.85 },
  { src: "f1971", tag: "1971 · Electronic exchanges", at: 4.5 },
  { src: "f1995", tag: "1995 · Online banking", at: 4.95 },
  { src: "f2007", tag: "2007 · Mobile banking", at: 5.8 },
  { src: "f2009", tag: "2009 · Bitcoin", at: 7.05 },
  { src: "f2020", tag: "2020 · DeFi", at: 7.55 },
  { src: "ftoday", tag: "Today · Tokenized assets", at: 8.1 },
];
const CW = 720, CH = 540;
/** Card i's offset from the stack centre: alternating lower-left / lower-right, like a hand-dealt pile. */
const cardOffset = (i: number) => (i === 0 ? [0, 0] : [(i % 2 ? -1 : 1) * (48 + (i % 3) * 14), i * 22]);

const Cards: React.FC<{ lt: number; t: number }> = ({ lt, t }) => {
  const shown = CARDS.filter((c) => lt >= c.at).length;
  // The stack recentres as it grows (one spring per new card) and slowly pushes in.
  const keys: [number, number][] = CARDS.map((c, i) => [c.at, -cardOffset(i)[1]! / 2]);
  const lift = CARDS.reduce((acc, c, i) => acc + (i === 0 ? 0 : (keys[i]![1] - keys[i - 1]![1]) * spring(lt - c.at, 140, 22)), 0);
  const push = 1 + 0.06 * clamp(lt / 9);
  const thesis = t >= T.wealth;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${lift - 30}px) scale(${push * (thesis ? 0.82 : 1)})`, transformOrigin: "50% 55%", opacity: thesis ? 0.8 : 1 }}>
        {CARDS.slice(0, shown).map((c, i) => {
          const [ox, oy] = cardOffset(i);
          const first = i === 0;
          const dur = first ? 0.7 : i < 3 ? 0.42 : 0.3;
          const g = easeOut(clamp((lt - c.at) / dur));
          const s = mix(first ? 0.12 : 0.24, 1, g);
          const origin = first ? "50% 50%" : (i % 2 ? "0% 100%" : "100% 100%");
          return (
            <div key={c.src} style={{ position: "absolute", left: CX - CW / 2 + ox!, top: CY - CH / 2 + oy!, width: CW, height: CH, transform: `scale(${s})`, transformOrigin: origin,
              boxShadow: "0 24px 70px rgba(0,0,0,0.75)", overflow: "hidden", borderRadius: 4, outline: "1px solid rgba(255,255,255,0.08)" }}>
              <Photo src={c.src} style={{ transform: `scale(${1.04 + 0.04 * clamp((lt - c.at) / 3)})` }} />
              <div style={{ position: "absolute", left: 12, top: 10, padding: "5px 10px", background: "rgba(0,0,0,0.72)", borderRadius: 4, fontFamily: mono, fontSize: 15, letterSpacing: "0.06em", color: "#fff", opacity: g }}>{c.tag}</div>
            </div>
          );
        })}
      </div>
      {/* Thesis words, synced to "But wealth isn't built…" */}
      {t >= T.wealth && t < T.isnt && <Big size={300} style={{ left: 60, top: 30, opacity: ramp(t, T.wealth, 0.1) }}>Wealth</Big>}
      {t >= T.isnt && t < T.built && (
        <AbsoluteFill style={{ background: "#000" }}><Big size={150} style={{ left: 90, top: 120 }}>isn't</Big></AbsoluteFill>
      )}
      {t >= T.built && (
        <AbsoluteFill style={{ background: "#000" }}>
          <Big size={560} style={{ left: mix(-40, -160, ramp(t, T.built, T.overnight - T.built)), top: CY - 300 }}>built</Big>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------------- 3 · "happen" types on over a photo */

const Happen: React.FC<{ lt: number }> = ({ lt }) => {
  const word = "overnight";
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${1.05 + lt * 0.03})`, filter: "grayscale(1) brightness(0.55)" }}><Photo src="f1967" /></AbsoluteFill>
      <div style={{ position: "absolute", left: 60, top: CY - 170, fontFamily: sans, fontWeight: 600, fontSize: 310, letterSpacing: "-0.045em", color: "#fff", whiteSpace: "nowrap", lineHeight: 1 }}>
        {[...word].map((ch, i) => {
          const p = ramp(lt, i * 0.07, 0.12);
          const wob = lt > 0.7 ? Math.sin(lt * 9 + i * 1.7) * 7 : 0;
          return <span key={i} style={{ display: "inline-block", opacity: p, transform: `translateY(${wob}px) rotate(${wob * 0.3}deg)` }}>{ch}</span>;
        })}
      </div>
    </AbsoluteFill>
  );
};

/* --------------------------------------------------------------------------------------- 4 · echo grid */

const Echo: React.FC<{ lt: number }> = ({ lt }) => {
  const cols = 12, rows = 14;
  const clear = ramp(lt, 0.25, 0.7);
  const line = ramp(lt, 0.55, 0.3);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {Array.from({ length: cols * rows }, (_, k) => {
        const c = k % cols, r = Math.floor(k / cols);
        const gone = (c + 1) / cols <= clear * 1.15 && c !== cols - 1 && c !== cols - 2;
        return <div key={k} style={{ position: "absolute", left: 150 + c * 140, top: 120 + r * 62, fontSize: 22, fontWeight: 500, color: "#fff", opacity: gone ? 0 : 1 }}>overnight</div>;
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: CY - 20, textAlign: "center", fontSize: 30, color: "#fff", opacity: line, wordSpacing: "60px" }}>it takes a</div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------- 5 · "strategy" huge over swapping images */

const SWAPS = ["s1", "f1971", "s2", "f1995", "f2009", "s3", "f2020", "s4"];

const Strategy: React.FC<{ lt: number }> = ({ lt }) => {
  const idx = Math.min(SWAPS.length - 1, Math.floor(lt / 0.3));
  const tiles = [
    { src: "s2", x: 30, y: 40, w: 260, at: 0.6 }, { src: "s3", x: 1560, y: 60, w: 300, at: 1.0 },
    { src: "f2007", x: 60, y: 780, w: 280, at: 1.5 }, { src: "s4", x: 1580, y: 790, w: 280, at: 1.9 },
  ];
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <div style={{ position: "absolute", left: CX - 560, top: CY - 300, width: 1120, height: 600, overflow: "hidden", borderRadius: 8 }}>
        <Photo src={SWAPS[idx]!} style={{ filter: "brightness(0.8)", transform: `scale(${1.05 + (lt % 0.3) * 0.1})` }} />
      </div>
      {tiles.map((tl) => {
        const p = spring(lt - tl.at, 260, 20);
        return lt < tl.at ? null : (
          <div key={tl.src + tl.x} style={{ position: "absolute", left: tl.x, top: tl.y, width: tl.w, height: tl.w * 0.66, overflow: "hidden", borderRadius: 6, transform: `scale(${p})`, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
            <Photo src={tl.src} />
          </div>
        );
      })}
      <Big size={330} style={{ left: 0, right: 0, textAlign: "center", top: CY - 170, textShadow: "0 10px 60px rgba(0,0,0,0.5)" }}>strategy</Big>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------- 6 · icon from a dot */

const Icon: React.FC<{ lt: number }> = ({ lt }) => {
  const s = spring(lt, 150, 13);
  const tilt = mix(-35, -8, easeOut(clamp(lt / 0.7)));
  return (
    <AbsoluteFill style={{ background: dk.deep }}>
      <AbsoluteFill style={{ background: "radial-gradient(500px 400px at 50% 50%, rgba(138,166,255,0.18), rgba(138,166,255,0) 70%)", opacity: s }} />
      <div style={{ position: "absolute", left: CX - 80, top: CY - 97, transform: `scale(${s}) rotate(${tilt}deg)`, filter: "drop-shadow(0 0 40px rgba(138,166,255,0.6))" }}>
        <Mark h={194} top={dk.accent} bottom="#FFFFFF" />
      </div>
      <div style={{ position: "absolute", left: CX + 70 + lt * 40, top: CY + 60 + lt * 20, width: 34, height: 34, transform: `scale(${spring(lt - 0.15, 200, 14)}) rotate(45deg)`,
        background: "radial-gradient(circle, #fff, rgba(138,166,255,0.6) 40%, rgba(138,166,255,0) 70%)" }} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------- 7 · the DIY to-do list typed and replaced */

/** Typed one after another on the VO ("…swapping, bridging, rebalancing… and checking six wallets a day"). */
const TODO = ["Swap USDC to SOL", "Bridge ETH to Base", "Rebalance my portfolio", "Check 6 wallets", "Read 40 threads"];
const TODO_AT = [0.9, 2.5, 4.0, 5.55, 7.1];

const Prompt: React.FC<{ lt: number }> = ({ lt }) => {
  const push = ramp(lt, 0.5, 0.5, easeInOut);
  const scale = mix(0.7, 1.9, push) * (1 + 0.025 * Math.sin(lt * 4));
  const start = TODO_AT[0]!;
  let i = 0;
  TODO_AT.forEach((a, k) => { if (lt >= a) i = k; });
  const local = lt - TODO_AT[i]!;
  // Type at 20 chars/s, hold, then clear the field just before the next request.
  const next = TODO_AT[i + 1] ?? Infinity;
  const clearing = lt > next - 0.18;
  const text = lt < start || clearing ? "" : TODO[i]!.slice(0, Math.max(0, Math.floor(local * 20)));
  const hue = (lt * 120) % 360;
  return (
    <AbsoluteFill style={{ background: dk.deep }}>
      <div style={{ position: "absolute", left: CX - 380, top: CY - 50, width: 760, height: 100, transform: `scale(${scale})`, transformOrigin: "30% 50%" }}>
        <div style={{ position: "absolute", inset: -3, borderRadius: 26, background: `linear-gradient(${hue}deg, #8AA6FF, #3D63D9, #B9C8F2, #8AA6FF)`, filter: "blur(0.5px)", boxShadow: "0 0 40px rgba(138,166,255,0.35)" }} />
        <div style={{ position: "absolute", inset: 0, borderRadius: 24, background: "#0C1322", display: "flex", alignItems: "center", padding: "0 34px", fontSize: 36, color: lt < start ? dk.inkFaint : dk.ink }}>
          {lt < start ? "What do you need to do today?" : text}
          {lt >= start && <span style={{ width: 3, height: 40, marginLeft: 3, background: dk.ink, opacity: Math.floor(lt * 3) % 2 ? 1 : 0.2 }} />}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ----------------------------------------------------------------------------- 8 · chaos, out of focus */

const Chaos: React.FC<{ lt: number }> = ({ lt }) => (
  <AbsoluteFill style={{ background: "#000", perspective: 1400 }}>
    <AbsoluteFill style={{ transform: `rotateX(28deg) rotateZ(-8deg) translate(${-lt * 320}px, ${-lt * 120}px) scale(1.5)`, filter: "blur(5px) brightness(0.8)" }}>
      <Photo src="chaos" />
    </AbsoluteFill>
  </AbsoluteFill>
);

/* --------------------------------------------------------------------------------- 9 · hype collage */

const HYPE = [
  { text: "Next 100x token", x: 80, y: 80, size: 64, from: [-1, 0], at: 0, serif: false, accent: false },
  { text: "Don't miss out", x: 1080, y: 150, size: 72, from: [1, 0], at: 0.35, serif: true, accent: true },
  { text: "Top 10 coins this week", x: 300, y: 330, size: 56, from: [0, -1], at: 0.7, serif: false, accent: false },
  { text: "Last chance", x: 1180, y: 480, size: 80, from: [1, 0], at: 1.05, serif: true, accent: false },
  { text: "Everyone is buying", x: 120, y: 560, size: 60, from: [-1, 0], at: 1.4, serif: false, accent: true },
  { text: "Before it's too late", x: 900, y: 700, size: 52, from: [0, 1], at: 1.75, serif: true, accent: false },
];

const Hype: React.FC<{ lt: number }> = ({ lt }) => {
  const r = rng(9);
  return (
    <AbsoluteFill style={{ background: "#0B0B0C" }}>
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i} style={{ position: "absolute", left: r() * W, top: r() * H, width: 160, fontSize: 9, lineHeight: 1.4, color: "rgba(255,255,255,0.25)", opacity: ramp(lt, r() * 1.5, 0.3) }}>
          ████ ███ ██████ ███ ████████ ██ █████ ███ ███████ ██ ████ ████ ███
        </div>
      ))}
      {HYPE.map((h) => {
        const p = spring(lt - h.at, 200, 22);
        return lt < h.at ? null : (
          <div key={h.text} style={{ position: "absolute", left: h.x + h.from[0]! * (1 - p) * 900, top: h.y + h.from[1]! * (1 - p) * 500, fontSize: h.size,
            fontFamily: h.serif ? "Georgia, 'Times New Roman', serif" : sans, fontStyle: h.serif ? "italic" : "normal", fontWeight: h.serif ? 400 : 700,
            letterSpacing: h.serif ? "-0.01em" : "-0.03em", color: h.accent ? dk.accent : "#fff", whiteSpace: "nowrap" }}>{h.text}</div>
        );
      })}
      <Big size={300} style={{ top: 770, left: mix(W, -380, ramp(lt, 0.2, T.words - T.hype, (x) => x)), letterSpacing: "-0.02em", fontWeight: 700, transform: "scaleY(1.15)" }}>
        <span style={{ color: dk.accent }}>HY</span>PE
      </Big>
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------------- 10 · single words in the stop */

const WORDS = ["hype", "is", "not", "a", "plan."];

const Words: React.FC<{ lt: number }> = ({ lt }) => {
  // "Hype is not a plan." — word starts measured in the VO line (it starts at 27.6 s).
  const AT = [0.2, 1.0, 1.22, 1.45, 1.7];
  let i = 0;
  AT.forEach((a, k) => { if (lt >= a) i = k; });
  const each = 0;
  const last = i === WORDS.length - 1;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: last ? CY - 120 : CY - 22, textAlign: "center", fontSize: last ? 220 : 40, fontWeight: last ? 600 : 500,
        letterSpacing: last ? "-0.045em" : "-0.01em", color: "#fff", transform: `translateY(${-(lt - AT[i]!) * 14}px) scale(${1 + (lt - AT[i]!) * (last ? 0.05 : 0.12)})`, opacity: lt < AT[0]! ? 0 : 1 }}>
        {WORDS[i]}
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------- 11, 16 · logo build */

const LogoBuild: React.FC<{ lt: number; outAt?: number; tagline?: boolean }> = ({ lt, outAt = Infinity, tagline = false }) => {
  const markH = 150;
  const L = lockup(markH);
  const p = spring(lt, 120, 16);
  const blur = (1 - clamp(lt / 0.6)) * 14;
  const slide = ramp(lt, 0.75, 0.6, easeInOut);
  const out = ramp(lt, outAt, 0.4);
  const left = CX - mix(L.markW / 2, L.width / 2, slide);
  return (
    <AbsoluteFill style={{ background: dk.deep, opacity: 1 - out, filter: out > 0 ? `blur(${out * 14}px)` : undefined }}>
      <AbsoluteFill style={{ background: `radial-gradient(${700 + 80 * Math.sin(lt * 2)}px ${400 + 40 * Math.sin(lt * 2)}px at 50% 50%, rgba(61,99,217,${(0.18 + 0.06 * Math.sin(lt * 2.4)) * p}), rgba(61,99,217,0) 70%)` }} />
      <div style={{ position: "absolute", left, top: CY - markH / 2, display: "flex", alignItems: "center", gap: L.gap, transform: `scale(${1 + lt * 0.035})`, transformOrigin: `${CX - left}px ${markH / 2}px` }}>
        <div style={{ filter: blur > 0.2 ? `blur(${blur}px)` : undefined }}>
          <Mark h={markH} top={dk.accent} bottom="#FFFFFF"
            topStyle={{ transform: `translate(${(1 - p) * -260}px, ${(1 - p) * -200}px) rotate(${(1 - p) * -200}deg)` }}
            bottomStyle={{ transform: `translate(${(1 - p) * 260}px, ${(1 - p) * 220}px) rotate(${(1 - p) * 180}deg)` }} />
        </div>
        <Wordmark capH={L.capH} fill="#FFFFFF" letters={(i) => ramp(lt, 0.95 + i * 0.07, 0.3)} />
      </div>
      {tagline && (
        <div style={{ position: "absolute", left: 0, right: 0, top: CY + 130, textAlign: "center", opacity: 0.85 }}>
          <Typewriter lt={lt} text="Invest in strategies, not individual trades." at={2.05} cps={13} size={54} color={dk.ink} cursor={false} />
        </div>
      )}
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------------- 12 · new task → glowing button */

const NewTask: React.FC<{ lt: number; amount: string; basket: string; prefix?: string }> = ({ lt, amount, basket, prefix }) => {
  const enter = ramp(lt, 0, 0.5);
  const typed = Math.floor(Math.max(0, lt - 0.5) * 9);
  const btn = spring(lt - 1.3, 200, 18);
  const move = ramp(lt, 1.6, 0.6, easeInOut);
  const click = 2.35;
  const press = lt > click && lt < click + 0.15 ? 1 : 0;
  const glow = ramp(lt, click, 0.3) * (1 - ramp(lt, click + 0.9, 0.6) * 0.4);
  const cx = mix(CX + 600, CX + 30, move), cy = mix(CY + 420, CY + 185, move);
  return (
    <AbsoluteFill style={{ background: dk.deep }}>
      <div style={{ position: "absolute", left: CX - 420, top: CY - 150, width: 840, opacity: enter, transform: `scale(${1.65 - 0.06 * lt})`, transformOrigin: "50% 45%" }}>
        <div style={{ fontFamily: mono, fontSize: 18, letterSpacing: "0.14em", color: dk.inkFaint }}>{prefix ?? "INVEST IN"} {basket.toUpperCase()}</div>
        <div style={{ marginTop: 14, height: 110, borderRadius: 18, background: "#0C1322", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", padding: "0 30px", fontSize: 64, fontWeight: 300, color: dk.ink }}>
          {amount.slice(0, typed)}
          <span style={{ width: 3, height: 60, marginLeft: 4, background: dk.ink, opacity: typed < amount.length || Math.floor(lt * 3) % 2 ? 1 : 0 }} />
          <span style={{ marginLeft: "auto", fontSize: 28, color: dk.inkMuted }}>USDC</span>
        </div>
        <div style={{ margin: "34px auto 0", width: 300, height: 76, borderRadius: 38, background: glow > 0.3 ? dk.accentStrong : dk.ink, color: glow > 0.3 ? "#fff" : dk.paperInk,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 500, transform: `scale(${btn * (1 - 0.05 * press)})`,
          boxShadow: `0 0 ${60 * glow}px rgba(138,166,255,${0.8 * glow})` }}>Get preview</div>
      </div>
      <Cursor x={cx} y={cy} press={press} opacity={ramp(lt, 1.5, 0.2)} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------- 13 · UI in 3D tilt over the misty plate, legs */

const LEGS = [
  { kind: "All fees, in one transfer", from: "USDC", to: "USDC", chain: "Solana" },
  { kind: "Swap · USDC → SOL", from: "USDC", to: "SOL", chain: "Solana" },
  { kind: "Cross-chain · USDC → BTC", from: "USDC", to: "BTC", chain: "Bitcoin" },
  { kind: "Cross-chain · USDC → ETH", from: "USDC", to: "ETH", chain: "Base" },
  { kind: "Cross-chain · USDC → LINK", from: "USDC", to: "LINK", chain: "Arbitrum" },
];

const Plate: React.FC<{ lt: number }> = ({ lt }) => (
  <AbsoluteFill style={{ transform: `scale(${1.08 + lt * 0.01}) translateX(${-lt * 6}px)`, filter: "brightness(0.55) saturate(0.7)" }}><Photo src="plate" /></AbsoluteFill>
);

const Legs: React.FC<{ lt: number; dur: number }> = ({ lt, dur }) => {
  const p = lt / dur;
  const enter = spring(lt, 90, 18);
  const step = 0.62;
  return (
    <AbsoluteFill style={{ background: dk.deep }}>
      <Plate lt={lt} />
      <div style={{ position: "absolute", inset: 0, perspective: 2000 }}>
        <div style={{ position: "absolute", left: 60, top: 40, width: 1600, height: 760, transformOrigin: "60% 40%", transform: `translateY(${(1 - enter) * 500}px) scale(${mix(1.08, 1.16, p)}) rotateX(${mix(18, 9, p)}deg) rotateY(${mix(-12, -5, p)}deg) rotateZ(${mix(2, 0.5, p)}deg)`,
          borderRadius: 26, background: "rgba(10,17,30,0.94)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 60px 140px rgba(0,0,0,0.7)" }}>
          <Ui src="invest-split" w={640} ratio={ratio("investSplit")} glow={0} style={{ left: 40, top: 60 }} />
          <div style={{ position: "absolute", left: 730, top: 60, width: 820 }}>
            <div style={{ fontFamily: mono, fontSize: 18, letterSpacing: "0.14em", color: dk.inkFaint }}>YOUR PLAN · SIGN EACH STEP</div>
            <div style={{ position: "relative", marginTop: 20 }}>
              {/* The accent bar travelling down the steps (ref5's progress line) */}
              <div style={{ position: "absolute", left: -18, top: 0, width: 4, height: 104 * LEGS.length, borderRadius: 2, background: "rgba(255,255,255,0.06)" }} />
              <div style={{ position: "absolute", left: -18, top: 0, width: 4, borderRadius: 2, height: 104 * LEGS.length * clamp((lt - 0.6) / (step * LEGS.length)), background: dk.accent, boxShadow: "0 0 20px rgba(138,166,255,0.9)" }} />
              {LEGS.map((l, i) => {
                const inP = ramp(lt, 0.3 + i * 0.12, 0.4);
                const done = lt > 0.6 + (i + 1) * step;
                const active = !done && lt > 0.6 + i * step;
                return (
                  <div key={i} style={{ height: 88, marginBottom: 16, borderRadius: 16, background: active ? "rgba(61,99,217,0.16)" : "rgba(255,255,255,0.03)", border: `1px solid rgba(138,166,255,${active ? 0.6 : 0.08})`,
                    display: "flex", alignItems: "center", gap: 16, padding: "0 22px", opacity: inP, transform: `translateX(${(1 - inP) * 60}px)` }}>
                    <Disc sym={l.from} size={32} /><span style={{ color: dk.inkFaint }}>→</span><Disc sym={l.to} size={32} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 26, color: dk.ink }}>{l.kind}</div>
                      <div style={{ fontSize: 18, color: dk.inkMuted }}>on {l.chain}</div>
                    </div>
                    <div style={{ fontSize: 19, padding: "8px 14px", borderRadius: 999, color: done ? "#7EE2A8" : active ? dk.accent : dk.inkMuted, background: done ? "rgba(126,226,168,0.12)" : "rgba(255,255,255,0.05)" }}>
                      {done ? "✓ Signed by you" : active ? "Sign in wallet…" : "Ready to sign"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 930 }}><Caption lt={lt} text="Every step, signed by you." at={0.4} size={58} /></div>
    </AbsoluteFill>
  );
};

/* --------------------------------------------------------------------------- 14 · review → create plan */

const Review: React.FC<{ lt: number; dur: number }> = ({ lt, dur }) => {
  const push = ramp(lt, 0, dur, easeOut);
  const move = ramp(lt, 1.7, 0.7, easeInOut);
  const click = 2.6;
  const press = lt > click && lt < click + 0.15 ? 1 : 0;
  const glow = ramp(lt, click, 0.3);
  return (
    <AbsoluteFill style={{ background: dk.deep }}>
      <Plate lt={lt + 6} />
      <div style={{ position: "absolute", inset: 0, perspective: 2000 }}>
        <div style={{ position: "absolute", inset: 0, transform: `rotateX(${mix(14, 6, push)}deg) rotateY(${mix(10, 3, push)}deg) scale(${mix(0.92, 1.08, push)})`, transformOrigin: "40% 45%" }}>
          <Ui src="rebalance-version" w={1080} ratio={ratio("rebalanceVersion")} style={{ left: 120, top: 150 }} />
          <div style={{ position: "absolute", left: 1270, top: 220, borderRadius: 22, boxShadow: `0 0 ${70 * glow}px rgba(138,166,255,${0.7 * glow})` }}>
            <Ui src="rebalance-decide" w={560} ratio={ratio("rebalanceDecide")} style={{ position: "relative", transform: `scale(${1 - 0.03 * press})` }} />
          </div>
        </div>
      </div>
      <Cursor x={mix(1700, 1530, move)} y={mix(900, 470, move)} press={press} opacity={ramp(lt, 1.2, 0.2)} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 930 }}><Caption lt={lt} text="Managers publish updates. You decide." at={0.4} size={58} /></div>
    </AbsoluteFill>
  );
};

/* ----------------------------------------------------------------------------------- 15 · drift */

const Drift: React.FC<{ lt: number; dur: number }> = ({ lt, dur }) => {
  const p = lt / dur;
  const move = ramp(lt, 1.0, 0.7, easeInOut);
  const click = 1.9;
  const press = lt > click && lt < click + 0.15 ? 1 : 0;
  const ok = ramp(lt, click + 0.35, 0.4);
  const w = 1250, h = w / ratio("attention");
  const left = CX - w / 2, top = 170;
  return (
    <AbsoluteFill style={{ background: dk.deep }}>
      <Plate lt={lt + 12} />
      <div style={{ position: "absolute", inset: 0, perspective: 1800 }}>
        <div style={{ position: "absolute", inset: 0, transform: `rotateX(${mix(18, 8, p)}deg) rotateZ(${mix(-3, -1, p)}deg) scale(${mix(1, 1.1, p)})` }}>
          <Ui src="attention-drift" w={w} ratio={ratio("attention")} glow={1 + ok} style={{ left, top }} />
          {/* "Rebalance to target" creates a plan: the badge confirms that, it never claims a trade happened */}
          <div style={{ position: "absolute", left: left + 40, top: top + h * 0.53, padding: "10px 18px", borderRadius: 999, fontSize: 24, color: "#7EE2A8", background: "rgba(14,23,38,0.95)",
            border: "1px solid rgba(126,226,168,0.5)", opacity: ok, transform: `scale(${mix(0.8, 1, ok) * (1 + 0.03 * Math.sin(lt * 5))})`, boxShadow: `0 0 ${30 * ok}px rgba(126,226,168,0.4)` }}>✓ Rebalance plan ready to review</div>
        </div>
      </div>
      <Cursor x={mix(1500, left + 150, move)} y={mix(950, top + h * 0.79, move)} press={press} opacity={ramp(lt, 0.8, 0.2) * (1 - ramp(lt, click + 0.6, 0.3))} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 930 }}><Caption lt={lt} text="Drifted? Rebalance to target, or keep it custom." at={0.3} size={52} /></div>
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------------- baskets by verified managers */

const Baskets: React.FC<{ lt: number; dur: number }> = ({ lt, dur }) => {
  const cards = ["discover-card-balanced", "discover-card-core", "discover-card-solana"];
  const verified = 3.3; // VO "verified by Bytesac" at 36.94 s
  const p = lt / dur;
  return (
    <AbsoluteFill style={{ background: dk.deep }}>
      <Plate lt={lt} />
      <div style={{ position: "absolute", inset: 0, perspective: 1800, transform: `scale(${1 + 0.05 * p})` }}>
        {cards.map((c, i) => {
          const e = spring(lt - 0.2 - i * 0.18, 150, 18);
          const x = CX - 780 + i * 540;
          const chip = spring(lt - verified - i * 0.15, 260, 18);
          return (
            <div key={c} style={{ position: "absolute", left: x, top: 200, width: 480, transform: `translateY(${(1 - e) * 600 + Math.sin(lt * 1.5 + i) * 6}px) rotateY(${(i - 1) * -14}deg) rotateX(10deg)` }}>
              <Ui src={c} w={480} ratio={ratio("discoverCard")} style={{ position: "relative" }} />
              <div style={{ position: "absolute", right: 16, top: -22, transform: `scale(${chip})`, display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999,
                background: "rgba(14,23,38,0.95)", border: "1px solid rgba(138,166,255,0.6)", color: dk.ink, fontSize: 20, boxShadow: "0 0 30px rgba(138,166,255,0.4)" }}>
                <span style={{ width: 22, height: 22, borderRadius: 11, background: dk.accentStrong, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>✓</span>
                Verified by Bytesac
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 880 }}>
        <Caption lt={lt} text="Baskets built by experienced managers." at={0.35} size={56} />
        <Caption lt={lt} text="Verified by Bytesac." at={verified} size={56} color={dk.inkMuted} />
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------- crypto and tokenized assets */

const ASSET_CHIPS = [
  { label: "Crypto", sub: "BTC · ETH · SOL", at: 0.3, x: -560, y: -170 },
  { label: "Tokenized stocks", sub: "where available", at: 1.36, x: 300, y: -230 },
  { label: "Tokenized funds", sub: "e.g. T-bills", at: 3.06, x: -520, y: 160 },
  { label: "Tokenized gold", sub: "on chain", at: 3.84, x: 340, y: 130 },
];

const Tokenized: React.FC<{ lt: number }> = ({ lt }) => {
  const e = spring(lt, 120, 18);
  return (
    <AbsoluteFill style={{ background: dk.deep }}>
      <Plate lt={lt + 24} />
      <div style={{ position: "absolute", inset: 0, perspective: 1800 }}>
        <div style={{ position: "absolute", left: CX - 280, top: 170, transform: `translateY(${(1 - e) * 400}px) rotateX(10deg) scale(${1 + lt * 0.015})` }}>
          <Ui src="discover-card-balanced" w={560} ratio={ratio("discoverCard")} style={{ position: "relative" }} glow={1.4} />
        </div>
      </div>
      {ASSET_CHIPS.map((c) => {
        const p = spring(lt - c.at, 240, 18);
        return lt < c.at ? null : (
          <div key={c.label} style={{ position: "absolute", left: CX + c.x, top: 430 + c.y + Math.sin(lt * 1.6 + c.x) * 6, transform: `scale(${p})`, padding: "16px 24px", borderRadius: 20,
            background: "rgba(14,23,38,0.95)", border: "1px solid rgba(138,166,255,0.45)", boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(138,166,255,0.2)" }}>
            <div style={{ fontSize: 32, color: dk.ink, letterSpacing: "-0.01em" }}>{c.label}</div>
            <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: "0.1em", color: dk.inkFaint, marginTop: 4 }}>{c.sub.toUpperCase()}</div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: 880 }}>
        <Caption lt={lt} text="Crypto and tokenized stocks, funds and gold." at={0.3} size={52} />
      </div>
    </AbsoluteFill>
  );
};

export { easeOut };
