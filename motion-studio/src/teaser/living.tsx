// "Living stills": per-shot motion layered on the AI start frames so they read as footage (no AI video).
// Coordinates are fractions of the frame, read from the start frames with a 10% grid (tests/grid-*.png).
import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp, easeInOut, easeOut, mix, ramp, rng } from "../lib/motion";

const W = 1920;
const H = 1080;
const px = (fx: number) => fx * W;
const py = (fy: number) => fy * H;

type P = { lt: number; dur: number };
const img: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
const Frame: React.FC<{ id: string; style?: React.CSSProperties }> = ({ id, style }) => <Img src={staticFile(`teaser/frames/${id}.jpg`)} style={{ ...img, ...style }} />;

/** A soft light added on top of the frame. */
const Glow: React.FC<{ x: number; y: number; r: number; color: string; a: number; blend?: React.CSSProperties["mixBlendMode"] }> = ({ x, y, r, color, a, blend = "screen" }) => (
  <div style={{ position: "absolute", left: px(x) - r, top: py(y) - r, width: r * 2, height: r * 2, borderRadius: "50%",
    background: `radial-gradient(circle, rgba(${color},${a}) 0%, rgba(${color},${a * 0.35}) 35%, rgba(${color},0) 70%)`, mixBlendMode: blend }} />
);

/** Seeded twinkling points inside a box (city lights, stars, dust). */
const Twinkles: React.FC<{ lt: number; seed: number; n: number; box: [number, number, number, number]; colors: string[]; size: [number, number]; drift?: [number, number]; rate?: number; a?: number }> = ({
  lt, seed, n, box, colors, size, drift = [0, 0], rate = 2, a = 0.9,
}) => {
  const r = rng(seed);
  const pts = Array.from({ length: n }, () => ({ x: r(), y: r(), s: mix(size[0], size[1], r()), ph: r() * 6.28, c: colors[Math.floor(r() * colors.length)]!, sp: 0.6 + r() }));
  const [x0, y0, x1, y1] = box;
  return (
    <>
      {pts.map((p, i) => {
        const tw = Math.pow(0.5 + 0.5 * Math.sin(lt * rate * p.sp + p.ph), 3);
        const x = px(mix(x0, x1, p.x)) + drift[0] * lt * p.sp;
        const y = py(mix(y0, y1, p.y)) + drift[1] * lt * p.sp;
        return <div key={i} style={{ position: "absolute", left: x - p.s, top: y - p.s, width: p.s * 2, height: p.s * 2, borderRadius: "50%",
          background: `radial-gradient(circle, rgba(${p.c},${a * tw}), rgba(${p.c},0) 70%)`, mixBlendMode: "screen" }} />;
      })}
    </>
  );
};

/* ----------------------------------------------------------------------------------------------- shots */

/** A1 — night apartment: window lights twinkle, phone glow pulses on the face, a little handheld sway. */
const A1: React.FC<P> = ({ lt }) => {
  const pulse = 0.55 + 0.25 * Math.sin(lt * 5.3) + 0.15 * Math.sin(lt * 11.7); // a scrolling screen flickers
  return (
    <AbsoluteFill>
      <Frame id="A1" />
      <Twinkles lt={lt} seed={11} n={34} box={[0.02, 0.06, 0.48, 0.5]} colors={["255,90,90", "120,255,170", "255,230,190", "150,190,255"]} size={[4, 12]} rate={1.6} a={0.8} />
      <Twinkles lt={lt} seed={12} n={22} box={[0.5, 0.08, 0.95, 0.48]} colors={["255,230,190", "150,190,255", "255,90,90"]} size={[3, 9]} rate={1.3} a={0.7} />
      {/* Light streaks drifting across the glass */}
      <div style={{ position: "absolute", left: px(-0.3) + lt * 90, top: py(0.08), width: 600, height: py(0.42), background: "linear-gradient(100deg, rgba(255,255,255,0), rgba(170,200,255,0.10), rgba(255,255,255,0))", mixBlendMode: "screen" }} />
      <Glow x={0.6} y={0.58} r={150} color="140,200,255" a={0.55 * pulse} />
      <Glow x={0.43} y={0.38} r={190} color="120,170,255" a={0.22 * pulse} />
    </AbsoluteFill>
  );
};

