<!-- README.md -->
# PayMeDash

One repository for the PayMeDash storefronts and the point of sale.

| App | Directory | Deploys to | What it is |
| --- | --- | --- | --- |
| Landing page | `apps/web` | `paymedash.com` (apex) | Static marketing page |
| Storefront | `apps/store` | `demo.paymedash.com`, `<username>.paymedash.com` | Cloudflare Worker; demo fixture or a resolved Dash Platform store |
| Point of sale | `apps/pos` | `pos.paymedash.com` | Static register UI |

`apps/store` serves the **storefront** from the root of every
`*.paymedash.com` host that is not otherwise reserved. Cloudflare routes that
host family to the one Worker, so:

- `demo.paymedash.com/` renders the built-in demo fixture, with no network
  call.
- `<username>.paymedash.com/` resolves the label to a Dash Platform store and
  renders it, or renders "Store Not Found" with a reason.

The landing page is a separate app because it is a separate host with no
per-request logic; it never needs to read a `Host` header.

## Not in this repository

The API Worker is a separate, private service. It is routed in front of these
sites at `/v1/*` and is what actually resolves DPNS names, verifies grovedb
proofs, and serves store listings. This repository cannot deploy it, and its
source is not public.

## Requirements

- Node `>=22.12.0` (see `.nvmrc`)
- pnpm `10.15.0` (see `packageManager` in `package.json`)

## Getting started

```sh
pnpm install
```

Then, from the repository root:

```sh
pnpm dev:web      # landing page
pnpm dev:store    # storefront Worker
pnpm dev:pos      # point of sale
```

Target one app directly with `pnpm --filter @paymedash/<app> <script>`.

## Verification

```sh
pnpm -r check     # astro check, every app
pnpm -r test      # node --test, every app that has tests
pnpm -r build     # production build, every app
```

CI (`.github/workflows/ci.yml`) runs `install --frozen-lockfile`, then
`check`, `test` and `build` for each app on every push to `master` and every
pull request.

## Layout

```text
apps/web     static landing page (apex)
apps/store   Cloudflare Worker: demo + hosted storefronts
apps/pos     static point of sale
```

Each app is independently deployable. They deliberately do **not** share a UI
package: `Layout.astro` and `global.css` are duplicated per app so that neither
app's build can be broken by a change made for the other.

## Conventions

- **Money is integer cents** everywhere internally. Display formatting is the
  only place a decimal appears.
- Storefront resolution is keyed on a **DPNS username**, not an identifier.
  Identifiers are base58 and therefore case-sensitive, which cannot survive a
  DNS label round trip. See `apps/store/src/lib/store-host.ts` for the full
  reasoning.

## Documentation

- `AGENTS.md` — repository facts, dispatch rules, and the address
  classification table. Per-app guidance lives in `apps/store/AGENTS.md` and
  `apps/pos/AGENTS.md`.
- `docs/paymedash-deployment.md` — the host map and what was deployed where.

## License

MIT — see [LICENSE](./LICENSE).
