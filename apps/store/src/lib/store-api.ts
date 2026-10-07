// src/lib/store-api.ts
//
// Client for the `paymedash-api` store-resolution endpoint.
//
// The endpoint is `GET /v1/store?name=<dpns-label>` on the shared Worker that is
// routed in front of this site at `paymedash.com/v1/*` (see
// ../paymedash-api/packages/api/wrangler.jsonc). It answers with the store
// document that the name's identity owns, and it only answers at all once the
// document's grovedb proof has verified — `proofVerified` is `true` on every
// 200 and the storefront renders nothing otherwise.
//
// WHY THE RESPONSE SHAPE IS TRUSTED HERE AND NOT RE-DERIVED
// The Worker is the only producer of this payload and the proof was checked
// there, in-process. This module therefore PARSES the response (so a malformed
// body cannot crash the page) rather than re-validating a proof it cannot see.
// What it does not do is invent a store: an error status yields a discriminated
// result the page turns into "Store Not Found".
//
// The store schema is yappr's, read from the live contract. Several fields are
// JSON-encoded STRINGS (`contactMethods`, `policies`, `paymentUris`), so they
// are parsed defensively: a store whose `policies` is not valid JSON still
// renders, with that one section omitted.

/*
 * The API origin the resolver is reached through.
 *
 * `paymedash.com/v1/*` is routed to the `paymedash-api` Worker (see that
 * repo's wrangler.jsonc). The storefront calls the APEX route even when it is
 * itself served from `<username>.paymedash.com`: the request is made from the
 * Astro server, not the browser, so it is a plain server-to-server call and
 * Cloudflare routes it to the Worker without any CORS involvement. Pointing at
 * the subdomain instead would re-enter the Astro worker and loop.
 *
 * Overridable via `STORE_API_ORIGIN` so a local Astro server can point at a
 * local `wrangler dev` instance; production leaves it unset.
 */
/*
 * `import.meta.env` is replaced by Vite at BUILD time; it is `undefined` under
 * the plain `node --test` runner, so the access is optional-chained rather than
 * read directly. The value still comes from `STORE_API_ORIGIN` when a build
 * sets it, and falls back to the production origin otherwise.
 */
const BUILD_STORE_API_ORIGIN = (import.meta.env as ImportMetaEnv | undefined)?.STORE_API_ORIGIN

export const STORE_API_ORIGIN: string =
    (BUILD_STORE_API_ORIGIN as string | undefined) ?? 'https://paymedash.com'

/** The resolved store, as the Worker returns it. */
export interface StoreRecord {
    /** The DPNS label as requested, lower-cased. */
    name: string
    /** The homograph-normalized label the network compared. */
    normalizedName: string
    /** The identity that owns the name and the store document. */
    identityId: string
    /** The store document id, which products reference as `storeId`. */
    documentId: string
    /** The store's own properties (name, description, status, ...). */
    properties: Record<string, unknown>
    /** True on every 200: the document is the output of proof verification. */
    proofVerified: boolean
    /** False until a quorum public key is reachable; reported, not implied. */
    quorumVerified: boolean
    /** The grovedb root hash the proof was checked against, base58. */
    rootHash: string
}

/** The outcome of a store lookup. */
export type StoreLookup =
    | { status: 'found'; store: StoreRecord }
    | { status: 'invalid'; reason: string }
    | { status: 'not-found'; reason: string }
    | { status: 'error'; reason: string }

/** A single product listing, as the Worker returns it. */
export interface StoreItemRecord {
    /** The `storeItem` document id. */
    documentId: string
    /** The item's own properties (title, basePrice, currency, imageUrls, ...). */
    properties: Record<string, unknown>
}

/** The outcome of a store-item lookup. */
export type StoreItemsLookup =
    | { status: 'found'; items: StoreItemRecord[] }
    | { status: 'error'; reason: string }

/** A product ready for the storefront, with money held in integer cents. */
export interface StoreProduct {
    /** A stable id for the cart, derived from the item's document id. */
    id: number
    title: string
    /** Price in USD dollars, converted from the item's integer cents. */
    price: number
    imageUrl: string
    /** The price in integer cents, which is what the cart and pay step use. */
    priceCents: number
    currency: string
}

/** Read a string property, or `null` when it is absent or not a string. */
export function stringProperty(properties: Record<string, unknown>, key: string): string | null {
    const value = properties[key]

    return typeof value === 'string' ? value : null
}

/**
 * Parse a JSON-encoded string property.
 *
 * The yappr contract stores `contactMethods`, `policies` and `paymentUris` as
 * JSON strings rather than nested objects. A value that does not parse is
 * reported as `null` so the caller can omit that section instead of failing
 * the whole store over one bad field.
 */
export function jsonProperty<T>(properties: Record<string, unknown>, key: string): T | null {
    const raw = stringProperty(properties, key)

    if (raw === null) return null

    try {
        return JSON.parse(raw) as T
    } catch {
        return null
    }
}

/**
 * Resolve a store by its DPNS label.
 *
 * @param name the subdomain label (with or without a trailing `.dash`)
 * @param fetchImpl the fetch implementation, injected so the logic is testable
 */
