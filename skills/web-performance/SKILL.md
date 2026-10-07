---
name: web-performance
description: Audit how a website performs on every screen, from a low-end Android to a 4K desktop, then rank the problems by what people feel and route each one to the right fix. Measures cold loads per screen profile with a throttled filmstrip harness, reads field data split by device, sets per-screen budgets, and covers LCP, INP, CLS, TBT, bytes, TTFB, caching, compression, third-party scripts, bundles, bfcache and navigation speed. Ships `scripts/perf.mjs` (Playwright, with phone-low, phone, tablet, laptop and desktop-4k profiles, writes report.json and a filmstrip). Use when the user asks "is my site fast", "audit performance", "Lighthouse score dropped", "slow on mobile but fine on desktop", "Core Web Vitals failing", "what should I fix first", or before a launch. For the first two seconds (blank screen, flicker, fonts) use first-load; for slow taps and jank use runtime-performance; for image, video and canvas sizing use responsive-media; for motion feel use web-animation-design.
---

# Web Performance

A ranked list of what makes your site feel slow, measured on the screens people use, with each fix assigned.

## Scope

Use it for: auditing a site before launch or after a regression, reading field data, setting budgets, comparing phone and desktop, server and delivery settings, third-party scripts, bundle size, back/forward and link navigation.

Not for: the deep fixes, which live in the siblings. `first-load` handles blank screens, flicker, fonts and LCP. `runtime-performance` handles INP, scroll jank and frame rate. `responsive-media` handles image, video and canvas bytes per screen. `web-animation-design` handles how motion feels.

## Philosophy

### Your laptop is not your user

You build on a fast machine with a warm cache and a fibre connection. Your visitors open the link on a three-year-old Android in a train, on an iPad on hotel Wi-Fi, on a 5K monitor that asks for four times the pixels. Each of those is a different site. An audit that runs on one screen describes one person, and usually the one person who never complains: you.

### p75 is a person

Core Web Vitals are judged at the 75th percentile, per device class. So when your phone LCP is 3.1 s at p75, one phone visitor in four waits at least 3.1 s for the main content. An average hides them under everyone with a fast phone. Read p75 for phones and desktops separately, and picture the person behind it.

### Fix what people feel

A score is a summary. People feel specific moments: the screen staying dark, the headline vanishing, the button that doesn't answer, the image that sharpens two seconds late. Rank fixes by those moments, not by the size of the number they move. A change that improves Lighthouse while the filmstrip looks the same hasn't fixed anything.

### Measure, change one thing, measure again

Five fixes in one deploy tell you the total and nothing else. If one of them regressed the phone and another helped the desktop, the average says "a bit better" and you ship the regression. One change, the same harness, the same profiles, every time.

## Principles

1. **Measure before touching anything, on at least two profiles.** The phone and the largest screen the design targets. You can't know what changed without a before.
2. **Field data first when it exists.** CrUX, Vercel Speed Insights or `web-vitals` RUM show what real visitors get. Lab runs explain field numbers; they don't replace them.
3. **p75, split by device.** Core Web Vitals use the 75th percentile per device class.
4. **One change, one measurement.** Batched fixes hide which one helped and which one hurt.
5. **Rank by what the person feels.** Blank or flickering screen, then content jumping, then slow taps, then heavy bytes, then the rest.
6. **No fix ships that only moves a number.** Check the filmstrip and a real device.

## Diagnose

