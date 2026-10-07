---
name: runtime-performance
description: Find and remove the work that makes a loaded page feel late, on every screen. Produces a trace-backed fix list, the code changes, and INP and frame stats per device profile. Covers INP (input delay, processing, presentation), long tasks and yielding (scheduler.yield, requestIdleCallback, Web Workers), forced reflow and layout thrashing, style recalc on large DOMs, compositor layers and will-change, passive listeners and scroll-driven animations, 60/120 Hz frame budgets, blur and backdrop-filter cost on 4K/5K, canvas and WebGL render loops, content-visibility and virtualization, memory leaks and teardown and thermal throttling. Use when "scroll is janky", "clicks feel laggy", "typing lags", "the menu opens late", "fans spin up", "drops frames on my 4K screen", "the phone gets hot", "INP is poor", or before shipping heavy interactive UI. Not for the first paint (first-load), image/video/canvas sizing (responsive-media), motion design (web-animation-design) or a cross-screen audit (web-performance).
---

# Runtime Performance

A trace-backed list of what makes the page late after load, and the changes that fix it, measured on a throttled phone and on the largest screen you support.

## Scope

Use it for: taps that answer late, input that lags, scroll that hitches, animations that drop frames, canvases that heat the device, pages that slow down over a session.

Not for: the first two seconds (`first-load`), image, video and canvas byte sizing (`responsive-media`), what should move and how (`web-animation-design`), a full audit across screens (`web-performance`).

## Philosophy

### A tap is a question

Every tap asks "did that work?" The interface has one frame to say yes. When the answer takes 300 ms, people tap again, and now there are two items in the cart. Users never see your INP number. They see a button that ignored them, and they stop trusting the next one.

### The frame is shared

Your handler, the framework, the browser's style and layout, the third-party chat widget: all of it runs on one main thread, inside one frame. At 60 Hz that frame is 16.7 ms. At 120 Hz it is 8.3 ms. Any code you add spends from a budget other work already needs, so ask what each new line of code pushes out of the frame.

### Phones run out of CPU, big screens run out of pixels

A mid-range Android runs your JavaScript four to six times slower than a laptop. A 5K display paints seven times the pixels of a 1080p monitor. The same page fails in two different ways at the two ends, and a MacBook hides both. Profile the cheap phone and the biggest screen; the laptop in between rarely surprises you.

### Idle should cost nothing

A page nobody is touching should use no CPU and no GPU. A shader that keeps drawing behind a closed tab, an interval polling every 100 ms, a scroll listener that stays attached after the route changed: none of it shows up in a demo. It shows up as a warm phone, a spinning fan and a battery that drains on a page that looks still.

## Principles

1. **Trace before you change code.** Fix the function the trace names, not the one that looks slow.
2. **Feedback paints in the next frame; the result lands within 200 ms.** Pressed state first, heavy work after a yield.
3. **No main-thread task over 50 ms during interaction or scroll.** A 15 ms task on a laptop is 60–90 ms at 4–6× CPU throttle.
4. **Read layout, then write it.** Interleaving `offsetHeight` reads and style writes forces one layout per iteration.
5. **Scroll belongs to the compositor.** `scroll`, `wheel` and `touchmove` listeners are passive; scroll-linked visuals use CSS or `IntersectionObserver`.
6. **Only `transform` and `opacity` animate continuously.** Blur, shadows and filters are paid per pixel, and a 5K display has 14.7 million.
7. **Every loop can stop.** Render loops, intervals and observers pause off-screen and in hidden tabs, and are torn down on route change.
8. **Same profile before and after.** Same device profile, same steps, 3+ runs, medians.

## Diagnose

