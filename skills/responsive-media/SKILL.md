---
name: responsive-media
description: Size every image, video, canvas and icon for the screen that shows it, so a 390px phone on cellular downloads what it can display and a 5K monitor still gets a sharp result. Covers srcset with w descriptors and accurate sizes, device-pixel math, art direction with picture, AVIF/WebP/JPEG and quality settings, lossless WebP for flat UI, SVG vs raster, loading/decoding/fetchpriority, image CDN and framework component defaults, image-set() backgrounds, muted video loops instead of GIF, canvas/WebGL backing-store size, icon sprites, Save-Data and client hints, caching, and hi-DPI hairlines. Use when "images are blurry on retina", "the hero is 3 MB on mobile", "the LCP image is too heavy", "video eats mobile data", "the canvas is soft on 4K", "which image format should I use", or "how do I write srcset/sizes". For what loads first use first-load; for frame rate and tap latency use runtime-performance; for an audit across all screens use web-performance; for motion use web-animation-design.
---

# Responsive Media

Every image, video and canvas sized for the screen that shows it, with the bytes per screen measured before and after.

## Scope

Use it for: `srcset`/`sizes`, formats and encoder settings, art direction, video weight, canvas and WebGL resolution, icon delivery, per-screen byte budgets.

Not for: the order in which things load on the first paint (`first-load`), dropped frames and slow taps (`runtime-performance`), a site-wide audit (`web-performance`), how media animates (`web-animation-design`).

## Philosophy

### Think in device pixels

A screen doesn't care how big your source file is. It cares how many physical pixels the image covers. A card 390 CSS pixels wide on an iPhone covers 1170 device pixels. The same card on a 1080p office monitor covers 390. Every decision in this skill starts from that number, so compute it before you pick a file.

### The smallest screen pays for every mistake

A 2.4 MB hero costs a laptop on fibre a fraction of a second. On a phone on a train it costs several seconds of grey box and part of someone's data plan. You can't see that from your desk, so you measure it. Light on phones is the default you protect.

### Sharpness is part of the design

Shipping fewer bytes is half the job. A product shot that looks soft on a 5K display reads as careless to exactly the people who look closest: designers, reviewers, buyers on big screens. The goal is the right pixels for each screen, which is sometimes more than you'd guess.

### Every exception is a decision

Sometimes you cap the 4K candidate and accept slight softness to stay under 600 KB. That's fine when you choose it. Write it down, so the next person doesn't "fix" it or repeat it by accident.

## Principles

1. **Needed width = rendered CSS width × DPR.** The browser picks from your candidates using this number. If you don't know it, you're guessing.
2. **Photos stop at 2×.** A 3× candidate has 2.25× the pixels of a 2× one, and in a photo almost nobody sees the difference at arm's length. Flat UI, text in images and line art may go to 3× on phones, where edges show it.
3. **`sizes` describes the layout.** Without it the browser assumes `100vw`, so every thumbnail in a three-column grid downloads at full screen width.
4. **Reserve the box.** `width` + `height` (or `aspect-ratio`) on every `img`, `video`, `iframe` and `canvas`. Otherwise the text you're reading jumps down when the image lands.
5. **One image gets `fetchpriority="high"`: the LCP image.** Priority is relative. Give it to five images and none of them gets ahead.
6. **No GIFs.** The same clip as an H.264 MP4 is usually several times smaller. GIFs also can't pause, have no poster and ignore reduced motion.
7. **Cap canvas pixels, not only the ratio.** A full-screen shader at DPR 2 on a 5K display fills 14.7 million pixels every frame, and the fans tell you about it.
8. **Measure transferred bytes per screen**, on the phone and on the largest screen you support. Files on disk aren't what people download.

## Diagnose

