# Runtime Performance: Reference

Recipes behind [SKILL.md](SKILL.md). Each section stands alone; open the one that matches the fix.

## 1. Observers

Paste into the console or a debug build. Feature-detect with `PerformanceObserver.supportedEntryTypes`; LoAF and `longtask` are Chromium only.

```js
const types = PerformanceObserver.supportedEntryTypes

// Interactions (Event Timing). interactionId groups the pointerdown/up/click of one tap.
if (types.includes('event')) {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (!e.interactionId) continue
      const inputDelay = e.processingStart - e.startTime
      const processing = e.processingEnd - e.processingStart
      const presentation = e.startTime + e.duration - e.processingEnd
      console.log(e.name, e.target, { total: e.duration, inputDelay, processing, presentation })
    }
  }).observe({ type: 'event', durationThreshold: 16, buffered: true })
}

// Long animation frames, attributed to scripts.
if (types.includes('long-animation-frame')) {
  new PerformanceObserver((list) => {
    for (const f of list.getEntries()) {
      console.log('LoAF', Math.round(f.duration), 'blocking', Math.round(f.blockingDuration),
        'style+layout at', Math.round(f.styleAndLayoutStart - f.startTime))
      for (const s of f.scripts) console.log('  ', s.invoker, s.sourceURL, s.sourceFunctionName,
        Math.round(s.duration), 'forced layout', Math.round(s.forcedStyleAndLayoutDuration))
    }
  }).observe({ type: 'long-animation-frame', buffered: true })
}

// Long tasks: older and coarser, no script attribution.
if (types.includes('longtask')) {
  new PerformanceObserver((l) => l.getEntries().forEach((t) => console.log('longtask', Math.round(t.duration))))
    .observe({ type: 'longtask', buffered: true })
}

// Dropped frames from rAF deltas. Median delta ≈ refresh interval.
function frameMonitor(ms = 5000) {
  const deltas = []
  let last = performance.now()
  return new Promise((resolve) => {
    const end = last + ms
    const tick = (t) => {
      deltas.push(t - last)
      last = t
      if (t < end) return requestAnimationFrame(tick)
      const interval = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)]
      const dropped = deltas.reduce((n, d) => n + Math.max(0, Math.round(d / interval) - 1), 0)
      resolve({ hz: Math.round(1000 / interval), frames: deltas.length, dropped, pct: +((100 * dropped) / (deltas.length + dropped)).toFixed(1) })
    }
    requestAnimationFrame(tick)
  })
}
```

Event Timing durations are rounded to 8 ms, and `durationThreshold` cannot go below 16. Run `frameMonitor` on an idle page first: a janky page has a misleading median.

## 2. Reading a trace

Performance panel, recorded at 4× or 6× CPU:

| You see | It means | Go to |
| --- | --- | --- |
| Long yellow block under *Event: click* | Processing: your handler | SKILL §1, §2 |
| Another task running when the event starts | Input delay | SKILL §2 |
| Purple *Layout* with a red "Forced reflow" marker | Layout read after a write in JS | §4 here |
| *Recalculate Style* touching thousands of elements | Class or variable change on a high ancestor, broad `:has()` | SKILL §3 |
| Green *Paint* / *Raster* every frame of an animation | Non-composited property or blur | SKILL §5 |
| GPU track saturated, main thread idle, frames dropping | Fill-rate: blur, `backdrop-filter`, big canvas, many layers | SKILL §5, §6 |
| rAF callbacks firing while nothing on screen changes | A loop that should have stopped | §6 here |
| JS heap steps up after each navigation and stays up | Leak | §9 here |

## 3. Yield helpers

```js
export const yieldToMain = () =>
  globalThis.scheduler?.yield ? scheduler.yield() : new Promise((r) => setTimeout(r, 0))

// Run until the budget is spent, then yield.
export async function sliced(items, fn, budget = 8) {
  let start = performance.now()
  for (let i = 0; i < items.length; i++) {
    fn(items[i], i)
    if (performance.now() - start > budget) {
      await yieldToMain()
      start = performance.now()
    }
  }
}

// Idle queue with a guaranteed run.
export function whenIdle(tasks, timeout = 2000) {
  const ric = globalThis.requestIdleCallback ?? ((cb) => setTimeout(() => cb({ timeRemaining: () => 8, didTimeout: true }), 1))
  const run = (deadline) => {
    while (tasks.length && (deadline.timeRemaining() > 4 || deadline.didTimeout)) tasks.shift()()
    if (tasks.length) ric(run, { timeout })
  }
  ric(run, { timeout })
}

```

- Budget 8 ms when the page may run at 120 Hz; 40 ms for background work where only input matters (stays under the 50 ms long-task line).
- Debounce (~150 ms) work whose result matters once the user pauses: search, validation. Work that tracks the pointer (drag, resize handles) runs once per `requestAnimationFrame` with the latest event.

## 4. Read/write batching

```js
const reads = [], writes = []
let scheduled = false
function flush() {
  scheduled = false
  reads.splice(0).forEach((f) => f())
  writes.splice(0).forEach((f) => f())
}
const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(flush) } }
export const measure = (f) => { reads.push(f); schedule() }
export const mutate = (f) => { writes.push(f); schedule() }
```

Reads that force layout after a write: `offset*`, `client*`, `scroll*`, `getBoundingClientRect()`, `getClientRects()`, layout-dependent `getComputedStyle()` values, `innerText`, `focus()`, `scrollIntoView()`. The trace's "Forced reflow" marker names the exact line.

**FLIP** for layout-changing animations: read the first rect, apply the change, read the last rect, animate `transform` from the delta. One forced layout, then compositor-only motion.

## 5. Scroll-driven effects with fallbacks

