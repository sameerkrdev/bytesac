# ADR-002: CoinMarketCap as Primary Crypto Pricing Provider

- **Status:** APPROVED (implemented for market prices and ops-entered NAV; pricing hierarchy still open)
- **Date:** 2026-09-29
- **Related:** `docs/architecture/ARCHITECTURE.md`, ADR-010, D-015, D-027

## Context
Portfolio valuation, basket displays and transition planning need normalized market data. The user selected CoinMarketCap.

## Decision
CoinMarketCap is the primary crypto market-data provider, behind the platform-owned `getPrices` service (`apps/api/src/modules/assets/pricing.service.ts`) and a replaceable provider module (`providers/coinmarketcap.ts`). Market price, issuer NAV, indicative price and executable swap quote stay distinct; only the first two exist today.

| Topic | Implemented behavior |
|---|---|
| Fetching | On demand, never on a schedule. One batched `GET /v2/cryptocurrency/quotes/latest?id=<ids>&convert=USD` for all uncached ids, header `X-CMC_PRO_API_KEY`, 5 s timeout, response validated with zod (untrusted). |
| Mapping | An instrument has one `ACTIVE` market price reference holding the numeric CoinMarketCap id; replacing it retires the old one. |
| Cache | Redis key `price:cmc:<id>`, TTL 60 s. |
| Freshness | `observedAt` is CoinMarketCap `last_updated`; a price is `stale` when older than 5 minutes. A stale price is shown with a flag, not hidden. |
| Failure | A Redis cache failure is treated as a cache miss. A missing `COINMARKETCAP_API_KEY` (optional, empty by default), a timeout, an HTTP error or an unexpected shape returns `status: "unavailable"` (logged); the caller never receives an error and asset pages still render. One bad id makes the whole uncached batch unavailable until it is fixed. |
| NAV | Entered by ops with an as-of date, https source and history (`nav_observations`); the latest by as-of date is returned as a separate `kind: "nav"` entry. It is never converted into or merged with a market price. |
| Values | Decimal strings in `USD`. A market price is display-grade: the provider sends a JSON float, rendered as a plain decimal string (no exponent, at most 18 fraction digits). NAV values are exact strings. |
| History | None: no price table, no valuation snapshots, no scheduled job (needs a job queue). |

## Consequences
- Prices are informational. They are not proof of ownership, eligibility or redemption rights, and not an executable quote.
- Provider limits, attribution, commercial terms and asset mapping must be checked against the selected plan; the response shape was parsed from the documented shape (`data[id].quote.USD.{price,last_updated}`) and must be confirmed with a real key before launch.
- Source priority, fallback between providers and freshness policy for valuation remain open (D-027): this ADR fixes only the 5 minute flag and the market/NAV distinction.
- RWA valuation may need issuer-specific sources beyond manual NAV.
