<!-- AGENTS.md -->
# AGENTS.md — apps/pos (PayMeDash POS)

Guidance for AI coding agents working on the point-of-sale app of the
`paymedash` monorepo. Monorepo-wide rules are in the root `AGENTS.md`; this file
covers the POS itself.

## App facts

- **Purpose:** Browser-based USD point-of-sale keypad UI. A clerk enters a dollar
  amount, optionally applies a discount and a tip, and presses **Pay Now**.
- **Stack:** Astro `7.3.5` (static site, `output` default) + Tailwind CSS
  `4.3.3` wired through `@tailwindcss/vite`. TypeScript via
  `astro/tsconfigs/strict`. Package manager: pnpm (workspace root
  `pnpm-lock.yaml`; this app has no lockfile of its own).
- **No backend exists in this repo.** The payment API is the separate
  `paymedash-api` Worker (see "Deployed API" below), reached same-origin at
  `/v1`. `POST /v1/invoices` from the legacy engineering handoff does not exist.
- **Crypto is any-asset in, DASH out.** The POS accepts the origin assets listed
  by `GET /v1/assets` and settles DASH to the merchant address.

### Source layout

```text
astro.config.mjs          Astro config; registers the Tailwind Vite plugin
package.json              name "@paymedash/pos", version 25.10.3, MIT
tsconfig.json             extends astro/tsconfigs/strict
public/favicon.svg        site icon
public/manifest.webmanifest  PWA manifest (start_url "/", display standalone)
public/sw.js              minimal service worker: installability + asset cache
public/icon-192.png        PWA icon (192x192)
public/icon-512.png        PWA icon (512x512)
public/icon-maskable-512.png  PWA maskable icon (512x512)
public/apple-touch-icon.png   iOS home-screen icon (180x180)
src/pages/index.astro     page shell + ALL client state (amount/discount/tip)
src/components/
  Display.astro           renders USD amount, total, calculation text
  ModeTabs.astro          Amount / Discount / Tip tabs (Discount & Tip disabled
                          until hasBaseAmount is true)
  ModeContent.astro       per-mode helper content, including the tip preset buttons
  Keypad.astro            0-9 keypad plus Clear and Add buttons
src/lib/config.ts         stored POS config contract (PosConfig, coerceConfig, load/save/clear)
src/lib/config.test.ts    node:test unit tests for the config coercion rules
src/styles/global.css     contains only: @import "tailwindcss";
```

### How the UI works (verified from source)

- `src/pages/index.astro` owns all state in an inline `<script>`: `amountStr`
  (integer **cents**, e.g. `"500"` = `$5.00`), `discountPercent`, `tipPercent`,
  `baseAmount`, `activeMode`, `hasBaseAmount`.
- Components communicate through DOM `CustomEvent`s dispatched on `#pos-app`:
  `stateupdate`, `modechange`, `keypad:input`, `keypad:clear`, `keypad:add`,
  `tip:preset`. Events always use `bubbles: true, composed: true`.
- `Display.astro` divides `amountStr` by 100 to show dollars. Keep this contract:
  `amountStr` is **cents as an integer string** everywhere.
- **The payment method is chosen with buttons, not a `<select>`.**
  `#checkout-popular` shows a fixed set (`POPULAR_ASSET_IDS`) as branded buttons
  and `#checkout-asset-search` filters the rest on label, ticker or chain id
  into `#checkout-asset-results`. The chosen id lives in the `checkoutAssetId`
  script variable; no DOM element holds it, so read that variable rather than
  an element value. Each asset gets an inline SVG mark from `assetIcon()`,
  keyed by `BRAND_COLORS` with a monogram fallback for unknown chains.
- **The QR code is rendered locally** with the `qrcode` dependency onto
  `#checkout-qr`, above `#checkout-deposit`. The payload is a payment URI for
  chains with a scheme and the bare address otherwise. The scheme map is keyed
  on 1Click's short chain codes (`btc`, `eth`, `sol`, `base`, `arb`, `op`),
  **not** full names — EVM chains all use `ethereum`. No third-party image
  service is ever contacted.
- `#checkout-amount-symbol` carries the origin ticker beside the amount, which
  comes from `originSymbol` on the quote response. `renderQuote()` labels the
  figure so the coin and the chain-specific address below cannot be confused.
- `"Quote signature verified"` is **not** rendered. Verification still runs
  server-side on every quote and a failure is returned as an error; the boolean
  is only an internal signal and a customer cannot act on it.
- The Pay Now button is disabled until `total > 0`, and also while `total` is
  below the measured minimum (`lowestMinimumUsd`). Below the minimum the button
  reads `Below minimum $X.XX`, and the click handler repeats the check so the
  rule holds even if the button state is stale.
