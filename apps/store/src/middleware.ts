// src/middleware.ts
//
// Proxy the Pages-hosted subdomains (`www`, `pos`) to their real origins.
//
// WHY MIDDLEWARE AND NOT THE PAGE
// `src/pages/index.astro` only matches `/`. A Pages site is more than its
// index: the HTML references `/_astro/...` bundles and a `/manifest.webmanifest`,
// and those arrive as separate requests that never reach the page. Proxying
// from the page therefore served an index whose every asset 404'd --
// `pos.paymedash.com/_astro/...` and `pos.paymedash.com/manifest.webmanifest`
// returned 404 while the same paths on `paymedash-pos.pages.dev` returned 200.
// Measured, not assumed.
//
// Middleware runs for all paths, so this is where the forward belongs. The
// logic itself lives in `lib/pages-proxy.ts` so it can be unit tested without
// an Astro runtime; this file is the call site.
//
// This middleware is a no-op for every host that is NOT a proxied Pages host,
// so the storefront routes are untouched: `defineMiddleware` still calls
// `next()` and Astro renders the page as before.

import { defineMiddleware } from 'astro:middleware'

import { pagesProxyOriginFor, proxyToPages } from './lib/pages-proxy'

export const onRequest = defineMiddleware(async (context, next) => {
    const hostname = context.request.headers.get('host') ?? ''

    /* Not a proxied host: fall through to the storefront route unchanged. */
    if (pagesProxyOriginFor(hostname) === null) return next()

    return proxyToPages(context.request, pagesProxyOriginFor(hostname) as string)
})
