import type { ASSET_REQUIREMENT_KEYS, AssetItemStatus, AssetType, InstrumentStatus } from "@repo/validator";

type Tone = "success" | "warning" | "danger" | "neutral";
type Label = { label: string; tone: Tone };

export const INSTRUMENT_STATUS_LABEL: Record<InstrumentStatus, Label> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  UNDER_REVIEW: { label: "Under review", tone: "neutral" },
  CHANGES_REQUIRED: { label: "Changes required", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  ACTIVE: { label: "Active", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  DEPRECATED: { label: "Deprecated", tone: "warning" },
  RETIRED: { label: "Retired", tone: "neutral" },
};

export const ASSET_ITEM_STATUS_LABEL: Record<AssetItemStatus, Label> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  APPROVED: { label: "Approved", tone: "success" },
  ACTIVE: { label: "Active", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  RETIRED: { label: "Retired", tone: "neutral" },
};

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  CRYPTO: "Crypto",
  STABLECOIN: "Stablecoin",
  TOKENIZED_TREASURY: "Tokenized treasury",
  TOKENIZED_EQUITY: "Tokenized equity",
  TOKENIZED_FUND: "Tokenized fund",
  TOKENIZED_BOND: "Tokenized bond",
  TOKENIZED_COMMODITY: "Tokenized commodity",
  TOKENIZED_PRIVATE_CREDIT: "Tokenized private credit",
  TOKENIZED_OTHER: "Tokenized (other)",
};

export const ASSET_REQUIREMENT_LABEL: Record<(typeof ASSET_REQUIREMENT_KEYS)[number], string> = {
  deployment: "Add at least one deployment.",
  deployment_verification: "Every on-chain deployment must match the chain. Re-verify or correct its decimals.",
  deployment_source_url: "Every manually verified deployment needs a source URL.",
  market_price_reference: "Add a market price reference (CoinMarketCap id).",
  issuer: "Choose the issuer.",
  route: "Add at least one execution route.",
  eligibility_rule: "Add at least one eligibility rule.",
};
