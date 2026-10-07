<!-- AGENTS.md -->
# AGENTS.md — paymedash (monorepo)

Guidance for AI coding agents working in this repository.

## Repository facts

- **Purpose:** the PayMeDash front ends. One landing page, one storefront
  Worker that serves both the demo and every merchant's hosted shop, and one
  point of sale.
- **Layout:** pnpm workspace, `apps/*`, on branch `master`.
- **Package manager:** pnpm `10.15.0`, pinned in `packageManager`. The single
  root `pnpm-lock.yaml` is the only lockfile. Do not add another.
- **Node:** `>=22.12.0` (`.nvmrc`). Astro 7 requires it.
- **License:** MIT.

### The apps

```text
apps/web     static landing page, apex only. No adapter, no server route.
apps/store   Cloudflare Worker. `/` is server-rendered and reads the Host header.
apps/pos     static point of sale.
```

`apps/store` serves the root of every `*.paymedash.com` host:
`demo.paymedash.com` renders the local fixture in `src/data/products.ts`
without any network call, and `<username>.paymedash.com` resolves a Dash
Platform store through the API. Reserved labels (`www`, `demo`, `pos`) are never
treated as usernames — see `apps/store/src/lib/store-host.ts`.

### How a host is dispatched (measured, not assumed)

The store Worker owns the wildcard route `*.paymedash.com/*`. Cloudflare does
**not** reliably let a more-specific literal route win over a wildcard, so
`www` and `pos` cannot be handled by their own routes while the wildcard is
attached. They are instead **proxied** by this Worker:

- `apps/store/src/middleware.ts` forwards `www` and `pos` to their Pages
  origins and is a no-op for every other host.
- `apps/store/src/lib/pages-proxy.ts` holds the logic and the origin map.

Two constraints keep this correct, and both were established by measurement:

- **The forward must run for every path, not just `/`.** It lives in middleware
  because `src/pages/index.astro` only matches `/`. A Pages site also serves
  `/_astro/...` bundles and `/manifest.webmanifest` as separate requests; when
  the proxy was attached to the page, `pos.paymedash.com/_astro/...` and
  `pos.paymedash.com/manifest.webmanifest` returned 404 while the same paths
  on `paymedash-pos.pages.dev` returned 200.
- **Proxy targets must be the `*.pages.dev` production aliases**, never the
  `paymedash.com` spellings. A fetch to `pos.paymedash.com` would match the
  same wildcard, re-enter this Worker and loop.

### Not in this repository

The API Worker is `sansbankdao/paymedash-api`, a **separate repository**. It is
routed at `/v1/*` on `paymedash.com` and owns DPNS resolution, grovedb proof
verification and store listings. Nothing here can deploy it, and a change to
`/v1` behaviour cannot be made from this repo.

`/v1` and `/v1/` both serve the Swagger UI landing page. They are served, not
redirected: `/v1` is the address a caller types first. `/v1/docs` remains a
working alias. The page is built with chanfana's `getSwaggerUI()` pointed at
`/v1/openapi.json`. Hono's default `strict: true` treats `/v1` and `/v1/` as
different paths, so `/v1/` is answered by a surgical `notFound` handler that
reproduces Hono's own `404 Not Found` for everything else. Do **not** set
`strict: false`: it would relax trailing-slash matching for *every* route and
make `/v1/health/`, `/v1/store/` resolve too.

## Commands (run from the repository root)

```sh
pnpm install
pnpm -r check
pnpm -r test
pnpm -r build
pnpm dev:web | dev:store | dev:pos
```

Target one app with `pnpm --filter @paymedash/<app> <script>`.

## Rules for changes

- **Money is integer cents** internally. A resolved Dash Platform item stores
  cents (`basePrice`); carry that value through rather than recomputing it from
  a dollar display.