/** A2 — the tangle turns slowly while pulses of light race along the threads. */
const A2: React.FC<P> = ({ lt }) => {
  const r = rng(5);
  const cx = px(0.52), cy = py(0.48);
  const threads = Array.from({ length: 16 }, () => {
    const a0 = r() * Math.PI * 2, a1 = a0 + Math.PI + (r() - 0.5) * 1.6;
    const r0 = 500 + r() * 500, r1 = 500 + r() * 500;
    return {
      d: `M ${cx + Math.cos(a0) * r0} ${cy + Math.sin(a0) * r0 * 0.6} C ${cx + (r() - 0.5) * 500} ${cy + (r() - 0.5) * 400}, ${cx + (r() - 0.5) * 500} ${cy + (r() - 0.5) * 400}, ${cx + Math.cos(a1) * r1} ${cy + Math.sin(a1) * r1 * 0.6}`,
      sp: 0.35 + r() * 0.5, ph: r(), red: r() < 0.25,
    };
  });
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `rotate(${lt * 1.2}deg) scale(${1 + lt * 0.03})`, transformOrigin: `${cx}px ${cy}px` }}>
        <Frame id="A2" />
      </AbsoluteFill>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, mixBlendMode: "screen" }}>
        <defs><filter id="a2glow"><feGaussianBlur stdDeviation="3" /></filter></defs>
        {threads.map((th, i) => {
          const p = (lt * th.sp + th.ph) % 1;
          return (
            <path key={i} d={th.d} fill="none" stroke={th.red ? "rgba(255,120,120,0.9)" : "rgba(190,215,255,0.95)"} strokeWidth={3} pathLength={1}
              strokeDasharray="0.06 1" strokeDashoffset={-p} strokeLinecap="round" filter="url(#a2glow)" opacity={Math.sin(p * Math.PI)} />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

/** A3 — the lamp softens, dust drifts in its light, the camera eases toward the phone. */
const A3: React.FC<P> = ({ lt, dur }) => {
  const calm = ramp(lt, 0.3, dur, easeInOut);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${1 + 0.07 * calm})`, transformOrigin: `${px(0.47)}px ${py(0.84)}px` }}>
        <Frame id="A3" style={{ filter: `brightness(${mix(1.05, 0.9, calm)}) saturate(${mix(1, 0.8, calm)})` }} />
        <Glow x={0.65} y={0.2} r={260} color="255,236,210" a={mix(0.32, 0.12, calm)} />
        <Twinkles lt={lt} seed={21} n={40} box={[0.45, 0.02, 0.85, 0.6]} colors={["255,240,220"]} size={[2, 4]} drift={[6, -10]} rate={1} a={0.55} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "rgba(40,70,140,1)", mixBlendMode: "soft-light", opacity: 0.25 * calm }} />
    </AbsoluteFill>
  );
};

/** B4 — dawn: the arc brightens, a light runs along it, stars twinkle, the camera rises a little. */
const B4: React.FC<P> = ({ lt, dur }) => {
  const up = ramp(lt, 0, dur, easeOut);
  const run = (lt * 0.35) % 1;
  const x = mix(-0.05, 1.05, run);
  const y = 0.66 - 0.1 * Math.sin(Math.PI * clamp(x)) + 0.01; // follows the arc (0.66 at the edges, 0.56 at the peak)
  return (
    <AbsoluteFill style={{ transform: `translateY(${-30 * up}px)` }}>
      <Frame id="B4" style={{ filter: `brightness(${mix(0.85, 1.12, up)})` }} />
      <Twinkles lt={lt} seed={31} n={60} box={[0, 0, 1, 0.45]} colors={["220,230,255"]} size={[1.5, 3]} rate={2.5} a={0.8} />
      <Glow x={0.5} y={0.56} r={mix(380, 620, up)} color="170,200,255" a={mix(0.15, 0.4, up)} />
      <div style={{ position: "absolute", left: px(x) - 220, top: py(y) - 22, width: 440, height: 44, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(255,255,255,0.75), rgba(170,200,255,0) 70%)", mixBlendMode: "screen" }} />
    </AbsoluteFill>
  );
};

/** B1 — the frame is split at the gap so the two glass slabs really move together; a light passes; the floor flares. */
const B1: React.FC<P> = ({ lt, dur }) => {
  const join = ramp(lt, 0.2, dur * 0.7, easeInOut);
  const lock = ramp(lt, 0.2 + dur * 0.7 - 0.1, 0.5);
  const flash = lock * (1 - ramp(lt, 0.2 + dur * 0.7 + 0.4, 0.8));
  const sweep = ramp(lt, 0.5, dur - 0.6, easeInOut);
    // Only the top slab moves: it is cut out (soft mask) and the hole behind it is patched with the backdrop colour.
  const slab = "polygon(31% 5%, 69% 5%, 69% 50.5%, 31% 50.5%)";
  const dy = mix(-55, 0, join);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Frame id="B1" />
      <div style={{ position: "absolute", left: px(0.28), top: py(0.02), width: px(0.44), height: py(0.495), opacity: clamp(-dy / 20), background: "rgb(1,6,18)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent), linear-gradient(180deg, transparent, #000 10%)", WebkitMaskComposite: "source-in" }} />
      <Frame id="B1" style={{ clipPath: slab, transform: `translateY(${dy}px)` }} />
      {/* Light sweeping diagonally through the glass */}
      <div style={{ position: "absolute", left: px(0.33), top: py(0.08), width: px(0.34), height: py(0.8), overflow: "hidden", mixBlendMode: "screen", borderRadius: 60 }}>
        <div style={{ position: "absolute", top: -200, bottom: -200, width: 160, left: mix(-300, px(0.4) + 200, sweep), transform: "rotate(18deg)",
          background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(210,225,255,0.35), rgba(255,255,255,0))" }} />
      </div>
      <Glow x={0.49} y={0.9} r={mix(360, 520, flash)} color="200,215,255" a={0.22 + 0.4 * flash} />
      <Glow x={0.49} y={0.5} r={300} color="140,170,255" a={0.35 * flash} />
    </AbsoluteFill>
  );
};

/** B2 — the network: spheres light up one after another, the floor light pulses, slow orbiting drift. */
const B2: React.FC<P> = ({ lt, dur }) => {
  const nodes: [number, number, number][] = [[0.5, 0.5, 120], [0.27, 0.31, 70], [0.56, 0.13, 60], [0.7, 0.29, 50], [0.73, 0.65, 60], [0.59, 0.87, 60], [0.25, 0.75, 80]];
  const p = lt / dur;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${-20 * p}px, 0) rotate(${-1.5 * p}deg) scale(${1 + 0.05 * p})`, transformOrigin: `${px(0.5)}px ${py(0.5)}px` }}>
        <Frame id="B2" />
        {nodes.map(([x, y, r], i) => {
          const k = i === 0 ? 0.5 + 0.5 * Math.sin(lt * 3) : Math.pow(Math.max(0, Math.sin((lt * 1.6 - i * 0.45) * Math.PI / 1.4)), 4);
          return <Glow key={i} x={x} y={y} r={r * 2.2} color="180,205,255" a={0.55 * k} />;
        })}
      </AbsoluteFill>
      <Glow x={0.5} y={0.98} r={520} color="220,230,255" a={0.18 + 0.1 * Math.sin(lt * 2.2)} />
    </AbsoluteFill>
  );
};

