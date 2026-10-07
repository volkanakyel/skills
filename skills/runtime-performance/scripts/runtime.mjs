#!/usr/bin/env node
// Runtime performance harness: scroll + tap on a device profile, report LoAF, long tasks,
// dropped frames and interaction latency.
//
// usage: node runtime.mjs <url> [--profile phone|phone-low|tablet|laptop|desktop-4k]
//                               [--tap <selector>] [--out <dir>] [--runs 3]
//
// Needs `playwright` or `playwright-core` resolvable from the current directory, and Chrome
// (falls back to Playwright's bundled Chromium).
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PROFILES = {
  phone: { viewport: { width: 390, height: 844 }, dpr: 3, touch: true, cpu: 4 },
  'phone-low': { viewport: { width: 360, height: 780 }, dpr: 2, touch: true, cpu: 6 },
  tablet: { viewport: { width: 820, height: 1180 }, dpr: 2, touch: true, cpu: 2 },
  laptop: { viewport: { width: 1440, height: 900 }, dpr: 2, touch: false, cpu: 1 },
  'desktop-4k': { viewport: { width: 1920, height: 1080 }, dpr: 2, touch: false, cpu: 1 },
}

function parseArgs(argv) {
  const opts = { profile: 'phone', tap: null, out: 'runtime-report', runs: 3 }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--profile') opts.profile = argv[++i]
    else if (a === '--tap') opts.tap = argv[++i]
    else if (a === '--out') opts.out = argv[++i]
    else if (a === '--runs') opts.runs = Number(argv[++i])
    else if (a === '-h' || a === '--help') opts.help = true
    else rest.push(a)
  }
  opts.url = rest[0]
  return opts
}

function loadChromium() {
  const require = createRequire(resolve(process.cwd()) + '/')
  for (const name of ['playwright', 'playwright-core']) {
    try {
      return require(name).chromium
    } catch {}
  }
  console.error('runtime.mjs: could not resolve "playwright" or "playwright-core" from ' + process.cwd() +
    '.\nInstall one (pnpm add -D playwright-core) or run from a project that has it.')
  process.exit(1)
}

// Runs in the page before any script: observers + rAF frame log.
function instrument() {
  const w = window
  const P = (w.__rt = { loaf: [], longtasks: [], events: [], frames: [], recording: false })
  const types = PerformanceObserver.supportedEntryTypes || []
  if (types.includes('long-animation-frame'))
    new PerformanceObserver((l) => {
      for (const f of l.getEntries())
        P.loaf.push({
          t: Math.round(f.startTime), duration: Math.round(f.duration), blocking: Math.round(f.blockingDuration),
          scripts: f.scripts.map((s) => ({
            invoker: s.invoker, source: s.sourceURL, fn: s.sourceFunctionName,
            duration: Math.round(s.duration), forcedLayout: Math.round(s.forcedStyleAndLayoutDuration),
          })),
        })
    }).observe({ type: 'long-animation-frame', buffered: true })
  if (types.includes('longtask'))
    new PerformanceObserver((l) => l.getEntries().forEach((e) => P.longtasks.push({ t: Math.round(e.startTime), duration: Math.round(e.duration) })))
      .observe({ type: 'longtask', buffered: true })
  if (types.includes('event'))
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (!e.interactionId) continue
        P.events.push({
          name: e.name, interactionId: e.interactionId, startTime: e.startTime, duration: e.duration,
          processingStart: e.processingStart, processingEnd: e.processingEnd,
          target: e.target ? e.target.tagName.toLowerCase() + (e.target.id ? '#' + e.target.id : '') + (e.target.className && typeof e.target.className === 'string' ? '.' + e.target.className.trim().split(/\s+/).join('.') : '') : null,
        })
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true })
  let last = 0
  const tick = (t) => {
    if (P.recording && last) P.frames.push(t - last)
    last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// interval = the display's refresh interval, measured on the idle, unthrottled page.
function frameStats(deltas, interval) {
  if (deltas.length < 10) return { frames: deltas.length, hz: null, dropped: 0, droppedPct: 0, worstFrameMs: null }
  const sorted = [...deltas].sort((a, b) => a - b)
  const dropped = deltas.reduce((n, d) => n + Math.max(0, Math.round(d / interval) - 1), 0)
  return {
    frames: deltas.length,
    hz: Math.round(1000 / interval),
    dropped,
    droppedPct: +((100 * dropped) / (deltas.length + dropped)).toFixed(1),
    worstFrameMs: Math.round(sorted.at(-1)),
  }
}

async function runOnce(browser, opts, profile) {
  const ctx = await browser.newContext({
    viewport: profile.viewport, deviceScaleFactor: profile.dpr, isMobile: profile.touch, hasTouch: profile.touch,
  })
  await ctx.addInitScript(instrument)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await page.goto(opts.url, { waitUntil: 'load', timeout: 90000 })
  await page.waitForTimeout(1000) // let load settle before throttling
  // Baseline refresh interval: median rAF delta on the idle, unthrottled page.
  const interval = await page.evaluate(() => new Promise((done) => {
    const d = []; let last = 0
    const tick = (t) => { if (last) d.push(t - last); last = t; d.length < 30 ? requestAnimationFrame(tick) : done(d.sort((a, b) => a - b)[15]) }
    requestAnimationFrame(tick)
  }))
  if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu })

  // Scroll: a real synthesized gesture (compositor path), top → bottom.
  const scrollable = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - innerHeight))
  const loafBefore = await page.evaluate(() => window.__rt.loaf.length)
  await page.evaluate(() => { window.__rt.frames = []; window.__rt.recording = true })
  const t0 = Date.now()
  if (scrollable > 0) {
    await cdp.send('Input.synthesizeScrollGesture', {
      x: Math.round(profile.viewport.width / 2), y: Math.round(profile.viewport.height * 0.7),
      yDistance: -Math.min(scrollable, 20000), speed: 1500,
      gestureSourceType: profile.touch ? 'touch' : 'mouse', preventFling: true,
    })
  } else {
    await page.waitForTimeout(2000)
  }
  await page.waitForTimeout(300)
  const scrollMs = Date.now() - t0
  const scroll = await page.evaluate((n) => {
    window.__rt.recording = false
    return { frames: window.__rt.frames.slice(), loaf: window.__rt.loaf.slice(n) }
  }, loafBefore)

  // Tap: scroll the target into view, then a real tap/click.
  let interaction = null
  if (opts.tap) {
    const el = page.locator(opts.tap).first()
    await el.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const evBefore = await page.evaluate(() => window.__rt.events.length)
    if (profile.touch) await el.tap()
    else await el.click()
    await page.waitForTimeout(1000)
    const evs = await page.evaluate((n) => window.__rt.events.slice(n), evBefore)
    if (evs.length) {
      // Group entries by interaction (pointerdown/up/click of one tap), keep the slowest,
      // and split it the way web-vitals does: earliest start, earliest processingStart, latest processingEnd.
      const groups = Object.values(evs.reduce((g, e) => ((g[e.interactionId] ||= []).push(e), g), {}))
      const worst = groups.map((es) => {
        const start = Math.min(...es.map((e) => e.startTime))
        const latency = Math.max(...es.map((e) => e.duration))
        const pStart = Math.min(...es.map((e) => e.processingStart))
        const pEnd = Math.max(...es.map((e) => e.processingEnd))
        return {
          latency, inputDelay: Math.round(pStart - start), processing: Math.round(pEnd - pStart),
          presentation: Math.max(0, Math.round(start + latency - pEnd)),
          events: es.map((e) => e.name).join('+'), target: es[0].target,
        }
      }).reduce((a, b) => (b.latency > a.latency ? b : a))
      interaction = { ...worst, entries: evs }
    } else {
      interaction = { latency: '<16', note: 'no event entry over the 16 ms threshold' }
    }
  }

  const all = await page.evaluate(() => ({ loaf: window.__rt.loaf, longtasks: window.__rt.longtasks }))
  await ctx.close()
  const scrollLoaf = scroll.loaf
  return {
    scroll: {
      distance: Math.min(scrollable, 20000), ms: scrollMs, ...frameStats(scroll.frames, interval),
      loafCount: scrollLoaf.length, worstLoaf: scrollLoaf.reduce((m, f) => Math.max(m, f.duration), 0),
      loafBlockingMs: scrollLoaf.reduce((s, f) => s + f.blocking, 0),
    },
    interaction,
    loaf: all.loaf,
    longtasks: all.longtasks,
  }
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : null
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help || !opts.url) {
  console.log('usage: node runtime.mjs <url> [--profile ' + Object.keys(PROFILES).join('|') + '] [--tap <selector>] [--out <dir>] [--runs 3]')
  process.exit(opts.help ? 0 : 1)
}
const profile = PROFILES[opts.profile]
if (!profile) {
  console.error(`unknown profile "${opts.profile}" — use one of: ${Object.keys(PROFILES).join(', ')}`)
  process.exit(1)
}