- **Never resolve a store by identifier.** Use the DPNS username. Identifiers
  are base58 and case-sensitive, and every HTTP stack lower-cases the `Host`
  header, so an identifier cannot survive a DNS label round trip. The reasoning
  is documented at the top of `apps/store/src/lib/store-host.ts`.
- **The `client:load` warnings in `apps/pos` are pre-existing.** Four Astro
  components are rendered with a hydration directive. Astro warns and the build
  still completes; Astro 7.3.5 does not fail on them. Do not "clean these up"
  as a drive-by — see the POS section below.
- **`Layout.astro` and `global.css` are duplicated per app on purpose.** The
  apps must stay independently deployable. Do not extract them to a shared
  package without deciding that trade-off explicitly.
- **Do not unify dependency versions across apps casually.** `apps/store`,
  `apps/web` and `apps/pos` are all on Astro `^7.3.5` and Tailwind `^4.3.3`.
  Changing one app's Astro major is a migration, not a bump.

### Reserved subdomains

`www`, `demo` and `pos` are reserved in
`apps/store/src/lib/store-host.ts` and must stay that way. `pos` in particular
is reserved because `pos.paymedash.com` is `apps/pos`; without it the store
Worker would try to resolve a merchant literally named `pos`. They stay
reserved *while* being proxied, so `storeNameFromHostname()` returns `null` for
them and they can never be mistaken for merchants.

## Address classification (for the shielded-payment feature)

Addresses are distinguished by their **HRP and a bech32m type byte**, verified
against the platform source and against a from-scratch BIP-350 encoder that
reproduces the repo's own test vectors.

| Kind | Prefix | Discriminator |
| --- | --- | --- |
| Core **L1** | `X…` mainnet, `y…` testnet | base58 version byte |
| Platform **transparent L2** | `dash1k…` / `dash1s…` | bech32m type byte `0xb0` (P2PKH) / `0x80` (P2SH) |
| Platform **shielded L2** | `dash1z…` (`tdash1z…`) | bech32m type byte `0x10`, 43-byte payload |

Key points, all from source:

- **Shielded L2 is `dash1z…`.** `OrchardAddress::ORCHARD_TYPE = 0x10` in
  `platform/packages/rs-dpp/src/address_funds/orchard_address.rs`. Encoding a
  44-byte payload (`0x10 ‖ diversifier(11) ‖ pk_d(32)`) under HRP `dash` yields
  a first data character of `z`.
- **Transparent L2 is `dash1k…` / `dash1s…`.**
  `PlatformAddress::P2PKH_TYPE = 0xb0`, `P2SH_TYPE = 0x80` in
  `address_funds/platform_address.rs`. The repo's own vectors are
  `dash1krma5z3ttj75la4m93xcndna9ullamq9y5e9n5rs` and
  `dash1sppl5xpu70aka8nacc4kj2htflydspzkxch4cad6`.
- **A shared `dash` HRP is not enough to tell the two L2 kinds apart.** The
  type byte and payload length are what differ (21 bytes transparent, 44 bytes
  shielded). Classify on the decoded payload, not on the prefix alone.
- **L2 kinds cannot be told apart by network.** Per DIP-0018 `tdash` covers
  Testnet, Devnet and Regtest; only "mainnet vs not" is decidable from the HRP
  (`PlatformAddress::is_mainnet_bech32m`).

## Shielded payments — capability, from source

The protocol side exists and is complete. The **browser** side is not.

- **Transitions exist** in
  `platform/packages/rs-dpp/src/state_transition/state_transitions/shielded/`:
  `shield_from_asset_lock`, `shield`, `shielded_transfer`, `unshield`,
  `shielded_withdrawal`, `identity_create_from_shielded_pool`.
- **`shield_from_asset_lock` is the L1 → shielded-pool path.** It takes an
  `AssetLockProof` and emits an Orchard bundle;
  `rs-sdk/src/platform/transition/shield_from_asset_lock.rs` broadcasts it.
