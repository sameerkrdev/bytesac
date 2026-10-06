// Video 3 — Investor film (docs/script-03-investor.md, grammar from ref4: docs/style-guide-ref4.md).
import React from "react";
import { AbsoluteFill, Html5Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFonts, sans } from "../lib/fonts";
import { Act1 } from "./act1";
import { Act2 } from "./act2";
import { Act3 } from "./act3";
import { Act4 } from "./act4";
import { dk } from "./kit";

loadFonts();

export const InvestorFilm: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill style={{ background: dk.deep, overflow: "hidden", fontFamily: sans }}>
      {/* ref4's camera never stops: a slow, continuous drift over everything (scale keeps the edges covered) */}
      <AbsoluteFill style={{ transform: `translate(${18 * Math.sin(t * 0.61) + 8 * Math.sin(t * 1.37)}px, ${12 * Math.sin(t * 0.47 + 1.1) + 5 * Math.sin(t * 1.13)}px) scale(${1.045 + 0.012 * Math.sin(t * 0.29)})` }}>
        <Act1 t={t} />
        <Act2 t={t} />
        <Act3 t={t} />
        <Act4 t={t} />
      </AbsoluteFill>
      <Html5Audio src={staticFile("audio/investor-mix.wav")} />
    </AbsoluteFill>
  );
};
