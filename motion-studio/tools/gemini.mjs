// node tools/gemini.mjs <model> <out-prefix> "<prompt>" [--tts voice] [--image 16:9] [--ref file.png ...]
// Calls generateContent and saves every inline part (audio/image/text) to disk.
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const [model, out, prompt] = process.argv.slice(2);
const ttsIdx = process.argv.indexOf('--tts');
const body = { contents: [{ parts: [{ text: prompt }] }] };
// Reference images (inline), e.g. the real logo or a brand object, so generated frames keep exact shapes.
for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--ref') {
  const file = process.argv[i + 1];
  const mime = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  body.contents[0].parts.push({ inlineData: { mimeType: mime, data: readFileSync(file).toString('base64') } });
}
const imgIdx = process.argv.indexOf("--image");
if (imgIdx > 0) body.generationConfig = { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: process.argv[imgIdx + 1] } };
if (ttsIdx > 0) body.generationConfig = { responseModalities: ['AUDIO'],
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.argv[ttsIdx + 1] } } } };

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'content-type': 'application/json' },
  body: JSON.stringify(body) });
const json = await res.json();
if (!res.ok) { console.error(res.status, JSON.stringify(json.error ?? json).slice(0, 600)); process.exit(1); }
const ext = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'image/png': 'png', 'image/jpeg': 'jpg' };
const cand = json.candidates?.[0];
if (!cand?.content?.parts?.length) {
  console.error('no parts; finishReason:', cand?.finishReason, JSON.stringify(json.promptFeedback ?? cand ?? json).slice(0, 600));
  process.exit(1);
}
let n = 0;
for (const part of json.candidates?.[0]?.content?.parts ?? []) {
  if (part.text) console.log('text:', part.text.slice(0, 400));
  const d = part.inlineData;
  if (!d) continue;
  const e = ext[d.mimeType] ?? (d.mimeType.startsWith('audio/L16') ? 'pcm' : 'bin');
  const file = `${out}-${n++}.${e}`;
  writeFileSync(file, Buffer.from(d.data, 'base64'));
  console.log('saved', file, d.mimeType);
}
