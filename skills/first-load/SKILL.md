---
name: first-load
description: Make the first two seconds of a page load steady on every screen. No blank screen before the first paint, no content hidden and shown again at hydration, no font swap jump, no placeholder that pops into a different image, no layout shift. Covers render-blocking CSS, critical paint, SSR + hydration flicker (JS hiding server-rendered content), fonts (preload, subsetting, unicode-range, metric-matched fallbacks), shader and image placeholders, LCP, CLS, theme flash, per-breakpoint critical paths, and a throttled filmstrip to measure it. Use when a page "shows a black/white screen first", "flickers on load", "text jumps when the font loads", "the animation starts late", "the hero pops in", when LCP or CLS regress, or before shipping a landing page. For curves and durations use web-animation-design; for image and video bytes per screen use responsive-media; for jank after load use runtime-performance; for a full audit use web-performance.
---

# First Load

Every frame between pressing Enter and the page settling shows either the final design or a deliberate step toward it.

## Scope

Use it for: the blank first second, hydration flicker, font loading, placeholders for shaders, video and hero images, theme flash, layout shifts during load, the LCP element on each breakpoint.

Not for: easing and duration values (`web-animation-design`), image sizes and formats per screen (`responsive-media`), slow taps or scroll jank after load (`runtime-performance`), a full multi-screen audit (`web-performance`).

## Philosophy

### The first frame is a design

Someone opening your link on a train sees the first frame before anything else you made. If that frame is a white rectangle on a dark brand, the product has already said something you didn't design. Treat the frame at 300 ms with the same care as the settled page: the right background colour, the right font or a fallback that occupies the same space, nothing that will be taken away a moment later.

### Every frame is a valid state

A load is a sequence. Each frame should show either the final design or a step that moves toward it: a placeholder that resembles the final, an entrance in progress. A frame that goes backwards (content visible, then hidden) or sideways (a gradient replaced by a different scene) reads as a glitch, even when it lasts 200 ms. People can't name it, but they notice the page "loading weird".

### Numbers lie without a filmstrip

Fading the hero in from opacity 0 can improve LCP on paper while the person stares at an empty page. A good TBT says nothing about the font swapping halfway through the headline. Metrics tell you when; the filmstrip tells you what. You need both, from the same run, before and after every change.

### Your laptop hides all of this

On a MacBook over fibre, every resource arrives in the same few milliseconds and none of these defects exist. On a mid-range Android over a weak 4G signal, the stylesheet takes 400 ms, hydration takes 2 s, and the flicker becomes obvious. Measure on the slow profile first, then confirm on a real phone.

## Principles

1. **Read the filmstrip before the numbers.** People see a sequence of frames: dark rectangle, gradient, fallback font, real font, logo. Each change is a separate defect, and a metric like FCP hides most of them.
2. **JavaScript never hides what the server already painted.** `gsap.from({ opacity: 0 })`, `v-if="mounted"` and `opacity-0` until `onMounted` all paint the content, remove it at hydration, then bring it back.
3. **CSS for what isn't on this route stays off the critical path.** A component rendered only in another branch, mode or below the fold must not add a render-blocking `<link>`.
4. **The first text paint uses the real font or a fallback with the same metrics.** The swap may change letterforms. It may not move a line.
5. **A placeholder matches what replaces it.** Same colours, same composition, same position, then a short crossfade.
6. **Same harness before and after.** Same throttling, viewport and run count. Report medians with the filmstrip.

## Diagnose

