<!-- apps/store/README.md -->
# Homemade Crypto

The PayMeDash storefront: a demo shop and every merchant's hosted shop, built
with [Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com),
maintained by Sansbank DAO.

This app is served from the root of every `*.paymedash.com` host:

- Storefront demo: <https://demo.paymedash.com>
- Hosted storefront: `https://<username>.paymedash.com` — resolves a Dash
  Platform username to that identity's store

It is one Astro build behind a Cloudflare Worker that reads the request `Host`
header, so the demo cannot drift from what the landing page advertises.

## 🚀 Project Structure

The project is organized as follows:

```text
/
├── public/
│   ├── _headers                    Cloudflare security headers + cache rules
│   └── favicon.svg
├── src
│   ├── components
│   │   ├── ProductCard.astro
│   │   ├── Storefront.astro
│   │   └── StoreNotFound.astro
│   ├── data
│   │   └── products.ts             the demo fixture products
│   ├── layouts
│   │   └── Layout.astro
│   ├── lib
│   │   ├── address.ts              Dash address classification (L1 / L2 / shielded)
│   │   ├── address.test.ts
│   │   ├── cart.ts
│   │   ├── cart.test.ts
│   │   ├── create-store.ts         client half of "Create a Store" (never signs)
│   │   ├── create-store.test.ts
│   │   ├── identifier.ts           Dash Platform Identifier validation
│   │   ├── identifier.test.ts
│   │   ├── pages-proxy.ts          the www/pos Pages origin map + forwarding
│   │   ├── store-api.ts            client for the paymedash-api store + items resolver
│   │   ├── store-api.test.ts
│   │   ├── store-host.ts           hostname -> DPNS label parsing/validation
│   │   └── store-host.test.ts
│   ├── middleware.ts               proxies the www/pos hosts; no-op otherwise
│   ├── pages
│   │   ├── index.astro             the storefront (SSR), chosen by Host
│   │   └── create-store.astro      the "Create a Store" form
│   ├── styles
│   │   └── global.css
│   ├── env.d.ts
│   └── types.ts
└── package.json
```

`/` is the storefront and `<username>.paymedash.com/` is a merchant's hosted
storefront; both are the same server-rendered route, which is why `index.astro`
is not prerendered. `create-store.astro` publishes a new store document.

Product data for the demo lives in `src/data/products.ts`. The shared `Product`
type is defined once in `src/types.ts` and imported wherever it is needed.

See `AGENTS.md` for the dispatch rules and the deploy procedure.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `pnpm install`            | Installs dependencies                            |
| `pnpm dev`                | Starts local dev server at `localhost:4321`      |
| `pnpm build`              | Build your production site to `./dist/`          |
| `pnpm preview`            | Preview your build locally, before deploying     |
| `pnpm check`              | Runs `astro check` for type and content errors   |
| `pnpm test`               | Runs the unit tests                              |
| `pnpm audit`              | Scans dependencies for known vulnerabilities     |
| `pnpm astro ...`          | Run CLI commands like `astro add`, `astro check` |
| `pnpm astro -- --help`    | Get help using the Astro CLI                     |

## 🧾 License

Released under the MIT License. See [LICENSE](./LICENSE).

Copyright (c) 2025 Sansbank DAO.
