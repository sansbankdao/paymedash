<!-- apps/web/README.md -->
# PayMeDash

The PayMeDash landing page, built with [Astro](https://astro.build) and
[Tailwind CSS](https://tailwindcss.com), maintained by Sansbank DAO.

- Live at: <https://paymedash.com> (apex) and <https://www.paymedash.com>
- Deployed as: the `paymedash-web` Cloudflare Pages project

This is a fully static site: no adapter, no server routes, nothing that reads
a request header. That is why it is a separate app from the storefront — the
apex is a different host with no per-request logic. It never needs to be
rebuilt when the storefront changes.

The page embeds the live demo storefront from `demo.paymedash.com` in an
iframe. The Content-Security-Policy in `public/_headers` authorizes that frame
with `frame-src`, so if the demo host ever changes, update the policy in the
same commit.

## 🚀 Project Structure

The project is organized as follows:

```text
/
├── public/
│   ├── _headers                    Cloudflare security headers + cache rules
│   └── favicon.svg
├── src
│   ├── layouts
│   │   └── Layout.astro
│   ├── pages
│   │   └── index.astro             the landing page (embeds the demo)
│   └── styles
│       └── global.css
└── package.json
```

`Layout.astro` and `global.css` are duplicated per app on purpose: the apps
must stay independently deployable. Do not extract them into a shared package
without deciding that trade-off explicitly.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `pnpm install`            | Installs dependencies                            |
| `pnpm dev`                | Starts local dev server at `localhost:4321`      |
| `pnpm build`              | Build your production site to `./dist/`          |
| `pnpm preview`            | Preview your build locally, before deploying     |
| `pnpm check`              | Runs `astro check` for type and content errors   |
| `pnpm audit`              | Scans dependencies for known vulnerabilities     |
| `pnpm astro ...`          | Run CLI commands like `astro add`, `astro check` |
| `pnpm astro -- --help`    | Get help using the Astro CLI                     |

## 🧾 License

Released under the MIT License. See [LICENSE](../../LICENSE) at the repository
root.

Copyright (c) 2025 Sansbank DAO.
