import { describe, it, expect } from "vitest";
import { checkSource } from "../index.ts";

/**
 * nudo check 金标：多形态 JS 片段上的门禁行为。
 * 每条：source + 期望 ok / 期望出现的 issue code。
 */

type Gold = {
  name: string;
  source: string;
  expectOk: boolean;
  expectCode?: string;
};

const golds: Gold[] = [
  {
    name: "valid positive call",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const r = needsPositive(5);
`,
    expectOk: true,
  },
  {
    name: "negative call violates x>0",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const r = needsPositive(-1);
`,
    expectOk: false,
    expectCode: "nudo:constraint-violated",
  },
  {
    name: "range guard lo is clamp not violation",
    source: `
function clampId(id) {
  if (id < 1) return 1;
  if (id > 9999) return 9999;
  return id;
}
clampId(0);
`,
    // `id < 1` 是回退守卫，不作为调用前置
    expectOk: true,
  },
  {
    name: "range guard valid mid",
    source: `
function clampId(id) {
  if (id < 1) return 1;
  if (id > 9999) return 9999;
  return id;
}
clampId(50);
`,
    expectOk: true,
  },
  {
    name: "pure arithmetic no constraints",
    source: `
function add(a, b) { return a + b; }
const r = add(1, 2);
`,
    expectOk: true,
  },
  {
    name: "ESM export function still listed",
    source: `
export function scale(x) { return x + 1; }
`,
    expectOk: true,
  },
  {
    name: "async function listed",
    source: `
export async function load(id) { return id + 1; }
`,
    expectOk: true,
  },
  {
    name: "class constructor listed",
    source: `
class Counter {
  constructor(n) { this.n = n; }
  get() { return this.n; }
}
export function main() { return new Counter(1).get(); }
`,
    expectOk: true,
  },
  // --- 真阳性：必须报 ---
  {
    name: "zero violates x>0",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(0);
`,
    expectOk: false,
    expectCode: "nudo:constraint-violated",
  },
  {
    name: "unary negative call",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-3);
`,
    expectOk: false,
    expectCode: "nudo:constraint-violated",
  },
  {
    name: "x>=1 rejects 0",
    source: `
function idx(i) {
  if (i >= 1) return i;
  return 1;
}
idx(0);
`,
    expectOk: false,
    expectCode: "nudo:constraint-violated",
  },
  {
    name: "upper bound x<10 rejects 10",
    source: `
function small(n) {
  if (n < 10) return n;
  return 9;
}
small(10);
`,
    expectOk: false,
    expectCode: "nudo:constraint-violated",
  },
  // --- 真阴性：不得误报（clamp / 无前置） ---
  {
    name: "clamp negative input is not violation",
    source: `
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
clamp(-5, 0, 100);
`,
    expectOk: true,
  },
  {
    name: "no guard no constraint",
    source: `
function double(n) { return n * 2; }
double(-1);
`,
    expectOk: true,
  },
  {
    name: "equality guard is not numeric precondition",
    source: `
function onlyZero(x) {
  if (x === 0) return 0;
  return 1;
}
onlyZero(5);
`,
    expectOk: true,
  },
  {
    name: "min boundary valid",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(1);
`,
    expectOk: true,
  },
  // --- 结构 ---
  {
    name: "arrow function constraint",
    source: `
const needsPositive = (x) => {
  if (x > 0) return x;
  return 0;
};
needsPositive(-2);
`,
    expectOk: false,
    expectCode: "nudo:constraint-violated",
  },
  {
    name: "export default function",
    source: `
export default function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-1);
`,
    expectOk: false,
    expectCode: "nudo:constraint-violated",
  },
  {
    name: "both bounds mid valid",
    source: `
function pct(n) {
  if (n >= 0 && n <= 100) return n;
  return 0;
}
pct(50);
`,
    expectOk: true,
  },
  {
    name: "both bounds high invalid",
    source: `
function pct(n) {
  if (n >= 0 && n <= 100) return n;
  return 0;
}
pct(150);
`,
    // 目前 extractParamReqs 可能只取到一侧；若未报则记为 known gap
    expectOk: false,
    expectCode: "nudo:constraint-violated",
  },
];

describe("nudo check gold standards", () => {
  for (const g of golds) {
    it(g.name, () => {
      const report = checkSource("gold.js", g.source);
      expect(report.ok, formatIssues(report)).toBe(g.expectOk);
      if (g.expectCode) {
        expect(
          report.issues.some((i) => i.code === g.expectCode),
          formatIssues(report),
        ).toBe(true);
      }
      // 每个 case 至少能列出函数或明确无函数
      expect(Array.isArray(report.signatures)).toBe(true);
    });
  }
});

function formatIssues(r: { issues: Array<{ severity: string; code: string; message: string }> }): string {
  return r.issues.map((i) => `${i.severity} ${i.code}: ${i.message}`).join("; ") || "(none)";
}
