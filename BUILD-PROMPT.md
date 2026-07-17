# BUILD PROMPT — Stock Reconciliation System (Skincare Brand Indonesia)

Copy everything below this line into your coding agent (Claude Code / Cursor / etc.).

---

## ROLE & GOAL

You are a senior full-stack engineer. Build a **standalone stock recording & reconciliation system** for an Indonesian skincare brand (~70 SKUs, produced via maklon/contract manufacturer, selling on Shopee and TikTok Shop, hundreds of packages/day, significant returns).

**Core principle: no stock number ever changes without a trace.** Every movement flows through ONE append-only Stock Ledger. Every discrepancy must be drillable down to its root cause. This is NOT a CRUD app — it is a forensic audit system for inventory.

## MANDATORY STACK (per client brief — non-negotiable)

- **Next.js 14+ (App Router) + TypeScript** — frontend AND backend (API routes / server actions). Do NOT add a separate Express server; Next.js handles it all.
- **Supabase (Postgres)** — database, auth, and storage.
- **Tailwind CSS + shadcn/ui** — UI components, data tables, forms.
- **Recharts** — dashboard charts (stock trends, discrepancy trends, top-moving SKUs).
- **Deploy to Vercel** (free tier) + Supabase (free tier). Submission must be a LIVE working URL.

Optional/only if needed: `xlsx`/`papaparse` for file import, `date-fns` for dates. Skip barcode scanning and react-pdf in phase 1 — not in the brief scope.

**Auth:** single role only — **Admin**. Use Supabase Auth email/password. One seeded admin account. No RBAC, no NextAuth needed.

**No pricing/money anywhere.** The system counts units only.

## THE PROBLEM YOU ARE SOLVING (and the required solution for each)

The client's spreadsheet stock never matches physical warehouse stock, and nobody can explain WHERE the difference leaks. Each known leak point must have an explicit mechanism:

1. **Cancelled orders** — stock deducted at shipment, order later cancelled, stock never restored on paper.
   → Solution: orders are only *reservations* until shipped. Physical deduction happens at Shopee `SHIPPED` / TikTok `IN_TRANSIT`. A cancellation after shipping creates a pending return record; a cancellation before shipping just releases the reservation. Both leave ledger/audit entries.

2. **Returns with different fates** — some come back sellable, some damaged, some lost by courier.
   → Solution: every return starts as `IN_TRANSIT_BACK`. Warehouse manually inspects and sets condition: `SELLABLE` (ledger: return-in to sellable stock), `DAMAGED` (ledger: return-in to damaged/quarantine, never sellable), or `LOST` (ledger: write-off with reason `lost_in_transit`). A return that stays uninspected too long appears on the anomaly worklist. **TikTok claim reminder: alert when a lost/undelivered TikTok return approaches the 40-day claim deadline** (show days remaining, escalating urgency).

3. **Bonus, promo, samples (biggest leak)** — goods leave the warehouse tied to no order, so they were invisible.
   → Solution: dedicated manual outbound flow with mandatory **reason** (`offline_sale`, `bonus`, `promo`, `sample`, `damaged`, `expired`) — reason and channel are SEPARATE fields and must never be conflated (offline sale and bonus are both manual channel but mean different things). Every manual outbound writes a ledger entry with reason, channel, note, and operator.

4. **Estimated initial stock** — discrepancy exists before selling even starts.
   → Solution: initial stock is entered as an explicit `OPNAME/INITIAL_COUNT` ledger event per product per batch, flagged as "baseline", so later discrepancies are measured against a known, dated starting point. Support importing the client's existing spreadsheet (columns: product name, sisa stok/current stock) via CSV/XLSX import.

## CORE DATA MODEL (Postgres via Supabase)

Design around an **append-only ledger**. Suggested tables (refine as needed, but keep the ledger immutable):

- `products` — id, sku, name, is_active.
- `bundles` + `bundle_items` — admin-defined recipes; marketplace bundle listings explode into unit products at ingestion. **There is no bundle stock.**
- `batches` — id, product_id, batch_code, expiry_date, received_at, source (maklon). Stock is tracked per batch.
- `stock_ledger` — **append-only, the heart of the system**: id, created_at, product_id, batch_id, qty_delta (+/-), movement_type (`INBOUND_MAKLON`, `SALE_OUT`, `MANUAL_OUT`, `RETURN_IN`, `CANCEL_RELEASE`, `ADJUSTMENT_OPNAME`, `WRITE_OFF`, ...), reason, channel (`shopee`, `tiktok`, `offline`, `internal`), ref_type + ref_id (order/return/opname linkage), stock_state (`SELLABLE`, `DAMAGED`, `QUARANTINE`), operator, note. **No UPDATE or DELETE ever** — corrections are new reversing entries. Enforce with Postgres trigger or RLS.
- `orders` + `order_items` — marketplace_order_id, channel, status timeline (`CREATED` → `SHIPPED`/`IN_TRANSIT` → `DELIVERED` / `CANCELLED` / `RETURN_REQUESTED`), raw payload stored for traceability.
- `reservations` — created at order creation, released on cancel, converted to ledger `SALE_OUT` on ship. Available stock = on-hand (ledger sum) − active reservations.
- `returns` — order ref, channel, status, received_condition (null until inspected), inspected_by/at, tiktok claim deadline date.
- `opname_sessions` + `opname_counts` — physical count per product/batch vs system count, variance, resulting adjustment ledger entries (requiring a reason).
- `anomalies` — daily-generated worklist: type, severity, linked records, status (`OPEN`/`INVESTIGATING`/`RESOLVED`), resolution note.