- **The minimum is measured, not published.** 1Click exposes no limits or
  minimum endpoint (verified: its OpenAPI paths are `/v0/tokens`, `/v0/quote`,
  `/v0/status`, `/v0/deposit/submit`, `/v0/orders`, `/v0/generate-intent`,
  `/v0/submit-intent`, `/v0/any-input/withdrawals`, `/v0/auth/*`) and the token
  list carries no minimum field. The only source is the refusal message
  `Amount is too low for bridge, try at least <N>`, where `N` is in
  **destination base units (DASH duff)**. `GET /v1/minimum` probes every route
  with `dry: true` and reports the **lowest** floor plus every asset that
  reaches it, because a sale is payable when any one accepted asset can cover
  it. `dry: true` is documented to simulate a quote "without generating a
  deposit address or initiating the swap process", so probing creates no
  addresses; it does still validate `recipient`, which is why a valid DASH
  address is always sent.
- **Floors measured live**: `1000000` duff for sol, eth, usdc-eth, usdt-eth,
  usdc-sol, ltc, doge, eth-base, usdc-base, usdc-arb, usdc-op, usdc-avax;
  `8572595` for btc; `4914854` for xrp. `dai-eth` ("No liquidity available"),
  `usdc-pol` and `usdt-tron` ("Temporary swap limits") are unusable.
- **A missing figure is `null`, never `0`.** A `$0.00` minimum reads as
  "anything is accepted" and disables the very warning it exists to give.
- The Pay Now enabled state is driven by `updateDOM()`, which is why
  `loadMinimum()` calls it after the figure arrives.
- The Discount and Tip tabs are enabled from `total` (plus any applied discount
  or tip), **not** `hasBaseAmount`. Gating on `hasBaseAmount` locked the tabs
  for a clerk who typed the whole sale on the display — the same bug that was
  fixed for Pay Now. A 100% discount zeroes the total, so an applied discount or
  tip also counts as a sale in progress.
- `calculateTotal()` = `(baseAmount + amountStr/100) * (1 - discount/100) * (1 + tip/100)`.
  `baseAmount` holds the running subtotal accumulated with the `+` key, and
  `amountStr` is the amount currently on the display. Both must be summed: a
  version that read only `amountStr` made `+` a one-way trip that zeroed the
  total and disabled Pay Now permanently. `Display.astro` renders the same sum,
  so keep the two in step.

## Commands

From the **monorepo root**:

```sh
pnpm install                            # install the whole workspace
pnpm --filter @paymedash/pos dev        # astro dev, http://localhost:4321
pnpm --filter @paymedash/pos build      # astro build -> apps/pos/dist/
pnpm --filter @paymedash/pos preview    # preview the production build
pnpm --filter @paymedash/pos check      # astro check (types)
pnpm --filter @paymedash/pos test       # node --test src/lib/*.test.ts
```

## Conventions

- Match the existing 4-space indentation in `.astro` files.
- Keep money as integers where possible (`amountStr` cents); never introduce
  floating-point dollars into state.
- Preserve the `stateupdate` event payload contract; components depend on it.
- The UI is USD-denominated (`Display.astro` hardcodes the `USD` label).

## Gotchas for agents

- **Do not `read` binary assets** (`public/favicon.svg` and any future images,
  PDFs, archives). Verify them with `ls -la`, `file`, or `du` instead. Loading a
  large binary inflates the context window.
- `src/styles/global.css` intentionally contains only the Tailwind import; do
  not add global rules without reason.
- `src/pages/index.astro` holds the single source of truth for POS state. When
  extending behavior (for example a payment/charge flow), route new state
  through `updateDOM()` rather than adding parallel state holders.

## PWA / installability

The terminal is installable as a standalone app.

- `start_url` is **`/`**, the payment terminal, not `/admin`. An installed app is
  the point of sale.
- `public/sw.js` is a **minimal** service worker. It exists to satisfy the
  browser's install criteria, to cache the content-hashed `/_astro` assets, and
  for nothing else. It is deliberately **not** an offline cache.
- **Never cache `/v1`.** A cached quote, price, or swap status would show the
  clerk a stale amount or an already-settled sale. The worker returns before
  handling any `/v1` request so the network answers and can fail visibly.
- Navigations are network-first, so a deploy cannot leave a client running HTML
  that points at deleted bundles. Only `/_astro` and static file extensions are
  cache-first.
- `beforeinstallprompt` is **Chromium-only**. iOS Safari has no programmatic
  install, so `/admin` shows share-sheet steps instead of a button that cannot
  act. Do not claim a button can install on iOS.
- Registration happens on `/`, not `/admin`, because `start_url` is `/`.

## Integration context: NEAR Intents (for planned any-crypto payments)

