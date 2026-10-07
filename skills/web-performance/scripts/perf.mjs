#!/usr/bin/env node
// First-load harness: cold loads of a URL under a screen profile, with a filmstrip.
//
//   node perf.mjs <url> [--profile phone] [--runs 3] [--selector h1] [--out ./perf/<profile>]
//   node perf.mjs <url> --profile all      # every profile, one sub-folder each
//
// Writes <out>/report.json (medians + every run) and <out>/filmstrip.png (python3 + Pillow).
// Needs Playwright in the current project (`pnpm add -D playwright-core` or `playwright`)
// and Chrome installed (falls back to Playwright's bundled Chromium).

import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const NETWORK = {
  // RTT ms, down/up in bits per second
  'slow-4g': { latency: 150, down: 1.6e6, up: 750e3 },
  'fast-4g': { latency: 60, down: 9e6, up: 1.5e6 },
  cable: { latency: 20, down: 50e6, up: 10e6 },
}

export const PROFILES = {
  'phone-low': { width: 360, height: 780, dpr: 2, mobile: true, cpu: 6, network: 'slow-4g' },
  phone: { width: 390, height: 844, dpr: 3, mobile: true, cpu: 4, network: 'slow-4g' },
  tablet: { width: 820, height: 1180, dpr: 2, mobile: true, cpu: 2, network: 'fast-4g' },
  laptop: { width: 1440, height: 900, dpr: 2, mobile: false, cpu: 1, network: 'fast-4g' },
  'desktop-4k': { width: 1920, height: 1080, dpr: 2, mobile: false, cpu: 1, network: 'cable' },
}

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'))
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
if (!url) {
  console.error('usage: node perf.mjs <url> [--profile phone|phone-low|tablet|laptop|desktop-4k|all] [--runs 3] [--selector h1] [--out dir]')
  process.exit(1)
}

const loadPlaywright = () => {
  const require = createRequire(join(process.cwd(), '/'))
  for (const name of ['playwright', 'playwright-core']) {
    try {
      return require(name).chromium
    } catch {}
  }
  console.error('Playwright not found in this project. Install it: pnpm add -D playwright-core')
  process.exit(1)
}

// Runs in the page before any script: records LCP, CLS, long tasks, fonts, and the
// effective opacity of the headline on every frame (to catch hidden-then-shown flicker).
const observe = (selector) => {
  const w = window
  w.__perf = { lcp: [], cls: [], longtasks: [], trace: [], fonts: [] }
  const watch = (type, fn) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true })
    } catch {}
  }
  const describe = (n) => {
    if (!n) return '?'
    const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    return n.nodeName.toLowerCase() + (cls ? `.${cls}` : '')
  }
  watch('largest-contentful-paint', (e) => w.__perf.lcp.push({ t: e.startTime, size: e.size, el: e.element ? describe(e.element) : e.url }))
  watch('layout-shift', (e) => !e.hadRecentInput && w.__perf.cls.push({ t: e.startTime, v: e.value, src: (e.sources || []).map((s) => describe(s.node)) }))
  watch('longtask', (e) => w.__perf.longtasks.push({ t: e.startTime, d: e.duration }))
  let last = ''
  const tick = () => {
    const el = document.querySelector(selector)
    let op = el ? 1 : 0
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity)
    const vis = el ? Math.round(op * 100) / 100 : -1
    if (String(vis) !== last) {
      w.__perf.trace.push({ t: Math.round(performance.now()), opacity: vis })
      last = String(vis)
    }
    const root = document.getElementById('__nuxt') || document.getElementById('root') || document.getElementById('app') || document.getElementById('__next')
    if (w.__perf.hydratedAt == null && root && (root.__vue_app__ || Object.keys(root).some((k) => k.startsWith('__react')))) {
      w.__perf.hydratedAt = Math.round(performance.now())
    }
    if (performance.now() < 9000) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  document.fonts?.addEventListener('loadingdone', (e) =>
    e.fontfaces.forEach((f) => w.__perf.fonts.push({ t: Math.round(performance.now()), font: `${f.family} ${f.weight}` })),
  )
}

const median = (values) => {
  const v = values.filter((x) => x != null).sort((a, b) => a - b)
  return v.length ? Math.round(v[Math.floor(v.length / 2)]) : null
}

