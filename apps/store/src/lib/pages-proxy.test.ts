// src/lib/pages-proxy.test.ts
//
// Regression tests for the Pages proxy. Run with:
//   node --test src/lib/pages-proxy.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { proxyToPages } from './pages-proxy.ts'

const POS_REQUEST = new Request('https://pos.paymedash.com/admin')
const POS_ORIGIN = 'https://paymedash-pos.pages.dev'

/** Swap global fetch for one canned answer, restoring afterwards. */
function stubFetch(answer: () => Response | Promise<Response>): void {
    const original = globalThis.fetch
    globalThis.fetch = (async () => answer()) as typeof fetch
    test.after(() => {
        globalThis.fetch = original
    })
}

test('a directory redirect passes through WITH its location header', async () => {
    /*
     * Regression: the proxy used to rebuild the response with only
     * `content-type` and `cache-control`. A Pages site answers `/admin`
     * with 308 + `location: /admin/`, and a rebuilt redirect without the
     * location left the browser with nowhere to go — a blank page.
     * Measured live before the fix.
     */
    stubFetch(() => new Response(null, {
        status: 308,
        headers: { location: '/admin/', 'content-type': 'text/html; charset=utf-8' },
    }))

    const response = await proxyToPages(POS_REQUEST, POS_ORIGIN)

    assert.equal(response.status, 308)
    assert.equal(response.headers.get('location'), '/admin/')
})

test('a normal answer keeps its content type and gains no location', async () => {
    stubFetch(() => new Response('<html>ok</html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
    }))

    const response = await proxyToPages(POS_REQUEST, POS_ORIGIN)

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(response.headers.get('location'), null)
})

test('the forwarded request goes to the origin with the same path', async () => {
    let seenUrl = ''
    stubFetch(() => {
        return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    })

    const original = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request) => {
        seenUrl = String(input)
        return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    }) as typeof fetch
    test.after(() => {
        globalThis.fetch = original
    })

    await proxyToPages(POS_REQUEST, POS_ORIGIN)

    assert.equal(seenUrl, 'https://paymedash-pos.pages.dev/admin')
})
