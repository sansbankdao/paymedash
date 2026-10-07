// src/lib/store-api.test.ts
//
// Tests for the store-resolution client. Run with:
//   node --test src/lib/store-api.test.ts
//
// Every network call is injected, so the suite is deterministic and offline.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    fetchStore,
    fetchStoreItems,
    toProduct,
    stringProperty,
    jsonProperty,
    STORE_API_ORIGIN,
} from './store-api.ts'

/** Build a fetch stub that returns one canned response. */
function stubFetch(status: number, body: unknown): typeof fetch {
    return (async () => ({
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
    })) as unknown as typeof fetch
}

/** A minimal 200 payload matching the Worker's StoreShow response. */
function foundPayload() {
    return {
        name: 'm0m0',
        normalizedName: 'm0m0',
        identityId: 'FdsY5zEVvfmaQPMmFHZz6NHjovGZeq8H4QBZjpwoRf59',
        documentId: '8KBeHXAr1TSufSyBTbKV1spUfJKTKRmEEWAnRZtAZyR1',
        properties: { name: 'Little Gem Shop', status: 'active' },
        proofVerified: true,
        quorumVerified: false,
        rootHash: 'G7GKTtN67DcGC8nLafXbtKP2QQkeYKg1ieLSmfCXJcxb',
    }
}

test('the API origin is the site the Worker is routed on', () => {
    assert.equal(STORE_API_ORIGIN, 'https://paymedash.com')
})

test('reads a string property, rejecting non-strings', () => {
    assert.equal(stringProperty({ a: 'x' }, 'a'), 'x')
    assert.equal(stringProperty({ a: 1 }, 'a'), null)
    assert.equal(stringProperty({}, 'a'), null)
})

test('parses a JSON-encoded property and tolerates a bad one', () => {
    assert.deepEqual(jsonProperty({ policies: '[{"name":"Returns"}]' }, 'policies'), [
        { name: 'Returns' },
    ])
    assert.equal(jsonProperty({ policies: 'not json' }, 'policies'), null)
    assert.equal(jsonProperty({}, 'policies'), null)
})

test('a 200 becomes a found store with the proof flag carried through', async () => {
    const result = await fetchStore('m0m0', stubFetch(200, foundPayload()))

    assert.equal(result.status, 'found')
    assert.equal(result.store.identityId, 'FdsY5zEVvfmaQPMmFHZz6NHjovGZeq8H4QBZjpwoRf59')
    assert.equal(result.store.documentId, '8KBeHXAr1TSufSyBTbKV1spUfJKTKRmEEWAnRZtAZyR1')
    assert.equal(result.store.proofVerified, true)
    assert.equal(result.store.quorumVerified, false)
})

test('a 200 with no proof flag is not treated as verified', async () => {
    const payload: Record<string, unknown> = foundPayload()
    delete payload.proofVerified

    const result = await fetchStore('m0m0', stubFetch(200, payload))

    assert.equal(result.status, 'found')
    assert.equal(result.store.proofVerified, false)
})

test('a 400 is reported as invalid, not as not-found', async () => {
    const result = await fetchStore('ab', stubFetch(400, { error: 'name is invalid.', statusCode: 400 }))

    assert.equal(result.status, 'invalid')
    assert.equal(result.reason, 'name is invalid.')
})

test('a 404 is reported as not-found', async () => {
    const result = await fetchStore('nobody', stubFetch(404, { error: 'No identity has registered this name.', statusCode: 404 }))

    assert.equal(result.status, 'not-found')
    assert.equal(result.reason, 'No identity has registered this name.')
})

test('an unreachable API is an error, not a claim the store is missing', async () => {
    const failing = (async () => {
        throw new Error('network down')
    }) as unknown as typeof fetch

    const result = await fetchStore('m0m0', failing)

    assert.equal(result.status, 'error')
})

test('a 200 with the wrong shape is an error rather than a half-built store', async () => {
    const result = await fetchStore('m0m0', stubFetch(200, { name: 'm0m0' }))

    assert.equal(result.status, 'error')
})

test('lists a store\u2019s items from its document id', async () => {
    const result = await fetchStoreItems(
        '8KBeHXAr1TSufSyBTbKV1spUfJKTKRmEEWAnRZtAZyR1',
        stubFetch(200, {
            storeId: '8KBeHXAr1TSufSyBTbKV1spUfJKTKRmEEWAnRZtAZyR1',
            items: [{ documentId: 'itemA', properties: { title: 'Spinel', basePrice: 20000, currency: 'USD' } }],
            proofVerified: true,
            rootHash: 'abc',
        }),
    )

    assert.equal(result.status, 'found')
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].documentId, 'itemA')
})

test('a malformed item is skipped rather than failing the whole list', async () => {
    const result = await fetchStoreItems(
        'id',
        stubFetch(200, {
            items: [
                { documentId: 'ok', properties: {} },
                { properties: {} },
                null,
            ],
        }),
    )

    assert.equal(result.status, 'found')
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].documentId, 'ok')
})

test('converts a store item into a product with money kept in cents', () => {
    const product = toProduct({
        documentId: 'itemA',
        properties: {
            title: 'Spinel',
            basePrice: 20000,
            currency: 'USD',
            imageUrls: '["https://example.test/spinel.png"]',
        },
    })

    assert.ok(product)
    assert.equal(product.title, 'Spinel')
    assert.equal(product.priceCents, 20000)
    assert.equal(product.price, 200)
    assert.equal(product.imageUrl, 'https://example.test/spinel.png')
    assert.equal(product.currency, 'USD')
})

test('a product with no image gets a placeholder', () => {
    const product = toProduct({ documentId: 'itemA', properties: { title: 'Spinel', basePrice: 20000 } })

    assert.ok(product)
    assert.ok(product.imageUrl.startsWith('https://placehold.co/'))
})

test('an item with no title or no price is not a product', () => {
    assert.equal(toProduct({ documentId: 'x', properties: { basePrice: 1 } }), null)
    assert.equal(toProduct({ documentId: 'x', properties: { title: 't' } }), null)
})

test('the same document id always hashes to the same cart id', () => {
    const a = toProduct({ documentId: 'same', properties: { title: 't', basePrice: 1 } })
    const b = toProduct({ documentId: 'same', properties: { title: 't', basePrice: 1 } })

    assert.ok(a)
    assert.ok(b)
    assert.equal(a.id, b.id)
    assert.ok(a.id >= 0)
})

test('the name is URL-encoded into the request', async () => {
    let seen = ''

    const capture = (async (url: string) => {
        seen = url
        return { status: 404, ok: false, json: async () => ({ error: 'x' }) }
    }) as unknown as typeof fetch

    await fetchStore('a b', capture)

    assert.equal(seen, `${STORE_API_ORIGIN}/v1/store?name=a%20b`)
})