- **The Orchard bundle is the blocker.** A bundle needs a Halo 2 **proving
  key**. `dpp`'s builder is gated behind the `shielded-client` feature
  (`rs-dpp/Cargo.toml`), whose definition is
  `["state-transition-signing", "dep:grovedb-commitment-tree"]`. That feature
  also gates the `orchard_address` module in `address_funds/mod.rs`
  (`#[cfg(feature = "shielded-client")] mod orchard_address;`). So the whole
  Orchard/Halo 2 dependency tree is opt-in.
- **`wasm-dpp2` does not enable `shielded-client`.** Its `dpp` dependency
  lists `state-transition-signing`, `identity-serialization`, `bls-signatures`,
  `platform-value`, `json-conversion`, `state-transitions` — and nothing else.
  So `OrchardProver`, `build_output_only_bundle` and `ProvingKey` are **not
  compiled into the browser build**. Confirmed by exhaustive search: no wasm
  crate (`wasm-dpp2`, `wasm-sdk`, `wasm-dpp`) mentions `OrchardBundleParams`,
  `OrchardProver`, `ProvingKey` or any bundle-builder symbol.
- **WASM can only take a finished bundle, not make one.**
  `ShieldFromAssetLockTransition` (wasm-dpp2 `src/shielded/`) is a constructor
  that *accepts* `actions`, `anchor`, `proof` and `bindingSignature` as
  arguments. It serializes and broadcasts; it does not prove.
- **Only Rust and `rs-platform-wallet` enable `shielded-client`.** A repo-wide
  grep for `shielded-client` matches exactly three manifests: `rs-dpp`
  (definition), `rs-sdk` (`shielded` feature) and `rs-platform-wallet`
  (`shielded` feature). No wasm, JS or TS crate is among them.
- **The TS SDK has no shielded support at all.** The `dash-platform-sdk`
  v1.4.0 checkout has zero shielded/orchard matches outside its README, which
  lists "shielded transitions support" under **v1.5.x (next)** — i.e. not yet
  shipped. That SDK also predates the newer DAPI shielded RPCs.

**Consequence.** Constructing the proof in the browser is not possible with the
shipped WASM. The proof is produced by a **separate proving service**, the
`wasm-prover` Worker, and returned to the browser as a finished
`OrchardBundleParams`. The browser keeps the asset-lock private key and does the
assembling and broadcasting; the service never sees a spending key, a note, or
an asset-lock private key, and never broadcasts. Do not record a design decision
here as though the browser could prove today.

The proving service is a **separate, private repository**
(`sansbankdao/wasm-prover`), deployed at `https://prover.sansbank.dev`. It is
DAO-wide and was deliberately not named after this project. Nothing in this
repository can deploy it or change its interface.

DAPI **does** expose the shielded read surface, so balances and notes are
fetchable: `getShieldedEncryptedNotes`, `getShieldedAnchors`,
`getMostRecentShieldedAnchor`, `getShieldedPoolState`, `getShieldedNotesCount`,
`getShieldedNullifiers` (`dapi-grpc/protos/platform/v0/platform.proto`).

## Deploy reality

- `apps/web` and `apps/pos` are static; `apps/store` is a Cloudflare Worker
  (`wrangler.jsonc`, name `paymedash-store`).
- `paymedash.com` is the Cloudflare zone for this family.
- The API is deployed from its own repository, not this one.
- **Deploy the store Worker from its build output**, not the source directory:
  `wrangler deploy --config dist/server/wrangler.json` after `astro build`.
- **The store Worker can only reach DAPI by hostname.** A `fetch()` to a bare IP
  is blocked at the edge with Cloudflare error 1003 before it leaves. See
  `paymedash-api`'s `DAPI_URL`.
- **Route ordering cannot be relied on.** Workers routes do not reliably
  prioritise a literal over a wildcard, which is why `www`/`pos` are proxied
  rather than routed.

Per-app guidance lives in `apps/store/AGENTS.md` and `apps/pos/AGENTS.md`.