| Symptom (user's words) | Likely cause | Go to |
| --- | --- | --- |
| "Black screen for a second" | Render-blocking CSS, fonts or JS arriving late or competing for bandwidth | §1 |
| "It shows, disappears, then fades back" | JS entrance hiding SSR content at hydration | §2 |
| "The text jumps when the font loads" | Late font discovery, no preload, unmatched fallback | §3 |
| "The font changes in the middle of the animation" | Entrance starts before the font arrives | §3, §4 |
| "The logo shows up last" | Separate, slower entrance or a late asset | §4 |
| "The background suddenly changes" | Placeholder doesn't resemble the shader, video or image | §5 |
| "It flashes white before going dark" | Theme applied after the first paint | §6 |
| "Things move around while it loads" | Missing dimensions, injected UI, font metrics | §7 |
| "Buttons don't respond at first" | Long hydration, long tasks | §8 |
| "LCP is late but the HTML is fast" | LCP element hidden by an animation or lazy-loaded | §9 |
| "Fine on my phone, slow on desktop" (or the reverse) | Different LCP element per breakpoint, desktop assets on every critical path | §10 |

## 1. The blank first second

The browser paints nothing until every render-blocking stylesheet in `<head>` has downloaded and been parsed. On Slow 4G (about 200 KB/s) with a 4× slower CPU, a 120 KB stylesheet costs about 100 ms to download and about 200 ms to parse, and it shares the connection with every `modulepreload`, font and image the HTML announces.

- **List the blocking resources:** `performance.getEntriesByType('resource').filter(e => e.renderBlockingStatus === 'blocking')`. Each entry sits on the critical path.

**Ask:** Does this stylesheet style anything visible in the first viewport on this route? If not, it shouldn't block the paint.

- **Drop CSS that isn't for this route.** In Vue/Nuxt, a statically imported component ships its CSS as a blocking `<link>` even when its `v-if` branch never renders. Use `defineAsyncComponent` or Nuxt's `Lazy*` prefix for branches, modes and below-the-fold sections. In React, `React.lazy` or `next/dynamic`.
- **Give the critical resources priority.** `fetchpriority="high"` on the LCP image and on above-the-fold font preloads. Preload nothing the first paint doesn't use.
- **Paint the page colour from the HTML.** A one-line inline `<style>html{background:#111}</style>` makes the first frame the right colour instead of the browser's default white. Pair it with `<meta name="color-scheme">` and `theme-color`.
- **Watch the global stylesheet.** A utility framework's single CSS file grows with the whole app, admin and dashboards included. Keep the entry stylesheet lean and let route-specific CSS load with its route.
Why it matters: on a phone over Slow 4G, every 100 KB of blocking CSS is roughly half a second of an empty screen before parsing even starts. Nothing you designed is on screen yet.

- Local dev servers usually speak HTTP/1.1 (6 connections per origin), so contention looks worse than on HTTP/2 or HTTP/3 in production. Fix it anyway: a mid-range phone on a weak network behaves closer to the throttled run than to your laptop.

## 2. Hydration flicker

SSR paints the hero. JS loads, hydrates, and runs `gsap.from('.hero', { opacity: 0 })`, which sets opacity 0 on something already visible and animates it back. On a slow phone the hero blinks out for hundreds of milliseconds. `opacity-0` classes removed in `onMounted`, `v-if="isMounted"` wrappers and `<ClientOnly>` around visible content do the same.

You won't see it locally: on a fast laptop, hydration finishes before the first paint is even visible. On a low-end Android the HTML paints at 0.9 s, hydration lands at 3–4 s, and the headline vanishes and returns in front of the reader.

**Ask:** Is this element in the server HTML and visible without scrolling? If yes, its entrance runs in CSS.

```css
/* Runs with the first frame, needs no JS */
.hero-line {
  animation: rise 700ms var(--ease-out) both;
}
.hero-line:nth-child(2) { animation-delay: 80ms; }

@keyframes rise {
  from { opacity: 0; transform: translateY(10px); }
}

@media (prefers-reduced-motion: reduce) {
  .hero-line { animation: none; }
}
```

- If it's in the SSR HTML and above the fold, its entrance is CSS. JS entrances are for content that appears after load: scroll reveals, route changes, user actions.
- Scroll reveals that pre-hide (`.reveal { opacity: 0 }` waiting for an IntersectionObserver) never apply above the fold. Gate the pre-hide on a class set by an inline head script (`html.js .reveal`) so a failed or blocked script leaves everything visible.
- Play the entrance once per visit. A client-side navigation back to the page shouldn't replay it.
- To detect it, trace the hero's effective opacity on every frame from the first paint. Any visible-to-hidden transition is a flicker. The harness in *Measure* does this.

## 3. Fonts

A `@font-face` file is fetched only after the CSS is parsed and the browser finds text that needs it, which is often the moment the page is already visible. With `font-display: swap`, text renders in the fallback and re-renders when the face arrives.

The person starts reading the headline in Arial, and 400 ms later every line shifts width and some words jump to the next line. They lose their place. With a preload and a matched fallback, the swap becomes a change of letterforms in place, and on most connections the real font arrives before the text is visible at all.

**Ask:** Which faces are visible in the first viewport on the phone? Preload those, and only those.

- **Preload every face used above the fold**, usually two (display and body), with `fetchpriority="high"` and `crossorigin`. More preloads compete with the CSS.
- **Subset.** Many fonts ship Latin Extended, Greek, Cyrillic and symbols. Split a Latin core from the rest with `unicode-range`; the browser downloads the full file only when a character needs it. Expect 40–60% less per face, depending on the font.

```css
/* Declared first: the full file, fetched only for characters the subset lacks */
@font-face { font-family: 'Brand'; src: url(/fonts/Brand-Light.woff2) format('woff2'); font-weight: 300; font-display: swap; }
/* Declared last: wins for every character in its range */
@font-face {
  font-family: 'Brand'; src: url(/fonts/Brand-Light-latin.woff2) format('woff2'); font-weight: 300; font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2190-2199, U+2212;
}
```

```sh
python3 -m fontTools.subset Brand-Light.woff2 \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2199,U+2212" \
  --layout-features='*' --flavor=woff2 --output-file=Brand-Light-latin.woff2
```

- **Metric-matched fallback.** Declare a local face with overridden metrics and put it right after the web font in the stack. Lines then wrap at the same points before and after the swap.

```css
@font-face {
  font-family: 'Brand Fallback';
  src: local('Helvetica Neue'), local('Arial');
  size-adjust: 96%;          /* match average glyph width */
  ascent-override: 103%;     /* hhea.ascent / unitsPerEm / size-adjust */
  descent-override: 24%;     /* |hhea.descent| / unitsPerEm / size-adjust */
  line-gap-override: 0%;
}
:root { --font-sans: 'Brand', 'Brand Fallback', system-ui, sans-serif; }
```

Read `hhea.ascent`, `hhea.descent` and `head.unitsPerEm` with fontTools. Tune `size-adjust` by comparing the rendered width of one sample line in both fonts. `fontaine` (Nuxt, Vite) and `next/font` generate these overrides for you.

- `font-display: swap` for the faces you preload. `font-display: optional` for faces that aren't worth a swap on a slow first visit; they'll be cached for the next one.

## 4. One sequence for the first screen

A header that fades over 1200 ms, a title rising at 160 ms, a form at 340 ms and a logo last reads as loading. The person waits for the last piece before trusting the page, so the slowest entrance sets the perceived load time.

**Ask:** When does the last element of the first screen settle? If the answer is past 1 s, shorten the sequence before tuning anything else.

On first load:

- Content settles within about 800 ms, staggered 60–100 ms, `ease-out`. The brand mark is in the first step.
- Start text entrances when the font can be there. With preloads it usually arrives with the CSS. If it doesn't, a delay of up to 100 ms costs less than a swap halfway through the animation.
- Blur in entrances: text only, under 8 px, and never on an element that is a backdrop root, because it breaks the `backdrop-filter` behind it.
- Decorative layers (shader, video, ambient loops) start after the content has settled.

## 5. Placeholders

A WebGL shader, a video or a hero image replaces a placeholder. When the placeholder is a flat gradient and the final is a textured scene, the swap looks like a second page load.

On a 4K display the shader may be ready in 300 ms; on a phone it may take 2 s to compile. Both people should see the same composition the whole time, with the texture sharpening at the end.

**Ask:** If the real thing never loaded, would the placeholder still look intentional? If not, it's a loading state, and people will read it as one.

- Build the placeholder from the same parts: same colour stops, same composition, an approximation of the texture (`repeating-linear-gradient` for stripes, a blurred 20–40 px LQIP for photos).
- Crossfade over 300–600 ms `ease-out` once the real thing has drawn its first frame. For WebGL, wait for the first rendered frame, not context creation. For images, wait for `img.decode()`.
- Load the expensive part (`import('three')`, shader compile) when idle, with a bound: `requestIdleCallback(init, { timeout: 2000 })`, falling back to `setTimeout(init, 1)` where `requestIdleCallback` is missing (Safari). Stop rendering off-screen.
- Under `prefers-reduced-motion: reduce`, render one still frame or keep the placeholder.

## 6. Theme flash

A dark-mode site that applies its theme during hydration paints light first. A small inline `<script>` in `<head>` reads the stored preference (or `prefers-color-scheme`) and sets the class and `color-scheme` before the first paint. Keep it dependency-free and under 1 KB, and set `theme-color` there too so the browser UI matches from the first frame.

A white flash on a dark site is brightest at night, in a dark room, on an OLED phone.

```html
<script>
  try {
    const t = localStorage.getItem('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    document.documentElement.classList.toggle('dark', t === 'dark')
    document.documentElement.style.colorScheme = t
  } catch {}
</script>
```

## 7. Layout stability

A shift during load moves the button someone was about to tap. On a phone that means a wrong tap and a page they didn't want.


- Every `img`, `video`, `iframe` and `canvas` has `width` and `height`, or an `aspect-ratio`.
- UI injected after load (cookie banners, toasts, sticky bars) overlays the page. It never pushes content down.
- Fonts: the metric overrides in §3.
- Find the source of each shift: `layout-shift` entries carry `sources[].node`.

## 8. JavaScript on the first route

- Ship the route. Lazy-load overlays (cart, search, modals) on first open, below-the-fold sections near the viewport, and components of other modes never.
- Heavy libraries (three.js, GSAP plugins, charts) live in their own chunks, imported where used.
- Long tasks over 50 ms during load delay the first taps. Decorative setup (shader compile, canvas) runs when idle and yields between steps.
- `modulepreload` hints for chunks the first paint doesn't need compete with CSS and fonts on slow links. Lower them with `fetchpriority="low"` or drop them.

## 9. LCP

**Ask:** What is the largest element in the first viewport on each profile? That's the one that gets priority, and the one that never fades from zero.


- The LCP element is in the server HTML, not rendered on the client.
- LCP image: `fetchpriority="high"`, never `loading="lazy"`, a correct `sizes`, and no fade from opacity 0.
- LCP text: preloaded font, an entrance that starts within 100 ms and stays short. Chrome doesn't report a paint at opacity 0 as LCP, so a slow fade pushes LCP to the first visible frame.

## 10. Each breakpoint has its own critical path

The phone's LCP may be the headline, the laptop's a 2560 px hero, and the landscape tablet may show a sidebar the phone never renders. Optimising only the phone can leave the laptop waiting 3 s on a hero image nobody preloaded.

- **Find the LCP element per profile** (phone, tablet, laptop, 4K) and prioritise that one: `<link rel="preload" as="image" imagesrcset="…" imagesizes="…" media="(min-width: 1024px)">`. The `media` attribute stops phones from fetching the desktop hero.
- **`display: none` still costs.** An `<img src>` inside a hidden breakpoint still downloads unless it's `loading="lazy"`, and its component's JS still runs. Use `<picture>` with `media` sources, or don't render the branch.
- **Laptops see more above the fold.** A 1440 × 900 viewport shows sections the phone scrolls to. `loading="lazy"` on those delays the laptop's LCP.
- **Big screens need more pixels.** A full-bleed hero at DPR 2 on a 2560 px wide display asks for 5120 device pixels. Cap the largest `srcset` candidate (see `responsive-media`).
- **Fonts used only on wide layouts** get a preload with `media`, or `font-display: optional`, so phones that never show them don't download them.
- Desktop networks are not always fast (hotel Wi-Fi, tethering). Throttle the desktop profile too.

## Screens

| Screen | What changes | Check |
| --- | --- | --- |
| Low-end Android | CPU dominates: CSS parse, hydration, long tasks | `phone-low` profile, TBT, hydration time |
| iPhone | Safari supports `fetchpriority` from 17.2; `requestIdleCallback` may be missing | Safari Web Inspector, cold load on cellular |
| Tablet | Landscape and portrait have different first screens | Both orientations, LCP element of each |
| Laptop | More content above the fold, desktop-only components | `laptop` profile, nothing lazy in the first 900 px |
| 4K / 5K | Larger image candidates, bigger canvas backing store | `desktop-4k` profile, LCP image bytes |

## Measure

Cold cache, 3 or more runs, medians. Start with the phone profile (390 × 844, DPR 3, touch, Slow 4G: 150 ms RTT, 1.6 Mbps down, 750 Kbps up, 4× CPU), then every profile whose layout differs. The harness ships with `web-performance`:

```sh
node <skills>/web-performance/scripts/perf.mjs <url> --profile phone --runs 5 --selector h1 --out ./perf/phone
node <skills>/web-performance/scripts/perf.mjs <url> --profile laptop --runs 5 --selector h1 --out ./perf/laptop
# report.json: FCP, LCP + element, headline-visible time, hydration, CLS + sources, TBT,
#              blocking resources, font timings, per-frame headline opacity, flicker flag
# filmstrip.png: one frame every 150 ms from 0 to 3.6 s (needs python3 + Pillow)
```

Count the distinct states the filmstrip passes through before the page settles. A good load reads: page colour, content entering in its real font, settled, decoration fading in.

Targets on the phone profile: first paint ≤ 1.0 s, LCP ≤ 2.0 s, headline fully visible ≤ 1.8 s, CLS 0, TBT ≤ 200 ms, no flicker, fonts loaded before or while the headline appears.

Then a real phone (Safari Web Inspector or `chrome://inspect`), cold, on cellular.

## Before shipping

- [ ] No JS entrance (`gsap.from`, `opacity-0` until mounted, `ClientOnly`) on server-rendered content above the fold
- [ ] Components from other branches or modes load lazily
- [ ] Above-the-fold fonts preloaded with `crossorigin` and `fetchpriority="high"`
- [ ] Fonts subset to the scripts the page uses, with the full file behind `unicode-range`
- [ ] Fallback face has `size-adjust` and ascent/descent overrides
- [ ] Placeholders share colours and composition with the final shader, video or image
- [ ] First-screen sequence settles within about 1 s, brand mark first
- [ ] LCP image painted at full opacity with `fetchpriority="high"`
- [ ] Preloads for breakpoint-specific assets carry `media`
- [ ] Nothing a laptop sees at first paint is `loading="lazy"`
- [ ] Measured throttled on the phone profile and the largest profile, filmstrip attached

## Report

- Before and after: filmstrip states plus medians (first paint, LCP, headline visible, CLS, TBT, flicker), one column group per profile.
- What changed: file and change, one line each.
- What still needs a real device: GPU shader compile time, iOS font cache, HTTP/2 prioritisation.