**FEFO batch allocation:** operators NEVER pick batches. Every outbound automatically allocates from the batch with the nearest expiry that has stock, splitting across batches when needed. Allocation is recorded per batch in the ledger.

## FEATURE SCOPE (all required)

1. **Product & batch management** — CRUD products, bundle recipes, batches with expiry.
2. **Stock ledger view** — filterable/searchable full movement history; from any stock number, click through to the exact entries that produced it.
3. **Inbound from maklon** — receive goods: product, qty, batch code, expiry → ledger.
4. **Manual outbound** — reason + channel + qty; FEFO allocated; ledger entries.
5. **Marketplace order ingestion** — orders, cancellations, returns from Shopee & TikTok Shop. **No real API integration.** Instead:
   - **Simulation buttons**: a "Simulator" page with buttons that inject realistic dummy events — new order (single & bundle items), order shipped, cancelled before ship, cancelled after ship, return created, return received. Architect this behind an **adapter interface** (e.g. `MarketplaceEventSource`) so real Shopee/TikTok APIs can later replace the simulator WITHOUT touching core logic. Simulated events go through the exact same ingestion pipeline.
   - **File import** (CSV/XLSX) as a second ingestion path: order exports and initial stock.
6. **Return handling** — inspection queue, condition decision (sellable/damaged/lost), TikTok 40-day claim reminders.
7. **Expiry notifications** — per batch: warning tiers (e.g. ≤90/≤30 days, expired), surfaced on dashboard.
8. **Stock opname** — create session, enter physical counts (fast keyboard-friendly entry per product/batch), auto-compare vs system, show variance, post corrections as ledger adjustments with reasons.
9. **Reconciliation — two rhythms:**
   - **Daily**: automated self-consistency checks producing an anomaly worklist — e.g. negative stock, orders shipped but never delivered/returned past threshold, returns uninspected > X days, cancellations without stock restoration, reservation leaks, TikTok claims nearing deadline.
   - **Opname**: system count vs physical count comparison with drill-down.
   - **Drill-down everywhere**: any discrepancy → contributing movements → source document. This is evaluation criterion #1.
10. **Dashboard** — current stock per product (sellable vs damaged vs reserved), open anomalies count, expiring batches, top movers (Recharts), recent movements.

## UX REQUIREMENTS

- Users are **warehouse operators, not developers**: Bahasa Indonesia UI labels, big obvious buttons, minimal typing, sensible defaults, confirmation summaries before posting movements, mobile-friendly (opname often done on phone in the warehouse).
- Every list = shadcn data table with search/filter/sort.
- Seed data: ~70 realistic skincare products (Aura Hydrogel Mask, Body Mask Pink, DNA Salmon, Laxloss New, Peel of Masker, Sabun Doosting Bar, etc.), multiple batches with staggered expiries, sample orders/returns, and one opname session — so the live demo tells the whole story immediately.

## BUILD ORDER

1. Supabase schema + immutability trigger on ledger + seed script.
2. Ledger engine: posting functions (inbound, FEFO outbound, return-in, adjustment) as pure, unit-tested TypeScript in one module — all writes go through it.
3. Order ingestion pipeline + reservation lifecycle + bundle explosion.
4. Simulator page (adapter pattern) + file import.
5. Returns + opname + daily anomaly job (Vercel cron or on-demand "Run daily check" button).
6. Dashboard + drill-down UI + polish.
7. Deploy to Vercel, verify all flows live, write README (setup, env vars, design decisions & WHY — especially how each leak point in the problem section is closed).

## ACCEPTANCE TESTS (must pass on the live site)

- Simulate order → stock reserved, not deducted. Simulate ship → ledger SALE_OUT with FEFO batch. Cancel before ship → reservation released, no phantom deduction. Cancel after ship → pending return appears.
- Return marked damaged → sellable stock unchanged, damaged stock +1, fully traced.
- Manual out "bonus" vs "offline sale" recorded distinctly and filterable.
- Bundle order of "2× Paket Glowing" explodes into unit products per recipe.
- Opname with a deliberate mismatch → variance shown → drill-down reveals contributing movements → correction posted as adjustment, never an edit.
- Ledger rows cannot be updated/deleted (verify trigger).
- Sum of ledger per product/batch always equals displayed stock.

Judging priority: (1) correct stock logic & traceable discrepancies, (2) feature completeness, (3) warehouse-operator usability, (4) code & deploy quality.
