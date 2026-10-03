# Brainstorm Log — Questions, Options and the User's Answers

Every brainstorm question asked, the options offered (recommended option first), and the user's exact answer. Final decisions also live in each spec's "Decisions" table, the decision register and the ADRs; deferred options live in `docs/domains/FUTURE-PLANS.md`. Specs 1–8 were brainstormed in earlier sessions whose Q&A was not recorded; see the "Decisions" tables in their specs under `docs/superpowers/specs/`.

---

## Spec 9 — Rebalance, skip/catch-up, drift, repair, notifications (2026-10-02)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Scope | A one spec, drift by polling (rec.) · B two specs · C one spec + Alchemy webhooks | **A** | One spec; webhooks → future plan |
| 2 | Rebalance routing | A direct sell→buy legs (rec.) · B hub through USDC on Solana · C hybrid | **B, and add A to future plan** | Hub; direct pairing → future plan |
| 3 | Trade thresholds | A platform defaults 50 bps / $5 (rec.) · B none · C per-version manager thresholds | **A and C** | Defaults + optional per-version override (10–1000 bps, $1–$100) |
| 4 | Fix semantics | asked "explain" with drift/short examples and smallcase comparison; then A smallcase-style (block rebalance while SHORT, one buy-back per asset, user-editable sync split) (rec.) · B per-basket fixed pro-rata, blocked · C per-basket, rebalance allowed | **A, and add to future plan: one plan for buy and sync across all baskets to save network fees** | Smallcase-style; combined repair plan → future plan |
| 5 | Partial rebalance / version published mid-plan | A version applied only on COMPLETED; newer version cancels PLANNED plans (rec.) · B applied on first settled leg · C block publishing | **A** | As A |
| 6 | Drift detection and notifications | A nightly + portfolio read, version threshold (default 500 bps), weekly email cap, keep custom (rec.) · B in-app only · C hourly job | **A** | As A |
| 7 | Basket cash between sells and buys | A `position_cash_entries` sub-ledger (rec.) · B no basket cash · C USDC row in the ledger | **A** | As A |
| 8 | Network fee placement in a rebalance | A extend D-071 (first / between sells and buys / refuse) (rec.) · B always up front · C always from proceeds | **A** | As A; no platform/manager fees until Spec 10 |
| 9 | Investor basket notifications | A email only (rec.) · B defer · C in-app inbox | **C, use Firebase notifications if needed** | Inbox + email + push |
| 10 | Push | A inbox + FCM web push, mobile later (rec.) · B inbox only · C web + mobile push | **A** | Web push via FCM; mobile push → future plan |
| 11 | Manager adoption view | A aggregate counts, "<5" masking (rec.) · B defer · C per-investor rows | **A** | As A |
| — | Merge-time minor 6: push token on logout | fix before merge (rec.) · defer | **Fix before merge** | Revoke on sign-out |
| — | Merge-time minor 8: adoption masking can be differenced | accept for launch (rec.) · fix | **Accept for launch** | Joint masking open (D-084) |

## Spec 10 — Manager fees, platform fees, earnings (2026-10-02)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Fee recipient | A direct to the organization's payout wallet (rec.) · B platform treasury + payouts · C platform only | **A** | Direct payouts |
| 2 | Platform's own fee | A none (rec.) · B take rate · C separate per-operation fee | **C, editable from the admin panel** | Per-operation platform fee, ops-editable |
| 3 | Platform fee configuration | A per-operation schedule, versioned (rec.) · B one global percent · C A + per-basket/organization overrides | **C** | Schedule + overrides (basket > organization > default) |
| 4 | Manager fee shape | A percent + optional cap, or fixed (rec.) · B keep schema · C percent with required cap | **A** | As A |
| 5 | Management fee | A disclosed, not collected (rec.) · B accrue and collect at next operation · C remove | **A** | Not collected; accrual → future plan |
| 6 | Subscriptions | A prepaid signed periods (rec.) · B SPL delegation auto-renew · C collect at operations | **"add this into the future plan" → clarified: move the whole subscription feature to future plans** | Subscriptions deferred entirely |
| 7 | Fee timing and refunds | A fees first, non-refundable (rec.) · B fees last on settled · C fee credit | **A** | As A |
| 8 | Rebalance fee source | A follow D-079 (proceeds allowed for Solana-only sells) (rec.) · B always up front · C always from proceeds; asked "explain" | **A for now, add B to future plan** | As A; B → future plan |
| 9 | Manager rebalance fee scope | A only when applying a newer version (rec.) · B every rebalance · C drift fix at half rate | **A** | As A |
| 10 | No verified payout wallet | A waive (rec.) · B block basket · C escrow | **A** | Waive + ops warning + email |
| 11 | Earnings reporting | A organization page (Owner/Admin) + ops revenue + reconciliation (rec.) · B all members · C minimal | **A** | As A |
| — | Second fix wave for N1 (rent priced with ETH/BTC price) | yes, small fix (rec.) · merge as-is | **Yes** | Fixed before merge |

