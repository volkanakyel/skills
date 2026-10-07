# Responsive Media: Reference

Console snippet, encoder commands, recipes and byte budgets. The rules and the reasons behind them are in [SKILL.md](SKILL.md).

## Image audit (console snippet)

Paste into DevTools once per screen profile (phone DPR 3, laptop DPR 2, 4K DPR 2, 1080p DPR 1). Scroll to the bottom first so lazy images load. For each `<img>` it prints the natural width, the needed width (rendered CSS width × DPR), the ratio between them, bytes over the wire and a verdict. Cross-origin images show `?` bytes unless the server sends `Timing-Allow-Origin`.

```js
(() => {
  const dpr = window.devicePixelRatio || 1
  const res = new Map(performance.getEntriesByType('resource').map((e) => [e.name, e]))
  const rows = [...document.images]
    .filter((img) => img.complete && img.naturalWidth > 0)
    .map((img) => {
      const r = img.getBoundingClientRect()
      const src = img.currentSrc || img.src
      const entry = res.get(src)
      const bytes = entry ? entry.transferSize || entry.encodedBodySize : 0
      const needed = Math.round(r.width * dpr)
      const ratio = needed ? img.naturalWidth / needed : 0
      const verdict = r.width === 0 ? 'hidden'
        : ratio > 1.5 ? 'OVERSIZED'
        : ratio < 1 ? 'undersized (soft)'
        : 'ok'
      return {
        image: src.split('/').pop().split('?')[0].slice(0, 40),
        natural: `${img.naturalWidth}×${img.naturalHeight}`,
        rendered: `${Math.round(r.width)}×${Math.round(r.height)} @${dpr}x`,
        needed,
        ratio: Math.round(ratio * 100) / 100,
        KB: bytes ? Math.round(bytes / 1024) : '?',
        lazy: img.getAttribute('loading') || '',
        priority: img.getAttribute('fetchpriority') || '',
        verdict,
      }
    })
  console.table(rows)
  const over = rows.filter((r) => r.verdict === 'OVERSIZED')
  const kb = rows.reduce((a, r) => a + (typeof r.KB === 'number' ? r.KB : 0), 0)
  console.log(`${rows.length} images · ${kb} KB · ${over.length} oversized · ${rows.filter((r) => r.verdict.startsWith('under')).length} undersized @${dpr}x`)
  return rows
})()
```

*Oversized* is bytes the screen throws away. *Undersized* is softness on this screen, which can be deliberate (a capped 4K candidate).

## Encoder commands

### sharp: one source to a full ladder in AVIF, WebP and JPEG

```js
// node make-ladder.mjs src.jpg out/hero
import sharp from 'sharp'

const [src, out] = process.argv.slice(2)
const widths = [480, 768, 1080, 1440, 1920, 2560, 3840]
const meta = await sharp(src).metadata()

for (const w of widths.filter((w) => w <= meta.width)) {
  const base = sharp(src).resize({ width: w, withoutEnlargement: true }).toColourspace('srgb')
  await base.clone().avif({ quality: 55, effort: 6 }).toFile(`${out}-${w}.avif`)
  await base.clone().webp({ quality: 75 }).toFile(`${out}-${w}.webp`)
  await base.clone().jpeg({ quality: 78, mozjpeg: true }).toFile(`${out}-${w}.jpg`)
}
```

The ladder stops at the source width; `withoutEnlargement` never upscales.

### CLI encoders

```sh
# AVIF (libavif): -q 50–60 for photos, speed 4–6
avifenc -q 55 -s 5 in.png out.avif

# WebP lossy, and lossless for flat UI and device frames
cwebp -q 75 -m 6 -metadata none in.jpg -o out.webp
cwebp -lossless -z 9 -metadata none frame.png -o frame.webp

# Resize with ImageMagick before encoding
magick in.jpg -resize 1440x -colorspace sRGB -strip out-1440.jpg

# SVG: minify, then compare file sizes
npx svgo --multipass -i in.svg -o out.svg
```

### Rasterise a heavy SVG at 1× and 2×

```sh
rsvg-convert -w 742 frame.svg -o frame@1x.png && cwebp -lossless -z 9 frame@1x.png -o frame@1x.webp
rsvg-convert -w 1484 frame.svg -o frame@2x.png && cwebp -lossless -z 9 frame@2x.png -o frame@2x.webp
```

For pixel-exact output, render the SVG in the target browser and screenshot it instead. Diff the WebP against the SVG before swapping.

### ffmpeg: loops, posters, HLS

