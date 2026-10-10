const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function waitlistWelcomeEmail(name: string): { subject: string; html: string; text: string } {
  const first = name.trim().split(/\s+/)[0] || "there";
  const subject = `${first}, you're on the Bytesac waitlist`;
  const text = [
    `Hi ${first},`,
    "",
    "Thank you for joining the Bytesac waitlist.",
    "",
    "Most people who want a diversified crypto portfolio end up juggling spreadsheets, scattered wallets, and one-off swaps. Rebalancing by hand is slow, easy to get wrong, and rarely aligned with a clear strategy.",
    "",
    "Bytesac is a manager-led, multi-chain investment basket platform. Verified fund managers publish versioned baskets; you stay in self-custody — assets remain in your wallets and you sign every value-moving transaction. The platform may co-sign Solana legs as fee payer and send EVM gas drops where needed; it never takes custody of your assets.",
    "",
    "We're building carefully before opening widely. We'll email you when there is something meaningful to share.",
    "",
    "— Sameer",
    "Cofounder, Bytesac",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F6F8FB;font-family:Geist,system-ui,-apple-system,sans-serif;color:#0F1E3A;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(180deg,#E8EEFC 0%,#F6F8FB 42%);">
    <tr><td align="center" style="padding:48px 16px;">
      <table role="presentation" width="100%" style="max-width:560px;background:#FFFFFF;border:1px solid #E2E7EF;border-radius:20px;overflow:hidden;">
        <tr><td style="padding:40px 36px 8px;">
          <p style="margin:0 0 8px;font:500 11px/1.2 ui-monospace,monospace;letter-spacing:0.12em;text-transform:uppercase;color:#56627A;">Bytesac</p>
          <h1 style="margin:0 0 20px;font:300 28px/1.2 Geist,system-ui,sans-serif;letter-spacing:-0.02em;">You're on the list</h1>
          <p style="margin:0 0 16px;font:400 16px/1.6;color:#0F1E3A;">Hi ${esc(first)},</p>
          <p style="margin:0 0 16px;font:400 16px/1.6;color:#56627A;">Thank you for joining the waitlist. Most people who want a diversified crypto portfolio end up juggling spreadsheets, scattered wallets, and one-off swaps — rebalancing by hand is slow and rarely aligned with a clear strategy.</p>
          <p style="margin:0 0 16px;font:400 16px/1.6;color:#56627A;">Bytesac is a <strong style="color:#0F1E3A;font-weight:500;">manager-led, multi-chain basket platform</strong>. Verified managers publish versioned strategies; you stay in <strong style="color:#0F1E3A;font-weight:500;">self-custody</strong> — your assets stay in your wallets and you sign every value-moving transaction.</p>
          <p style="margin:0 0 24px;font:400 16px/1.6;color:#56627A;">We're opening carefully. We'll email you when there's something meaningful to share.</p>
          <p style="margin:0;font:400 16px/1.6;color:#0F1E3A;">— Sameer<br/><span style="color:#56627A;">Cofounder, Bytesac</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}
