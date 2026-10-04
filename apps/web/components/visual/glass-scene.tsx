"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Slice } from "@/components/visual/allocation-ring";
import { cn } from "@/lib/utils";

/*
 * Real-time glass objects (three.js through react-three-fiber). Every piece assembles one after another, from the
 * outer frame inward, each landing on the layer before it; then the object idles and follows the pointer a little.
 * Load through `GlassScene` (glass-scene-lazy.tsx), which code-splits this module and falls back to a still image under
 * reduced motion or without WebGL. Purely decorative: the accessible name lives on the wrapper.
 */

export type GlassVariant = "ring" | "stack";

const ease = (p: number) => 1 - Math.pow(1 - Math.min(Math.max(p, 0), 1), 4);

/** Reads the categorical data palette from the current theme so the glass tints match the 2D charts. */
function themeColors(): THREE.Color[] {
  const css = getComputedStyle(document.documentElement);
  return [1, 2, 3, 4, 5, 6].map((i) => new THREE.Color(css.getPropertyValue(`--c-data${i}`).trim() || "#3D63D9"));
}

function glass(tint: THREE.Color | string, opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  const color = new THREE.Color(tint);
  return new THREE.MeshPhysicalMaterial({
    color: color.clone().lerp(new THREE.Color("#ffffff"), 0.55),
    transmission: 1, thickness: 1.1, roughness: 0.06, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.04, dispersion: 0.35,
    iridescence: 0.35, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 420],
    attenuationColor: color, attenuationDistance: 2.4, envMapIntensity: 1.5, specularIntensity: 1,
    ...opts,
  });
}

function arcShape(r0: number, r1: number, a0: number, a1: number) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, a0, a1, false);
  s.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
  s.absarc(0, 0, r0, a1, a0, true);
  s.closePath();
  return s;
}

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

type Piece = {
  geometry: THREE.BufferGeometry; material: THREE.Material;
  rest: THREE.Vector3; restRot: THREE.Euler; from: THREE.Vector3; fromRot: THREE.Euler; delay: number; breathe?: THREE.Vector3;
};

function buildRing(slices: Slice[], colors: THREE.Color[]): Piece[] {
  const pieces: Piece[] = [];
  const frame = glass("#cfe0f3", { roughness: 0.05, thickness: 0.3 });
  // 1 · outer frame
  pieces.push({ geometry: new THREE.TorusGeometry(2.42, 0.055, 24, 160), material: frame, rest: new THREE.Vector3(0, 0, 0), restRot: new THREE.Euler(), from: new THREE.Vector3(0, 0, 5), fromRot: new THREE.Euler(0, 0, -0.8), delay: 0 });
  // 2 · allocation segments, largest first, each landing on the frame's plane slightly above it
  const total = slices.reduce((s, x) => s + x.bps, 0) || 1;
  const gap = 0.035;
  let a = Math.PI / 2;
  slices.forEach((slice, i) => {
    const sweep = (slice.bps / total) * Math.PI * 2;
    const a0 = a - sweep + gap / 2, a1 = a - gap / 2;
    a -= sweep;
    const geo = new THREE.ExtrudeGeometry(arcShape(1.42, 2.12, a0, a1), { depth: 0.34, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 5, curveSegments: 64 });
    geo.translate(0, 0, -0.17);
    const mid = (a0 + a1) / 2;
    const dir = new THREE.Vector3(Math.cos(mid), Math.sin(mid), 0);
    pieces.push({
      geometry: geo, material: glass(colors[i % colors.length]!),
      rest: new THREE.Vector3(0, 0, 0.16), restRot: new THREE.Euler(),
      from: dir.clone().multiplyScalar(2.6).add(new THREE.Vector3(0, 0, 4.5)), fromRot: new THREE.Euler(0.6, -0.5, 0.4),
      delay: 0.45 + i * 0.16, breathe: dir.clone().multiplyScalar(0.05),
    });
  });
  // 3 · inner ring, 4 · lens core
  const d = 0.45 + slices.length * 0.16 + 0.15;
  pieces.push({ geometry: new THREE.TorusGeometry(1.2, 0.07, 24, 120), material: frame, rest: new THREE.Vector3(0, 0, 0.3), restRot: new THREE.Euler(), from: new THREE.Vector3(0, 0, 5), fromRot: new THREE.Euler(0, 0, 0.9), delay: d });
  const core = new THREE.CylinderGeometry(0.86, 0.86, 0.22, 96, 1);
  core.rotateX(Math.PI / 2);
  pieces.push({ geometry: core, material: glass("#eaf2fb", { roughness: 0.32, thickness: 0.9 }), rest: new THREE.Vector3(0, 0, 0.42), restRot: new THREE.Euler(), from: new THREE.Vector3(0, 0, 5), fromRot: new THREE.Euler(0.8, 0, 0), delay: d + 0.18 });
  return pieces;
}

