// apps/web/astro.config.mjs
// @ts-check
import { defineConfig } from 'astro/config'

import tailwindcss from '@tailwindcss/vite'

// https://astro.build/config
//
// The landing page is a fully static build: there is no adapter and no
// server-rendered route. It owns the apex (`paymedash.com`) only. The demo
// storefront and the hosted `<username>.paymedash.com` storefronts are a
// separate Worker (`apps/store`), so nothing here needs to read a Host header
// or rewrite a route.
export default defineConfig({
    site: 'https://paymedash.com',
    vite: {
      plugins: [tailwindcss()]
    }
})
