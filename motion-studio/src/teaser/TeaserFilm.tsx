// Video 4 — Cinematic teaser (docs/script-04-teaser.md): Runway footage + ref4 grammar, on the measured Lyria grid.
// Shots with no Runway clip yet (src/teaser/clips.json) use the start frame with a slow camera move (animatic).
import React from "react";
import { AbsoluteFill, Html5Audio, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFonts, sans } from "../lib/fonts";
import { clamp, easeInOut, easeOut, mix, ramp } from "../lib/motion";
import { LogoStage } from "../investor/act1";
import { lockup, Mark, Wordmark } from "../lib/pieces";
import { Caption, CX, CY, dk, Typewriter, Ui, ratio, W } from "../investor/kit";
import clips from "./clips.json";
import { Living } from "./living";

loadFonts();

/** Bar n of the teaser track, anchored on the drop at 15.72 s (123.05 BPM, 1.9504 s per bar). */
const BAR = 1.9504;
const bar = (n: number) => 0.117 + n * BAR;

export const TEASER_DURATION = bar(25.5);

type Foot = { kind: "foot"; id: keyof typeof clips; move: [number, number, number, number]; cap?: string; cap2?: string; capAt?: number };
type Code = { kind: "code"; id: string };
type Shot = (Foot | Code) & { from: number; to: number };

/** move = [scaleFrom, scaleTo, panX px, panY px] for the animatic camera. */
const SHOTS: Shot[] = [
  { kind: "foot", id: "A1", from: 0, to: bar(2), move: [1.04, 1.16, -30, 0], cap: "Markets never sleep.", capAt: 0.6 },
  { kind: "foot", id: "A2", from: bar(2), to: bar(4), move: [1.18, 1.04, 0, 0], cap: "…so neither do you." },
  { kind: "code", id: "giant", from: bar(4), to: bar(5.5) },
  { kind: "foot", id: "A3", from: bar(5.5), to: bar(7), move: [1.02, 1.14, 0, 20], cap: "What if you could just… stop?" },
  { kind: "code", id: "calmer", from: bar(7), to: bar(8) },
  { kind: "foot", id: "B4", from: bar(8), to: bar(10), move: [1.0, 1.08, 0, -24] },
  { kind: "foot", id: "B1", from: bar(10), to: bar(12), move: [1.04, 0.98, 0, 30], cap: "Experts build the strategy.", cap2: "Experienced managers, verified by Bytesac." },
  { kind: "foot", id: "B2", from: bar(12), to: bar(14), move: [1.06, 1.14, 20, -110], cap: "One basket.", cap2: "Seven chains." },
  { kind: "code", id: "product", from: bar(14), to: bar(16) },
  { kind: "foot", id: "B3", from: bar(16), to: bar(18), move: [1.02, 1.13, 0, 0], cap: "Your assets stay in your wallet.", cap2: "You sign every step." },
  { kind: "code", id: "never", from: bar(18), to: bar(19) },
  { kind: "foot", id: "B5", from: bar(19), to: bar(21), move: [1.03, 1.12, -20, 0], cap: "Invest calmly." },
  { kind: "code", id: "cta", from: bar(21), to: bar(23) },
  { kind: "code", id: "logo", from: bar(23), to: TEASER_DURATION },
];

export const TeaserFilm: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const fadeOut = ramp(t, TEASER_DURATION - 0.6, 0.6);
  return (
    <AbsoluteFill style={{ background: dk.deep, overflow: "hidden", fontFamily: sans }}>
      {SHOTS.map((s, i) => (
        <Sequence key={i} from={Math.round(s.from * fps)} durationInFrames={Math.round((s.to - s.from) * fps) + (i < SHOTS.length - 1 ? 1 : 0)} layout="none">
          <ShotView s={s} lt={t - s.from} dur={s.to - s.from} />
        </Sequence>
      ))}
      <AbsoluteFill style={{ background: "#000", opacity: fadeOut }} />
      <Html5Audio src={staticFile("audio/teaser-mix.wav")} />
    </AbsoluteFill>
  );
};

