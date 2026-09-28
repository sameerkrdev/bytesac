# Context Management for Coding Agents

## Purpose
Keep project context durable, discoverable and synchronized with implementation. Conversation history is not a substitute for repository documentation.

## Required read protocol
At the beginning of every task:
1. Read `AGENTS.md`.
2. Read `docs/README.md`.
3. Read `docs/architecture/ARCHITECTURE.md`.
4. Read the domain specifications related to the task.
5. Read the decision register and relevant ADRs.
6. Inspect the actual repository `/docs` tree and read applicable additional documents.
7. Inspect code, tests and migrations before proposing changes.

For a narrow task, read the relevant sections in depth, but first inspect the document headings and determine whether cross-domain dependencies apply. For auth, for example, also inspect manager onboarding and permission requirements. For execution, also inspect asset registry, portfolio, pricing and authority decisions.

## Context source hierarchy
- User's latest explicit decisions.
- Accepted ADRs and decision register.
- Current domain specifications.
- Existing code/tests for implemented behavior.
- Proposals clearly labeled as such.
- Current official provider documentation for external capabilities.

When two sources disagree, do not silently pick one. Record the discrepancy, explain impact and ask for a decision when it changes product or financial behavior.

## Change protocol
For each implementation task:
1. Write a short task plan and list relevant docs.
2. Identify domain invariants and acceptance criteria.
3. Make the smallest coherent code change.
4. Add/update tests.
5. Update the relevant domain document.
6. Update decision register or add an ADR if a decision changed.
7. Verify that docs and code do not contradict each other.
8. Report actual checks and unresolved issues.

## Decision records
Use `docs/decisions/ADR-TEMPLATE.md` for material choices. Keep the decision register current:
- `APPROVED`: explicitly accepted.
- `PROPOSED`: recommended but not locked.
- `OPEN`: needs a decision.
- `SUPERSEDED`: replaced; retain a link to the replacement.

Do not turn a proposed design into an approved fact merely because it appears in an architecture document.

## Keeping context concise
- Keep `docs/README.md` as a short index.
- Put stable architecture in architecture docs.
- Put detailed product behavior in domain specs.
- Put implementation-specific details next to the code when they change frequently.
- Link instead of copying large sections.
- Preserve rationale and consequences for decisions.
- Remove stale duplicated guidance only after migrating its meaning to the authoritative document.
