/**
 * Homepage content constants (copy, code samples, comparison rows, feature lists).
 * Kept free of React so `src/pages/index.tsx` stays a thin layout layer.
 *
 * Translate ids are the i18n contract — do not rename without updating
 * `i18n/zh-Hans/code.json`.
 */

/* ── Shared product example ────────────────────────────────────────────────
   Inlays follow product semantics:
   - Function body: algebraic Abs (sidecar vars / path preds). No concrete
     case bindings unless a call-site / @nudo:case is in view.
   - calls.js tab: concrete call-site facts + contract gate.
   ------------------------------------------------------------------------ */

/** Lines are 1-based; inlay = always-visible hint, detail = hover panel. */
export type LineHint = { line: number; inlay: string; detail: string };

export const sourceCode = `export function lineTotal(price, qty) {
  return price * qty;
}

export function applyCoupon(order, code) {
  const rate =
    code === "VIP10" ? 0.1 :
    code === "VIP20" ? 0.2 : 0;
  return {
    ...order,
    total: order.subtotal * (1 - rate),
    coupon: rate > 0 ? code : "NONE",
  };
}

// call sites are evidence
lineTotal(12, 3);
applyCoupon({ subtotal: 100, items: 3 }, "VIP10");

// L1 gate: price > 0 from pricing.nudo.js
lineTotal(0, 2);`;

/* Algebraic inlays — no case, no concrete "when" */
export const sourceHints: LineHint[] = [
  {
    line: 1,
    inlay: "price: number · price > 0",
    detail:
      "param  price\nshape  number\npred   price > 0     // sidecar\nconf   path\n\nqty    number · qty ≥ 1",
  },
  {
    line: 2,
    inlay: "term (price × qty) · > 0",
    detail:
      "return\n  term  (price * qty)\n  pred  (price * qty) > 0\n        // price>0 ∧ qty≥1  ⇒  product > 0\n        // aligns with sidecar return number().gt(0)\n  conf  path\n\n(no concrete case — algebraic entry vars)",
  },
  {
    line: 5,
    inlay: "order shape · code: string",
    detail:
      "param  order\n  shape  { subtotal ≥ 0; items ≥ 0 }\n  conf   path (sidecar)\nparam  code\n  shape  string\n  conf   path",
  },
  {
    line: 8,
    inlay: "rate ∈ {0, 0.1, 0.2}",
    detail:
      "term   rate\npred   rate = 0 ∨ rate = 0.1 ∨ rate = 0.2\n       // path-narrowed on code === …\nconf   path",
  },
  {
    line: 12,
    inlay: "term subtotal×(1−rate) · ≥ 0",
    detail:
      "field  total\n  term  order.subtotal * (1 - rate)\n  pred  total ≥ 0          // sidecar number().ge(0)\n  conf  path",
  },
  {
    line: 13,
    inlay: "coupon: string",
    detail:
      "field  coupon\n  term  rate>0 ? code : \"NONE\"\n  pred  string\n  conf  path",
  },
  {
    line: 18,
    inlay: "=> 36  #exact",
    detail:
      "call   lineTotal(12, 3)\nresult 36  #exact\n\nConcrete values live at the call site.",
  },
  {
    line: 19,
    inlay: "total 90 · coupon \"VIP10\"",
    detail:
      "call   applyCoupon({subtotal:100, items:3}, \"VIP10\")\nrate   0.1\ntotal  90\ncoupon \"VIP10\"  #exact",
  },
  {
    line: 21,
    inlay: "⊭ price > 0",
    detail:
      "call     lineTotal(0, 2)\nactual   0  #exact\nexpected price > 0   // sidecar\ngate     nudo:constraint-violated",
  },
];

export const contractCode = `import { number, fn, shape, string } from "@nudojs/core";

export const lineTotal = fn(
  { price: number().gt(0), qty: number().ge(1) },
  number().gt(0)
);

export const applyCoupon = fn(
  {
    order: shape({
      subtotal: number().ge(0),
      items: number().ge(0),
    }),
    code: string(),
  },
  shape({
    subtotal: number(),
    items: number(),
    total: number().ge(0),
    coupon: string(),
  })
);`;

/* Accepted sidecar after review — human-tightened preds */
export const contractHints: LineHint[] = [
  {
    line: 3,
    inlay: "reviewed · price > 0 · qty ≥ 1",
    detail:
      "accepted into pricing.nudo.js\nhuman tightened number() → number().gt(0)\nreturn number().gt(0)\n\ndraft is a starting point — this is the gate",
  },
  {
    line: 8,
    inlay: "reviewed shape",
    detail:
      "promoted body-read fields to obligations\nonly after review — draft never auto-enforces",
  },
  {
    line: 17,
    inlay: "return shape · total ≥ 0",
    detail: "L1 obligations live here after accept",
  },
];