const chromium = loadChromium()
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
} catch {
  browser = await chromium.launch({ headless: true })
}

const runs = []
for (let i = 0; i < opts.runs; i++) runs.push(await runOnce(browser, opts, profile))
await browser.close()

const pick = (f) => median(runs.map(f))
const summary = {
  url: opts.url,
  profile: `${opts.profile} (${profile.viewport.width}×${profile.viewport.height} @${profile.dpr}x, ${profile.touch ? 'touch' : 'mouse'}, CPU ${profile.cpu}×)`,
  runs: runs.length,
  scroll: {
    refreshHz: pick((r) => r.scroll.hz),
    droppedPct: pick((r) => r.scroll.droppedPct),
    worstFrameMs: pick((r) => r.scroll.worstFrameMs),
    loafCount: pick((r) => r.scroll.loafCount),
    worstLoafMs: pick((r) => r.scroll.worstLoaf),
    loafBlockingMs: pick((r) => r.scroll.loafBlockingMs),
  },
  interaction: opts.tap
    ? {
        selector: opts.tap,
        latencyMs: pick((r) => r.interaction?.latency),
        inputDelayMs: pick((r) => r.interaction?.inputDelay),
        processingMs: pick((r) => r.interaction?.processing),
        presentationMs: pick((r) => r.interaction?.presentation),
      }
    : null,
  longTasks: { count: pick((r) => r.longtasks.length), worstMs: pick((r) => r.longtasks.reduce((m, t) => Math.max(m, t.duration), 0)) },
  topScripts: Object.entries(
    runs[0].loaf.flatMap((f) => f.scripts).reduce((acc, s) => {
      const key = `${s.invoker} ${s.fn || ''} ${s.source ? s.source.split('/').pop() : ''}`.trim()
      acc[key] = acc[key] || { ms: 0, forcedLayoutMs: 0 }
      acc[key].ms += s.duration
      acc[key].forcedLayoutMs += s.forcedLayout
      return acc
    }, {}),
  ).sort((a, b) => b[1].ms - a[1].ms).slice(0, 5).map(([script, v]) => ({ script, ...v })),
}

mkdirSync(opts.out, { recursive: true })
writeFileSync(join(opts.out, 'report.json'), JSON.stringify({ summary, runs }, null, 1))
console.log(JSON.stringify(summary, null, 1))
console.log(`\nreport → ${join(opts.out, 'report.json')}`)