/** B3 — a band of light sweeps across the glass wallet; glint; floor pulse. */
const B3: React.FC<P> = ({ lt, dur }) => {
  const sweep = ramp(lt, 0.3, dur - 0.5, easeInOut);
  const glint = Math.pow(Math.max(0, 1 - Math.abs(sweep - 0.55) * 6), 2);
  return (
    <AbsoluteFill>
      <Frame id="B3" />
      <div style={{ position: "absolute", left: px(0.2), top: py(0.6), width: px(0.58), height: py(0.26), overflow: "hidden", mixBlendMode: "screen",
        clipPath: "polygon(4% 22%, 22% 5%, 96% 16%, 92% 60%, 70% 92%, 2% 64%)" }}>
        <div style={{ position: "absolute", top: -100, bottom: -100, width: 220, left: mix(-300, px(0.58) + 100, sweep), transform: "rotate(-24deg)",
          background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(225,235,255,0.55), rgba(255,255,255,0))" }} />
      </div>
      <Glow x={0.62} y={0.66} r={90} color="255,255,255" a={0.9 * glint} />
      <Glow x={0.48} y={0.86} r={560} color="210,222,255" a={0.12 + 0.08 * Math.sin(lt * 2)} />
    </AbsoluteFill>
  );
};

/** B5 — sunrise: the sun flares, haze drifts over the city, the light warms; slow forward drift. */
const B5: React.FC<P> = ({ lt, dur }) => {
  const rise = ramp(lt, 0, dur, easeOut);
  return (
    <AbsoluteFill>
      <Frame id="B5" style={{ filter: `brightness(${mix(0.92, 1.08, rise)}) saturate(${mix(0.9, 1.05, rise)})` }} />
      <div style={{ position: "absolute", left: px(0.3) - 200 + lt * 40, top: py(0.6), width: px(0.9), height: py(0.3), opacity: 0.35 + 0.15 * rise,
        background: "radial-gradient(ellipse 50% 50% at 50% 50%, rgba(235,240,250,0.55), rgba(235,240,250,0) 70%)", filter: "blur(10px)" }} />
      <Glow x={0.93} y={0.42} r={mix(160, 300, rise)} color="255,235,205" a={mix(0.45, 0.85, rise)} />
      <Glow x={0.93} y={0.42} r={700} color="255,225,190" a={0.18 * rise} />
      {/* Lens streak from the sun */}
      <div style={{ position: "absolute", left: px(0.93) - 700, top: py(0.42) - 3, width: 1400, height: 6, background: "linear-gradient(90deg, rgba(255,230,200,0), rgba(255,235,210,0.5), rgba(255,230,200,0))", opacity: 0.5 * rise, mixBlendMode: "screen" }} />
    </AbsoluteFill>
  );
};

const SHOTS: Record<string, React.FC<P>> = { A1, A2, A3, B4, B1, B2, B3, B5 };

/** A still that behaves like footage: per-shot motion + a gentle handheld/breathing camera. */
export const Living: React.FC<{ id: string; lt: number; dur: number; move: [number, number, number, number] }> = ({ id, lt, dur, move }) => {
  const Shot = SHOTS[id]!;
  const p = clamp(lt / dur);
  const [s0, s1, panX, panY] = move;
  const sc = mix(s0, s1, easeInOut(p));
  const hx = 5 * Math.sin(lt * 1.3) + 2.5 * Math.sin(lt * 3.1);
  const hy = 4 * Math.sin(lt * 1.1 + 1) + 2 * Math.sin(lt * 2.7);
  const breathe = 0.6 * Math.max(0, Math.sin(lt * 0.9)); // focus breathing
  return (
    <AbsoluteFill style={{ transform: `translate(${panX * p + hx}px, ${panY * p + hy}px) scale(${sc})`, filter: breathe > 0.05 ? `blur(${breathe * 0.8}px)` : undefined }}>
      <Shot lt={lt} dur={dur} />
    </AbsoluteFill>
  );
};