| Symptom (user's words) | Likely cause | Go to |
| --- | --- | --- |
| "Black screen for a second", "it flickers", "the font jumps" | Critical path, hydration, font loading | `first-load` |
| "Taps feel laggy", "scroll stutters", "the fan spins up" | Long tasks, layout thrash, render loops | `runtime-performance` |
| "Images are heavy on mobile", "blurry on my 4K screen" | Wrong candidates, missing `sizes`, uncapped DPR | `responsive-media` |
| "It's slow everywhere, even the HTML" | TTFB, no edge caching, cold starts | §4 |
| "Fast locally, slow in production" | Third-party scripts, missing compression, HTTP/1.1 | §4, §5 |
| "The bundle keeps growing" | Whole-app imports, heavy libraries in the main chunk | §6 |
| "Back button reloads the page" | bfcache blocked | §7 |
| "Lighthouse dropped but nothing changed" | Third-party script update, lab variance | §2, §5 |

## 1. The screen matrix

**Ask:** Which screens do your visitors use, and which screen does your design stress most? Measure at least those two.

| Profile | Viewport (CSS px) | DPR | CPU | Network | What it reveals |
| --- | --- | --- | --- | --- | --- |
| `phone-low` | 360 × 780 | 2 | 6× slower | Slow 4G | Main-thread cost: parse, hydration, long tasks |
| `phone` | 390 × 844 | 3 | 4× | Slow 4G | The default audit: critical path, fonts, flicker, LCP |
| `tablet` | 820 × 1180 | 2 | 2× | Fast 4G | Breakpoint-specific assets, orientation changes |
| `laptop` | 1440 × 900 | 2 | 1× | Fast 4G | More above the fold, desktop-only components |
| `desktop-4k` | 1920 × 1080 | 2 | 1× | Cable | 3840 device px wide: oversized heroes, canvas and blur cost |

Slow 4G is 150 ms RTT, 1.6 Mbps down, 750 Kbps up. Fast 4G is 60 ms, 9 Mbps, 1.5 Mbps. Cable is 20 ms, 50 Mbps, 10 Mbps. These are the harness presets; quote them with any number you report.

The phone and the 4K display fail for opposite reasons. The phone runs out of CPU and bandwidth: script work that takes 150 ms on a MacBook takes about 900 ms under `phone-low`'s 6× throttle, and often longer on a real budget phone. The 4K display runs out of pixels: the same full-screen blur that costs nothing on a 390 px phone paints 8 million device pixels a frame. You need both runs to see both problems.

## 2. Budgets

Core Web Vitals thresholds, field data at p75:

| Metric | Good | Needs improvement | Poor |
| --- | --- | --- | --- |
| LCP | ≤ 2.5 s | ≤ 4.0 s | > 4.0 s |
| INP | ≤ 200 ms | ≤ 500 ms | > 500 ms |
| CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |

Lab budgets for a marketing or content page. Tighten them for a landing page, loosen them for an app shell behind a login:

| | phone (Slow 4G, 4×) | laptop (Fast 4G) | desktop-4k |
| --- | --- | --- | --- |
| First paint | ≤ 1.0 s | ≤ 0.6 s | ≤ 0.5 s |
| LCP | ≤ 2.0 s | ≤ 1.2 s | ≤ 1.2 s |
| TBT | ≤ 200 ms | ≤ 100 ms | ≤ 100 ms |
| CLS | 0 | 0 | 0 |
| Flicker | none | none | none |
| JS on the first route (compressed) | ≤ 150 KB | ≤ 250 KB | ≤ 250 KB |
| Images above the fold | ≤ 200 KB | ≤ 500 KB | ≤ 800 KB |

The lab budget is tighter than the field threshold on purpose. The lab is one clean run; the field includes slower phones, worse networks and busy CPUs. A page at 2.4 s in the lab is often over 2.5 s for one visitor in four.

A budget is a tripwire. Crossing one means you open the filmstrip and explain why. Sometimes the answer is "this page is a video player" and the budget moves. Write that down.

## 3. The audit, in order

### Field data, split by device

- **CrUX** (PageSpeed Insights, the CrUX API or BigQuery) gives p75 LCP, INP and CLS for phones and desktops separately. Read both.
- **RUM** if the site has it: Vercel Speed Insights, or `web-vitals` with attribution sent to your own endpoint.

```js
import { onLCP, onINP, onCLS } from 'web-vitals/attribution'

const send = (m) => navigator.sendBeacon('/vitals', JSON.stringify({
  name: m.name, value: m.value, rating: m.rating,
  width: innerWidth, dpr: devicePixelRatio,
  target: m.attribution?.interactionTarget ?? m.attribution?.target ?? m.attribution?.largestShiftTarget,
}))
onLCP(send); onINP(send); onCLS(send)
```

Record viewport width and DPR with every metric. "Slow on mobile" turns into a fix once you know it's 360 px Android at DPR 2 and not iPhone at DPR 3.

### Lab runs per profile

```sh
node <skills>/web-performance/scripts/perf.mjs https://example.com --profile phone --runs 5 --selector h1
node <skills>/web-performance/scripts/perf.mjs https://example.com --profile all --runs 3 --out ./perf
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--profile` | `phone` | `phone-low`, `phone`, `tablet`, `laptop`, `desktop-4k`, a comma list, or `all` |
| `--runs` | `3` | Cold loads per profile; medians are reported |
| `--selector` | `h1` | Element whose per-frame opacity is traced to detect flicker |
| `--out` | `./perf/<profile>` | Output folder; with several profiles, one sub-folder each |

It prints one row per profile (FCP, LCP, headline visible, hydration, TBT, CLS, flicker, total KB, LCP element) and writes `report.json` and `filmstrip.png` (one frame every 150 ms). It needs Playwright in the project (`pnpm add -D playwright-core`) and Chrome, with a fallback to Playwright's bundled Chromium. The filmstrip needs `python3` and Pillow.

Run it against a production build or a deployed preview. A dev server serves unbundled, unminified code with hot-reload scripts, and its numbers are wrong in both directions.

Then a real device: Safari Web Inspector for iPhone, `chrome://inspect` for Android, cold, on cellular.

### Triage

Read the filmstrip first, then the numbers. Route every finding:

| Finding | Owner |
| --- | --- |
| Blank screen, content hidden then shown, font jump, theme flash, late LCP, shifts on load | `first-load` |
| Slow taps, INP over 200 ms, scroll jank, dropped frames, heat, battery drain | `runtime-performance` |
| Heavy or blurry images, video data cost, soft canvas on 4K, wrong format, missing `sizes` | `responsive-media` |
| Motion that feels slow at 60 fps | `web-animation-design` |
| Slow TTFB, no compression, weak caching, third parties, slow navigations | §4–7 below |

**Ask:** If you could fix one thing before tomorrow's launch, which frame in the phone filmstrip would you change? Start there.

## 4. Server and delivery

The HTML has to arrive before anything else can start. Every millisecond of TTFB delays every metric behind it, on every screen.

- **TTFB ≤ 0.8 s at p75.** Slower: cache the HTML at the edge (static, ISR or `stale-while-revalidate`), move data fetching off the critical path, check cold starts and the distance between your functions and your database.
- **Compression:** Brotli or gzip on HTML, CSS, JS, JSON and SVG. Never on woff2, AVIF, WebP, JPEG or MP4; they're already compressed and recompressing wastes CPU.
- **HTTP/2 or HTTP/3 in production.** HTTP/1.1 allows 6 connections per origin, so every preload competes with the stylesheet.
- **Caching:** hashed assets get `Cache-Control: public, max-age=31536000, immutable`. Unhashed files (fonts in `/public`, images by name) get a long `max-age` plus `stale-while-revalidate`. HTML gets a short `max-age` or `no-cache` with revalidation.
- **Origins:** each new origin on the critical path costs DNS, TCP and TLS, about 3 round trips, which is roughly 450 ms on Slow 4G. Self-host fonts. `preconnect` only to the 2–3 origins used in the first second.

## 5. Third-party scripts

Analytics, chat widgets, tag managers, A/B testing tools and embeds are a common cause of poor INP and TBT in the field, and they don't exist on your local build.

- **Inventory them.** Group `performance.getEntriesByType('resource')` by origin, with transfer size and duration.
- **Defer what the first paint doesn't need.** `defer` or `async`, load after the `load` event or on first interaction, or move to a worker with Partytown where it works.
- **Facades for heavy embeds.** A static thumbnail with a play button for YouTube or Vimeo, a plain button for the chat widget. Load the real thing on click.
- **Avoid anti-flicker snippets.** Client-side A/B tools that hide the page until the experiment decides create a blank screen on purpose. Run experiments on the server or at the edge.

**Ask:** Would the page still work for the first ten seconds without this script? If yes, it doesn't load in the first ten seconds.

## 6. Bundles

On `phone-low`, every 100 KB of compressed JS can cost hundreds of milliseconds of parse and execution before a tap can respond.

- Ship the route, not the app: route-level splitting, lazy overlays (modals, cart, search), lazy below-the-fold sections, and never the components of a branch the page doesn't render.
- Heavy libraries (three.js, charts, editors, GSAP plugins) in their own chunks, imported where used.
- Look for duplicates and whole-library imports: `npx vite-bundle-visualizer`, `npx nuxi analyze`, `@next/bundle-analyzer`. Moment, full lodash and complete icon packs are the usual finds.
- Target the browsers you support (ES2020 or later) and drop polyfills for the rest.

## 7. Navigation after the first page

The second page is where people decide whether the site feels fast.

- **bfcache.** Back and forward should be instant. Common blockers: `unload` handlers, `Cache-Control: no-store` on the HTML, open WebSocket or WebRTC connections, a `window.opener` reference. Check DevTools → Application → Back/forward cache, which names the blocker.
- **Prefetch on intent.** Framework link prefetching on viewport or hover (`<NuxtLink>`, Next's `<Link>`), or Speculation Rules for multi-page sites. `"eagerness": "moderate"` starts on hover (about 200 ms) or pointer down and suits most sites. `"immediate"` and `"eager"` prerender earlier and spend data that phone users on metered plans pay for.

```html
<script type="speculationrules">
{ "prerender": [{ "where": { "href_matches": "/*" }, "eagerness": "moderate" }] }
</script>
```

- **View transitions** make a navigation feel continuous; they don't make it faster. Keep them ≤ 300 ms and skip them under `prefers-reduced-motion: reduce`.

## Screens

| Screen | What changes | Check |
| --- | --- | --- |
| Low-end Android | CPU dominates: hydration, long tasks, third parties | `phone-low` profile, TBT, INP in the field |
| iPhone | Fast CPU, Safari specifics: `fetchpriority` from Safari 17.2, tight memory limits on large canvases and many layers, 120 Hz on Pro models | Safari Web Inspector on a real device |
| Tablet | Desktop layout, phone-class CPU, touch; landscape and portrait have different first screens and often different LCP elements | `tablet` profile in both orientations |
| Laptop | More above the fold; anything `loading="lazy"` in the first 900 px delays LCP | `laptop` profile, LCP element |
| 4K / 5K | Full-bleed heroes 3840–5120 device px wide; full-screen `backdrop-filter` or WebGL paints 8–14 million pixels per frame | `desktop-4k` profile, image bytes, frame rate |
| Resize, split view, foldables | A resize must not refetch the LCP image or rebuild the page | Rotate and resize with DevTools open on the Network panel |
| Save-Data | `navigator.connection?.saveData` and the `Save-Data` header ask for less: no autoplay video, lower image quality, no prefetch | Toggle Data Saver on Android Chrome |

## Measure

- **Harness:** `scripts/perf.mjs` (§3). Filmstrip first, numbers second, medians of 3 or more runs.
- **Lighthouse per screen:** the default mobile run and `npx lighthouse <url> --preset=desktop`. For a tablet, set `--screenEmulation.width`, `--screenEmulation.height` and `--screenEmulation.deviceScaleFactor`. Lighthouse simulates throttling by default; the harness applies DevTools throttling, which produces a real filmstrip.
- **DevTools Performance panel** with 4–6× CPU throttling and the matching network preset, to find the script, style recalculation or image behind a number.
- **Field:** CrUX by device, RUM with width and DPR.
- **Hardware:** one mid-range Android, one iPhone, one large external display. Emulation can't show GPU compile time, thermal throttling or the font cache.

## Before shipping

- [ ] Measured on a production build, on the phone profile and the largest target screen, then on a real device
- [ ] Field numbers read at p75 per device class, not as averages
- [ ] Filmstrip attached to every reported number, before and after
- [ ] One change per measurement
- [ ] Third-party scripts deferred, facaded or moved server-side; no anti-flicker snippet
- [ ] HTML revalidates instead of `no-store`; bfcache works on the main routes
- [ ] Brotli or gzip on text responses only
- [ ] `preconnect` limited to 2–3 origins used in the first second
- [ ] Speculation Rules at `moderate` or lower; Save-Data respected
- [ ] Images sized per screen (`responsive-media`)

## Report

- **Field** (if available): p75 LCP, INP and CLS for phones and desktops.
- **Lab:** one row per profile with first paint, LCP and its element, headline visible, TBT, CLS, flicker and KB.
- **Filmstrip:** the states the page passes through before it settles, per profile when they differ.
- **Ranked fixes:** most-felt first, each with its owner skill, the file and the expected effect. Apply what's in scope, then re-measure with the same command.
- **Needs a device:** whatever emulation can't prove.
