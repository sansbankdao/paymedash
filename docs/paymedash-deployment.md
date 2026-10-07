<!-- docs/paymedash-deployment.md -->

# paymedash.com deployment

This document describes the live host family on `paymedash.com`.

## What runs where

| Host | Kind | Project / Worker | Origin |
| --- | --- | --- | --- |
| `paymedash.com` | Pages | `paymedash-web` | `paymedash-web.pages.dev` |
| `www.paymedash.com` | Pages | `paymedash-web` | `paymedash-web.pages.dev` |
| `pos.paymedash.com` | Pages | `paymedash-pos` | `paymedash-pos.pages.dev` |
| `demo.paymedash.com` | Worker | `paymedash-store` | fixture, no network |
| `<username>.paymedash.com` | Worker | `paymedash-store` | DPNS -> store document |
| `paymedash.com/v1`, `/v1/*` | Worker | `paymedash-api` | API |

The `paymedash-store` Worker owns the route `*.paymedash.com/*` and proxies
`www.` and `pos.` to the two Pages origins (`src/lib/pages-proxy.ts`). The apex
is NOT in that wildcard -- it is the landing page, served by `paymedash-web`.

## Why `paymedash-api` has its own config

One wrangler config file defines one Worker, so the API Worker deploys from
`wrangler.paymedash.jsonc`:

    npx wrangler deploy --config wrangler.paymedash.jsonc

## Why the route must be declared in the store config

`wrangler deploy` attaches a route only when the config declares one. The
wildcard DNS record alone is not sufficient -- a Worker with no route receives
no traffic. The pattern is `*.paymedash.com/*` and it deliberately excludes the
apex.

## Deployed versions

| Worker | Version ID |
| --- | --- |
| `paymedash-api` | `b137e9b8-4ddf-4512-ab67-75b537441fdf` |
| `paymedash-store` | `380c8082-e31c-4e38-9c29-9a45ecffd06e` |

`paymedash-store`'s favicon `aria-label` was updated, so the Worker carries a
newer version; the first recorded deploy was
`8d780d6e-0ac5-4886-8107-20b08e71711e`.

## Verified live

- `demo.paymedash.com` -> 200, "Homemade Crypto -- Demo", fixture renders in
  full.
- `pos.paymedash.com` -> 200, "PayMeDash POS"; `/_astro/` and
  `/manifest.webmanifest` return 200 through the proxy. `/admin/`, `/terms/`
  and `/privacy/` -> 200, all titled "PayMeDash".
- `www.paymedash.com` and `paymedash.com` -> 200, "PayMeDash".
- `paymedash.com/v1/shield/quote?amount=0.05` -> 200 with a real quote.
- `paymedash.com/v1/store?name=homemadecrypto` -> 404
  `No identity has registered this name.` The resolver was REACHED via the
  service binding, which is what the binding exists to prove: the failure is a
  real upstream answer, not the HTML-loop the binding prevents.

## Product name

The user-visible product name is **PayMeDash** (commit `7d32608`).

The npm identifiers are `@paymedash/*` with the root workspace package named
`paymedash`. This needs no lockfile change: the lockfile keys
workspace members by PATH, and nothing depends on another package by name, so
`pnpm install --frozen-lockfile` still passes.

The localStorage keys are `paymedash.config.v1` / `paymedash.checkout.v1` and
the service worker cache is `paymedash-static-v1`. The service worker deletes
any cache whose key is not its own on activate, so a stale cache evicts itself.
