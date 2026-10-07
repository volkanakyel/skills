# Design Engineering Skills

Skills that help agents ship interfaces that feel right and load fast, on every screen.

I'm [Volkan](https://www.volkanakielle.com), a design engineer. I build products from first sketch to production, design and code, no hand-off. What I care about is consistency. Same curve on every popover, same press on every button, same clean first frame on a cheap Android and on a 5K monitor.

Users never mention it. They just trust the product more.

## Install

```bash
npx skills@latest add volkanakyel/skills
```

## AI defaults

Agents ship fast. Their defaults ship with them.

| AI default | What I ship |
| --- | --- |
| `transition-all 300ms ease-in` | 180 ms, two properties, ease-out |
| Hero hidden until JavaScript loads | Visible on the first frame |
| One 2560px image for every screen | The size each screen needs |
| Tested on a MacBook | Phone first, then up to 4K |

Each row looks small. Together they decide whether your product feels premium or generated.

## Reference

- **[web-animation-design](./skills/web-animation-design/SKILL.md)** — One motion system for the whole product, and an audit that finds every value off it.
- **[web-performance](./skills/web-performance/SKILL.md)** — Measure your site from phone to 4K and fix what users feel first.
- **[first-load](./skills/first-load/SKILL.md)** — No blank screen, no flicker, no font jump.
- **[runtime-performance](./skills/runtime-performance/SKILL.md)** — Instant taps and smooth scroll after load.
- **[responsive-media](./skills/responsive-media/SKILL.md)** — Light images on phones, sharp ones on 5K.

More coming. See [CONTRIBUTING.md](./CONTRIBUTING.md) to add one.

## Credits

Motion guidance draws on [Emil Kowalski](https://emilkowal.ski)'s [Animations on the Web](https://animations.dev). If you want his own take, install [his skills](https://github.com/emilkowalski/skills) too. They pair well with these.

---

MIT © Volkan Akyel
