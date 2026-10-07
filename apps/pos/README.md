<!-- apps/pos/README.md -->
# PayMeDash POS

The PayMeDash point of sale: a register UI that accepts Dash, built with
[Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com),
maintained by Sansbank DAO.

- Live at: <https://pos.paymedash.com>
- Deployed as: the `paymedash-pos` Cloudflare Pages project
  (served through the store Worker's proxy in production)

This is a fully static installable PWA. It ships a web app manifest, a service
worker (`public/sw.js`, cache `paymedash-static-v1`), and its own icon set. It
calls no server: amounts, currency and settings live on the device.

## 🚀 Project Structure

The project is organized as follows:

```text
/
├── public/
│   ├── favicon.svg                 favicon and PWA icons
│   ├── icon-192.png / icon-512.png / icon-maskable-512.png
│   ├── apple-touch-icon.png
│   ├── manifest.webmanifest
│   └── sw.js                       service worker; evicts foreign caches
├── src
│   ├── components
│   │   ├── Display.astro
│   │   ├── Keypad.astro
│   │   ├── ModeTabs.astro
│   │   └── ModeContent.astro
│   ├── lib
│   │   ├── address.ts              Dash address classification (L1 / L2 / shielded)
│   │   ├── address.test.ts
│   │   ├── config.ts               device settings (localStorage paymedash.config.v1)
│   │   └── config.test.ts
│   ├── pages
│   │   ├── index.astro             the register UI
│   │   ├── admin.astro             settings and device configuration
│   │   ├── privacy.astro
│   │   └── terms.astro
│   └── styles
│       └── global.css
└── package.json
```

`src/lib/address.ts` classifies a pasted address by its **decoded payload**,
never by its string prefix: Core L1 (Base58, version byte), transparent L2
(bech32m `dash1k…`/`dash1s…`), and shielded L2 (bech32m `dash1z…`, 43-byte
payload). A shared `dash` HRP is not enough to tell the two L2 kinds apart.

Settings persist in localStorage under `paymedash.config.v1`, and a checkout
draft under `paymedash.checkout.v1`. The
service worker deletes any cache whose key is not its own on activate.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `pnpm install`            | Installs dependencies                            |
| `pnpm dev`                | Starts local dev server at `localhost:4321`      |
| `pnpm build`              | Build your production site to `./dist/`          |
| `pnpm preview`            | Preview your build locally, before deploying     |
| `pnpm check`              | Runs `astro check` for type and content errors   |
| `pnpm test`               | Runs the unit tests (Node's built-in runner)     |
| `pnpm audit`              | Scans dependencies for known vulnerabilities     |
| `pnpm astro ...`          | Run CLI commands like `astro add`, `astro check` |
| `pnpm astro -- --help`    | Get help using the Astro CLI                     |

See `AGENTS.md` for the architectural constraints before changing anything.

## 🧾 License

Released under the MIT License. See [LICENSE](../../LICENSE) at the repository
root.

Copyright (c) 2025 Sansbank DAO.