The `ANY-crypto -> DASH` POS feature **is implemented and live** as of
2026-09-25. The POS Charge flow calls the `paymedash-api` Worker (see
"Deployed API" below). The following facts were verified live from the NEAR
Intents documentation and API on 2026-09-25 and must be used instead of the
figures in the legacy engineering handoff, which contained several errors.

### Deployed API

The checkout is served by the `paymedash-api` Worker, which is routed at `/v1`
on this zone and on `paymedash.com`, in front of the static Pages site.

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/health` | Liveness, destination asset, `partnerKeyPresent` |
| `GET /v1/assets` | Origin chains the POS can accept |
| `GET /v1/price` | DASH spot price in USD, read from the 1Click token list |
| `GET /v1/minimum` | Lowest payable amount across routes, in DASH and USD, with the assets that reach it |
| `POST /v1/quote` | Create an `EXACT_OUTPUT` swap paying out to a DASH address |
| `GET /v1/status` | Track a swap by deposit address (and memo) |
| `GET /v1/docs`, `/v1/redoc`, `/v1/openapi.json` | Generated API browser and spec |

- Source: a separate, private repository. It is not part of this monorepo and
  cannot be deployed from here.
- The partner JWT lives in a Cloudflare Secrets Store binding on the Worker.
  It is never sent to the browser and never committed to this repository. Do
  not add it to any tracked file; the POS has no need for it.
- `partnerKeyPresent: true` from `/v1/health` and `authenticated: true` on a
  quote are the observable proof that the binding resolves.
- `/admin` **is deployed** at `https://pos.paymedash.com/admin`. It is marked
  `noindex, nofollow` and is not linked from the POS, but it is publicly
  reachable, so **no secret may ever be entered into it**. It stores display
  settings and the merchant payout address in localStorage, which is
  device-local, not shared between devices, and not authoritative.
- **The partner JWT is never in this repository or in the browser.** It is a
  Cloudflare Secrets Store binding on the Worker. `/admin` shows only a boolean
  read from `GET /v1/health`. Do not add a field that accepts it.
- **The payout address is supplied by the merchant, never by this project.**
  The API holds no address of its own: `destinationAddress` is **required** on
  every quote, is validated as a Dash mainnet address before any upstream call,
  and is refused with a 400 when absent or malformed. The only place it is
  stored is the device-local `/admin` setting. There is deliberately no
  server-side variable for it, so one deployment cannot become the payout
  target for every terminal using the API.
- **There is no `terminalReady` field on `GET /v1/health`.** The Worker cannot
  know whether a given terminal has an address, so it does not claim to. The POS
  drives the setup prompt from its own local setting alone.
- Refunds default to NEAR Intents to `REFUND_NEAR_ACCOUNT`
  (`sansbank-dao.near`); 1Click requires `refundTo` to be non-empty for every
  quote. A quote that carries a `refundAddress` refunds on the origin chain
  instead.

### What NEAR Intents is, and which surface to integrate

- **NEAR Intents is the protocol.** It defines *intents* ("I have X, I want Y"),
  with market makers (solvers) competing to fulfill them, and atomic on-chain
  settlement via the `intents.near` Verifier contract.
- **1Click Swap API is the REST distribution channel for NEAR Intents** — the
  production integration surface for a POS. Per the official docs: *"1Click Swap
  is a REST API that automates routing and settlement on NEAR Intents."* If asked
  to "integrate NEAR Intents", the correct layer is the 1Click API; the
  lower-level **Message Bus** (solver JSON-RPC/WebSocket) and **Verifier
  contract** are protocol internals that a POS does not need.
- Docs index: `https://docs.near-intents.org/llms.txt`
  Full text: `https://docs.near-intents.org/llms-full.txt`
  OpenAPI: `https://1click.chaindefuser.com/docs/v0/openapi.yaml`

### Verified API facts

| Fact | Value |
| --- | --- |
| Base URL | `https://1click.chaindefuser.com` |
| Tokens | `GET /v0/tokens` (live; 197 assets at time of check) |
| Quote | `POST /v0/quote` — returns **HTTP 201** on success (not 200) |
| Status | `GET /v0/status?depositAddress=...` (add `depositMemo` if `depositMode` = `MEMO`) |
| Optional deposit hint | `POST /v0/deposit/submit` with `{depositAddress, txHash}` |
| Quote identity | **There is no `quoteId`.** Track a swap by its `depositAddress` (and `depositMemo`). |
| Auth | Optional JWT via `X-API-Key` (or `Authorization: Bearer`). Unauthenticated adds **0.25%**. |
| Unauthenticated rate limit | **1200 requests / 60s (20 RPS)** — observed via `x-ratelimit-limit-unauth` header, not ~5 RPS. |
| DASH asset id | `nep141:dash.omft.near` (decimals 8). Dash is supported on the Bitcoin & Forks tab. |
| Dash treasury address | `XxA9DbXaFpF4GFY8KUNX7eAxhZPsWtcKhc` |