```css
.progress { position: fixed; inset: 0 0 auto; height: 2px; transform-origin: 0 50%; transform: scaleX(0); }
@supports (animation-timeline: scroll()) {
  .progress { animation: progress linear both; animation-timeline: scroll(root block); }
  @keyframes progress { to { transform: scaleX(1); } }
}

@supports (animation-timeline: view()) {
  .reveal { animation: reveal linear both; animation-timeline: view(); animation-range: entry 0% entry 60%; }
  @keyframes reveal { from { opacity: 0; transform: translateY(16px); } }
}
@media (prefers-reduced-motion: reduce) { .reveal, .progress { animation: none; } }
```

Without scroll timelines, show the final state, or toggle a class once with an observer:

```js
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) }
}, { rootMargin: '0px 0px -10% 0px' })
document.querySelectorAll('.reveal').forEach((el) => io.observe(el))
```

Never pre-hide above-the-fold content waiting for an observer. That is a first-load flicker (`first-load`).

## 6. A render loop that stops

```js
export function createLoop(canvas, draw, { fps = 0 } = {}) {
  let raf = 0, visible = false, last = 0
  const minDelta = fps ? 1000 / fps : 0
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')
  const frame = (t) => {
    raf = requestAnimationFrame(frame)
    if (minDelta && t - last < minDelta - 1) return // ambient scenes: fps: 30
    last = t
    draw(t)
  }
  const sync = () => {
    const should = visible && !document.hidden && !reduce.matches
    if (should && !raf) raf = requestAnimationFrame(frame)
    if (!should && raf) { cancelAnimationFrame(raf); raf = 0 }
    if (reduce.matches) draw(0) // one still frame
  }
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync() })
  io.observe(canvas)
  document.addEventListener('visibilitychange', sync)
  reduce.addEventListener('change', sync)
  return () => {
    io.disconnect()
    document.removeEventListener('visibilitychange', sync)
    reduce.removeEventListener('change', sync)
    cancelAnimationFrame(raf)
  }
}
```

## 7. Adaptive canvas resolution

```js
// Backing store: DPR capped, total pixels capped for huge screens.
export function sizeCanvas(canvas, { maxDpr = 2, maxPixels = 2560 * 1440 } = {}) {
  const { width, height } = canvas.getBoundingClientRect()
  let dpr = Math.min(devicePixelRatio, maxDpr)
  const px = width * height * dpr * dpr
  if (px > maxPixels) dpr *= Math.sqrt(maxPixels / px)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  return dpr
}

// Drop render scale after sustained slow frames.
let scale = 1, slow = 0
export function adapt(frameMs, budgetMs, apply) {
  slow = frameMs > budgetMs * 1.2 ? slow + 1 : Math.max(0, slow - 1)
  if (slow > 30 && scale > 0.5) { scale -= 0.1; slow = 0; apply(scale) }
}
```

Three.js: `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`, plus the pixel cap through `renderer.setSize`.

## 8. Resize without loops

```js
let pending = 0
const ro = new ResizeObserver((entries) => {
  const { inlineSize, blockSize } = entries[0].contentBoxSize[0]
  cheapUpdate(inlineSize, blockSize)
  clearTimeout(pending)
  pending = setTimeout(() => expensiveRelayout(inlineSize, blockSize), 120)
})
ro.observe(container)
```

- Observe the container, write to a child. Writing the observed element's own size triggers "ResizeObserver loop completed with undelivered notifications".
- Container queries handle breakpoint layout changes with no JS at all.

## 9. Teardown by stack

**Vanilla:** one `AbortController` per component for listeners; `disconnect()` observers; `clearInterval`/`clearTimeout`; `cancelAnimationFrame`; `URL.revokeObjectURL`.

**Vue:**
```js
onMounted(() => { ac = new AbortController(); ctx = gsap.context(() => { /* timelines */ }, root.value) })
onBeforeUnmount(() => { ac.abort(); ctx.revert(); ro?.disconnect(); stopLoop?.() })
```
Chart, map and scene instances in `markRaw` or outside reactive state.

**React:**
```js
useEffect(() => {
  const ac = new AbortController()
  window.addEventListener('resize', onResize, { signal: ac.signal })
  return () => ac.abort()
}, [])
```
`useGSAP` from `@gsap/react` reverts on unmount; plain `gsap` inside `useEffect` needs `ctx.revert()` in the cleanup.

**Three.js:**
```js
scene.traverse((o) => {
  o.geometry?.dispose()
  for (const m of [].concat(o.material ?? [])) {
    for (const v of Object.values(m)) v?.isTexture && v.dispose()
    m.dispose()
  }
})
renderTarget?.dispose(); controls?.dispose()
renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
```

**Leak check:** Memory panel heap snapshot, navigate away and back five times, snapshot again, filter "Detached". `getEventListeners(window)` in the console shows listener counts.

## 10. Device profiles

Used by `scripts/runtime.mjs`. Reuse them for manual DevTools runs so numbers stay comparable.

| Profile | Viewport | DPR | Input | CPU throttle | Stands in for |
| --- | --- | --- | --- | --- | --- |
| `phone` | 390×844 | 3 | touch | 4× | Recent mid-range phone |
| `phone-low` | 360×780 | 2 | touch | 6× | Low-end Android |
| `tablet` | 820×1180 | 2 | touch | 2× | iPad Air class |
| `laptop` | 1440×900 | 2 | trackpad | 1× | MacBook class |
| `desktop-4k` | 1920×1080 | 2 | mouse | 1× | 4K monitor at 200 % (3840×2160) |

CPU throttling slows the CPU, not the GPU. Fill-rate problems show up through the `desktop-4k` pixel count and on real hardware only.