/* Call sites live in their own tab — concrete facts + gate example */
export const checkOutput = `$ npx nudojs check pricing.js
signatures
  lineTotal(price: number, qty: number) => number
  applyCoupon(order: { subtotal: number, items: number }, code: string)
    => { subtotal: number, items: number, total: number, coupon: string }
issues
  [ERROR L21 lineTotal] lineTotal[price]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: price > 0
      → use a value satisfying price > 0, or relax the precondition on price
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)`;

export const checkHints: LineHint[] = [
  {
    line: 3,
    inlay: "from sidecar + body",
    detail:
      "signatures reflect Abs after contracts:\nprice: number · price > 0 (sidecar)\nqty:   number · qty ≥ 1\n// unconstrained entry params print as any\n// unknown = inference failed — not this",
  },
  {
    line: 6,
    inlay: "L1 gate",
    detail:
      "call site lineTotal(0, 2) ⊭ sidecar pred\nactual ⊭ expected on Abs\nCI: nudo check exits 1",
  },
  {
    line: 8,
    inlay: "price > 0",
    detail:
      "expected pred from pricing.nudo.js\nalgebraic — not a declared TS type\ncontracts are JS modules — no second language",
  },
];

export const dtsOutput = `$ npx nudojs export pricing.js --format dts
/**
 * Case: call@L17 (12, 3) => 36
 * Case: call@L21 (0, 2) => 0
 * @param price - number
 * @param qty   - number
 * @returns number
 */
export declare function lineTotal(
  price: number,
  qty: number
): number;

/**
 * Case: call@L18 (…) => { …, coupon: "VIP10" }
 * @param order - { subtotal: number; items: number }
 * @param code  - string
 * @returns { subtotal: number; items: number;
 *            total: number; coupon: string }
 */
export declare function applyCoupon(
  order: { subtotal: number; items: number },
  code: string
): {
  subtotal: number;
  items: number;
  total: number;
  coupon: string;
};`;

export const dtsHints: LineHint[] = [
  {
    line: 3,
    inlay: "call@ evidence",
    detail:
      "Case rows are extensional notes\nfrom observed call sites\n(not the contract product)",
  },
  {
    line: 13,
    inlay: "abs → .d.ts",
    detail:
      "one-way lossy projection of Abs\nCI gate remains nudo check\nZod / guards carry numeric bounds",
  },
];

/* CLI export --format schema writes a ready-to-import zod JS module. */
export const zodOutput = `// nudo export pricing.js --format schema --dialect zod
// One-way lossy projection of Abs; nudo check remains the gate.

import { z } from "zod";

export const lineTotalInput = z.object({
  price: z.number().gt(0),
  qty: z.number().gte(1),
});
export const lineTotalOutput = z.number().gt(0);

export const applyCouponInput = z.object({
  order: z.object({
    subtotal: z.number().gte(0),
    items: z.number().gte(0),
  }),
  code: z.string(),
});
export const applyCouponOutput = z.object({
  subtotal: z.number(),
  items: z.number(),
  total: z.number().gte(0),
  coupon: z.string(),
});`;

export const zodHints: LineHint[] = [
  {
    line: 8,
    inlay: "pred → z.number().gt(0)",
    detail:
      "sidecar number().gt(0)\nprojects to zod bound\n(absToSchemaSource)",
  },
  {
    line: 11,
    inlay: "return → z.number().gt(0)",
    detail:
      "return contract number().gt(0)\n→ z.number().gt(0)\n// matches algebra on entry preds",
  },
  {
    line: 23,
    inlay: "total ≥ 0 → gte(0)",
    detail:
      "sidecar total: number().ge(0)\n→ z.number().gte(0)",
  },
];

/* ── Comparison / feature / list data ─────────────────────────────────────── */

export type BeyondRow = { code: string; ts: string; nudo: string };

export const beyondExamples: BeyondRow[] = [
  { code: `"0x" + id`, ts: "string", nudo: "`0x${string}`" },
  { code: `"hello".slice(1, 3)`, ts: "string", nudo: '"el"' },
  { code: `"a,b,c".split(",")`, ts: "string[]", nudo: '["a", "b", "c"]' },
  { code: `for (let i = 0; i < 5; i++) sum += i`, ts: "number", nudo: "10" },
];

export type AdoptStep = {
  tagId: string;
  tagDefault: string;
  titleId: string;
  titleDefault: string;
  cmd: string;
};

