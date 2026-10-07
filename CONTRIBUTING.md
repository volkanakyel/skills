# Adding a skill

```sh
mkdir skills/<name> && cp templates/skill-template.md skills/<name>/SKILL.md
```

## Layout

```
skills/<name>/
├─ SKILL.md      required. Loaded into the agent's context, keep it under ~450 lines
├─ <TOPIC>.md    optional. Longer reference the skill links to
└─ scripts/      optional. Tools the skill tells the agent to run
```

- The folder name and the `name:` field match, in kebab-case.
- Scripts use what the project already has (Playwright resolved from the working directory, for example) and print a clear message when something is missing.

## Description

The agent loads a skill from its `description` alone. Keep it under 1024 characters, in three parts:

1. What it produces.
2. What it covers, as a list of topics and APIs.
3. `Use when …` with phrases a user would actually type, then which sibling handles the neighbouring job.

## Sections

Every skill uses the same order, so people and agents know where to look:

| Section | Content |
| --- | --- |
| `# Title` + one sentence | What you get |
| `## Scope` | Use it for / not for, with sibling names |
| `## Philosophy` | 3–4 short beliefs, each explained with a real scenario |
| `## Principles` | Numbered rules, one-line reason each |
| `## Diagnose` | Symptom → likely cause → section |
| `## 1.` … `## n.` | The fixes, with values and working code |
| `## Screens` | Phone, tablet, laptop, 4K. Required for performance and layout skills |
| `## Measure` | How to prove it worked |
| `## Before shipping` | Checklist |
| `## Report` | What the agent hands back |

## Writing

- Explain the why. Every rule gets a reason and a scenario a reader can picture: which screen, which component, what the user notices.
- One answer per question, with the reason. No menus of options.
- Numbers you'd defend in a review. Cite the standard when you use one (Core Web Vitals, WCAG, Apple HIG). No invented statistics.
- Plain CSS, HTML and JS first, then short notes for Vue, Nuxt, React and Next.
- Symptoms in the user's words: "the page flashes white", not "FOUC".
- No project names or file paths from client work.
- Short sentences. One em dash per paragraph at most. Skip filler words like seamless, robust, leverage, crucial and ensure.

## Before opening a PR

- [ ] `name` matches the folder, description under 1024 characters, no ": " inside it (it breaks the YAML)
- [ ] `npx skills@latest add . --list` shows the new skill
- [ ] Listed in `README.md`, one line, same format as the others
- [ ] Sibling skills mention the new one where their scopes meet
- [ ] Every script and snippet ran once against a real page
