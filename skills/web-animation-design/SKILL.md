---
name: web-animation-design
description: Build and enforce one motion system for a web product, so every popover uses the same curve, every button the same press, and every sheet the same timing. Inventories the motion values already in the codebase, finds drift, defines a small token set (three curves, a duration scale by role and travel, stagger), emits it once to CSS variables, Tailwind v4 @theme, GSAP CustomEase, Motion and WAAPI, maps every UI role to tokens, and audits the codebase against them. Covers easing, duration, paired elements, choreography, springs for gestures, hover gating, iOS :active, 120 Hz, reduced motion, Tailwind v4 scale/translate transitions, GSAP vs CSS conflicts, Vue Transition, @starting-style. Use when "our animations feel inconsistent", "which easing and duration should we use", "set up motion tokens", "every modal animates differently", "make the app feel cohesive", "audit our transitions", or when adding motion to a design system. For first-load entrances use first-load; for frame drops use runtime-performance.
---

# Motion System

One set of motion tokens for the whole product, mapped to every UI role and enforced in code.

## Scope

Use it for: setting up motion tokens, choosing a curve and duration for a component, auditing a codebase for drift, moving a product from inline transitions to one system.

Not for: entrances on the first paint and hydration flicker (`first-load`), dropped frames and slow interactions (`runtime-performance`), image and video weight (`responsive-media`), a full audit across screens (`web-performance`).

You work like the design engineer who owns the product's feel. You don't judge one animation at a time. You judge whether the hundredth animation in the codebase agrees with the first.

## Philosophy

### Consistency is the product

A user opens the account menu, then the currency picker, then the cart. If the menu takes 180 ms, the picker 300 ms and the cart slides on a different curve, nobody files a bug. They stop trusting that the product was made by one team. Motion is the part of the interface that runs on time, so inconsistency in it is felt as a rhythm problem. Your job is to make every surface keep the same beat.

### A token is a promise

`--dur-sm` means "this is how long a small surface takes to appear, everywhere." When a developer types `duration-[220ms]` instead, the promise breaks quietly. Tokens exist so the next person, or the next agent, can add a dropdown without re-deciding what a dropdown feels like. Fewer tokens make a stronger promise: three curves and four durations are easier to keep than twelve.

### Users feel drift before they see it

Two buttons with 150 ms and 200 ms presses look identical in a screenshot. Pressed one after the other, the second feels heavier. Drift lives in time, so you find it in code with search, not by looking at the page. Inventory first, opinions second.

### Role decides, not the component

A filter popover in the shop and an action menu in the admin are the same role: a small surface anchored to a trigger. They get the same tokens even if two different people built them, in two different frameworks. When you meet a new component, ask which role it plays before you ask how it should move.

## Principles

1. **Tokens before components.** An inline duration is drift with a delay. Every value comes from the scale in §2.
2. **Three curves are enough.** `out` for what appears and leaves, `in-out` for what moves on screen, `sheet` for edge panels. Hover colour uses the `ease` keyword.
3. **No `ease-in` on interface motion.** It spends its first frames barely moving, which is when the user looks for a response.
4. **Interface motion stays at or under 320 ms.** Only first-load cascades and scroll reveals run longer.
5. **What moves together shares one token.** Panel and backdrop. Menu and chevron.
6. **Keyboard actions are instant.** Same component, opened by a shortcut: duration 0.
7. **Compositor properties only.** `transform`, `opacity`, `clip-path`. Layout properties re-run layout every frame.
8. **Reduced motion keeps meaning.** Remove travel, scale and parallax. Keep short fades.

## Diagnose