**Required `/v0/quote` fields** (missing any returns HTTP 400):
`dry` (boolean), `swapType`, `originAsset`, `destinationAsset`, `amount`
(integer string, base units), `depositType`, `recipient`, `recipientType`,
`refundTo`, `refundType`, `deadline` (ISO-8601).

**Response fields used for pricing/timing:** `amountIn`, `amountInFormatted`,
`amountInUsd`, `minAmountIn`, `amountOut`, `amountOutFormatted`, `amountOutUsd`,
`minAmountOut`, `timeEstimate` (seconds), `depositAddress`, `depositMode`,
`depositMemo`, `deadline` (ISO-8601), `refundFee`, `withdrawFee`.

- `amountOut` is in **base units** (e.g. duff for DASH). There is no `minAmount`
  or `maxAmount` field; the minimum is `minAmountIn`.
- Every quote payload carries `signature` + `timestamp`. Verify with
  `verifyQuoteSignature()` from `@defuse-protocol/one-click-sdk-typescript`
  (>= 0.1.24): signed message is
  `stringify({ ...quoteRequest, ...quoteResponse, timestamp })`, SHA-256, Base58.

### Status values (`GET /v0/status`)

`KNOWN_DEPOSIT_TX`, `PENDING_DEPOSIT`, `INCOMPLETE_DEPOSIT`, `PROCESSING`,
`SUCCESS`, `REFUNDED`, `FAILED`.

### Refunds are automatic — there is no refund endpoint

- `POST /v0/refund` **does not exist**. Refunds go to the `refundTo` address
  captured at quote time. Underpayment below `amountIn`/`minAmountIn` is refunded
  by the `deadline`; overpayment is swapped and the excess refunded.
- `EXACT_INPUT`: below `amountIn` -> refunded; above `amountIn` -> excess refunded.
- `EXACT_OUTPUT`: below `minAmountIn` -> refunded; above `amountIn` -> excess refunded.
- `FLEX_INPUT`: accepted within a slippage band on both sides; below `minAmountIn`
  refunded after deadline.
- `ANY_INPUT`: deposit-and-sweep, authorized partners only, ~$1,000 USD sweep
  threshold, never refunds (retries), `appFees` not allowed.

### Fees (verified)

- Protocol fee: **0.0001% (1 pip)**, on-chain.
- Unauthenticated 1Click: **+0.25%** on non-`ANY_INPUT` quotes.
- Authenticated with no `appFees`: **0.20%**, or **0.01%** on stablecoin /
  same-asset multichain routes.
- Authenticated with `appFees`: 50/50 split, 1Click keeps >= 20 bps (>= 1 bp for
  stablecoins); combined total capped at **500 bps (5%)**.

### Operational caveats that break POS assumptions

- **No testnet exists for NEAR Intents.** Test on mainnet with small amounts.
- **`$1,000` minimum on nine chains** (temporary, from 2026-09-09): BSC, Polygon,
  TON, Optimism, Avalanche, Stellar, Monad, XLayer, ADI. **Dash is not on that
  list**, but re-check `https://docs.near-intents.org/changelog/overview` before
  shipping.
- **Tron** has a separate temporary `$100` minimum.
- **No InstantSend here.** InstantSend is a Dash-network mechanism and is absent
  from NEAR Intents docs. `GET /v0/status` reports when tokens are delivered to
  the merchant DASH address; InstantSend detection requires a Dash node/Insight
  layer in a separate `watcher` component.
- **Compliance screening runs on non-dry quotes** (TRM Labs and others). A swap
  can be delayed or blocked; design a graceful degradation path.

## Citable protocol claims (do not restate unsourced figures)

Do not repeat the legacy handoff's stale claims. Specifically:

- Wrong: `https://api.1inch.dev/swap/v6.1/1/quote` — that is the unrelated **1inch**
  (EVM DEX aggregator) API, not NEAR Intents.
- Wrong: "`/v0/refund` on 1Click" — no such endpoint.
- Wrong: `quoteId` on a quote — track by `depositAddress`.
- Wrong: "~5 RPS" — observed limit is 20 RPS unauthenticated.
- Wrong: `duwei` for DASH — the DASH base unit is the **duff** (1 DASH = 1e8 duff).
- Do not cite the Dash blog post "Dash Is Live on NEAR Intents". Its URL could
  never be located, so it must not be restated. DASH support is confirmed live
  by `GET /v0/tokens` and by real quotes, which is the evidence to cite instead.
- Do not cite a Maya Protocol status or a "Dash on Maya since 2023" date. No
  source was ever retrieved for either, and `midgard.ninerealms.com` no longer
  resolves (`midgard.mayachain.info` returns 404), so the claim is neither
  verifiable nor needed: the integration runs on 1Click.
