// src/lib/pages-proxy.ts
//
// Proxy the Pages-hosted subdomains through this Worker.
//
// WHY THIS EXISTS
// Username storefronts need the `*.paymedash.com/*` route. So do `www` and
// `pos`, but Cloudflare does NOT let a more specific literal route win over a
// wildcard reliably: attaching the wildcard made `www` and `pos` answer with
// this app's "Store Not Found" instead of the Pages sites. Measured, not
// assumed -- both returned "Store Not Found" until the wildcard was removed.
//
// Rather than give up either the wildcard or the two hostnames, this Worker
// owns the wildcard and FORWARDS `www` and `pos` to their real origins. Every
// `*.paymedash.com` host therefore reaches one script, and this is the only
// place that decides what each host means.
//
// WHY THE ORIGINS ARE `*.pages.dev`
// The origins are the Pages production aliases, addressed as `*.pages.dev`
// rather than as `www.paymedash.com` / `pos.paymedash.com` on purpose:
// fetching the `paymedash.com` spelling would match the same wildcard,
// re-enter this Worker and loop forever.
//
// WHY THIS IS A MODULE AND NOT INLINE IN THE PAGE
// It must run for EVERY path, not just `/`, because a Pages site is more than
// its index: the HTML references `/_astro/...` bundles and a
// `/manifest.webmanifest`, and those are separate requests. A proxy that only
// handled `/` served broken pages -- `pos.paymedash.com/_astro/...` and
// `pos.paymedash.com/manifest.webmanifest` returned 404 while the same paths
// on `paymedash-pos.pages.dev` returned 200. Measured, not assumed.
//
// Astro middleware runs for all paths, and `index.astro` only matches `/`. The
// two therefore cannot share the same call site, so the logic lives here and
// the middleware is its only caller.
//
// `www` and `pos` stay in `RESERVED_SUBDOMAINS` (see `store-host.ts`), so
// `storeNameFromHostname()` returns `null` for them and they can never be
// mistaken for merchants named "www" or "pos" while they are being proxied.

import { STORE_DOMAIN } from './store-host.ts'

/**
 * Hosts this Worker proxies, mapped to the Pages origin that serves them.
 *
 * Both origins were verified 200 before being recorded here:
 *   paymedash-web.pages.dev -> "PayMeDash"
 *   paymedash-pos.pages.dev -> "PayMeDash POS"
 */
export const PAGES_PROXY_ORIGINS: Record<string, string> = {
    [`www.${STORE_DOMAIN}`]: 'https://paymedash-web.pages.dev',
    [`pos.${STORE_DOMAIN}`]: 'https://paymedash-pos.pages.dev',
}

/**
 * Strip a `Host` header down to the bare, lower-cased hostname.
 *
 * Drops a trailing dot (the root label) and any `:port`, so a header such as
 * `pos.paymedash.com:443` still compares. Kept beside `storeNameFromHostname`
 * in spirit: same parsing concern, so the two agree on what a host is.
 */
export function bareHostname(hostname: string): string {
    return hostname.replace(/\.$/, '').split(':')[0].toLowerCase()
}

/**
 * Is this hostname one this Worker should proxy, and to where?
 *
 * @returns the Pages origin to forward to, or `null` when the host is not one
 *          of the proxied Pages hosts and must be handled as a storefront.
 */
export function pagesProxyOriginFor(hostname: string): string | null {
    if (typeof hostname !== 'string') return null

    return PAGES_PROXY_ORIGINS[bareHostname(hostname)] ?? null
}

/**
 * Fetch `request` from `origin`, preserving the path and query.
 *
 * The `Host` header is NOT forwarded: the upstream Pages project must see its
 * own hostname, or it would apply the wrong custom-domain logic and could loop
 * back here. `redirect: 'manual'` keeps the upstream's own redirects (a
 * Pages `_redirects` rule, say) intact instead of following them here.
 *
 * Only `accept` is copied. Forwarding a browser's full header set would send
 * `host`-dependent and `cf-*` headers the origin did not ask for.
 */
export async function proxyToPages(request: Request, origin: string): Promise<Response> {
    const target = new URL(request.url)
    target.host = new URL(origin).host
    target.protocol = 'https:'

    const upstream = await fetch(target.toString(), {
        method: request.method,
        headers: { accept: request.headers.get('accept') ?? '*/*' },
        redirect: 'manual',
    })

    /*
     * Preserve the upstream status and content type. The body streams through
     * untouched, so a binary asset (font, image) is not decoded as text.
     *
     * `location` is preserved too, because a Pages site redirects directory
     * URLs: `/admin` answers 308 with `location: /admin/`. A rebuilt response
     * that dropped the header would be a redirect with no destination — the
     * browser has nowhere to go and renders a blank page. Measured, not
     * assumed: `pos.<domain>/admin` returned 308 without `location` and
     * followed to 0 bytes, while the same request straight to the Pages origin
     * redirected normally.
     */
    const headers = new Headers({
        'content-type': upstream.headers.get('content-type') ?? 'text/html; charset=utf-8',
        'cache-control': upstream.headers.get('cache-control') ?? 'public, max-age=0, must-revalidate',
    })

    const location = upstream.headers.get('location')
    if (location !== null) headers.set('location', location)

    return new Response(upstream.body, {
        status: upstream.status,
        headers,
    })
}