async function runProfile(chromium, name, out, runs, selector) {
  const p = PROFILES[name]
  if (!p) throw new Error(`unknown profile "${name}" (${Object.keys(PROFILES).join(', ')})`)
  const net = NETWORK[p.network]
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }))
  const results = []
  for (let r = 0; r < runs; r++) {
    const ctx = await browser.newContext({
      viewport: { width: p.width, height: p.height },
      deviceScaleFactor: p.dpr,
      isMobile: p.mobile,
      hasTouch: p.mobile,
    })
    await ctx.addInitScript(observe, selector)
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.down / 8, uploadThroughput: net.up / 8 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu })

    const frames = []
    if (r === 0) {
      cdp.on('Page.screencastFrame', async (f) => {
        frames.push({ ts: f.metadata.timestamp, data: f.data })
        await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
      })
      const scale = Math.min(1, 390 / p.width)
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: Math.round(p.width * scale), maxHeight: Math.round(p.height * scale), everyNthFrame: 1 })
    }
    const navStart = Date.now() / 1000
    await page.goto(url, { waitUntil: 'load', timeout: 120000 })
    await page.waitForTimeout(4000)
    if (r === 0) await cdp.send('Page.stopScreencast')

    const data = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      const paints = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)]))
      const res = performance.getEntriesByType('resource')
      const kb = (list) => Math.round(list.reduce((a, e) => a + e.transferSize, 0) / 1024)
      const file = (e) => e.name.split('?')[0].split('/').pop()
      return {
        ttfb: Math.round(nav.responseStart),
        fcp: paints['first-contentful-paint'],
        load: Math.round(nav.loadEventEnd),
        htmlKB: Math.round(nav.encodedBodySize / 1024),
        bytesKB: { total: kb(res) + Math.round(nav.transferSize / 1024), js: kb(res.filter((e) => /\.m?js(\?|$)/.test(e.name))), css: kb(res.filter((e) => /\.css(\?|$)/.test(e.name))), img: kb(res.filter((e) => e.initiatorType === 'img' || /\.(avif|webp|png|jpe?g|gif|svg)(\?|$)/.test(e.name))), font: kb(res.filter((e) => /\.woff2?(\?|$)/.test(e.name))) },
        blocking: res.filter((e) => e.renderBlockingStatus === 'blocking').map(file),
        fontFiles: res.filter((e) => /\.woff2?(\?|$)/.test(e.name)).map((e) => ({ file: file(e), start: Math.round(e.startTime), end: Math.round(e.responseEnd) })),
        perf: window.__perf,
      }
    })
    const tr = data.perf.trace
    data.lcp = data.perf.lcp.at(-1) ?? null
    data.cls = Math.round(data.perf.cls.reduce((a, e) => a + e.v, 0) * 1000) / 1000
    data.tbt = Math.round(data.perf.longtasks.reduce((a, e) => a + Math.max(0, e.d - 50), 0))
    data.flicker = tr.some((pt, i) => pt.opacity > 0.9 && tr.slice(i + 1).some((q) => q.opacity >= 0 && q.opacity < 0.5))
    data.headlineVisibleAt = tr.find((pt) => pt.opacity >= 0.99)?.t ?? null
    data.hydratedAt = data.perf.hydratedAt ?? null
    results.push(data)

    if (r === 0 && frames.length) {
      const base = Math.min(navStart, frames[0].ts)
      const dir = join(out, 'frames')
      mkdirSync(dir, { recursive: true })
      for (let ms = 0; ms <= 3600; ms += 150) {
        const f = [...frames].reverse().find((x) => (x.ts - base) * 1000 <= ms)
        if (f) writeFileSync(join(dir, `${String(ms).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'))
      }
    }
    await ctx.close()
  }
  await browser.close()

  const first = results[0]
  const summary = {
    url,
    profile: { name, ...p },
    runs,
    ttfb: median(results.map((x) => x.ttfb)),
    fcp: median(results.map((x) => x.fcp)),
    lcp: median(results.map((x) => x.lcp?.t)),
    lcpElement: first.lcp?.el ?? null,
    headlineVisibleAt: median(results.map((x) => x.headlineVisibleAt)),
    hydratedAt: median(results.map((x) => x.hydratedAt)),
    tbt: median(results.map((x) => x.tbt)),
    cls: Math.max(...results.map((x) => x.cls)),
    flicker: results.map((x) => x.flicker),
    load: median(results.map((x) => x.load)),
    bytesKB: first.bytesKB,
    htmlKB: first.htmlKB,
    blocking: first.blocking,
    fontFiles: first.fontFiles,
    fontsDone: first.perf.fonts,
    headlineTrace: first.perf.trace.slice(0, 12),
    clsSources: first.perf.cls,
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify({ summary, results }, null, 1))
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    execFileSync('python3', [join(here, 'filmstrip.py'), join(out, 'frames'), join(out, 'filmstrip.png')], { stdio: 'ignore' })
  } catch {
    console.error('filmstrip skipped (needs python3 + Pillow)')
  }
  return summary
}

const chromium = loadPlaywright()
const profileArg = flag('profile', 'phone')
const runs = Number(flag('runs', '3'))
const selector = flag('selector', 'h1')
const names = profileArg === 'all' ? Object.keys(PROFILES) : profileArg.split(',')
const table = []
for (const name of names) {
  const out = flag('out', null) ? (names.length > 1 ? join(flag('out'), name) : flag('out')) : join('perf', name)
  const s = await runProfile(chromium, name, out, runs, selector)
  table.push({ profile: name, fcp: s.fcp, lcp: s.lcp, headline: s.headlineVisibleAt, hydrated: s.hydratedAt, tbt: s.tbt, cls: s.cls, flicker: s.flicker.some(Boolean), kb: s.bytesKB.total, lcpElement: s.lcpElement })
  console.error(`${name} → ${out}/report.json`)
}
console.table(table)