| Symptom (user's words) | Likely cause | Go to |
| --- | --- | --- |
| "The hero is 3 MB on my phone" | No `srcset`, or `sizes` missing / `100vw` on a narrow slot | §1, §5 |
| "Images are blurry on retina" | Only a 1× candidate, or the ladder stops too low | §1 |
| "Grid thumbnails load slowly" | Framework default `sizes="100vw"` | §1, §5 |
| "The crop looks wrong on mobile" | Same image at every width, no art direction | §2 |
| "LCP is late, the image is the LCP" | Lazy-loaded, CSS background, or too heavy | §4, §6 |
| "Video eats mobile data" | 1080p loop on phones, audio track, autoplay under Save-Data | §7 |
| "The canvas is soft on 4K" or "fans spin up on 4K" | Raw DPR, or no pixel budget | §8 |
| "This SVG is heavier than a photo" | Path-heavy or embedded-bitmap SVG | §3 |
| "Hairlines look thick on iPhone" | `1px` border = 3 device px at DPR 3 | §12 |

## 1. srcset and sizes

The browser chooses a candidate before it has laid out the page. It doesn't know your image sits in a 384px grid column. `sizes` is how you tell it. Get it wrong and the browser does the safe thing: assumes full width and downloads the biggest file that fits the viewport.

**Ask:** At each breakpoint, how wide is this image in CSS pixels?

```html
<img
  src="/img/hero-1080.jpg"
  srcset="/img/hero-480.jpg 480w, /img/hero-768.jpg 768w, /img/hero-1080.jpg 1080w,
          /img/hero-1440.jpg 1440w, /img/hero-1920.jpg 1920w, /img/hero-2560.jpg 2560w"
  sizes="(min-width: 1280px) 1200px, (min-width: 768px) calc(100vw - 64px), calc(100vw - 32px)"
  width="1200" height="675" alt="…"
  fetchpriority="high">
```

- List media conditions from largest to smallest. The last entry has no condition. Subtract padding: `calc(100vw - 32px)`.
- A capped container ends at the cap: `(min-width: 1280px) 1200px`. Without it, a 2560px-wide monitor asks for a 2560 CSS px image that is shown at 1200.
- Grids get one entry per column count: `(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw`. Subtract gaps when they're over ~24px.
- `sizes="auto"` lets the browser use the laid-out width, but only on `loading="lazy"` images and only in Chromium (126+). Keep a fallback after it: `sizes="auto, (min-width: 1024px) 33vw, 100vw"`.
- `x` descriptors (`1x, 2x`) are for fixed-size images such as avatars and logos, where the CSS width never changes.

## 2. Art direction with picture

`srcset` changes resolution. It never changes the crop. A 16:9 landscape hero squeezed into a 390px portrait screen leaves a face the size of a thumbnail. When the subject gets lost, ship a different crop.

**Ask:** Shrink the desktop image to phone width. Is the subject still readable?

```html
<picture>
  <source media="(max-width: 767px)" type="image/avif" width="960" height="1200"
          srcset="/img/hero-portrait-480.avif 480w, /img/hero-portrait-960.avif 960w" sizes="100vw">
  <source media="(max-width: 767px)" width="960" height="1200"
          srcset="/img/hero-portrait-480.jpg 480w, /img/hero-portrait-960.jpg 960w" sizes="100vw">
  <source type="image/avif" srcset="/img/hero-1440.avif 1440w, /img/hero-2560.avif 2560w" sizes="100vw">
  <img src="/img/hero-1440.jpg" srcset="/img/hero-1440.jpg 1440w, /img/hero-2560.jpg 2560w"
       sizes="100vw" width="1440" height="720" alt="…">
</picture>
```

The first `<source>` whose `media` and `type` both match wins, so order matters. `width`/`height` on each `<source>` switch the aspect ratio per breakpoint without a layout shift.

## 3. Formats and quality

Format is the cheapest win you have. The same 1440px photo is often 30–50% smaller as AVIF than as JPEG at similar visual quality. Flat graphics follow different rules: lossy formats add noise around hard edges, while lossless WebP compresses large single-colour areas very well.

**Ask:** Is this a photo, or flat shapes and text?

| Asset | Format |
| --- | --- |
| Photo, hero, product shot | AVIF → WebP → JPEG, through `<picture>` or a CDN that reads `Accept` |
| Screenshot, device frame, flat illustration | Lossless WebP, or PNG-8. Compare with lossless AVIF; it rarely wins |
| Logo, icon, simple illustration | SVG after `svgo`. Raster only when the SVG is heavier than a 2× WebP |
| SVG with heavy path data, embedded bitmaps or filters | Rasterise to lossless WebP at 1× and 2× |

- Starting quality: AVIF 50–60, WebP 75, JPEG 75–80 (mozjpeg). Compare at 100% on a 2× screen before going lower. AVIF at low quality smears film grain, skin and soft gradients first.
- Strip metadata and convert to sRGB. A wide-gamut photo without colour management looks washed out in some browsers.
- Check the SVG file size before assuming vector is lighter. A device frame drawn with paths can weigh 500 KB where a lossless 2× WebP of it weighs 10–20 KB.

Encoder commands are in [REFERENCE.md](REFERENCE.md).

## 4. Loading attributes

`loading="lazy"` tells the browser to wait until layout says the image is near the viewport. That's right for the twentieth product card and wrong for the hero: the hero now waits for CSS and layout before it even starts downloading.

| Image | Attributes |
| --- | --- |
| LCP image | `fetchpriority="high"`, no `loading` attribute |
| Other images above the fold | defaults |
| Below the fold | `loading="lazy" decoding="async"` |
| Carousel slides after the first | `loading="lazy"` |

Above the fold changes per screen. A laptop at 1440×900 shows two rows of cards that a phone has to scroll to. Check the fold on each profile before marking anything lazy.

## 5. Image CDNs and framework components

Framework components save you from writing ladders by hand. They also hide what reaches the HTML, and the most common default, `sizes="100vw"`, is wrong for anything that isn't full-bleed. Read the rendered `<img>` in DevTools, not the component props.

- **Next.js `<Image>`**: pass `sizes` for anything that isn't fixed-size. Mark the LCP image with `preload` (Next 16+; `priority` before 16). Default `quality` is 75, and Next 16 only allows the values listed in `images.qualities`.
- **Nuxt Image**: `<NuxtImg sizes="100vw md:50vw lg:400px">` uses the `screens` keys from config. `densities="x1 x2"` for fixed-size images. `<NuxtPicture format="avif,webp">` for format fallback. Add `preload` and `fetchpriority="high"` on the LCP image.
- **Remote CDNs** (Cloudinary, Imgix, Supabase Storage, Vercel): request `w=` per candidate and automatic format. Check that responses send `Vary: Accept` or use per-format URLs, so a cache never hands AVIF to a browser that can't decode it.

## 6. Background images

A CSS background is found only after the stylesheet has downloaded and been parsed. It can't be lazy-loaded, can't take `fetchpriority`, and has no `alt`. Keep backgrounds for decoration.

**Ask:** If this image failed to load, would the page lose meaning? If yes, it's an `<img>`.

```css
.hero {
  background-image: url(/img/hero-1440.jpg);
  background-image: image-set(
    url(/img/hero-1440.avif) type('image/avif') 1x,
    url(/img/hero-2880.avif) type('image/avif') 2x,
    url(/img/hero-1440.jpg) 1x,
    url(/img/hero-2880.jpg) 2x
  );
  background-size: cover;
}
```

For a content image that has to fill its box, use `<img>` with `object-fit: cover`.

## 7. Video

Video is the heaviest thing most pages autoplay. A 15-second 1080p loop can weigh as much as the rest of the page combined, and on a phone that 1080p is downscaled to a 390px box anyway.

```html
<video autoplay muted loop playsinline preload="metadata"
       poster="/video/loop-poster.webp" width="1280" height="720">
  <source src="/video/loop-720.webm" type="video/webm; codecs=av01.0.05M.08">
  <source src="/video/loop-720.mp4" type="video/mp4">
</video>
```

- Short loops: 720p for phones, 1080p for desktop, no audio track (`ffmpeg -an`). A silent loop with an audio track is paying for bytes nobody hears.
- `<source media>` on video works again in Chrome 120+, Firefox 120+ and Safari. For older engines, pick the URL in JS on load with `matchMedia`.
- Long video: HLS with `preload="none"`. Safari plays it natively; elsewhere load hls.js on the first play.
- Pause off-screen with an `IntersectionObserver`. Under `prefers-reduced-motion: reduce` or Save-Data, don't autoplay: show the poster and a play button.
- The poster is the first frame people see, often for seconds on cellular. Same crop as the video, encoded and sized like any other image.

## 8. Canvas and WebGL

A canvas renders at whatever backing-store size you give it. Set it to CSS size × raw DPR on a 5K display and the GPU fills 14.7 million pixels every frame for a gradient that looks the same at a third of that. Cap the total pixel count as well as the ratio.

```js
const MAX_DPR = 2
const MAX_PIXELS = 2560 * 1440 // ~3.7 million pixels per frame

function resize(canvas, renderer) {
  const { width, height } = canvas.getBoundingClientRect()
  let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
  const pixels = width * height * dpr * dpr
  if (pixels > MAX_PIXELS) dpr *= Math.sqrt(MAX_PIXELS / pixels)
  renderer.setPixelRatio(dpr) // three.js. For 2D: canvas.width = Math.round(width * dpr)
  renderer.setSize(width, height, false)
}

new ResizeObserver(() => resize(canvas, renderer)).observe(canvas)
```

- **Ask:** Does this canvas draw text or hairlines? If yes, keep full DPR. Soft gradients and noise shaders look the same at 1–1.5×.
- Recompute when the window moves to a screen with another DPR: listen for `change` on `matchMedia('(resolution: ' + devicePixelRatio + 'dppx)')` and re-register after each change.

## 9. Icons and fonts

- A few icons: inline SVG with `currentColor`, so they follow the theme with no extra request. Dozens across pages: one external sprite, `<use href="/icons.svg#name">`, cached once. No icon fonts: they render as text, read badly in screen readers and download as one block.
- Fonts: subset to the scripts you use; a Latin subset is often half the size of the full file. A variable font pays off from three weights. A face only the desktop hero uses is fetched only when text on the page needs it, so keep it out of mobile layouts instead of preloading it everywhere.

## 10. CSS per screen

- `<link rel="stylesheet" media="(min-width: 1024px)">` is still downloaded on a phone, at the lowest priority and without blocking render. It saves blocking time, not bytes.
- Components sized with `@container` need `sizes` that match the container widths, not the viewport.

## 11. Network hints

These help on Chromium and do nothing elsewhere. Treat them as a bonus on top of `srcset`, never as the mechanism.

- **Save-Data** (`Save-Data: on` header, `navigator.connection.saveData`): lower-quality candidates, no autoplay video, no decorative media. Someone turned this on deliberately; respect it.
- **`navigator.connection.effectiveType`**: coarse and Chromium only. Use it to skip decorative video, never to remove content.
- **Client hints** (`Accept-CH: Sec-CH-DPR, Sec-CH-Width, Sec-CH-Viewport-Width`) let a server or CDN pick the size. Chromium only, so `srcset` stays the baseline.

## 12. Caching and hi-DPI details

- Hashed filenames (`hero.3f2a1c.avif`): `Cache-Control: public, max-age=31536000, immutable`. Unhashed (`/img/og.png`): shorter `max-age` + `stale-while-revalidate`, or an update never reaches returning visitors.
- Image CDN transforms must be cached at the edge. Re-encoding AVIF on every cache miss is slower than serving a cached JPEG.
- Hairlines: `1px` is 2–3 device pixels on hi-DPI screens, so a divider designed as a hairline looks heavy on an iPhone. Use `0.5px` under `@media (min-resolution: 2dppx)` and check DPR 1 separately.
- A 2× file on a 1080p monitor wastes bytes. `srcset` picks the 1× candidate; a hard-coded `src="hero@2x.jpg"` doesn't.

## Screens

| Screen | What changes | Check |
| --- | --- | --- |
| Phone, 360–430px, DPR 2–3 | Cellular, data cost, small cache. Full-width photo needs ~860–1290 device px | Photos capped at 2×, portrait crop, 720p loops, Save-Data path |
| Foldable, 280–720px | Width changes on fold | `sizes` follows the layout; Chrome keeps a larger cached candidate instead of downgrading |
| Tablet, 768–1366px, DPR 2 | Two orientations, often two crops | Art direction on rotate, 1440–1920 candidates for full-width |
| Laptop, 1280–1728px, DPR 2 | 2560–3456 device px | Container-capped images at 2×, full-bleed up to 2560–3456 |
| Desktop 1080p, DPR 1 | 1920 device px | The ladder has a ~1920 candidate so it doesn't jump to 2560 |
| 4K / 5K, 1920–2560px at DPR 2 | 3840–5120 device px, full-bleed heroes reach 1–3 MB | Cap the largest candidate at 2560 or 3840; slight softness beats a 5 MB hero |
| Ultrawide, 3440px | 43:18 viewport | `max-width` the content or art-direct a wider crop |

**Candidate ladders.** Full-bleed: `480, 768, 1080, 1440, 1920, 2560, 3840`. Container of width C: `C/2, C, 1.5C, 2C` (600, 1200, 1800, 2400 for 1200px). Grid thumbnails: 1× and 2× the largest column width. Gaps between candidates of ~1.3–1.5× keep the chosen file close to the needed width without a dozen encodes.

**`sizes` by layout:**

| Layout | `sizes` |
| --- | --- |
| Full-bleed | `100vw` |
| 1200px container, 16px gutters | `(min-width: 1232px) 1200px, calc(100vw - 32px)` |
| 3 / 2 / 1 columns, 24px gap, 1200px container | `(min-width: 1232px) 384px, (min-width: 1024px) calc((100vw - 80px) / 3), (min-width: 640px) calc((100vw - 56px) / 2), calc(100vw - 32px)` |
| Fixed 320px sidebar | `(min-width: 1024px) calc(100vw - 384px), 100vw` |

## Measure

Run each profile separately: phone (390×844, DPR 3, Slow 4G), laptop (1440×900, DPR 2), 4K (2560×1440, DPR 2) and 1080p (DPR 1). A fix that helps the phone can make 4K soft, so look at both ends every time.

1. **DevTools → Network**, filter *Img* and *Media*, cache disabled, device emulation per profile. Sort by size. Read *Transferred*, the type column and which candidate loaded.
2. **Needed vs delivered pixels**: paste the image-audit snippet from [REFERENCE.md](REFERENCE.md). Ratio above 1.5 is oversized, below 1 is soft on that screen.
3. **Lighthouse** on mobile: "Properly size images", "Serve images in modern formats", "Efficiently encode images". It doesn't test 4K; the snippet does.
4. **Coverage** tab for icon sprites and CSS per screen.
5. **Real devices**: a phone on cellular and a 2× external display. Emulation gets DPR right, not decode time or real bandwidth.

## Before shipping

- [ ] Every raster image has `srcset` with `w` descriptors
- [ ] `sizes` matches the CSS at each breakpoint, including inside framework components
- [ ] The LCP image has `fetchpriority="high"` and no `loading="lazy"`; no other image has `high`
- [ ] Every `img`, `video`, `iframe` and `canvas` has `width`/`height` or `aspect-ratio`
- [ ] No GIF; loops are muted `playsinline` MP4/WebM with a poster
- [ ] Video doesn't autoplay under Save-Data or reduced motion
- [ ] Heavy SVGs are rasterised to lossless WebP at 1× and 2×
- [ ] Photo candidates stop at 2×
- [ ] Canvas uses a capped DPR and a pixel budget
- [ ] Icons are inline SVG or a `<symbol>` sprite
- [ ] Content images are `<img>`, not CSS backgrounds
- [ ] Only hashed assets are cached `immutable`
- [ ] Bytes measured on phone and 4K, before and after

## Report

- Bytes per screen, before → after: phone, laptop, 4K (and 1080p if relevant), from the Network panel.
- Audit snippet result per profile: oversized and undersized counts.
- Changes: file and change, one line each.
- Left for a real device: decode time on a mid-range phone, cellular bandwidth, colour on a wide-gamut display.
- Write findings in device pixels and bytes: "the grid sends 2560px images to a 390px phone, 1.8 MB for 1170 needed pixels". A 4K candidate kept soft to stay under budget is a decision; say so.
