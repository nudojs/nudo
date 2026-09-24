---
slug: /guides/ai-native-dx
description: AI-native DX — why agents close red→green with less noise on Nudo than on TypeScript. Structured actions, honest unknown, and measurable evals.
---

# AI-native DX

**You'll leave with:** how Nudo is built for **agent repair loops** — not only human IDEs — and how to measure that objectively (tokens · rounds · bugs).

Nudge for agents: **do not trust declarations. Run `nudo check --json`. The `actual` field is a value; `actions[]` is the next step.**

## Why agents struggle on TypeScript

| Agent pain on TS | What happens |
|------------------|--------------|
| **Silent green** | `ms: number` + `setDelay(0)` type-checks. The bug ships. |
| **Prose errors** | “Not assignable to type …” — no value, no command |
| **Two IRs** | Annotations drift from runtime; the agent “fixes” the wrong side |
| **Expensive loops** | Full-project `tsc` / LS rounds cost latency and tokens |

## What Nudo gives the agent

| Need | Face |
|------|------|
| Ground truth | Analysis **executes** JS (Abs). Call sites are evidence. |
| Machine gate | `npx nudojs check <file> --json` → **CheckJson v1** (stable codes) |
| Next step | `issues[].actions[]` — `draft` / `relax` / `callsite` / … + optional `command` |
| Honesty | `any` ≠ `unknown`; **`budget.truncated`** when results widened |
| Fast loops | Edit-path checks stay cheap vs `tsc.LS` |
| Exit | `migrate retire` — one gate, not dual-run |

```json
{
  "code": "nudo:constraint-violated",
  "actual": "0  #exact",
  "expected": "ms > 0",
  "actions": [
    { "kind": "callsite", "label": "use a value satisfying the constraint", "hint": "ms > 0" },
    { "kind": "relax", "label": "relax the precondition (edit *.nudo.js / @nudo:refine)" },
    { "kind": "draft", "command": "nudo contract --draft", "label": "emit a sidecar draft you can edit" }
  ]
}
```

Few-shot wrong→right pairs live in [Agents](../reference/agents) (and `packages/lsp/agent-skill/SKILL.md`). Paste block:

```text
Read https://nudojs.github.io/nudo/agents.md and set up Nudo in this project.
Primary gate: npx nudojs check <path>.
Prefer issues[].actions[] over parsing suggestion prose.
Do not invent body-AST obligations. @nudo:case is debug-only.
Entry params print as any; unknown = inference failed.
Leaving tsc: npx nudojs migrate status|strip|verify|retire (exit is retire).
```

## What to measure (do not debate “feels agent-friendly”)

| Metric | Definition | Why it matters |
|--------|------------|----------------|
| **detectRate** | Bug is red at the gate | Did the agent even see it? |
| **silentGreen** | Gate exits 0 while the bug remains | TypeScript failure mode |
| **wrongFixGreen** | Gate stays green after the *typical wrong* fix | Cheatable gate |
| **diagTokens** | ≈ tokens of the first red payload (**only when detected**) | Read cost once the gate speaks |
| **rounds** | Gate runs on the **documented** fix path | Iteration tax |

Paired harness (same bug in JS+Nudo vs TS+tsc) — `pnpm run agent-dx`:

```text
task                | detect n/ts | diagTok n/ts (when fired) | wrongFixGreen n/ts | rounds n/ts
01-constraint       | RED/SG      | 101/0                     | true/true          | 1/0
02-shape            | RED/RED     | 96/58                     | true/true          | 1/1
03-assign           | RED/RED     | 98/44                     | false/true         | 1/1
04-entry-throws     | RED/SG      | 124/0                     | false/true         | 1/0
05-return           | RED/SG      | 96/0                      | true/true          | 1/0

detectRate    nudo=5/5   ts=2/5
silentGreen   nudo=0/5   ts=3/5
wrongFixGreen nudo=3/5   ts=5/5
```

**TS “cheap” tokens are often silence** — the agent never sees the bug. Nudo pays tokens to **detect**.

```bash
pnpm run agent-dx                      # table
node benchmark/agent-dx/run.mjs --json # ingest
pnpm run agent-eval                    # Nudo-only 10-task red→green
pnpm run dx-metrics                    # fix-rate / time-to-green
```

Source: [`benchmark/agent-dx/`](https://github.com/nudojs/nudo/tree/main/benchmark/agent-dx).

### Heavier paired evals (in-repo)

`agent-dx` is the **static** gate-payload probe. For **LLM repair loops** on a multi-file module graph (real historical bugs: detect · silentGreen · token/round cost), use `benchmark/lsp-rounds/` — fixtures are generated from a local `node-semver` checkout (`oss-semver/build.mjs`); the curated report is `benchmark/lsp-rounds/out/OSS-SEMVER.md`.

**OSS historical-bug slice (node-semver, 6 recent fixes, ~2.4k LOC multi-file)** — both sides finished **6/6**:

| | Nudo | TypeScript |
|--|--|--|
| detectRate | **6/6** | **6/6** |
| silentGreen | false | false (when finished) |
| tokenTotal | **569k** | 993k (**+75%**) |
| rounds / repairLoops | **45 / 16** | 63 / 21 |
| gate peak RSS | **226MB** | 289MB |

Takeaway: on a **large real module**, both toolchains can reach full detect — the gap is **cost and reliability**, not a ceiling fight. Under tighter budgets the TS side also showed **silentGreen** (gate green, bugs left) in 2/3 attempts; Nudo’s completed run did not. Type-face probes (`agent-dx`) still show the sharper **detect / silentGreen** split on constraint-shaped bugs.

```bash
node benchmark/lsp-rounds/oss-semver/build.mjs /path/to/node-semver
node benchmark/lsp-rounds/harness/run.mjs --seed 1 --task oss
```

## Agent loop (recommended)

```text
write/patch JS
  → nudo check --json
  → pick actions[] (or few-shot pair)
  → edit callsite / relax contract / draft→accept
  → nudge check again
  → green, or honest unknown (do not fake @returns)
```

Scriptable probes:

```bash
npx nudojs check src/app.js --what-if raw=string --target size
npx nudojs contract --draft src/app.js --json    # draftSource + unified diff
```

## Non-goals (keep the agent honest)

- Do **not** rewrite JS → TS “for types”.
- Do **not** invent body-AST obligations.
- Do **not** silence `unknown` with a fabricated `@returns`.
- Do **not** present dual `tsc` + `nudo check` as the end state — exit is **`migrate retire`**.

## Next

- [Agents](../reference/agents) — rules + few-shot fix pairs
- [Error faces](./error-faces) — human-readable `actual ⊭ expected`
- [Mental model](../getting-started/mental-model) — 10 minutes
- [Migrate from TypeScript](./migrating-from-typescript) — retire tsc
