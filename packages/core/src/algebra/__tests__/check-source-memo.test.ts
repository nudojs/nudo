import { describe, it, expect, beforeEach } from "vitest";
import {
  checkSource,
  resetCheckSourceMemo,
  evictCheckSourceMemoForPaths,
  resetGeneralizeMemo,
  pTrue,
} from "../index.ts";
import { STD_NUDO_SRC, withStdImport } from "./nudo-constraints.ts";
import { MAX_CHECK_MEMO, checkMemoSize } from "../check/check-memo.ts";

const SRC = `
function add(a, b) {
  return a + b;
}
function needsPositive(x) {
  /** @nudo:contract x positive */
  return x + 1;
}
`;

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
});

describe("checkSource whole-file memo", () => {
  it("hit returns equivalent report for same source", () => {
    const a = checkSource("/t/a.js", SRC, pTrue, {});
    const b = checkSource("/t/a.js", SRC, pTrue, {});
    expect(b.ok).toBe(a.ok);
    expect(b.signatures.map((s) => s.name)).toEqual(a.signatures.map((s) => s.name));
    expect(b.issues.map((i) => i.code)).toEqual(a.issues.map((i) => i.code));
    expect(b.summary).toEqual(a.summary);
  });

  it("evictCheckSourceMemoForPaths drops dependents of that dep", () => {
    const loadModule = () => "export const positive = number().gt(0);\n";
    const opts = { loadModule, fromFile: "/t/a.js" };
    const src = `
/// @nudo:import { positive } from "./shapes.nudo.js"
function needsPositive(x) {
  /** @nudo:contract x positive */
  return x + 1;
}
`;
    checkSource("/t/a.js", src, pTrue, opts);
    checkSource("/t/b.js", SRC, pTrue, {});
    const n = evictCheckSourceMemoForPaths(["/t/shapes.nudo.js"]);
    expect(n).toBeGreaterThan(0);
  });

  it("mutating returned issues does not corrupt cache", () => {
    const a = checkSource("/t/a.js", SRC, pTrue, {});
    a.issues.push({
      severity: "error",
      code: "x",
      message: "mutated",
    });
    a.signatures.length = 0;
    const b = checkSource("/t/a.js", SRC, pTrue, {});
    expect(b.issues.some((i) => i.message === "mutated")).toBe(false);
    expect(b.signatures.length).toBeGreaterThan(0);
  });

  it("reports constraint violation for const-assigned literal call", () => {
    const loadModule = (spec: string) =>
      spec.includes("std") ? STD_NUDO_SRC : undefined;
    const src = `${withStdImport(`
/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const bad = needsPositive(-1);
`)}`;
    const r = checkSource("/t/scan.js", src, pTrue, { loadModule, fromFile: "/t/scan.js" });
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("reports constraint violation for if-condition literal call", () => {
    const loadModule = (spec: string) =>
      spec.includes("std") ? STD_NUDO_SRC : undefined;
    const src = `${withStdImport(`
/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
if (needsPositive(-1)) {}
`)}`;
    const r = checkSource("/t/scan-if.js", src, pTrue, { loadModule, fromFile: "/t/scan-if.js" });
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("全量扫描 > 256 个文件时最先的条目不被逐出（LRU 抖动回归）", () => {
    // 2026-11-12：原 MAX_CHECK_MEMO=256 小于中型仓工作集（本仓干净语料 286）。
    // 顺序重扫时 LRU 恰好逐出「下一个要访问的条目」⇒ 命中率归零、
    // warm `check all` 41.0s；200 文件（容量内）对照仅 433.70ms。
    const SIMPLE = "function id(x) { return x; }";
    const n = 300;
    expect(MAX_CHECK_MEMO).toBeGreaterThan(n);
    for (let i = 0; i < n; i++) checkSource(`/t/f${i}.js`, SIMPLE, pTrue, {});
    expect(checkMemoSize()).toBe(n);
    // 第二轮完整重扫后仍是同样的 n 条（容量内 ⇒ 顺序重扫不逐出）
    for (let i = 0; i < n; i++) checkSource(`/t/f${i}.js`, SIMPLE, pTrue, {});
    expect(checkMemoSize()).toBe(n);
  });
});
