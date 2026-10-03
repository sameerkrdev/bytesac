import { sql } from "drizzle-orm";
import { char, index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { eligibilityAction, eligibilityOutcome, executionRoutes, instruments, investorStatus } from "./assets";
import { app } from "./enums";
import { users } from "./identity";
import { operationLegs, operations } from "./execution";

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Append-only (Spec 11): the latest row is current; it expires 365 days after creation. */
export const eligibilityDeclarations = app.table(
  "eligibility_declarations",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    /** ISO 3166-1 alpha-2. */
    country: char("country", { length: 2 }).notNull(),
    investorStatus: investorStatus("investor_status").notNull(),
    attestationVersion: text("attestation_version").notNull(),
    /** Geo signal from the configured edge header at declaration time. */
    ipCountry: char("ip_country", { length: 2 }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("eligibility_declarations_user_idx").on(t.userId, t.createdAt.desc())],
);

/** Append-only audit of every RWA decision at plan and leg quote (sell exclusions have a null leg). */
export const eligibilityDecisions = app.table(
  "eligibility_decisions",
  {
    id: id(),
    operationId: uuid("operation_id").references(() => operations.id),
    legId: uuid("leg_id").references(() => operationLegs.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    instrumentId: uuid("instrument_id").notNull().references(() => instruments.id),
    routeId: uuid("route_id").references(() => executionRoutes.id),
    action: eligibilityAction("action").notNull(),
    outcome: eligibilityOutcome("outcome").notNull(),
    ruleIds: uuid("rule_ids").array().notNull().default(sql`'{}'::uuid[]`),
    declarationId: uuid("declaration_id").references(() => eligibilityDeclarations.id),
    ipCountry: char("ip_country", { length: 2 }),
    evaluatedAt: ts("evaluated_at").notNull().defaultNow(),
  },
  (t) => [index("eligibility_decisions_operation_idx").on(t.operationId), index("eligibility_decisions_user_idx").on(t.userId, t.evaluatedAt)],
);