export async function fetchStore(
    name: string,
    fetchImpl: typeof fetch = fetch,
    origin: string = STORE_API_ORIGIN,
): Promise<StoreLookup> {
    const url = `${origin}/v1/store?name=${encodeURIComponent(name)}`

    let response: Response

    try {
        response = await fetchImpl(url, { headers: { accept: 'application/json' } })
    } catch (error) {
        /*
         * A network failure is reported as an error rather than as "not found":
         * the two are different claims, and telling a merchant their store does
         * not exist when the API is merely unreachable would be wrong.
         */
        return { status: 'error', reason: `Could not reach the store resolver: ${String(error)}` }
    }

    let body: unknown

    try {
        body = await response.json()
    } catch {
        return { status: 'error', reason: 'The store resolver returned a non-JSON response.' }
    }

    const payload = body as Record<string, unknown>

    if (response.status === 200) {
        const store = parseStore(payload)

        if (store === null) {
            return { status: 'error', reason: 'The store resolver returned an unexpected shape.' }
        }

        return { status: 'found', store }
    }

    const reason = typeof payload?.error === 'string' ? payload.error : 'The store could not be resolved.'

    if (response.status === 400) return { status: 'invalid', reason }

    return { status: 'not-found', reason }
}

/**
 * List a store's active items by the store's document id.
 *
 * Mirrors `fetchStore`: the Worker only answers after the items' grovedb proof
 * has verified, so a 200 is a verified list. A store with no active items is
 * an empty list, not an error.
 */
export async function fetchStoreItems(
    storeDocumentId: string,
    fetchImpl: typeof fetch = fetch,
    origin: string = STORE_API_ORIGIN,
): Promise<StoreItemsLookup> {
    const url = `${origin}/v1/store/items?storeId=${encodeURIComponent(storeDocumentId)}`

    let response: Response

    try {
        response = await fetchImpl(url, { headers: { accept: 'application/json' } })
    } catch (error) {
        return { status: 'error', reason: `Could not reach the store resolver: ${String(error)}` }
    }

    let body: unknown

    try {
        body = await response.json()
    } catch {
        return { status: 'error', reason: 'The store resolver returned a non-JSON response.' }
    }

    const payload = body as Record<string, unknown>

    if (response.status !== 200) {
        const reason = typeof payload?.error === 'string' ? payload.error : 'The store items could not be read.'
        return { status: 'error', reason }
    }

    if (!Array.isArray(payload?.items)) {
        return { status: 'error', reason: 'The store resolver returned an unexpected shape.' }
    }

    const items: StoreItemRecord[] = []

    for (const raw of payload.items) {
        const item = raw as Record<string, unknown>

        if (typeof item?.documentId !== 'string') continue
        if (typeof item?.properties !== 'object' || item.properties === null) continue

        items.push({
            documentId: item.documentId,
            properties: item.properties as Record<string, unknown>,
        })
    }

    return { status: 'found', items }
}

/**
 * Map a resolved store item to the storefront's product shape.
 *
 * The yappr contract stores prices as INTEGER CENTS in `basePrice` and the
 * image list as a JSON-encoded string in `imageUrls`. This converts cents to
 * the dollars the display shows, and keeps the cents too, because the cart and
 * the pay step must not round-trip money through a float.
 *
 * A stable cart id is derived from the document id: item document ids are
 * base58 and not numeric, so a non-cryptographic 31-bit hash of the id is used.
 * The cart is keyed by id alone, so the id only has to be stable across one
 * page render — two different items colliding in one storefront is the risk,
 * and a 31-bit space makes that negligible.
 */
export function toProduct(item: StoreItemRecord): StoreProduct | null {
    const title = stringProperty(item.properties, 'title')

    if (title === null) return null

    const basePrice = item.properties['basePrice']

    if (typeof basePrice !== 'number' || !Number.isFinite(basePrice)) return null

    const imageUrls = jsonProperty<string[]>(item.properties, 'imageUrls')
    const imageUrl = Array.isArray(imageUrls) && typeof imageUrls[0] === 'string'
        ? imageUrls[0]
        : 'https://placehold.co/150x150/A7D397/424769/png?text=' + encodeURIComponent(title)

    const currency = stringProperty(item.properties, 'currency') ?? 'USD'

    return {
        id: hashToId(item.documentId),
        title,
        price: basePrice / 100,
        priceCents: basePrice,
        imageUrl,
        currency,
    }
}

/* A stable, non-negative 31-bit id for a document id string. */
function hashToId(value: string): number {
    let hash = 0

    for (let i = 0; i < value.length; i++) {
        hash = (hash * 31 + value.charCodeAt(i)) | 0
    }

    return Math.abs(hash)
}

/* Narrow an unknown payload into a StoreRecord, or null when it is not one. */
function parseStore(payload: Record<string, unknown>): StoreRecord | null {
    if (typeof payload?.name !== 'string') return null
    if (typeof payload?.identityId !== 'string') return null
    if (typeof payload?.documentId !== 'string') return null
    if (typeof payload?.properties !== 'object' || payload.properties === null) return null

    return {
        name: payload.name,
        normalizedName: typeof payload.normalizedName === 'string' ? payload.normalizedName : payload.name,
        identityId: payload.identityId,
        documentId: payload.documentId,
        properties: payload.properties as Record<string, unknown>,
        proofVerified: payload.proofVerified === true,
        quorumVerified: payload.quorumVerified === true,
        rootHash: typeof payload.rootHash === 'string' ? payload.rootHash : '',
    }
}