| Symptom (user's words) | Likely cause | Go to |
| --- | --- | --- |
| "Every modal animates differently" | Inline durations and curves per component | §1, §2 |
| "The menu feels slow" | `ease-in`, or 300 ms+ on a small popover | §3 |
| "The backdrop lags behind the drawer" | Panel and backdrop on different tokens | §4 |
| "The press does nothing on iPhone" | No `touchstart` listener, `:active` never fires | §5 |
| "The press snaps instead of animating" | Tailwind v4 `scale-*` with `transition-[transform]` | §6 |
| "The GSAP animation stutters" | A CSS transition on the same property | §6 |
| "Fine on my laptop, odd on the phone" | Hover motion on touch, 120 Hz exposing uneven curves | Screens |
| "Toasts restart when two fire at once" | Keyframes instead of transitions | §3 |

## 1. Inventory

**Ask:** How many different curves and durations does this codebase use today?

You can't fix drift you haven't counted. Before proposing a single token, list every motion value in the repo and how often it appears. The counts tell you what the product already wants to be: if `cubic-bezier(0.23, 1, 0.32, 1)` appears 40 times and four near-copies appear twice each, the 40 is your `out` curve and the rest are typos.

Run from the repo root:

```sh
# Skip build output in every search (works in bash and zsh). Always pass a path:
# rg with no path reads stdin when it isn't a terminal, which hangs in agent shells.
rgm() { rg --glob '!{node_modules,dist,build,.nuxt,.next,.output,coverage}' "$@"; }

# Curves, grouped by value
rgm -o --no-filename "cubic-bezier\([^)]*\)" . | tr -d ' ' | sort | uniq -c | sort -rn

# Durations: ms values, Tailwind duration classes, GSAP/Motion seconds
rgm -o --no-filename "\b[0-9]{2,4}ms\b|duration-(\[[^]]+\]|\([^)]+\)|[0-9]+)|duration:\s*[0-9.]+" . | sort | uniq -c | sort -rn

# Easing classes and keywords
rgm -o --no-filename -P "\bease-(in-out|in|out|linear|\[[^]]+\]|\([^)]+\))|\b(ease|ease-in|ease-out|ease-in-out|linear)(?=[;,)\s])" . | sort | uniq -c | sort -rn

# Where motion is driven, per file
rgm -c "@keyframes|gsap\.(to|from|fromTo|timeline|set)|<Transition|<TransitionGroup|AnimatePresence|<motion\.|\.animate\(" .

# Known offenders
rgm -n "transition-all|transition:\s*all|ease-in[^-]|scale\(0\)|scale-0\b" .
```

Write the result down as a table (value, count, files). A typical product that grew without a system shows five `ease-out` variants and six or seven durations between 150 and 400 ms. Those usually collapse into the three curves and four durations below without anyone noticing a change, except that things now agree.

## 2. Tokens

**Ask:** Can every value in the inventory map to one of these, and if not, does it deserve its own token?

Keep the scale small enough to remember. A developer adding a tooltip at 6 pm will not open a doc; they'll reach for the name they remember.

| Token | Value | Use |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | enter, exit, press |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | move or morph on screen |
| `--ease-sheet` | `cubic-bezier(0.32, 0.72, 0, 1)` | edge sheets, drawers |
| `--dur-press` | `150ms` | press, hover colour |
| `--dur-sm` | `180ms` | popover, menu, tooltip, toggle |
| `--dur-md` | `240ms` | modal, toast, tab indicator, route fade |
| `--dur-lg` | `320ms` | sheet, drawer, large panel |
| `--dur-reveal` | `480ms` | scroll reveal, first-load item |
| `--stagger` | `40ms` | cascade step, capped at 6 items |

Exits run at about 0.7× their enter token: `sm` 120 ms, `md` 170 ms, `lg` 240 ms. Give them names (`--dur-sm-exit`) so nobody multiplies by hand. The exit is shorter because the user already decided: they clicked outside, pressed Escape, picked an option. Making them watch the menu leave for as long as it took to arrive charges them twice.

The `out` curve front-loads movement: it covers about 88% of the distance in the first third of the duration, where the `ease` keyword covers about 58%. That is why a 180 ms menu on `out` reads as instant and the same 180 ms on `ease` reads as soft. The `sheet` curve starts a little slower and lands long, which matches a panel that has weight and travels across most of the screen.

Write the scale once in CSS and once in a TS module for JS-driven motion. [TOKENS.md](TOKENS.md) has the emitters for Tailwind v4, GSAP, Motion and WAAPI, and a check that fails when the two copies disagree.

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-sheet: cubic-bezier(0.32, 0.72, 0, 1);
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

Tailwind v4 has an `--ease-*` theme namespace. Declaring the curves in `@theme static` replaces the stock `ease-out` and `ease-in-out` utilities, so `class="ease-out"` and `var(--ease-out)` resolve to the same curve. Without that, a team ends up with two `ease-out`s that differ by name only. Durations have no theme namespace: write `duration-(--dur-sm)`.

## 3. Roles

**Ask:** What is this element's job: confirm a press, show a small surface, take over the screen, or follow a finger?

Every animated element belongs to one row. A new component joins a row; it doesn't get a new row.

| Role | Curve | Enter / exit | Properties | Notes |
| --- | --- | --- | --- | --- |
| Press | out | press / press | `scale` 0.97 | `:active`, plus the iOS listener in §5 |
| Hover colour | `ease` | press | colour, background, border | no transform on dense lists |
| Toggle, switch | in-out | sm | `translate` of the thumb | transition, so fast clicks retarget |
| Popover, menu, select | out | sm / sm-exit | `opacity`, `scale` 0.96 | origin at the trigger |
| Tooltip | out | sm / sm-exit | `opacity`, `scale` 0.98 | ~500 ms wait before the first, none while another is open |
| Modal, dialog | out | md / md-exit | `opacity`, `scale` 0.96 | origin centre, backdrop on the same tokens |
| Sheet, drawer | sheet | lg / lg-exit | `translate` 100% | backdrop on the same tokens |
| Toast | out | md / md-exit | `translate`, `opacity` | transitions, never keyframes |
| Tab indicator, segmented pill | in-out | md | `translate`, `scale` | moves between known positions |
| Route change | out | md | `opacity` or View Transitions | off under reduced motion |
| First-load entrance | out | reveal + stagger | `opacity`, `translate` 8–12 px | CSS `@keyframes` on server HTML, see `first-load` |
| Scroll reveal | out | reveal | `opacity`, `translate` 12–16 px | below the fold, once |
| Drag follow / release | none, then spring | 1:1, then spring | `transform` | release decided by velocity |
| Keyboard-initiated | none | 0 | none | ⌘K, arrow keys, shortcuts |

Why the popover grows from its trigger and the modal from its centre: the popover belongs to the button that opened it, so it should look like it came out of that button. A modal belongs to the page. If the "Sort" menu in a shop's filter bar scales from its own centre, it appears to float in from nowhere, and the eye has to find it again.

Why toggles and toasts use transitions: a CSS transition starts from the current computed value when the state flips mid-flight. A keyframe animation restarts from its first frame. Tap a switch twice quickly and the keyframe version jumps back before reversing; the transition version turns around where it is.

Why the tooltip waits only once: the first tooltip is a question the user may not have asked, so it waits about half a second. Once one is open, the user is scanning a toolbar on purpose. Making every neighbour wait again turns scanning into a series of pauses.

Springs are for gestures. In Motion, `{ type: 'spring', duration: 0.4, bounce: 0 }` for drag release. Allow bounce up to 0.15 only where a slight overshoot tells the user the element is physical, like a bottom sheet snapping to its open detent. Everything else in the table uses curves, because a curve has a fixed end time and a role table needs fixed end times.

## 4. Pairs and choreography

**Ask:** Which elements does the user read as one object?

A cart drawer and its dimmed backdrop are one event. If the panel runs 320 ms and the backdrop 200 ms, the page goes dark and then the drawer arrives: the user sees two steps where you meant one.

- **Pairs share a token.** Panel and backdrop, popover and chevron rotation, hamburger icon and menu.
- **Exits mirror entrances.** Same curve, shorter token, same direction. A toast that rose from the bottom leaves through the bottom, so a downward swipe feels like the obvious way to dismiss it.
- **Cascades total 1 s or less.** Stagger 40 ms, cap the index at 6: `animation-delay: calc(min(var(--i), 6) * var(--stagger))`. Without the cap, item 30 in a product grid waits 1.2 s and the page looks like it is still loading.
- **One clock per screen.** On a landing page the logo, headline and call to action are one cascade, logo first. A logo that arrives after the headline reads as a late asset, not a choice.
- **Sorting and filtering do not stagger.** The user is reading the list. Re-staggering it on every filter change hides the results they asked for behind an animation they've already seen.

## 5. Input and access

**Ask:** Is there a pointer that can hover, and does the user want movement at all?

```css
@media (hover: hover) and (pointer: fine) {
  .card:hover .card-media { scale: 1.02; }
}

.popover[data-state='closed'] { opacity: 0; scale: 0.96; }

@media (prefers-reduced-motion: reduce) {
  .popover[data-state='closed'] { scale: 1; }   /* fade only, no growth */
  .parallax, .marquee { animation: none; }
}
```

- Phones fire a hover on tap and keep it until the next tap elsewhere. An ungated hover zoom on a product card means the card stays zoomed after the user taps it and goes back to the list. Tailwind v4 `hover:` is already wrapped in `@media (hover: hover)`. Hand-written `:hover` is not.
- iOS Safari only applies `:active` on pages with a touch listener. Without one, the press state never shows and every button feels dead on iPhone. Register one listener, once: `document.addEventListener('touchstart', () => {}, { passive: true })`.
- Reduced motion is per role, not a global `transition-duration: 0`. That blunt rule also removes the fades that explain what changed, so a menu blinks into existence. In Tailwind: `motion-reduce:scale-100 motion-reduce:translate-none`, and keep the opacity transition.
- GSAP and Motion paths check `matchMedia('(prefers-reduced-motion: reduce)')` or `useReducedMotion()` and set the end state directly.

## 6. Framework traps

These are the places where the tokens are right in the code and still wrong on screen.

- **Tailwind v4 transforms.** `scale-*`, `translate-*` and `rotate-*` write the individual `scale`, `translate` and `rotate` properties, not `transform`. So `transition-[opacity,transform]` with `active:scale-97` snaps: the press has no transition at all. Write `transition-[opacity,scale]`, or `transition-transform`, which lists all four properties. This one hides well because the class names look correct.
- **GSAP and CSS on one property.** A CSS `transition: transform` on an element GSAP tweens re-eases every tick, which shows as a smeared, lagging tween. Elements GSAP drives carry no CSS transition for the properties it animates.
- **Vue `<Transition>`.** Keep pure CSS motion in class props, so the tokens stay visible in the template:

```vue
<Transition
  enter-active-class="transition-[opacity,scale] duration-(--dur-sm) ease-out"
  enter-from-class="opacity-0 scale-96"
  leave-active-class="transition-[opacity,scale] duration-(--dur-sm-exit) ease-out"
  leave-to-class="opacity-0 scale-96"
>
  <div v-if="open" class="origin-top-right">…</div>
</Transition>
```

- **Motion (React).** Import from `motion/react`. When the main thread is busy (hydration, data parsing), animate a full `transform` string. The `x`, `y` and `scale` shorthands are composed in JavaScript each frame.
- **Inserted elements without JS.** `@starting-style` gives `<dialog>`, `[popover]` and newly inserted nodes an entry state using the same tokens, with no mounted flag. Example in [TOKENS.md](TOKENS.md).
- **`transition-all`.** It animates whatever changes, including colour on theme switch and padding on a breakpoint. A button that slowly re-colours when the user toggles dark mode is `transition-all`. List the properties.

## 7. Audit

**Ask:** For each animated element, which role is it, and does its code use that role's tokens?

Compare the inventory against §2 and §3. Report one row per finding:

| Where | Now | Token | Fix |
| --- | --- | --- | --- |
| `components/Menu.vue:42` | `duration-300 ease-in` | popover: `sm`, out | `duration-(--dur-sm) ease-out` |
| `components/Cart.vue:18` | backdrop 200 ms, panel 350 ms | sheet: `lg`, sheet | both `duration-(--dur-lg) ease-sheet` |
| `styles/button.css:9` | `transition: transform 150ms` + `active:scale-97` | press | `transition: scale var(--dur-press) var(--ease-out)` |
| `pages/index.vue:60` | `gsap.from('.hero', { opacity: 0 })` | first-load entrance | CSS keyframes, see `first-load` |

Order rows by how often the user meets the element. Buttons, nav and menus come first because they run hundreds of times per session; a settings dialog opened once a month comes last. Group repeated fixes into one row with a file list ("14 buttons use `transition-all`").

## Screens

| Screen | What changes | Check |
| --- | --- | --- |
| Phone, touch | No hover; `:active` needs the touch listener; short thumb travel | Every pressable shows a press on a real iPhone |
| Phone, low-end Android | Main thread 4–6× slower; JS tweens drop frames first | Compositor properties only; CSS or WAAPI for anything during load |
| 120 Hz (iPhone Pro, iPad Pro, MacBook Pro) | Frame budget 8.3 ms; uneven JS motion is visible | Step through at 10% in the Animations panel; no rAF tweens on scroll |
| Tablet | Desktop layout, touch input | Hover-only affordances have a tap path |
| Laptop, desktop | Pointer hover; panels travel further | Travel over ~600 px steps up one token (`md` → `lg`) |
| 4K, 5K | Blur and `backdrop-filter` cost grows with area | No animated blur on full-screen layers |
| Reduced motion | Travel, scale and parallax removed | Fades of 150 ms or less remain; nothing jumps |

Why step up a token instead of scaling with distance: a side panel crossing 900 px of a desktop screen in 240 ms moves fast enough to blur, so it gets `lg`. A formula like `duration = px × 0.4` gives every panel its own duration and you are back to drift. Two or three discrete steps keep the system countable.

## Measure

- **Slow it down.** Chrome DevTools > More tools > Animations, playback at 10% or 25%. Pairs should start and end on the same frame, and nothing should snap in the last frame.
- **Step frames.** Record the screen (QuickTime, or `ffmpeg -f avfoundation -framerate 60 -i "1" out.mov` on macOS) and scrub. A 1 px jump at the start or end means the layer is promoted late: add `will-change: transform` only while the element animates.
- **Read computed values.** Elements panel, Computed tab, filter `transition` or `animation`. Confirm the token resolved to `cubic-bezier(0.23, 1, 0.32, 1)` and not `ease`.
- **Use real devices.** One iPhone, one mid-range Android. Press states, sticky hover and 120 Hz only show there.

## Before shipping

- [ ] Every duration and curve in the diff references a token
- [ ] Each animated element maps to one role in §3
- [ ] Pairs share tokens
- [ ] No `ease-in`, `transition-all`, `scale(0)` or animated layout properties
- [ ] Keyboard-initiated paths are instant
- [ ] Hover motion is gated; pressables have `:active`; the iOS listener exists
- [ ] Reduced motion removes travel and keeps short fades
- [ ] Tailwind v4 transitions list `scale` or `translate` where those utilities are used
- [ ] Checked at 10% speed and on a phone

## Report

- The inventory: distinct curves and durations found, with counts.
- The token set and the files it lives in.
- The audit table from §7, most-used elements first.
- What changed, one line per file.
- What still needs a feel check on a device.