```sh
# H.264 MP4, 720p, no audio, moov atom first
ffmpeg -i in.mov -an -vf "scale=-2:720,fps=30" -c:v libx264 -preset slow -crf 26 \
  -pix_fmt yuv420p -movflags +faststart loop-720.mp4

# 1080p desktop variant
ffmpeg -i in.mov -an -vf "scale=-2:1080,fps=30" -c:v libx264 -preset slow -crf 24 \
  -pix_fmt yuv420p -movflags +faststart loop-1080.mp4

# AV1 WebM: smaller files, slower encode
ffmpeg -i in.mov -an -vf "scale=-2:720" -c:v libsvtav1 -crf 38 -preset 6 loop-720.webm

# Poster from the first frame
ffmpeg -i loop-720.mp4 -frames:v 1 poster.png && cwebp -q 75 poster.png -o poster.webp

# GIF to MP4
ffmpeg -i anim.gif -an -movflags +faststart -pix_fmt yuv420p \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" anim.mp4

# HLS for long video
ffmpeg -i in.mp4 -c:v libx264 -crf 23 -c:a aac -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename 'seg_%03d.ts' index.m3u8
```

### fontTools: Latin subset

```sh
python3 -m fontTools.subset Brand-Regular.woff2 \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2199,U+2212" \
  --layout-features='*' --flavor=woff2 --output-file=Brand-Regular-latin.woff2
```

## Recipes

### Pause off-screen video, respect Save-Data and reduced motion

```js
const quiet = matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData

document.querySelectorAll('video[data-loop]').forEach((video) => {
  if (quiet) {
    video.removeAttribute('autoplay')
    video.pause()
    video.preload = 'none'
    return
  }
  new IntersectionObserver(([e]) => (e.isIntersecting ? video.play().catch(() => {}) : video.pause()), {
    rootMargin: '200px',
  }).observe(video)
})
```

### Pick a video resolution once, on load

```js
const big = matchMedia('(min-width: 1024px) and (min-resolution: 1.5dppx), (min-width: 1600px)').matches
video.src = big ? '/video/loop-1080.mp4' : '/video/loop-720.mp4'
```

### Save-Data and client hints on the server

```http
Accept-CH: Sec-CH-DPR, Sec-CH-Width, Sec-CH-Viewport-Width
Vary: Sec-CH-DPR, Sec-CH-Width, Save-Data
```

```js
// Chromium sends these; other browsers fall back to srcset
const saveData = req.headers['save-data'] === 'on'
const quality = saveData ? 45 : 70
```

### Hairline on hi-DPI screens

```css
.hairline { border-bottom: 1px solid var(--line); }
@media (min-resolution: 2dppx) {
  .hairline { border-bottom-width: 0.5px; }
}
```

### Preload a responsive LCP image

```html
<link rel="preload" as="image" fetchpriority="high"
      imagesrcset="/img/hero-768.avif 768w, /img/hero-1440.avif 1440w, /img/hero-2560.avif 2560w"
      imagesizes="100vw" type="image/avif">
```

Only for an image the parser finds late (CSS background, client-rendered). An `<img>` in the HTML needs no preload. `imagesizes` must equal the `<img sizes>`, or the image downloads twice.

### Nuxt Image and Next.js Image

```vue
<NuxtPicture src="/hero.jpg" format="avif,webp" sizes="100vw md:50vw lg:600px"
  width="1200" height="675" preload :img-attrs="{ fetchpriority: 'high', alt: '…' }" />
```

```jsx
// Next 16+: preload. Next 15 and earlier: priority
<Image src={hero} alt="…" preload sizes="(min-width: 1280px) 1200px, calc(100vw - 32px)" />
```

## Byte budgets per screen

Starting ceilings for a marketing page's media (images, posters, autoplay video), transferred. Adjust per project, and write down why.

| Profile | LCP image | First viewport | Whole page | Autoplay loop |
| --- | --- | --- | --- | --- |
| Phone, cellular (390px @3x) | 120 KB | 250 KB | 1 MB | 1.5 MB at 720p, poster only under Save-Data |
| Tablet (1024px @2x) | 200 KB | 400 KB | 2 MB | 2.5 MB |
| Laptop (1440px @2x) | 300 KB | 600 KB | 3 MB | 4 MB at 1080p |
| Desktop 1080p (1920px @1x) | 250 KB | 500 KB | 3 MB | 4 MB |
| 4K / 5K (2560px @2x) | 600 KB, capped candidate | 1.2 MB | 5 MB | 6 MB; a 1080p loop is acceptable |

When the phone budget is blown, check `sizes` before touching encoder settings.