const ShotView: React.FC<{ s: Shot; lt: number; dur: number }> = ({ s, lt, dur }) => {
  if (s.kind === "foot") return <Footage s={s} lt={lt} dur={dur} />;
  switch (s.id) {
    case "giant": return <Giant lt={lt} dur={dur} />;
    case "calmer": return <Calmer lt={lt} />;
    case "product": return <Product lt={lt} dur={dur} />;
    case "never": return <Never lt={lt} />;
    case "cta": return <Cta lt={lt} dur={dur} />;
    default: return <LogoStage lt={lt} url />;
  }
};

/* ------------------------------------------------------------------------------------------- footage */

/** Graded footage: Runway clip when present, else the start frame with a slow camera move. */
const Footage: React.FC<{ s: Foot; lt: number; dur: number }> = ({ s, lt, dur }) => {
  const p = lt / dur;
  const enter = ramp(lt, 0, 0.35);
  const has = clips[s.id];
  const media: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
  return (
    <AbsoluteFill style={{ background: dk.deep }}>
      <AbsoluteFill style={{ transform: has ? `scale(${1.02 + 0.03 * p})` : undefined,
        filter: `saturate(0.86) contrast(1.06) brightness(${0.92 * mix(0.6, 1, enter)}) blur(${(1 - enter) * 10}px)` }}>
        {has
          ? <OffthreadVideo src={staticFile(`teaser/clips/${s.id}.mp4`)} startFrom={12} muted style={media} />
          : <Living id={s.id} lt={lt} dur={dur} move={s.move} />}
      </AbsoluteFill>
      {/* Grade: navy shadows, cool highlights, vignette, grain (so AI footage matches the code shots) */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(7,13,24,0.25), rgba(7,13,24,0) 35%, rgba(7,13,24,0) 55%, rgba(7,13,24,0.85))" }} />
      <AbsoluteFill style={{ background: "rgba(40,70,140,0.18)", mixBlendMode: "soft-light" }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 75% 70% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }} />
      <Grain lt={lt} />
      {s.id === "B4" && <Introducing lt={lt} />}
      {s.cap && (
        <div style={{ position: "absolute", left: 0, right: 0, top: s.cap2 ? 905 : 930 }}>
          <Caption lt={lt} text={s.cap} at={s.capAt ?? 0.35} size={62} style={{ textShadow: "0 2px 30px rgba(0,0,0,0.6)" }} />
          {s.cap2 && <Caption lt={lt} text={s.cap2} at={(s.capAt ?? 0.35) + 0.5} size={44} color={dk.inkMuted} style={{ marginTop: 10, textShadow: "0 2px 30px rgba(0,0,0,0.6)" }} />}
        </div>
      )}
    </AbsoluteFill>
  );
};

const Grain: React.FC<{ lt: number }> = ({ lt }) => {
  const f = Math.floor(lt * 24);
  return <AbsoluteFill style={{ backgroundImage: `url(${staticFile("teaser/grain.png")})`, backgroundPosition: `${(f * 137) % 512}px ${(f * 71) % 512}px`, opacity: 0.07, mixBlendMode: "overlay" }} />;
};

const Introducing: React.FC<{ lt: number }> = ({ lt }) => {
  const intro = ramp(lt, 0.5, 0.6);
  const logo = ramp(lt, 1.1, 0.7);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: CY - 170, display: "flex", flexDirection: "column", alignItems: "center", gap: 30, transform: `scale(${1 + lt * 0.02})` }}>
      <div style={{ fontSize: 50, color: dk.inkMuted, opacity: intro, filter: intro < 1 ? `blur(${(1 - intro) * 8}px)` : undefined }}>Introducing</div>
      <div style={{ opacity: clamp(logo * 1.3), filter: logo < 1 ? `blur(${(1 - logo) * 12}px)` : undefined, transform: `translateY(${(1 - logo) * 20}px)` }}>
        <LogoMark />
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------------------------------ code shots */

const LogoMark: React.FC = () => {
  const markH = 120;
  const L = lockup(markH);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: L.gap }}>
      <Mark h={markH} top={dk.accent} bottom="#FFFFFF" />
      <Wordmark capH={L.capH} fill="#FFFFFF" />
    </div>
  );
};

