import React from "react";
import { Composition } from "remotion";
import { BRAND_DURATION, BrandFilm } from "./brand/BrandFilm";
import { WAITLIST_DURATION } from "./waitlist/timeline";
import { WaitlistFilm } from "./waitlist/WaitlistFilm";

const FPS = 60;

export const Root: React.FC = () => (
  <>
    <Composition id="Brand" component={BrandFilm} durationInFrames={Math.round(BRAND_DURATION * FPS)} fps={FPS} width={1920} height={1080} />
    <Composition id="Waitlist" component={WaitlistFilm} durationInFrames={Math.round(WAITLIST_DURATION * FPS)} fps={FPS} width={1920} height={1080} />
    <Composition id="BrandVertical" component={BrandFilm} durationInFrames={Math.round(BRAND_DURATION * FPS)} fps={FPS} width={1080} height={1920} />
  </>
);