/** Product path — Observation → Contracts → ecosystem → leave tsc. */
export const adoptSteps: AdoptStep[] = [
  {
    tagId: "homepage.adopt.day0.tag",
    tagDefault: "Observation",
    titleId: "homepage.adopt.day0.title",
    titleDefault: "Observe + gate",
    cmd: "npx nudojs check src/",
  },
  {
    tagId: "homepage.adopt.day1.tag",
    tagDefault: "Contracts",
    titleId: "homepage.adopt.day1.title",
    titleDefault: "Add contracts",
    cmd: "lib.nudo.js  ·  @nudo:contract  ·  nudo check",
  },
  {
    tagId: "homepage.adopt.eco.tag",
    tagDefault: "Ecosystem",
    titleId: "homepage.adopt.eco.title",
    titleDefault: "Project artifacts",
    cmd: "npx nudojs export src/ --format dts|schema",
  },
  {
    tagId: "homepage.adopt.exit.tag",
    tagDefault: "Exit",
    titleId: "homepage.adopt.exit.title",
    titleDefault: "Retire tsc",
    cmd: "npx nudojs migrate status|strip|verify|retire",
  },
];

export type TrialStat = { value: string; labelId: string; labelDefault: string };

export const trialStats: TrialStat[] = [
  {
    value: "98.6%",
    labelId: "homepage.trial.stat1",
    labelDefault: "precise signatures on @hapi/hoek",
  },
  {
    value: "0",
    labelId: "homepage.trial.stat2",
    labelDefault: "type annotations you write",
  },
  {
    value: "291 → 0",
    labelId: "homepage.trial.stat3",
    labelDefault: "contract check failures cleared",
  },
  {
    value: "0.2 ms",
    labelId: "homepage.trial.stat4",
    labelDefault: "median file-edit re-analyze",
  },
];

/** Cost narrative for AI coding — measured baselines, not a closed benchmark. */
export type CostStat = { value: string; compare: string; labelId: string; labelDefault: string };

export const costStats: CostStat[] = [
  {
    value: "569k",
    compare: "vs 993k",
    labelId: "homepage.cost.token",
    labelDefault: "agent tokens to green (OSS historical-bug slice)",
  },
  {
    value: "45",
    compare: "vs 63",
    labelId: "homepage.cost.rounds",
    labelDefault: "gate rounds on the documented fix path",
  },
  {
    value: "0.19 ms",
    compare: "vs 10 ms+",
    labelId: "homepage.cost.edit",
    labelDefault: "median single-file analyze (vs tsc.LS in micro probe)",
  },
];

export type SignatureCard = {
  fn: string;
  evidenceId: string;
  evidenceDefault: string;
  beforeId: string;
  beforeDefault: string;
  after: string;
};

export const signatureCards: SignatureCard[] = [
  {
    fn: "coupon",
    evidenceId: "homepage.trial.card.evidence1",
    evidenceDefault: "from cart.js call site",
    beforeId: "homepage.trial.card.before",
    beforeDefault: "no call-site evidence → any",
    after: '("vip") => "SAVE-VIP"',
  },
  {
    fn: "deepEqual",
    evidenceId: "homepage.trial.card.evidence2",
    evidenceDefault: "from @hapi/hoek usage",
    beforeId: "homepage.trial.card.before",
    beforeDefault: "no call-site evidence → any",
    after: "({a:1,b:{c:2}}, {a:1,b:{c:2}}) => boolean",
  },
  {
    fn: "flatten",
    evidenceId: "homepage.trial.card.evidence3",
    evidenceDefault: "from recursive + loop usage",
    beforeId: "homepage.trial.card.before",
    beforeDefault: "no call-site evidence → any",
    after: "([1,[2,[3,4]]]) => [1,2,3,4]",
  },
];

/** Validate vs. project rail under Work modes. */
export type EcoItem = { title: string; descId: string; descDefault: string };

export const ecoItems: EcoItem[] = [
  {
    title: "nudo check",
    descId: "homepage.eco.check",
    descDefault: "Validation / CI only. Does not generate artifacts.",
  },
  {
    title: "export · dts",
    descId: "homepage.eco.dts",
    descDefault: "`.d.ts` for TypeScript consumers. Lossy projection.",
  },
  {
    title: "export · Zod / guards",
    descId: "homepage.eco.zod",
    descDefault: "Runtime validators from Abs. Not a substitute for `check`.",
  },
  {
    title: "export · Standard Schema",
    descId: "homepage.eco.json",
    descDefault:
      "Standard Schema validators for runtime checks and downstream tooling.",
  },
  {
    title: "IDE / LSP",
    descId: "homepage.eco.ide",
    descDefault: "Hover / inlay read Abs directly.",
  },
  {
    title: "Agent / MCP",
    descId: "homepage.eco.agent",
    descDefault:
      "Coding agents read the same Abs via LSP / MCP — see the AI agents section.",
  },
];

export type AgentCard = {
  titleId: string;
  titleDefault: string;
  descId: string;
  descDefault: string;
  cmd: string;
};

