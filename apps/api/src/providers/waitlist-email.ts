import { themes } from "@repo/design-tokens";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const L = themes.light;
const D = themes.dark;
const SANS = "Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const POINTS: [string, string][] = [
  ["Strategies, not single trades", "Verified managers publish versioned baskets with a thesis, target weights and fees you can read before investing."],
  ["Your wallet, your keys", "Assets stay in your own wallets. You review a plan and sign every step that moves value."],
  ["Updates need your consent", "When a manager publishes a new version, you review it and apply or skip. Nothing changes without your signature."],
];

/** Welcome email in the Bytesac theme (light tokens inline, dark tokens for clients that honour prefers-color-scheme). Table layout for Outlook. Greets "there" without a name. */
export function waitlistWelcomeEmail(name: string | null): { subject: string; html: string; text: string } {
  const given = name?.trim().split(/\s+/)[0] ?? "";
  const first = given || "there";
  const subject = given ? `${given}, you're on the Bytesac waitlist` : "You're on the Bytesac waitlist";
  const text = [
    `Hi ${first},`,
    "",
    "Thank you for joining the Bytesac waitlist.",
    "",
    "Most people who want a diversified crypto portfolio end up juggling spreadsheets, scattered wallets, and one-off swaps. Rebalancing by hand is slow, easy to get wrong, and rarely aligned with a clear strategy.",
    "",
    "Bytesac is a manager-led, multi-chain investment basket platform. Verified fund managers publish versioned baskets; you stay in self-custody — assets remain in your wallets and you sign every value-moving transaction.",
    "",
    ...POINTS.flatMap(([t, b]) => [`- ${t}: ${b}`]),
    "",
    "We're building carefully before opening widely. We'll email you when there is something meaningful to share.",
    "",
    "— Sameer",
    "Cofounder, Bytesac",
  ].join("\n");

  const points = POINTS.map(([t, b], i) => `
              <tr><td style="padding:${i === 0 ? "0" : "16px"} 0 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
                  <td width="28" valign="top" style="padding-top:7px;"><div class="bx-dot" style="width:8px;height:8px;border-radius:999px;background:${L.accent};"></div></td>
                  <td valign="top">
                    <p class="bx-ink" style="margin:0;font:500 15px/1.45 ${SANS};color:${L.ink};">${t}</p>
                    <p class="bx-muted" style="margin:4px 0 0;font:400 14px/1.6 ${SANS};color:${L.inkMuted};">${b}</p>
                  </td>
                </tr></table>
              </td></tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light dark"/><meta name="supported-color-schemes" content="light dark"/>
<title>${esc(subject)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .bx-canvas { background:${D.canvas} !important; }
    .bx-card { background:${D.surface} !important; border-color:${D.line} !important; }
    .bx-tile { background:${D.surfaceMuted} !important; }
    .bx-rule { border-color:${D.line} !important; }
    .bx-ink { color:${D.ink} !important; }
    .bx-muted { color:${D.inkMuted} !important; }
    .bx-faint { color:${D.inkFaint} !important; }
    .bx-dot, .bx-top { background:${D.accent} !important; }
    .bx-bottom { background:${D.ink} !important; }
  }
  @media (max-width: 600px) { .bx-pad { padding-left:24px !important; padding-right:24px !important; } }
</style>
</head>
<body class="bx-canvas" style="margin:0;padding:0;background:${L.canvas};">
  <div style="display:none;max-height:0;overflow:hidden;">Thanks for joining. Here is what Bytesac is building.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="bx-canvas" bgcolor="${L.canvas}" style="background:${L.canvas};background-image:linear-gradient(180deg,${L.skyMid} 0%,${L.skyLow} 34%,${L.canvas} 62%);">
    <tr><td align="center" style="padding:40px 16px 48px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
        <tr><td style="padding:0 4px 24px;">
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td valign="middle" style="padding-right:10px;">
              <div class="bx-top" style="width:24px;height:10px;border-radius:4px;background:${L.accent};"></div>
              <div class="bx-bottom" style="width:24px;height:10px;border-radius:4px;background:${L.ink};margin-top:3px;"></div>
            </td>
            <td valign="middle" class="bx-ink" style="font:500 20px/1 ${SANS};letter-spacing:-0.02em;color:${L.ink};">Bytesac</td>
          </tr></table>
        </td></tr>
        <tr><td class="bx-card" style="background:${L.surface};border:1px solid ${L.line};border-radius:20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr><td class="bx-pad" style="padding:40px 40px 0;">
              <p class="bx-faint" style="margin:0 0 12px;font:500 11px/1.2 ${MONO};letter-spacing:0.12em;text-transform:uppercase;color:${L.inkFaint};">Waitlist</p>
              <h1 class="bx-ink" style="margin:0 0 24px;font:300 32px/1.15 ${SANS};letter-spacing:-0.028em;color:${L.ink};">You&rsquo;re on the list</h1>
              <p class="bx-ink" style="margin:0 0 16px;font:400 16px/1.6 ${SANS};color:${L.ink};">Hi ${esc(first)},</p>
              <p class="bx-muted" style="margin:0 0 16px;font:400 16px/1.6 ${SANS};color:${L.inkMuted};">Thank you for joining. Most people who want a diversified crypto portfolio end up juggling spreadsheets, scattered wallets and one-off swaps. Rebalancing by hand is slow and rarely aligned with a clear strategy.</p>
              <p class="bx-muted" style="margin:0 0 28px;font:400 16px/1.6 ${SANS};color:${L.inkMuted};">Bytesac is a <span class="bx-ink" style="color:${L.ink};font-weight:500;">manager-led, multi-chain basket platform</span>, built around self-custody.</p>
            </td></tr>
            <tr><td class="bx-pad" style="padding:0 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="bx-tile" style="background:${L.surfaceMuted};border-radius:14px;">
                <tr><td style="padding:24px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${points}
                  </table>
                </td></tr>
              </table>
            </td></tr>
            <tr><td class="bx-pad" style="padding:28px 40px 40px;">
              <p class="bx-muted" style="margin:0 0 24px;font:400 16px/1.6 ${SANS};color:${L.inkMuted};">We&rsquo;re opening carefully. We&rsquo;ll email you when there&rsquo;s something meaningful to share.</p>
              <p class="bx-ink" style="margin:0;font:400 16px/1.5 ${SANS};color:${L.ink};">Sameer</p>
              <p class="bx-muted" style="margin:2px 0 0;font:400 14px/1.5 ${SANS};color:${L.inkMuted};">Cofounder, Bytesac</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 4px 0;">
          <p class="bx-faint" style="margin:0;font:400 12px/1.6 ${SANS};color:${L.inkFaint};">You&rsquo;re receiving this because you joined the Bytesac waitlist. Bytesac never asks for your seed phrase or private keys.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
