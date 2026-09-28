# ADR-002: CoinMarketCap as Primary Crypto Pricing Provider

- **Status:** APPROVED (user-selected provider; integration details pending)
- **Date:** 2026-09-29
- **Related:** `docs/architecture/ARCHITECTURE.md`

## Context
Portfolio valuation, basket displays and transition planning need normalized market data. The user selected CoinMarketCap.

## Decision
Use CoinMarketCap as the primary crypto market-data provider behind a platform-owned `PricingService`. Keep market price, indicative price, issuer NAV and executable swap quote distinct. RWA valuation may require issuer-specific sources.

## Consequences
- Provider limits, attribution, commercial terms, asset mapping and freshness must be checked against the selected plan.
- Provider data is not proof of ownership, eligibility or redemption rights.
- Maintain a replaceable adapter and a documented fallback/source hierarchy.