export const agentCards: AgentCard[] = [
  {
    titleId: "homepage.agent.card1.title",
    titleDefault: "Same Abs as the IDE",
    descId: "homepage.agent.card1.desc",
    descDefault:
      "Hover / inlay and agent tools consume Abs directly. `export` projections stay lossy; Abs remains the source of truth.",
    cmd: "npx nudojs check src/ --json",
  },
  {
    titleId: "homepage.agent.card2.title",
    titleDefault: "LSP + MCP surface",
    descId: "homepage.agent.card2.desc",
    descDefault:
      "`@nudojs/lsp` exposes agent `executeCommand` tools. Wire MCP for Cursor, Claude Code, and other agent clients without a separate server protocol.",
    cmd: "@nudojs/lsp · nudo.contract · nudo.whatIf",
  },
  {
    titleId: "homepage.agent.card3.title",
    titleDefault: "Stable product rules",
    descId: "homepage.agent.card3.desc",
    descDefault:
      "Agents must not invent body-AST obligations or treat `@nudo:case` as contracts. Entry `any` ≠ `unknown`. Observation is `check`; Contracts is `contract` + `check`.",
    cmd: "actual ⊭ expected · nudo:constraint-violated",
  },
  {
    titleId: "homepage.agent.card4.title",
    titleDefault: "Agent entrypoint",
    descId: "homepage.agent.card4.desc",
    descDefault:
      "Publish `agents.md` + `llms.txt` so coding agents can set up Nudo without guessing product nouns. Paste the setup block into your agent and go.",
    cmd: "nudojs.github.io/nudo/agents.md",
  },
];

export const agentPaste = `Read https://nudojs.github.io/nudo/docs/reference/agents
Primary gate: npx nudojs check <path>
Contracts are *.nudo.js / @nudo:contract
Do not invent body-AST obligations. @nudo:case is debug-only.
Entry params print as any; unknown = inference failed.`;

export type PathCard = {
  eyebrowId: string;
  eyebrowDefault: string;
  titleId: string;
  titleDefault: string;
  descId: string;
  descDefault: string;
  to: string;
  ctaId: string;
  ctaDefault: string;
};

export const pathCards: PathCard[] = [
  {
    eyebrowId: "homepage.paths.card1.eyebrow",
    eyebrowDefault: "JS engineer",
    titleId: "homepage.paths.card1.title",
    titleDefault: "Type / CI gate on real JS",
    descId: "homepage.paths.card1.desc",
    descDefault:
      "Mental model, then a runnable check on your own files — signatures even when the gate is green.",
    to: "/docs/getting-started/quick-start",
    ctaId: "homepage.paths.card1.cta",
    ctaDefault: "Quick Start",
  },
  {
    eyebrowId: "homepage.paths.card2.eyebrow",
    eyebrowDefault: "TypeScript user",
    titleId: "homepage.paths.card2.title",
    titleDefault: "See the difference, then leave tsc",
    descId: "homepage.paths.card2.desc",
    descDefault:
      "Honest comparison, migration path, and a one-way retire gate — coexistence is not the end state.",
    to: "/docs/guides/vs-typescript",
    ctaId: "homepage.paths.card2.cta",
    ctaDefault: "Nudo vs TypeScript",
  },
  {
    eyebrowId: "homepage.paths.card3.eyebrow",
    eyebrowDefault: "Existing JS package",
    titleId: "homepage.paths.card3.title",
    titleDefault: "Contracts from real usage",
    descId: "homepage.paths.card3.desc",
    descDefault:
      "Point Nudo at tests and call sites. Draft contracts from evidence; accept only what you mean.",
    to: "/docs/guides/migrating-js",
    ctaId: "homepage.paths.card3.cta",
    ctaDefault: "Logic-first guide",
  },
  {
    eyebrowId: "homepage.paths.card4.eyebrow",
    eyebrowDefault: "CI / platform",
    titleId: "homepage.paths.card4.title",
    titleDefault: "Stable gates and diagnostics",
    descId: "homepage.paths.card4.desc",
    descDefault:
      "Recipes for `nudo check` in CI, machine-readable reports, and the diagnostics glossary.",
    to: "/docs/guides/recipes",
    ctaId: "homepage.paths.card4.cta",
    ctaDefault: "Recipes",
  },
  {
    eyebrowId: "homepage.paths.card5.eyebrow",
    eyebrowDefault: "AI coding agent",
    titleId: "homepage.paths.card5.title",
    titleDefault: "Same Abs face via LSP / MCP",
    descId: "homepage.paths.card5.desc",
    descDefault:
      "Agents run `nudo check`, respect sidecar contracts, and parse stable diagnostic IDs.",
    to: "/docs/reference/agents",
    ctaId: "homepage.paths.card5.cta",
    ctaDefault: "Agent docs",
  },
];

/** Command shown in hero copy button and the closing CTA. */
export const heroCmd = "npx nudojs check ./pricing.js";
