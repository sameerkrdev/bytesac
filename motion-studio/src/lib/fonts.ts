// Loads Geist from public/fonts before any frame is captured (text must never render in a fallback face).
import { continueRender, delayRender, staticFile } from "remotion";

const faces: [family: string, file: string, weight: string][] = [
  ["Geist", "Geist-Light.woff2", "300"],
  ["Geist", "Geist-Regular.woff2", "400"],
  ["Geist", "Geist-Medium.woff2", "500"],
  ["Geist Mono", "GeistMono-Medium.woff2", "500"],
];

let started = false;
export function loadFonts() {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("Loading Geist");
  Promise.all(
    faces.map(async ([family, file, weight]) => {
      const face = new FontFace(family, `url(${staticFile(`fonts/${file}`)}) format("woff2")`, { weight });
      await face.load();
      document.fonts.add(face);
    }),
  )
    .then(() => continueRender(handle))
    .catch((err) => {
      console.error(err);
      continueRender(handle);
    });
}

export const sans = '"Geist", system-ui, sans-serif';
export const mono = '"Geist Mono", ui-monospace, monospace';