| Symptom (user's words) | Likely cause | Go to |
| --- | --- | --- |
| "I tapped and nothing happened, so I tapped again" | Long handler, or a long task already running when input arrived | §1, §2 |
| "Typing lags" | Filtering or re-rendering on every `input` event | §1, §2 |
| "Scroll stutters on my phone" | Non-passive listeners, layout reads in scroll handlers | §4 |
| "The animation is choppy, worse on the big monitor" | Animated layout properties, large blur, too many layers | §5 |
| "It freezes for a moment after I click" | Forced layout or style recalc over a large DOM | §3 |
| "The fans spin up on an idle page" | Render loop or interval that never stops, uncapped canvas DPR | §6 |
| "Opening the list freezes" | Thousands of live DOM nodes | §7 |
| "It gets slower the longer the tab is open" | Leaked listeners, observers, timelines, WebGL resources | §8 |
| "Smooth at first, choppy after a minute" | Thermal throttling from sustained GPU/CPU load | §6, Screens |
| "Resizing the window janks" | Layout work on every `resize`, ResizeObserver feedback loop | Screens |

## 1. Interactions: paint first, work after

INP is the time from input to the next paint after the handlers run, taken from the slowest interactions of a visit. Thresholds at p75: good ≤ 200 ms, needs improvement ≤ 500 ms, poor > 500 ms. It replaced FID as a Core Web Vital on 12 March 2024 and counts every interaction, where FID counted the first.

**Ask:** what does the user need to see in the next frame to know the tap landed? Paint that first. Everything else can wait one task.

| Part | What it measures | Usual cause | Fix |
| --- | --- | --- | --- |
| Input delay | Input waiting for the main thread | Hydration, timers, analytics running | §2 |
| Processing | Your handlers | Too much work inside the handler | Paint the visible part, defer the rest |
| Presentation delay | Style, layout and paint of the result | Large DOM, forced layout, expensive paint | §3, §5, §7 |

```js
button.addEventListener('click', async () => {
  button.classList.add('is-pending') // visible answer, cheap
  await yieldToMain()                // let it paint
  render(computeExpensiveThing())    // the real work, next task
})
```

Picture "Add to cart" on a phone during hydration. The handler recalculates the total, updates three stores and logs an event: 180 ms of processing on top of 120 ms of input delay. The user sees nothing for 300 ms and taps again. Split it so the button shows its pending state in the next frame, and the second tap never happens.

- Pressed states live in CSS (`:active`, `[aria-pressed]`) and don't wait for JS.
- Optimistic UI: update the count, the heart, the cart badge first; reconcile with the server after.
- Analytics, logging and storage writes leave the handler: queue them after a yield or on idle.
- Text inputs: the native field echoes the character on its own, so never re-render the input. Debounce the expensive half (filter, search, validation) at ~150 ms.

## 2. Long tasks: split and yield

A task over 50 ms blocks any input that arrives during it. Split the work and yield between chunks.

The 50 ms line comes from the RAIL model: if input arrives at the worst moment, a 50 ms task still leaves room to answer within 100 ms. On `phone-low` a 12 ms laptop task becomes 72 ms and crosses it.

**Ask:** does this work have to happen before the next paint? If not, it goes after a yield, on idle, or in a Worker.

```js
function yieldToMain() {
  if (globalThis.scheduler?.yield) return scheduler.yield() // Chromium 129+
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function processAll(items, fn) {
  let deadline = performance.now() + 40
  for (const item of items) {
    fn(item)
    if (performance.now() > deadline) {
      await yieldToMain()
      deadline = performance.now() + 40
    }
  }
}
```

- `scheduler.yield()` resumes ahead of other queued tasks; `setTimeout(0)` goes to the back of the queue. Both let input through.
- Deferrable work (prefetch, precompute, cache warming): `requestIdleCallback(fn, { timeout: 2000 })`. Without `timeout` it can wait indefinitely on a busy page. Feature-detect it and fall back to `setTimeout`, since Safari support has lagged.
- CPU-bound pure work (parsing, image processing, search indexing) goes to a Web Worker. Removing 200 ms from the main thread beats chunking it.
- Third-party scripts run on the same thread. Check their LoAF attribution before blaming your own code.

## 3. Layout thrashing and style recalc

Reading `offsetHeight`, `getBoundingClientRect()`, `scrollTop` or `getComputedStyle()` after a style write forces a synchronous layout. In a loop, that is one layout per element.

An accordion list that measures each panel while expanding another is the classic case: 40 panels, 40 layouts, one frozen frame the user feels as a stutter right after the click. The fix changes no behaviour, only the order of reads and writes.

```js
// One forced layout per card
cards.forEach((card) => { card.style.height = card.scrollHeight + 'px' })

// One layout in total: all reads, then all writes
const heights = cards.map((card) => card.scrollHeight)
cards.forEach((card, i) => { card.style.height = heights[i] + 'px' })
```

- Batch writes in `requestAnimationFrame`, or read sizes from a `ResizeObserver` cache.
- Recalc cost scales with how many elements a change can touch. A class on `<body>` or a variable on `:root` restyles the whole document. Scope both to the smallest subtree.
- Don't drive per-frame motion through a CSS variable on a parent; set `transform` on the element.
- A broad `:has()` such as `body:has(.x)` re-evaluates on many DOM mutations. Keep the subject narrow.
- `contain: content` on self-contained widgets stops their changes from invalidating the page.
- Lighthouse flags DOM size above 1,400 nodes. Past that, profile style and layout specifically.

## 4. Scroll

Scrolling runs on the compositor and stays smooth while the main thread is busy, until a listener gives the main thread a vote.

Scroll is the interaction people repeat most, often hundreds of times per visit, and the one where a hitch is most visible because the content is under their finger. A single non-passive `touchmove` on `window` makes every scroll step wait for JS, and on a phone mid-hydration that wait is the stutter.

**Ask:** does this listener ever call `preventDefault()`? If not, it is passive. If it does, attach it to the one element that needs it.

```js
window.addEventListener('touchmove', onMove, { passive: true })
window.addEventListener('wheel', onWheel, { passive: true })
```

- A non-passive `touchstart`, `touchmove` or `wheel` listener makes every scroll step wait for JS. Use `{ passive: false }` only on the element that blocks scrolling (a canvas drag), never on `window`.
- Scroll-linked visuals (progress bar, parallax, header shrink) use scroll-driven animations (Chromium 115+, Safari 26) with a static fallback:

```css
@supports (animation-timeline: scroll()) {
  .progress { animation: grow linear both; animation-timeline: scroll(root); transform-origin: 0 50%; }
  @keyframes grow { from { transform: scaleX(0); } }
}
```

- Reveal-on-scroll uses `IntersectionObserver`, never `scroll` + `getBoundingClientRect()`.
- If JS must read scroll position, read it once per `requestAnimationFrame`. Trackpads and 120 Hz screens send more events than you have frames.
- `position: sticky` replaces JS that toggles `fixed`.
- Smooth-scroll libraries move scrolling onto the main thread. If one is required, it uses passive listeners, sleeps when idle, honours `prefers-reduced-motion`, and gets profiled on `phone-low`.
- `overscroll-behavior: contain` on inner scrollers stops scroll chaining into the page.

## 5. Frame budgets and animation cost

The browser needs part of each frame for style, layout, paint and compositing, so your share is smaller than the frame. On a 120 Hz iPad, a hover effect that runs 6 ms of JS per frame already misses frames that would have been fine at 60 Hz.

| Refresh rate | Frame | Practical JS per frame |
| --- | --- | --- |
| 60 Hz | 16.7 ms | ~10 ms |
| 120 Hz (ProMotion, high-refresh Android, 120 Hz laptops) | 8.3 ms | ~4–5 ms |

**Ask:** can this animation be expressed in `transform` and `opacity`? A sheet that slides is `translate`; a card that grows is `scale`; a header that shrinks is `scale` on the logo, not `height` on the bar.

- `transform` and `opacity` run on the compositor and survive a busy main thread as CSS animations or WAAPI. `width`, `top`, `box-shadow`, `filter` and large `clip-path` cost CPU or GPU every frame.
- Blur and `backdrop-filter` cost grows with area times radius. A 40 px backdrop blur on a menu is fine; the same blur full-screen on a 5K display drops frames. Keep large blurs static, smaller, or replace them with a pre-blurred image or an opaque fill on big screens.
- `will-change` reserves a GPU texture of element size × DPR². Set it right before the animation and remove it after. Dozens of full-width layers on a phone run out of GPU memory and get slower.
- Animate a child, not a container with 500 descendants. You pay for the painted area.
- JS animation libraries run on the main thread. Predetermined motion goes to CSS or WAAPI; per-frame JS stays allocation-free and never reads layout.

## 6. Render loops, canvas and WebGL

A `requestAnimationFrame` loop that runs when nobody can see it is the usual reason a landing page heats a phone.

A hero shader that keeps rendering after the user scrolls to the pricing table costs the same GPU time as when it was on screen. After a few minutes the phone throttles, and now the pricing table scrolls badly too. Stopping the loop off-screen fixes a symptom two sections away.

**Ask:** what changed on screen since the last frame? If nothing, don't draw.

```js
let running = false, raf = 0
const loop = (t) => { draw(t); raf = requestAnimationFrame(loop) }
const start = () => { if (!running) { running = true; raf = requestAnimationFrame(loop) } }
const stop = () => { running = false; cancelAnimationFrame(raf) }

new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop())).observe(canvas)
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()))
```

- Cap the backing store: `canvas.width = cssWidth * Math.min(devicePixelRatio, 2)`. Full-screen on a 5K display at DPR 2 is 5120 × 2880 = 14.7 MP per frame. Gradient and noise shaders look the same at 0.5–0.75 render scale there.
- Render on demand when nothing changes; draw ambient scenes at 30 fps.
- Animate from the rAF timestamp so motion is identical at 60 and 120 Hz.
- Under `prefers-reduced-motion`, draw one frame and stop.
- Sustained GPU load triggers thermal throttling on phones within minutes, and then the whole page slows down.

## 7. Big lists and long pages

A feed of 3,000 cards lays out all 3,000 every time a filter changes, though the user sees eight. The cost scales with what exists, not with what is visible.

**Ask:** how many items can this list hold in production, not in the fixture? Under 100, render them. Hundreds, `content-visibility`. Thousands, virtualize.

```css
.feed-item { content-visibility: auto; contain-intrinsic-size: auto 320px; }
```

- `content-visibility: auto` (Chromium 85+, Firefox 125+, Safari 18+) skips layout and paint for off-screen sections. `contain-intrinsic-size` keeps the scrollbar from jumping.
- Virtualize lists in the thousands (tables, logs, chat, search results). `content-visibility` reduces rendering cost; virtualization removes the nodes.
- Skip virtualization under ~100 items. It breaks find-in-page, anchors and screen-reader navigation for no gain.

## 8. Memory and teardown

In an SPA the page never reloads, so every leaked listener, observer, timeline and WebGL resource accumulates across routes.

Someone browsing products for ten minutes visits thirty routes. If each product page leaks a `resize` listener and a GSAP timeline, the thirtieth page runs thirty resize handlers on every rotation. Nothing breaks in testing because nobody tests the thirtieth page.

**Ask:** for every setup line in this component, where is its teardown line?

```js
const ac = new AbortController()
window.addEventListener('resize', onResize, { signal: ac.signal })
window.addEventListener('keydown', onKey, { signal: ac.signal })
ac.abort() // on teardown: removes both
```

- Observers `disconnect()`, intervals `clearInterval`, GSAP `ctx.revert()`, Three.js `dispose()` on geometries, materials, textures and render targets, then `renderer.dispose()` and `renderer.forceContextLoss()`.
- Chromium keeps about 16 live WebGL contexts per page and drops the oldest. One leaked context per navigation ends in a black canvas.
- Check: heap snapshot, navigate away and back five times, snapshot again, filter "Detached".

## 9. Framework notes

- **Vue:** library instances (map, chart, Three scene, editor) go in `markRaw`; large arrays in `shallowRef`, replaced, never mutated. `v-memo` and `v-once` on large static subtrees.
- **React:** move state down, split context, `memo` expensive children with stable props, `useTransition` or `useDeferredValue` so the typed character paints before the filtered list. With the React Compiler enabled, hand-written memoization is mostly redundant.
- "The framework is slow" needs a trace where framework frames dominate. Usually the cost is inside your components.

## Screens

| Screen | What changes | Check |
| --- | --- | --- |
| Low-end Android | CPU is the budget | `phone-low` (6×): long tasks, INP, hydration |
| iPhone | 120 Hz panels; Safari has capped rAF near 60 Hz by default; Low Power Mode caps the display at 60 Hz | Frame pacing at both rates, long sessions for heat |
| Tablet | Phone-class CPU, laptop-size viewport: more DOM, bigger layers and blurs. Split View resizes at any time | `tablet` profile, live resize, canvas backing store follows |
| Laptop | Trackpads send several `wheel` events per frame; 120 Hz MacBook Pro halves the budget; DPR 2 means 4× layer memory | Coalesce `wheel` and `pointermove` into one rAF |
| 4K / 5K / ultrawide | Pixels are the budget: 5K has 1.8× the pixels of 4K, 7× of 1080p; one full-screen layer is ~59 MB | `desktop-4k` profile, static blurs, capped canvas DPR, fullscreen at max size |
| Resize and orientation | `resize` fires continuously while dragging | `ResizeObserver`; cheap updates now, heavy ones debounced 100–150 ms; never resize the observed element from its own callback |

`orientationchange` is deprecated. Listen to `resize` or `screen.orientation` `change`.

## Measure

The harness loads a URL on a device profile, scrolls it with a real gesture (`Input.synthesizeScrollGesture`), optionally taps a selector, and reports LoAF, long tasks, dropped frames and the interaction breakdown:

```sh
node <skills>/runtime-performance/scripts/runtime.mjs <url> [--profile phone|phone-low|tablet|laptop|desktop-4k] [--tap <selector>] [--out <dir>] [--runs 3]
# → <out>/report.json (default ./runtime-report), plus a console summary
```

Needs `playwright` or `playwright-core` resolvable from the current directory, and Chrome (falls back to bundled Chromium). Serve over HTTP: on `file://` Chrome drops LoAF script attribution. Refresh rate is measured on the idle page before throttling, so dropped frames count against the real interval.

**DevTools Performance panel**, CPU 4× or 6×: read the Main track for long tasks, purple *Layout* blocks marked "Forced reflow", the Interactions track (hover for the three-part split), and the Frames track for dropped frames. *Rendering → Paint flashing* and *Layer borders* show what repaints and what is promoted.

**Long Animation Frames** (Chromium 123+) attribute slow frames to scripts:

```js
new PerformanceObserver((list) => {
  for (const f of list.getEntries()) {
    console.table(f.scripts.map((s) => ({ invoker: s.invoker, source: s.sourceURL, fn: s.sourceFunctionName, ms: Math.round(s.duration), forcedLayout: Math.round(s.forcedStyleAndLayoutDuration) })))
  }
}).observe({ type: 'long-animation-frame', buffered: true })
```

**Field data:** `onINP` from `web-vitals/attribution` gives `interactionTarget`, `inputDelay`, `processingDuration`, `presentationDelay` and the matching LoAF entries. Lab traces show what can be slow; field data shows what is.

**Hardware:** Android via `chrome://inspect`, iPhone and iPad via Safari → Develop → device → Timelines. Thermal behaviour only shows on a device.

Targets on `phone`: INP ≤ 200 ms (aim ≤ 100), no LoAF over 100 ms during scroll, dropped frames < 5 %, no tap-triggered task over 50 ms, zero activity from an off-screen canvas.

Observer snippets, trace reading, yield and batching helpers, render-loop and teardown recipes: [REFERENCE.md](REFERENCE.md).

## Before shipping

- [ ] Pressed and pending states are CSS or a class set before any heavy work
- [ ] No handler runs a task over 50 ms; long work is chunked with `scheduler.yield()` (fallback `setTimeout`) or sits in a Worker
- [ ] Every `requestIdleCallback` has a `timeout`
- [ ] No loop interleaves layout reads and style writes
- [ ] `touchmove` and `wheel` listeners are passive; `passive: false` only on the element that blocks scroll
- [ ] Scroll-linked visuals use scroll-driven animations, `IntersectionObserver` or `position: sticky`
- [ ] Nothing animates `width`, `height`, `top`, `left` or `box-shadow`
- [ ] No animated full-screen `backdrop-filter`; large blurs are static
- [ ] `will-change` is set per animation and removed after
- [ ] Canvas DPR is capped at 2, lower on 4K/5K
- [ ] Render loops stop off-screen, in hidden tabs and under reduced motion
- [ ] Lists in the thousands are virtualized or use `content-visibility: auto` with `contain-intrinsic-size`
- [ ] Every listener, observer, timeline and WebGL resource has a teardown
- [ ] Vue library instances are `markRaw`, large arrays `shallowRef`
- [ ] Measured on `phone` or `phone-low`, the largest supported screen, and one real device

## Report

- Before → after per profile: INP split for the interaction that mattered, worst LoAF, long tasks, dropped-frame %.
- Each change on one line, tied to the moment it fixes ("cart button: pressed state paints before the price recalculation").
- What needs a device: heat over minutes, Safari's rAF cadence on ProMotion, GPU fill-rate on a 5K display, Low Power Mode.
- A change that doesn't move the trace gets reverted and reported as such.
