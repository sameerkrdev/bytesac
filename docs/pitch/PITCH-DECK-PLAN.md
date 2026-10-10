# Bytesac pitch deck — research and plan

Status: deck built (2026-10-11): `docs/pitch/Bytesac-Pitch-Deck.pptx`, 12 main + 6 appendix slides, real product screenshots (demo data), native charts, Morph transitions and fade-in builds; `[Name]`, `[amount]` and the traction box still need team input. Visual storyboard: `docs/pitch/storyboard.html`.
Audience: pre-seed investors and Solana / Colosseum hackathon judges. One master deck, three cuts (§2).

Product truth for every slide comes from `docs/` (ADR-013 custody, ADR-014/015 execution and rebalancing, ADR-007..009 manager
vetting, ADR-018 RWAs, `domains/FUTURE-PLANS.md`). Design rules come from `docs/design/DESIGN-SYSTEM.md`: no invented
stats, simulated performance always labelled, never claim Bytesac "cannot touch a transaction" (it co-signs Solana legs as
fee payer and sends EVM gas drops). The approved phrasing is "never holds your keys or your funds".

---

## 1. What the research says about the format

| Finding | Source | What it means for us |
|---|---|---|
| Colosseum judges review the **2–3 min presentation video first**; it decides the shortlist. A voiceover over slides is fine; story beats polish. | [Colosseum workshop](https://blog.colosseum.com/perfecting-your-hackathon-submission/) | The main deck must also work as a 2.5 min voiceover. |
| A separate **technical demo video (≤3 min)** covers how it is built: features, stack, **Solana integration, on-chain logic, architecture**. Unclear Solana integration is a common mistake. | same | Architecture and Solana detail go in an appendix that drives the demo video. |
| Judging factors: founder–market fit, insight, product and execution, market size, communication, viability, **traction**; submission also asks for **go-to-market, demand validation and distribution**. Shortlisted teams get a 15 min interview. | [colosseum.com/hackathon](https://colosseum.com/hackathon) | We need a Team slide, a GTM/traction slide and real validation (user and manager conversations). |
| Frontier judges are investors; teams show MVP, user acquisition, monetization and team credentials. | [Incrypted on Frontier](https://incrypted.com/en/the-colosseum-frontier-hackathon-has-officially-kicked-off/) | Same deck serves both audiences. |
| Investors spend roughly **2–4 min** on a deck and **~12–15 s per slide**; the team slide gets the most time; ~10-slide decks have the highest completion (32% vs 22% average); 10–18 slides is the usual range. | [Storydoc](https://www.storydoc.com/blog/pitch-deck-statistics), [HummingDeck](https://hummingdeck.com/blog/pitch-deck-benchmarks-2026), [TechCrunch/DocSend](https://techcrunch.com/?p=1167693) | **12 main slides** (≈12 s each = 2.5 min) plus a short appendix. Your 11–12 estimate is right. |

### Hackathon timing: check this first

- **Colosseum Frontier** (Spring 2026) ran 6 Apr – 11 May 2026 and is **closed** (2,858 projects; grand prize Crowdbrain).
- The live Colosseum event is **Crypto World's Fair**, 14 Sep – **12 Oct 2026** (two days from today). Requirements: name,
  description, chains and tools, team backgrounds, location, logo, GitHub (private allowed with access for
  hackathon@colosseum.com), **2–3 min presentation video**, **≤3 min demo video**, GTM/demand validation/distribution.
  Products are judged on work done during the event and earlier work must be disclosed.
- Decide which event we target (or the Colosseum Accelerator / a later hackathon). Hitting 12 Oct means the video cut
  first, then the investor deck.

## 2. Recommended structure: 12 slides, 6 appendix, 3 cuts

| Cut | Slides | Length | Used for |
|---|---|---|---|
| **Pitch video** | 1–12 (slide 11 as a 10 s face-to-camera) | 2:30–2:50 | Colosseum presentation video |
| **Tech demo video** | A1–A4 + live product screen recording | ≤3:00 | Colosseum demo video |
| **Investor deck** | 1–12 + A1–A6 | send-ahead / meeting | VCs, accelerator interview |

Every topic you asked for has a home:

| You asked for | Where |
|---|---|
| Index / cover | 1 (no separate agenda slide; a table of contents costs 12 s and judges skip it) |
| Problem | 2 |
| Current solutions + competitor cons | 3 (+ A6 full matrix) |
| Our solution, core values, non-custodial | 4 |
| Features + user flow (user perspective) | 5 |
| Fund manager flow, manager management, how we prove managers are legit | 6 (+ A4) |
| Investment flow with drift and rebalancing, user and tech perspective | 7 (+ A3) |
| Multi-chain, RWAs, ETFs, equity, commodities, asset options | 8 |
| Architecture | 9 (simple) + A1/A2 (deep) |
| Market growth with graphs | 10 |
| Business model, GTM, traction | 11 |
| Team, future plans, ask | 12 (+ A5 roadmap detail) |

Team placement: investors expect it near the end, Colosseum wants the team in the first seconds of the video. Do both:
a 5 s spoken intro over slide 1 ("We're X and Y, we built …") and the full Team slide at 12.

---

## 3. Slide-by-slide content

Numbers are cited and dated; re-pull every figure from rwa.xyz / the Solana Foundation the day before recording.
`[NEED]` = input only the team has.

### 1 · Cover
- **Headline:** "Expert-managed portfolios. Held in your own wallet."
- **Sub:** "Vetted fund managers build multi-chain baskets of crypto and tokenized assets. You invest in USDC on Solana,
  approve every move, and keep the assets."
- Chips: Self-custody · Verified managers · 7 chains · USDC on Solana. Logo, "Built on Solana".
- **Visual:** sky atmosphere (bookend), the two-slab mark, one phone with the basket screen.
- **Motion:** sky fade → headline masked rise (line 2 +120 ms) → phone rises and sharpens → chips stagger in.

### 2 · Problem: three walls between people and good portfolios
1. **Building it yourself is hard.** Assets are spread across chains and wallets: 62% of crypto users already manage 2+
   wallets ([Reown/Nansen 2025](https://in.benzinga.com/markets/cryptocurrency/25/05/45128841/crypto-wallet-fragmentation-grows-62-of-users-manage-multiple-wallets-report-says));
   Solana alone lists 3,000+ RWA assets ([Solana Foundation, Sep 2026](https://solana.com/news/solana-ecosystem-roundup-september-2026)).
2. **Trusting someone else is dangerous.** ~$17B in crypto scam proceeds in 2025, impersonation scams up 1,400%
   ([Chainalysis 2026 report, via FastBull](https://www.fastbull.com/brokersview/news/chainalysis-2026-report-crypto-scam-loss-estimated-at-17b-in-2025-impersonation-fraud-soars-1400-319993)).
   Today "follow an expert" means handing over custody (vaults, copy-trading accounts) or following anonymous signals.
3. **Staying on target is a chore.** Prices drift the mix; rebalancing across chains means many swaps, bridges and gas tokens.
- **Visual:** three columns, each a mini illustration (wallet sprawl, a broken lock, a drifting ring). One big number per column.
- **Motion:** columns stagger in (80 ms), the big numbers count up.

### 3 · Today's options fall short
Compact matrix (full version in A6). Rows: smallcase, eToro copy/Smart Portfolios, Symmetry, Glider, vaults
(Enzyme / Chamber (dHEDGE), Kamino curators), tokenized-stock venues (xStocks, Ondo GM, Robinhood). Columns:
assets in your wallet · vetted managers · you approve each rebalance · multi-chain incl. BTC · tokenized stocks/gold.

| Option | Their limit (one line on the slide) |
|---|---|
| smallcase (India) | Proves the model (10M+ investors, SEBI-registered managers, holdings in your own demat) but Indian equities only, nothing on chain ([smallcase.com](https://www.smallcase.com/)) |
| eToro copy trading / Smart Portfolios | Custodial; 3.81M funded accounts ([Q4 2025 call](https://www.aol.com/finance/etoro-etor-q4-2025-earnings-174942622.html)); "Popular Investors" are users who meet thresholds, not vetted managers |
| Symmetry (Solana) | You hold a basket token, not the assets; anyone can create a basket; Solana only ([symmetry.fi](https://symmetry.fi/)) |
| Glider | Non-custodial smart wallet, stocks via Ondo ([Glider blog](https://blog.glider.fi/onchain-stocks-live-on-glider-with-ondo-finance/)), 0.30% on automated trades ([Glider blog](https://blog.glider.fi/glider-vs-aqumon/)); portfolios are self-built or copied, no accountable manager, automation runs on delegated permissions ([ZeroDev](https://www.zerodev.app/blogs/blog-zerodev-glider)) |
| On-chain vaults (Enzyme, Chamber, Kamino curators) | Pooled custody under the manager or curator; yield-focused; EVM or single-chain |
| xStocks / Ondo GM / Robinhood | Great access to single tokenized stocks; no portfolio, no manager, no rebalancing |

- **Bytesac row last, highlighted**, ticks in every column.
- **Motion:** competitor rows appear, then the Bytesac row slides up and its ticks fill one by one.

### 4 · Bytesac: the solution and what we stand for
- One line: "A marketplace where verified managers publish strategies and you execute them in your own wallet."
- Four core values (our principles, from `ARCHITECTURE.md` §1):
  1. **Your keys, your assets.** Self-custody; Bytesac never holds your keys or your funds (ADR-013).
  2. **Strategy is not execution.** A manager's update is a proposal; nothing moves without your signature (D-024, D-028).
  3. **Verified, accountable managers.** Screening, organization verification and reviewed basket versions (ADR-007..011).
  4. **Proof over promises.** Holdings come from chain evidence; every fee and every leg is shown before you sign; performance is labelled simulated (D-075, D-064).
- **Visual:** dark island slide (the self-custody section style), ring object centre, four values around it.
- **Motion:** Morph from slide 1's phone into the ring; values fade in clockwise.

### 5 · How it works for an investor
Five-step rail with real UI crops from the web/mobile app:
1. **Discover**: filters + AI search, simulated performance, manager profile, fees.
2. **Invest**: enter a USDC amount and slippage; preview every leg and every fee.
3. **Sign**: one leg at a time in your wallet (Phantom, MetaMask, Trust…); routes via LI.FI to your own addresses.
4. **Own**: assets land in your wallets across chains; portfolio shows target vs actual from chain data.
5. **Stay aligned or leave**: review manager updates, apply or skip; Leave keeps assets, Sell returns USDC; no lock-in.
- Feature chips: AI search · plan preview · per-leg tracking · drift alerts (inbox, email, push) · eligibility checks.
- **Motion:** progress line fills along the rail, each step's screenshot swaps in.

### 6 · Fund managers: how they work and how we keep them legit
Left: manager journey (apply → screening → organization verified → build basket → ops review → publish → earn).
Right: **the trust stack** (each a real control in the product):
- Public application with email confirmation; ops screening with contact and info requests (ADR-007).
- The submitted wallet must be **proven by signature** before manager rights are granted; a typed address never counts.
- Organization verification with jurisdiction-specific required documents, private to ops (ADR-008).
- Separate Solana **payout wallet proven by signature**; replacing it needs a new signature and ops approval.
- Team roles; Admins and Managers pass their **own identity verification** (ADR-009).
- Managers can only pick **ops-approved assets** from the registry, never arbitrary tokens (ADR-010).
- Every basket version is **frozen, hashed and reviewed** (strategy, assets, weights, fees, risks) before it can go live (ADR-011).
- **Fee caps** (0–100 bps, fixed fees ≤1% of minimum) and mandatory platform disclosures managers cannot remove.
- Every change carries a **rationale and a computed diff**; managers see adoption counts, never individual investors.
- **"Verified by Bytesac"** badge only while verification is active; full audit trail.
- Punchline: "**Managers steer the strategy. They never touch your money.**"
- **Motion:** journey draws left to right; trust stack builds as a layered shield.

### 7 · Rebalancing and drift (user view and engine view)
- **User view (top):** a drift chart. One asset's weight drifts from its 25% target past the 5% band (default drift
  threshold 500 bps), the position turns "Drifted", the user taps **Rebalance to target** or **Keep custom**. When the
  manager publishes v3 the user sees the rationale, the diff and a plan, then **Apply** or **Skip**.
- **Engine view (bottom):** reconcile holdings from chain → plan (skip trades under 50 bps or 5 USDC) → sells to USDC on
  Solana → buys sized to what actually arrived → each leg tracked to Settled / Failed / Unknown, never blindly retried.
- **Chart:** line chart of weights over time with a shaded tolerance band; illustrative data, labelled as such.
- **Motion:** the drift line draws in, crosses the band, the "Drifted" pill appears; then the sell → USDC → buy flow animates.

### 8 · One USDC entry, every chain, many asset classes
- **Chains:** Solana (settlement hub), Ethereum, Base, BNB Chain, Arbitrum, Polygon, Bitcoin (native BTC via PSBT).
- **Live in release 1:** crypto, stablecoins, permissionless tokenized RWAs traded on chain: tokenized stocks and ETFs
  (e.g. xStocks, Ondo Global Markets), tokenized gold, other tokenized assets, all per-user eligibility checked.
- **Roadmap:** permissioned RWAs and issuer subscription/redemption (e.g. tokenized treasury funds) after a KYC vendor;
  US and global stocks, ETFs, commodities, indices, currencies and rates, fixed and recurring deposits, pre-IPO
  (`FUTURE-PLANS.md`). Conventional broker-held stocks need a new custody decision first.
- Keep the split visible: two rings, "Live" and "Next", so nobody reads a roadmap item as shipped.
- **Motion:** chain logos orbit into the Solana hub; asset tiles flip from "Next" to "Live" only for shipped ones.

### 9 · Under the hood: why Solana
- Simple architecture strip: Web + Mobile → Bytesac API and worker → LI.FI routing, Alchemy RPC, CoinMarketCap → user's wallets on 7 chains.
- Why Solana (the judges' criterion):
  - **USDC on Solana is the single entry and settlement currency**; every rebalance routes through it.
  - **Sign-In with Solana**, and Solana legs are **co-signed by the platform fee payer** only when byte-identical to the quoted transaction.
  - **One Solana transaction pays every fee**: network cost, the manager (straight to their verified payout wallet) and the platform.
  - Speed and cost make "approve every move" practical.
- Proof points: $17.5B stablecoins, 13.07M stablecoin-holding wallets, 1M+ tokenized-stock holder wallets, $4.6B RWA value (Solana Foundation, Sep 2026); Solana handled 47% of on-chain RWA trades in the 12 months to 18 Aug 2026 (Allium, via [Hokanews](https://www.hokanews.com/2026/09/solana-rwa-ecosystem-reaches-record-46.html)).
- **Motion:** data packet runs along the strip; the Solana hub pulses once.

### 10 · Market: tokenized assets are compounding, and people already want managed baskets
- **Chart A (line):** tokenized RWAs, distributed value: ~$21B (Jan 2026) → ~$27.5B (end Q1) → $38.3B (mid-Aug) → **$39.0B (9 Oct 2026)**
  ([Investax Q1](https://investax.io/blog/q1-2026-real-world-asset-tokenization-market-report), [Cryptobriefing](https://cryptobriefing.com/tokenized-stocks-rwa-market-cap-share/), [KuCoin citing rwa.xyz](https://www.kucoin.com/blog/rwa-tokenization-2026-liquidity-regulation)).
- **Chart B (bars):** Solana RWA value ~$0.87B (end 2025) → $3.1B (Jun) → $4.23B (5 Sep) → **$4.6B (23 Sep 2026)**, about 5x in 9 months
  (end-2025 figure from secondary reports, verify on rwa.xyz; [Cryptobriefing](https://cryptobriefing.com/solana-rwa-ecosystem-surpasses-3-billion/), [Memeburn](https://memeburn.com/solana-rwa-ecosystem-2026-why-trading-matters-more/), [Solana Foundation](https://solana.com/news/solana-ecosystem-roundup-september-2026)).
- **Demand proof tiles:** smallcase 10M+ investors (model portfolios held in the investor's own account); eToro 3.81M
  funded accounts, copy trading at an all-time high in Q1 2026 ([Nasdaq](https://www.nasdaq.com/articles/etoro-group-q1-earnings-call-highlights));
  US robo-advisors ~$1.6T AUM in 2026 (Statista estimate); 560–741M crypto owners worldwide (Triple-A 2024, Crypto.com 2025).
- **TAM / SAM / SOM:** bottom-up, assumptions agreed by the team before publishing:
  - SAM: 13.07M stablecoin-holding wallets on Solana (Sep 2026).
  - SOM year 1 = wallets reached × conversion × average invested × (entry fee + platform fee) + rebalance volume × rebalance fee.
  - Example only: 13k investors × $800 = $10.4M invested in year 1. `[NEED]` real assumptions and fee rates (platform fee rates are still OPEN, D-087).
- Forecasts: label them as forecasts and show the range (e.g. $3T vendor forecast vs the $16T BCG figure for 2030); never as facts.
- **Motion:** line draws left to right; bars grow; the 39.0 label counts up.

### 11 · Business model, go-to-market and traction
- **Revenue (live in code):** platform fee per operation (invest, rebalance, repair, sell), set by ops; managers earn entry and rebalance
  fees paid straight to their verified payout wallet in the same Solana transaction (ADR-016). Bytesac never holds manager money.
- **Later:** management-fee collection, subscriptions, a take rate on manager fees (`FUTURE-PLANS.md`).
- **Flywheel:** verified managers bring their audiences → investors → adoption data and fees → more managers.
- **GTM:** `[NEED]` named launch managers (crypto funds, research desks, analysts) and channels; Solana community (Superteam, Colosseum), wallet partners.
- **Traction:** what is true today: product built end to end (web + mobile, 17 specs, 121 recorded decisions, invest, rebalance,
  drift repair, fees, RWA eligibility), mainnet pilot pending (deployment phase). `[NEED]` waitlist, manager LOIs,
  user interviews, any pilot numbers. This is the slide the judges weigh most after the team.
- **Motion:** flywheel rotates once; traction numbers count up.

### 12 · Team, roadmap and ask
- **Team:** `[NEED]` photo, name, role, one proof line each (what you shipped, finance/crypto background). Why us for this problem.
- **Roadmap (3 columns):** Now: release 1 pilot on mainnet with small amounts · Next: multi-wallet per chain (D-120/121),
  KYC vendor and permissioned RWAs, mobile push, combined repair · Later: stocks/ETFs/commodities/deposits/pre-IPO, more
  settlement currencies, subscriptions and management fees.
- **Ask:** `[NEED]` amount, instrument, 18-month milestones, use of funds (security audit, legal and RWA licensing per
  jurisdiction, manager acquisition, KYC vendor, team).
- Close on the sky bookend and the tagline; contact line.
- **Motion:** mirror of slide 1 (sky returns, phone rises), roadmap columns stagger.

### Appendix
- **A1 Architecture:** runtime diagram (Next.js web, Expo mobile, Express API modular monolith, BullMQ worker, Postgres/Supabase,
  Redis, R2; providers behind adapters: LI.FI, Alchemy, CoinMarketCap, Gemini, Resend, Twilio, FCM).
- **A2 Solana integration:** SIWS → plan → fee leg (one Solana tx, several USDC transfers) → per-leg quote (60 s) → wallet
  signs → fee payer co-signs only byte-identical messages → tracking → ledger from chain evidence. Leg state machine
  `PLANNED → SUBMITTED → PENDING_CHAIN → SETTLED | FAILED | UNKNOWN`; operations may end `PARTIAL`.
- **A3 Rebalance engine:** reconcile → states (version, backing, allocation, execution) → thresholds → sells → USDC hub →
  scaled buys → basket cash → shortfall repair (Buy back / Sync).
- **A4 Manager verification state machines:** application, organization, membership, basket version lifecycles.
- **A5 Eligibility and compliance:** self-declared country and investor status (365 days), geo-IP signal, RWAs denied by
  default until rules exist, restricted assets never force-sold. Legal review still open: say so if asked.
- **A6 Full competitor matrix + sources** (every number on the deck with its date and link).

## 4. Theme and motion rules (from the design system)

- Light canvas `#F6F8FB`, ink `#0F1E3A`, navy primary `#1C2B4A`, accent blue `#3D63D9` used sparingly; dark island
  `#070D18` for slides 4 and 9; chart palette `data1–6` (navy → pale blue), largest series first.
- Geist 300 for headlines (tight tracking), Geist Mono uppercase eyebrows, tabular figures.
- Sky atmosphere only on slides 1 and 12 (bookends); everything between is calm canvas. One focal object per slide.
- Real UI only from the actual app (screenshots from the mock-API visual QA in `apps/web/e2e`); no fake screens.
- Motion tokens: ease `cubic-bezier(0.22,1,0.36,1)`, 320/700 ms, 120 ms line stagger, 80 ms item stagger;
  order atmosphere → words → object → chips → actions. In PowerPoint: Morph between slides with shared objects
  (phone → ring → rail), Fade + small rise for entrances, Wipe for chart series. No spins, bounces or flying text.

## 5. Steps from here

1. **Decide** (user): target event and date, file format (PowerPoint `.pptx` with Morph, recommended for animation, or the
   Slides artifact that exports .pptx/PDF), and whether slide 11 shows fee rates.
2. **Collect `[NEED]` inputs:** team bios and photos, traction and validation, GTM names, the ask, SOM assumptions.
3. **Lock copy** slide by slide against this plan (one sentence headline each; read aloud ≤12 s).
4. **Refresh data** from rwa.xyz and the Solana Foundation the day before; rebuild charts from those numbers only.
5. **Capture real UI** (web mock-API personas, mobile screens) for slides 5–8.
6. **Build the deck** in the Bytesac theme with the motion rules above; appendix after slide 12.
7. **Record** the 2:30 pitch video (voiceover on slides, team on camera at start and end) and the ≤3 min tech demo (A1–A4 + live product).
8. **Review** against Colosseum's common mistakes: over time, buzzwords, unclear Solana integration, missing team, missing validation.
