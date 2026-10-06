# Video 3 — Investor film (ref4 grammar) · SCRIPT v1

Status: **approved 2026-10-06** (decisions below).

- **Format:** 1920×1080, 60 fps, ~96 s (ref4 is 92 s). Dark (Bytesac night theme) with white interludes.
- **Story:** problem → the alternatives and their cons → "Want to know how?" → Introducing Bytesac → feature tour →
  self-custody (the funny part) → CTA → logo.
- **Sound:** calm-exciting. Soft and tense in the problem act, silence before the reveal, a warm confident groove
  for the tour, a light playful sting in the custody act.

## Claim check (every on-screen claim against the docs)

| Brief says | What the product does (source) | On-screen wording |
|---|---|---|
| Sign up | Wallet sign-in (SIWS on Solana, SIWE on EVM chains); Bitcoin is link-only (USER-AUTHENTICATION) | "Sign in with your wallet." |
| Multiple chains | Assets on Solana, Ethereum, Base, BNB Chain, Arbitrum, Polygon and Bitcoin (ASSET-REGISTRY) | "One basket. Seven chains." |
| Invest "in any supported token" | **Investments are funded with USDC on Solana only** (ADR-013) | "Fund with USDC. Own assets across chains." |
| Swapping | Swaps and bridges are legs inside invest, rebalance and sell, routed by LI.FI to the user's own addresses (ADR-014) — not a standalone swap screen | "Every swap and bridge, routed for you." |
| RWAs: Apple, NVIDIA… | Release 1 offers permissionless tokenized RWAs (`TOKENIZED_*`, incl. equities) where the registry has them, region- and investor-status-gated (ADR-018) | "Crypto and tokenized stocks, funds and gold" (no company names — decision 3) |
| ETFs | "ETFs" means tokenized funds/equities on chain; conventional broker-held ETFs are future (FUTURE-PLANS) | "Tokenized stocks, funds and gold" |
| Managers with years of experience, verified | Organizations and their admins/managers pass document review by Bytesac ops (MANAGER-ORGANISATION-ONBOARDING); discovery filters by manager experience | "Experienced managers. Verified by Bytesac." (no invented numbers) |
| Your assets, not ours; never held | Self-custody: the platform holds no keys or funds; the user signs every transaction; exact-amount approvals, no delegation (ADR-013, D-022) | "Your assets stay in your wallet. Always." |
| Hacked or bankrupt → still safe | Assets sit in the user's wallet and need the user's signature to move. **"Safe" is too strong** (a user can still be phished; prices still move) | "We get hacked? They can't move what we never held." / "We go bankrupt? Your assets don't even notice." |
| Rebalance, drift, fix, sync | Apply or skip a version; drift → Rebalance to target / Keep custom; shortfall → Buy back or Sync (ADR-015) | as below |
| Notifications | Inbox, email, browser push (mobile push is future) (ADR-015) | "Inbox, email and push." |
| Competitors' cons | Category-level, factual | as below (no brand names unless you decide otherwise) |

## Script

| # | Time | ref4 beat | Picture | On-screen copy |
|---|---|---|---|---|
| 1 | 0–4.5 | Logo + floor light | Bytesac mark, wordmark types on, blue-white floor light | **Bytesac** |
| 2 | 4.5–8.5 | Question over dash field | Dashes rotate and form a **jagged** chart (chaos, not growth) | Investing in crypto today… |
| 3 | 8.5–9.5 | Second half | small drifting arrow | …is a full-time job. |
| 4 | 9.5–14.5 | White, giant scrolling words | Huge words pan right-to-left | **6 wallets · 4 bridges · 12 tabs · 0 sleep** |
| 5 | 14.5–16.5 | Typewriter on black | cursor | So you pick a shortcut. |
| 6 | 16.5–21.5 | Card carousel | Four dark glass cards, each with its cons; camera tracks across | **Exchanges** — hold your keys · can freeze withdrawals · one failure away from zero / **Copy-trading** — anonymous leaders · nothing verified · no accountability / **Doing it yourself** — many wallets · manual bridging · rebalance by hand / **Funds & robo-advisors** — no on-chain assets · broker custody · closed doors |
| 7 | 21.5–26.5 | Word slot machine (white) | One sharp word, faded neighbours | Custody risk · Unverified "experts" · Fragmented chains · Manual rebalancing · Hidden fees |
| 8 | 26.5–29.5 | 3D carousel | The four cards on a slowly rotating cylinder, dimming | (no copy) |
| 9 | 29.5–33 | Word build, white → black | | What if experts built the strategy… |
| 10 | 33–35 | Big word → ring | thin ring with one word | …and **you** kept the keys? |
| 11 | 35–40 | Concentric rings, pill count | Pill label swaps; number counts up | one basket → **7 chains** → **every asset in your wallet** |
| 12 | 40–43 | Pill to full-bleed, music drops out | | Want to know how? |
| 13 | 43–46 | Horizon arc, music drops in | Accent-blue planet edge | Introducing **Bytesac** |
| 14 | 46–51 | UI on 3D tilt | Real basket page (dark) | Baskets built by **experienced managers**. Verified by Bytesac. |
| 15 | 51–55 | Sidebar tour | Labels light up one by one | Sign in with your wallet → Discover baskets → Invest → Portfolio |
| 16 | 55–60 | Network | Solana hub with lines drawing to Ethereum, Base, BNB Chain, Arbitrum, Polygon, Bitcoin | Fund with USDC. Own assets on **7 chains**. |
| 17 | 60–64 | Swoosh + cards | Leg cards fly in (swap, bridge) | Every swap and bridge, routed for you. |
| 18 | 64–68 | Donut with leader lines | Real basket allocation incl. tokenized assets | Crypto **and** tokenized stocks, funds and gold. |
| 19 | 68–71 | Glass card → chart | Real allocation / weights card | One basket. Many assets. One plan. |
| 20 | 71–73 | Light wedge | | And that's not all. |
| 21 | 73–76 | Table, rows highlight | Real rebalance review | Manager publishes an update? **You** apply or skip. |
| 22 | 76–79 | Cards | Drift card → two buttons | Drifted? **Rebalance** to target, or **keep it custom**. |
| 23 | 79–81 | Cards | Repair panel | Something moved? **Buy back** or **Sync**. |
| 24 | 81–83 | Grid of small UI | Inbox, email, push tiles | Inbox, email and push. Never miss a change. |
| 25 | 83–86 | Orbit | User's wallet in the centre, asset logos orbiting | Your assets. **Your wallet.** Always. |
| 26 | 86–90 | Floating cards (the funny part) | Three "what if" cards around the centre line | **We get hacked?** They can't move what we never held. / **We go bankrupt?** Your assets don't even notice. / **We lose the Wi-Fi?** Still yours. *(centre)* We never hold your assets. Not for a second. |
| 27 | 90–93 | CTA, echo grid | | Invest in strategies, not individual trades. → **Join us** |
| 28 | 93–96 | URL type-on → logo + floor light | Bookend of shot 1 | bytesac.com → **Bytesac** |

## Decisions (user, 2026-10-06)

1. Audience: **retail investors** (CTA "Join us").
2. Competitors: **categories only**, no brand names or logos.
3. Tokenized stocks: **generic wording**, no company names.
4. End card: **bytesac.com**.