/** ref4's giant scrolling type on white. */
const Giant: React.FC<{ lt: number; dur: number }> = ({ lt, dur }) => {
  const p = lt / dur;
  const text = "Every chain · Every bridge · Every night";
  const x = mix(W * 0.45, W - 5300, easeInOut(p));
  return (
    <AbsoluteFill style={{ background: dk.paper }}>
      <div style={{ position: "absolute", top: CY - 170, left: x, fontSize: 290, fontWeight: 400, color: dk.paperInk, whiteSpace: "nowrap", letterSpacing: "-0.045em", lineHeight: 1 }}>{text}</div>
      <div style={{ position: "absolute", top: 160, left: mix(-900, 100, p), fontSize: 56, fontWeight: 300, color: "rgba(15,30,58,0.18)", whiteSpace: "nowrap" }}>swap · bridge · approve · sign · repeat · swap · bridge · approve · sign · repeat</div>
      <div style={{ position: "absolute", top: 840, left: mix(100, -900, p), fontSize: 56, fontWeight: 300, color: "rgba(15,30,58,0.18)", whiteSpace: "nowrap" }}>check · refresh · check · refresh · check · refresh · check · refresh · check</div>
    </AbsoluteFill>
  );
};

const Calmer: React.FC<{ lt: number }> = ({ lt }) => (
  <AbsoluteFill style={{ background: dk.deep }}>
    <AbsoluteFill style={{ background: `radial-gradient(800px 500px at 50% 60%, rgba(138,166,255,${0.08 + 0.06 * lt}), rgba(138,166,255,0) 70%)` }} />
    <div style={{ position: "absolute", left: 0, right: 0, top: CY - 40, textAlign: "center", transform: `scale(${1 + lt * 0.03})` }}>
      <Typewriter lt={lt} text="There's a calmer way." at={0.1} cps={24} size={72} />
    </div>
  </AbsoluteFill>
);

/** One beat of the real product (dark theme capture) so the teaser isn't only mood. */
const Product: React.FC<{ lt: number; dur: number }> = ({ lt, dur }) => {
  const p = lt / dur;
  const w = 1400;
  const enter = ramp(lt, 0, 0.6, easeOut);
  return (
    <AbsoluteFill style={{ background: dk.night }}>
      <AbsoluteFill style={{ background: "radial-gradient(1400px 700px at 50% 120%, rgba(61,99,217,0.22), rgba(61,99,217,0) 70%)" }} />
      <div style={{ position: "absolute", inset: 0, perspective: 2200 }}>
        <div style={{ position: "absolute", inset: 0, transform: `rotateX(${mix(22, 8, p)}deg) rotateY(${mix(-14, -4, p)}deg) scale(${mix(0.86, 0.98, p)})`, opacity: enter, filter: enter < 1 ? `blur(${(1 - enter) * 12}px)` : undefined }}>
          <Ui src="basket-hero" w={w} ratio={ratio("basketHero")} clip={0.8} style={{ left: CX - w / 2, top: 110 }} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 830 }}>
        <Caption lt={lt} text="Research every basket" at={0.4} size={62} />
        <Caption lt={lt} text="before you invest." at={0.8} size={44} color={dk.inkMuted} style={{ marginTop: 10 }} />
      </div>
    </AbsoluteFill>
  );
};

const Never: React.FC<{ lt: number }> = ({ lt }) => (
  <AbsoluteFill style={{ background: dk.deep }}>
    <div style={{ position: "absolute", left: 0, right: 0, top: CY - 50, transform: `scale(${1 + lt * 0.04})` }}>
      <Caption lt={lt} text="We never hold your assets." at={0.05} stagger={0.06} size={60} color={dk.inkMuted} />
      <Caption lt={lt} text="Not for a second." at={0.6} size={60} style={{ marginTop: 8 }} />
    </div>
  </AbsoluteFill>
);

const Cta: React.FC<{ lt: number; dur: number }> = ({ lt, dur }) => {
  const out = ramp(lt, dur - 0.3, 0.3);
  return (
    <AbsoluteFill style={{ background: dk.deep, opacity: 1 - out }}>
      <AbsoluteFill style={{ background: `radial-gradient(900px 500px at 50% 50%, rgba(138,166,255,${0.1 + 0.04 * Math.sin(lt * 2)}), rgba(138,166,255,0) 70%)` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: CY - 80, transform: `scale(${1 + lt * 0.02})` }}>
        <Caption lt={lt} text="Invest in strategies," at={0.1} stagger={0.08} size={84} />
        <Caption lt={lt} text="not individual trades." at={0.55} stagger={0.08} size={84} />
      </div>
    </AbsoluteFill>
  );
};

