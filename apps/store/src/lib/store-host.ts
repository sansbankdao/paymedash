// src/lib/store-host.ts
//
// Map a request hostname to the DPNS username it addresses.
//
// The platform serves one store per subdomain:
//
//   <USERNAME>.paymedash.com
//
// The apex (`paymedash.com`), `www`, `demo` and `pos` are NOT usernames —
// they are the landing page, the demo storefront, and the point of sale.
// Everything else is treated as a candidate DPNS label and handed to
// `isValidStoreName()`.
//
// WHY A USERNAME AND NOT AN IDENTIFIER
// A Dash Platform Identifier is base58, and base58 is case-sensitive:
// lower-casing it changes which bytes it decodes to. DNS label matching is
// case-INsensitive and every HTTP stack lower-cases the Host header before it
// reaches application code — the browser does it (WHATWG URL) and so does
// workerd. A case-sensitive id therefore cannot survive the round trip: it
// arrives mangled and would decode to a different identifier, or to nothing.
//
// A DPNS username does not have that problem. It is case-insensitive by
// construction — the contract stores a `normalizedLabel` with `o` mapped to
// `0` and `i`/`l` mapped to `1`, exactly so that spellings a human cannot tell
// apart resolve to one name. Lower-casing a username is therefore lossless,
// which is what makes it usable as a DNS label.
//
// This is deliberately network-agnostic: it parses and validates the host, it
// does NOT fetch anything. Turning the username into an identity id, and the
// identity id into a store document, is the resolver's job.

/** The registrable domain the storefront serves under. */
export const STORE_DOMAIN = 'paymedash.com'

/**
 * Subdomains that are reserved and never treated as a username.
 *
 * `pos` is reserved because `pos.paymedash.com` is the point-of-sale app
 * (`apps/pos`), not a merchant. Without it the host family
 * `*.paymedash.com` would route `pos.paymedash.com/` into this storefront
 * and try to resolve a DPNS username literally called `pos`.
 */
export const RESERVED_SUBDOMAINS = ['www', 'demo', 'pos'] as const

/**
 * The subdomain that serves the built-in demo storefront.
 *
 * The demo renders the local fixture in `src/data/products.ts` and never
 * contacts the resolver, so `demo.paymedash.com` works with no network and
 * no registered store. It stays in `RESERVED_SUBDOMAINS` above, which is why
 * `storeNameFromHostname()` returns `null` for it rather than a username.
 */
export const DEMO_SUBDOMAIN = 'demo'

/**
 * Is this hostname the demo storefront?
 *
 * Matches only `demo.paymedash.com` (any case, optional port, optional
 * trailing root dot) — not `demo.example.com`, and not a deeper name such as
 * `demo.eu.paymedash.com`. Kept beside `storeNameFromHostname()` so both
 * read the same `STORE_DOMAIN` and cannot drift.
 */
export function isDemoHost(hostname: string): boolean {
    if (typeof hostname !== 'string') return false

    const host = hostname.replace(/\.$/, '').split(':')[0]

    return host.toLowerCase() === `${DEMO_SUBDOMAIN}.${STORE_DOMAIN}`
}

/*
 * DPNS label rules, read from the contract rather than assumed.
 * Source: platform/packages/dpns-contract/schema/v1/dpns-contract-documents.json
 *
 *   "label": {
 *     "pattern": "^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]$",
 *     "minLength": 3,
 *     "maxLength": 63,
 *   }
 *
 * The pattern requires an alphanumeric at BOTH ends, so a label may not begin
 * or end with a hyphen. The length bounds are the contract's, not an arbitrary
 * choice: a 1- or 2-character label is not a DPNS name and can never resolve.
 */
const STORE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]$/

/** Minimum label length, from the contract schema (`minLength: 3`). */
export const STORE_NAME_MIN_LENGTH = 3

/** Maximum label length, from the contract schema (`maxLength: 63`). */
export const STORE_NAME_MAX_LENGTH = 63

/**
 * Is this a syntactically valid DPNS username?
 *
 * A shape check only — it does not prove the name is registered.
 */
export function isValidStoreName(label: unknown): label is string {
    if (typeof label !== 'string') return false

    if (label.length < STORE_NAME_MIN_LENGTH || label.length > STORE_NAME_MAX_LENGTH) return false

    return STORE_NAME_PATTERN.test(label)
}

/**
 * Convert a username to its homograph-safe normalized form.
 *
 * Lower-cases, then replaces `o` with `0` and `i`/`l` with `1`, exactly as the
 * contract's `normalizedLabel` `$comment` requires. This is the value a lookup
 * must compare against, so that `Bob`, `B0b` and `bob` resolve to one store.
 */
export function normalizeStoreName(label: string): string {
    return label.toLowerCase().replace(/o/g, '0').replace(/[il]/g, '1')
}

/**
 * Extract the candidate store username from a hostname.
 *
 * @returns the first label when `hostname` is exactly one label under
 *          `STORE_DOMAIN` and that label is not reserved; otherwise `null`.
 *          The label is returned lower-cased, which is the form a DPNS lookup
 *          needs — see the note at the top of this file.
 */
export function storeNameFromHostname(hostname: string): string | null {
    if (typeof hostname !== 'string') return null

    /* Drop a trailing dot (the root label) and any :port, so a `Host` header
     * such as `homemadecrypto.paymedash.com:443` still parses. */
    const host = hostname.replace(/\.$/, '').split(':')[0]

    const labels = host.split('.')

    /* Exactly one label above the two-label registrable domain. */
    if (labels.length !== 3) return null

    const [label, first, second] = labels

    /* Compare the suffix in lower case only — DNS labels are case-insensitive. */
    const domainLabels = STORE_DOMAIN.split('.')
    if (first.toLowerCase() !== domainLabels[0]) return null
    if (second.toLowerCase() !== domainLabels[1]) return null

    if (label.length === 0) return null

    const lowered = label.toLowerCase()

    if ((RESERVED_SUBDOMAINS as readonly string[]).includes(lowered)) return null

    return lowered
}
