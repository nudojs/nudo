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
      expect(Array.isArray(report.functions)).toBe(true);
    });
  }
});

function formatIssues(r: { issues: Array<{ severity: string; code: string; message: string }> }): string {
  return r.issues.map((i) => `${i.severity} ${i.code}: ${i.message}`).join("; ") || "(none)";
}