## Spec 10.1 — LI.FI hardening (2026-10-03)

User request: read six LI.FI FAQ pages; list changes/improvements → **"apply all improvement and suggested changes and add B1, B4, B8 into future plan"** (B1 integrator fee, B4 route order, B8 skipSimulation → future plans).

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | LI.FI refuses Solana wallets without SOL | A detect, 409 `SOL_REQUIRED` (rec.) · B platform SOL drop · C wait for real-key check | **A** | As A; SOL drop → future plan |
| 2 | Failed destination swap recovery | A recovery leg in the same operation · B separate `recover` operation (rec. after "A vs B" comparison) · C display only | **A, add B to future plan** | In-operation recovery leg; separate operation → future plan |
| 3 | Price impact limit | A constant 5% + display (rec.) · B ops-configurable · C display only | **A, add B to future plan** | As A; configurable limits → future plan |
| 4 | Bridge/exchange policy | A ops deny list, empty default (rec.) · B allow list · C env deny list | **A** | As A |
| — | Server-side price-impact backstop (merge time) | defer to OPEN-ITEMS (rec.) · add before merge | **Defer** | In OPEN-ITEMS |

## Spec 11 — Secondary-market RWAs and eligibility (2026-10-03)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Release-1 RWA routes | A secondary-market via LI.FI only (rec.) · B + one issuer subscription/redemption provider · C engine only | **A** | As A; issuer routes → future plan |
| 2 | Jurisdiction and investor status | A self-declaration + geo-IP signal, `KYC_REQUIRED` blocks (rec.) · B KYC vendor · C geo-IP only | **A** | As A; KYC vendor → future plan |
| 3 | Rule evaluation | A deny by default for RWAs, most specific wins, strictest on tie (rec.) · B allow by default · C rules for everything | **A** | As A |
| 4 | Ineligible users | A block buys, keep holdings, sells follow `sell` rules (rec.) · B rebalance without the blocked asset · C block everything | **A, add detailed info to future plan** | As A; option B detailed in FUTURE-PLANS |
| 5 | RWA pricing | A market price required, NAV display only (rec.) · B NAV fallback · C LI.FI `priceUSD` fallback | **A** (later: "also add question 5 into future plan") | As A; B and C → future plan |
| 6 | Permissioned tokens | A permissionless only (rec.) · B ops-recorded allowlists · C on-chain allowlist checks | **A, add this into the future plan** | As A; B and C → future plan |

## Spec 12 — Launch hardening (2026-10-03)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Scope | A must-fix + money/ops + small functional bugs (rec.) · B must-fix + money/ops · C all of OPEN-ITEMS §7 | **A** | As A; code debt → Spec 13, CI → Spec 16, UI → Spec 15 |
| 2 | Server-side price-impact backstop (asked to "explain again in simpler words") | A own check with route fees removed (rec.) · B own check with fees counted · C keep deferring | **A** | Fee-excluded check, > 5% refused, skipped under $10 |
| 3 | Fully sold positions | A auto-close when everything is 0 (rec.) · B "Close position" button · C leave | **both A and B** | Auto-close + dust (< $1) close button |
| 4 | Stuck recovery blocks the user | A auto-stop after 7 days (rec.) · B allow a second operation · C reminder only | **A, add the issue to future plans for a deeper fix** | Auto-stop; deeper fix in FUTURE-PLANS |
| 5 | Rebalance blocked by a non-investable held asset | A only bought assets must be investable (rec.) · B keep rule · C A + ops alert | **C, add the whole issue to future plans for a deeper fix** | Bought-only rule + ops alert; disposition flow in FUTURE-PLANS |


---

## Roadmap decisions

- 2026-10-02: rebalance (Spec 9) before fees (Spec 10); then RWAs (Spec 11).
- 2026-10-03 (final order after Spec 11):
  12. Launch hardening (must-fix debt, parked money/ops leftovers, deploy readiness).
  13. Code cleanup against user-supplied reference code (ask for references at the start) **and docs cleanup** (remove duplication, unwanted and outdated information).
  14. Audit every third-party library and provider integration against its official documentation.
  15. Basic UI for web and mobile.
  16. Deployment: Docker, GitHub Actions CI/CD, step-by-step launch guide.
  17. Redesign the whole web and mobile UI/UX from user-supplied reference images and videos.
  18. Motion-graphics promo/launch video (from a user-supplied reference motion-design video) and a platform presentation in the Bytesac theme.
  19. Future plans, one at a time with approval (last).
