# Motion Tokens: Emitters

The scale from [SKILL.md](SKILL.md) §2, written once and emitted to every place motion is authored. Copy the parts your stack uses.

## Contents

1. Source of truth (TS)
2. CSS and Tailwind v4
3. GSAP
4. Motion (React)
5. WAAPI
6. Entry states with `@starting-style`
7. Tooltip groups without a library
8. Drift check

---

## 1. Source of truth (TS)

JS-driven motion reads this module. CSS mirrors it, and the check in §8 fails when the two disagree.

```ts
// motion.ts
export const ease = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.65, 0, 0.35, 1],
  sheet: [0.32, 0.72, 0, 1],
} as const

export const dur = {
  press: 150,
  sm: 180,
  smExit: 120,
  md: 240,
  mdExit: 170,
  lg: 320,
  lgExit: 240,
  reveal: 480,
} as const // milliseconds

export const stagger = 40
export const staggerCap = 6

export const bezier = (e: readonly number[]) => `cubic-bezier(${e.join(', ')})`
export const seconds = (ms: number) => ms / 1000
```

## 2. CSS and Tailwind v4

```css
/* theme.css */
@import 'tailwindcss';

/* `static` keeps the variables in the output even when no utility uses them,
   so var(--ease-out) works in hand-written CSS too. */
@theme static {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-sheet: cubic-bezier(0.32, 0.72, 0, 1);
}

:root {
  --dur-press: 150ms;
  --dur-sm: 180ms;
  --dur-sm-exit: 120ms;
  --dur-md: 240ms;
  --dur-md-exit: 170ms;
  --dur-lg: 320ms;
  --dur-lg-exit: 240ms;
  --dur-reveal: 480ms;
  --stagger: 40ms;
}
```

What you get:

| You write | Resolves to |
| --- | --- |
| `ease-out` | `var(--ease-out)`, the token, not Tailwind's stock curve |
| `ease-sheet` | `var(--ease-sheet)` (new utility from the namespace) |
| `duration-(--dur-sm)` | `transition-duration: var(--dur-sm)` |
| `delay-(--stagger)` | `transition-delay: var(--stagger)` |

Without a framework, the `:root` block plus the three curves is the whole emitter.

## 3. GSAP

Register the curves under the same names, so a tween reads like the CSS next to it.

```ts
import { gsap } from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import { ease, dur, seconds } from './motion'

gsap.registerPlugin(CustomEase)
CustomEase.create('out', ease.out.join(','))
CustomEase.create('inOut', ease.inOut.join(','))
CustomEase.create('sheet', ease.sheet.join(','))

gsap.defaults({ ease: 'out', duration: seconds(dur.md) })

// A sheet
gsap.to(panel, { yPercent: 0, ease: 'sheet', duration: seconds(dur.lg) })
```

GSAP takes seconds; the module stores milliseconds so CSS and JS share numbers. Remove any CSS `transition` on properties GSAP animates.

Reduced motion:

```ts
const mm = gsap.matchMedia()
mm.add('(prefers-reduced-motion: reduce)', () => {
  gsap.set('.reveal', { opacity: 1, y: 0 })
})
mm.add('(prefers-reduced-motion: no-preference)', () => {
  gsap.from('.reveal', { opacity: 0, y: 16, duration: seconds(dur.reveal), stagger: 0.04 })
})
```

## 4. Motion (React)

```tsx
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ease, dur, seconds } from './motion'

export const popover = {
  enter: { duration: seconds(dur.sm), ease: ease.out },
  exit: { duration: seconds(dur.smExit), ease: ease.out },
}

function Menu({ open }: { open: boolean }) {
  const reduce = useReducedMotion()
  const from = reduce ? 'scale(1)' : 'scale(0.96)'
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          style={{ transformOrigin: 'top right' }}
          initial={{ opacity: 0, transform: from }}
          animate={{ opacity: 1, transform: 'scale(1)', transition: popover.enter }}
          exit={{ opacity: 0, transform: from, transition: popover.exit }}
        />
      )}
    </AnimatePresence>
  )
}
```

Gestures use springs, not tokens: `{ type: 'spring', duration: 0.4, bounce: 0 }` on drag release.

## 5. WAAPI

For one-off motion in plain JS, with no library:

```ts
import { ease, dur, bezier } from './motion'

export function pop(el: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  return el.animate(
    [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }],
    { duration: dur.sm, easing: bezier(ease.out), fill: 'backwards' },
  )
}
```

`fill: 'backwards'` applies the first keyframe during any delay, so the element doesn't flash at full opacity before it starts.

## 6. Entry states with `@starting-style`

A `<dialog>` that fades and grows on open, using only CSS and the tokens:

```css
dialog {
  opacity: 1;
  scale: 1;
  transition:
    opacity var(--dur-md) var(--ease-out),
    scale var(--dur-md) var(--ease-out),
    display var(--dur-md) allow-discrete,
    overlay var(--dur-md) allow-discrete;
}

dialog:not([open]) {
  opacity: 0;
  scale: 0.96;
  transition-duration: var(--dur-md-exit);
}

@starting-style {
  dialog[open] { opacity: 0; scale: 0.96; }
}

dialog::backdrop {
  background: rgb(0 0 0 / 0.4);
  transition: opacity var(--dur-md) var(--ease-out), display var(--dur-md) allow-discrete, overlay var(--dur-md) allow-discrete;
}
@starting-style {
  dialog[open]::backdrop { opacity: 0; }
}
```

Dialog and backdrop share `md`, as §4 of the skill requires. Browsers without `@starting-style` open the dialog instantly, which is an acceptable fallback.

## 7. Tooltip groups without a library

The first tooltip waits; neighbours open at once while the user scans. One shared timestamp does it:

```ts
let lastClosed = 0
const GROUP_WINDOW = 300 // ms after a tooltip closes during which the next opens instantly

export function openDelay() {
  return performance.now() - lastClosed < GROUP_WINDOW ? 0 : 500
}

export function markClosed() {
  lastClosed = performance.now()
}
```

When the delay is 0, also skip the enter animation (`transition-duration: 0ms` on that open). Radix (`delayDuration`, `skipDelayDuration`) and Base UI (`delay` on the provider) implement the same idea if you already use them.

## 8. Drift check

Fails CI when `theme.css` and `motion.ts` disagree, or when an inline duration or curve sneaks in. Adjust the paths.

```js
// scripts/check-motion.mjs
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const css = readFileSync('app/assets/css/theme.css', 'utf8')
const ts = readFileSync('app/utils/motion.ts', 'utf8')
const errors = []

const cssVar = (name) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()
const tsArray = (key) => ts.match(new RegExp(`${key}:\\s*\\[([^\\]]+)\\]`))?.[1].split(',').map(Number)
const tsNumber = (key) => Number(ts.match(new RegExp(`\\b${key}:\\s*(\\d+)`))?.[1])

for (const [cssName, tsKey] of [['ease-out', 'out'], ['ease-in-out', 'inOut'], ['ease-sheet', 'sheet']]) {
  const fromCss = cssVar(cssName)?.match(/cubic-bezier\(([^)]+)\)/)?.[1].split(',').map(Number)
  if (String(fromCss) !== String(tsArray(tsKey))) errors.push(`--${cssName} ${fromCss} ≠ ease.${tsKey} ${tsArray(tsKey)}`)
}
for (const [cssName, tsKey] of [['dur-press', 'press'], ['dur-sm', 'sm'], ['dur-sm-exit', 'smExit'], ['dur-md', 'md'], ['dur-md-exit', 'mdExit'], ['dur-lg', 'lg'], ['dur-lg-exit', 'lgExit'], ['dur-reveal', 'reveal']]) {
  if (parseInt(cssVar(cssName)) !== tsNumber(tsKey)) errors.push(`--${cssName} ${cssVar(cssName)} ≠ dur.${tsKey} ${tsNumber(tsKey)}`)
}

// Inline values outside the token files
const inline = execSync(
  `rg -n --glob '!{node_modules,dist,.nuxt,.next,.output}' --glob '!**/theme.css' --glob '!**/motion.ts' ` +
    `"cubic-bezier\\(|duration-\\[[0-9]+m?s\\]|transition-all|\\bease-in\\b" app src 2>/dev/null || true`,
  { encoding: 'utf8' },
).trim()
if (inline) errors.push(`inline motion values:\n${inline}`)

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log('motion tokens in sync')
```

Run it next to lint: `node scripts/check-motion.mjs`. The inline search keeps the system intact after the first audit: new code that types a curve or a duration by hand fails the check.