function buildStack(colors: THREE.Color[]): Piece[] {
  // Outer (largest) plate first; each smaller plate drops onto the one below it.
  const tints = ["#f2f7fd", "#dbe8f7", "#b9d0ef", colors[2]?.getStyle() ?? "#7aa2e3", colors[1]?.getStyle() ?? "#3D63D9"];
  return tints.map((tint, i) => {
    const size = 3.4 - i * 0.48;
    const geo = new THREE.ExtrudeGeometry(roundedRect(size, size, 0.42 - i * 0.04), { depth: 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 4, curveSegments: 24 });
    geo.translate(0, 0, -0.08);
    geo.rotateX(-Math.PI / 2);
    const y = i * 0.3;
    return {
      geometry: geo, material: glass(tint, { attenuationDistance: i > 2 ? 0.7 : 1.8 }),
      rest: new THREE.Vector3(0, y, 0), restRot: new THREE.Euler(), from: new THREE.Vector3(0, y + 3.2, 0), fromRot: new THREE.Euler(0, 0.9, 0),
      delay: i * 0.32, breathe: new THREE.Vector3(0, i * 0.05, 0),
    };
  });
}

/**
 * A plane behind the object painted in the page's own canvas colour (so it is invisible at the edges) with soft pools
 * of the data palette near the centre. It gives the transmissive glass something real to refract.
 */
function Backdrop({ host }: { host: RefObject<HTMLDivElement | null> }) {
  const texture = useMemo(() => {
    const el = host.current ?? document.documentElement;
    const css = getComputedStyle(el);
    const base = css.getPropertyValue("--c-canvas").trim() || "#F6F8FB";
    const colors = [3, 2, 3].map((i) => css.getPropertyValue(`--c-data${i}`).trim() || "#3D63D9");
    const size = 512, c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    [[0.42, 0.4, 0.2], [0.6, 0.55, 0.18], [0.48, 0.64, 0.14]].forEach(([x, y, r], i) => {
      const grad = g.createRadialGradient(x! * size, y! * size, 0, x! * size, y! * size, r! * size);
      grad.addColorStop(0, colors[i]!); grad.addColorStop(1, base);
      g.globalAlpha = 0.7; g.fillStyle = grad; g.fillRect(0, 0, size, size);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [host]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={[0, 0, -4]}>
      <planeGeometry args={[40, 40]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
    scene.environment = env;
    return () => { scene.environment = null; env.dispose(); pmrem.dispose(); };
  }, [gl, scene]);
  return null;
}

/** A soft light circling the object so highlights and iridescence travel across the glass. */
function OrbitingLight() {
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.4;
    light.current?.position.set(Math.cos(t) * 5, 2 + Math.sin(t * 0.7) * 1.5, Math.sin(t) * 5);
  });
  return <pointLight ref={light} intensity={18} distance={14} color="#dfeaff" />;
}

function Assembly({ variant, slices, active }: { variant: GlassVariant; slices: Slice[]; active: boolean }) {
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const start = useRef<number | null>(null);
  const pieces = useMemo(() => {
    const colors = themeColors();
    return variant === "ring" ? buildRing(slices, colors) : buildStack(colors);
  }, [variant, slices]);
  useEffect(() => () => { pieces.forEach((p) => { p.geometry.dispose(); p.material.dispose(); }); }, [pieces]);

  useFrame((state) => {
    if (!active) return;
    if (start.current === null) start.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - start.current;
    const settled = Math.min(1, Math.max(0, (t - (pieces.at(-1)!.delay + 1.1)) / 1.5));
    pieces.forEach((p, i) => {
      const m = meshes.current[i];
      if (!m) return;
      const e = ease((t - p.delay) / 1.1);
      m.visible = t >= p.delay;
      m.position.lerpVectors(p.from, p.rest, e);
      if (p.breathe) m.position.addScaledVector(p.breathe, settled * (0.5 + 0.5 * Math.sin(t * 0.9 + i)));
      m.rotation.set(p.fromRot.x * (1 - e), p.fromRot.y * (1 - e), p.fromRot.z * (1 - e));
      m.scale.setScalar(0.55 + 0.45 * e);
    });
    const g = group.current;
    if (g) {
      const baseX = variant === "ring" ? -0.42 : 0.62;
      const baseY = variant === "ring" ? 0.32 : -0.62;
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, baseX - state.pointer.y * 0.18 * settled, 0.06);
      g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, baseY + state.pointer.x * 0.28 * settled + Math.sin(t * 0.25) * 0.08 * settled, 0.06);
      if (variant === "ring") g.rotation.z = -t * 0.05 * settled;
    }
  });

  return (
    <group ref={group} position={variant === "stack" ? [0, -0.5, 0] : [0, 0, 0]}>
      {pieces.map((p, i) => (
        <mesh key={i} ref={(m) => { meshes.current[i] = m; }} geometry={p.geometry} material={p.material} visible={false} />
      ))}
    </group>
  );
}

/** True while the scene is mostly in view, so rendering pauses off screen. */
function useInView(ref: RefObject<HTMLDivElement | null>) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry!.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

export default function GlassCanvas({ variant, slices, className }: { variant: GlassVariant; slices: Slice[]; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const active = useInView(host);
  return (
    <div ref={host} className={cn("[mask-image:radial-gradient(closest-side,#000_72%,transparent)]", className)}>
      <Canvas frameloop={active ? "always" : "never"} dpr={[1, 1.75]} gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        camera={{ position: [0, 0, variant === "ring" ? 11.5 : 10.5], fov: 32 }} onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05; }}>
        <Environment />
        <Backdrop host={host} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[-3, 5, 6]} intensity={1.6} />
        <OrbitingLight />
        <Assembly variant={variant} slices={slices} active={active} />
      </Canvas>
    </div>
  );
}
