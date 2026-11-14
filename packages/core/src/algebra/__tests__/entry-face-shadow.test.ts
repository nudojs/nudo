/**
 * ADR 0001 阶段 1 · check 面接线验收（切片 1 影子双读 / 切片 2 可切换 /
 * 切片 3 默认切换 + 缓存键纪律）。
 *
 * 切片 3 起 `entryFaceEnabled` **默认开启**：`check` 的入口名表由
 * `SemanticIndex.entries` 解析；`setSemanticIndexEntryFace(false)` 仍是
 * 可回退旧面的 fallback。`shadowEnabled` 独立且默认关闭，只负责记录分歧。
 */
import { describe, it, expect, afterEach } from "vitest";
import { checkSource } from "../check/check.ts";
import { checkMemoKey } from "../check/check-memo.ts";
import { l2Count } from "./nudo-constraints.ts";
import { parseSource } from "../parse-source.ts";
import {
  compareEntryFaces,
  resolveEntryFace,
  semanticIndexEntryFaceSegment,
  semanticIndexShadowActive,
  setSemanticIndexEntryFace,
  setSemanticIndexShadow,
  takeSemanticIndexShadow,
} from "../scan/entry-face-shadow.ts";
import { listTopFunctions, listClassEntryNames } from "../scan/scan-top-functions.ts";
import type { CheckOptions } from "../check/check-types.ts";
import type { LoadDepsFingerprint } from "../key/load-deps-fp.ts";

const DESTRUCTURED = `export const { a } = { a: () => null.x };`;
const CONTROL = `export function f() { return 1; }`;

/** 每个用例后恢复交付默认态：索引面开启、影子关闭。 */
afterEach(() => {
  setSemanticIndexShadow(false);
  setSemanticIndexEntryFace(true);
  takeSemanticIndexShadow();
});

describe("ADR 0001 阶段 1 · check 影子双读与 fallback", () => {
  it("影子开关默认关闭：不记录分歧", () => {
    expect(semanticIndexShadowActive()).toBe(false);
    checkSource("/virtual/shadow-off.js", DESTRUCTURED);
    expect(takeSemanticIndexShadow()).toBeUndefined();
  });

  it("回退旧面后开启影子：只记录分歧，门禁结论仍以旧面为准", () => {
    setSemanticIndexEntryFace(false);
    setSemanticIndexShadow(true);
    const report = checkSource("/virtual/shadow-on.js", DESTRUCTURED);
    const diff = takeSemanticIndexShadow();
    expect(diff).toBeDefined();
    expect(diff!.added).toContain("a");
    expect(diff!.missing).toEqual([]);
    // 旧面看不见解构导出 ⇒ 0 fn ⇒ 不会因新索引多报 entry-may-throw。
    expect(l2Count(report)).toBe(0);
  });

  it("影子开关前后同一源码的报告一致（只读观察不改结论）", () => {
    setSemanticIndexShadow(false);
    const before = checkSource("/virtual/shadow-before.js", CONTROL);
    setSemanticIndexShadow(true);
    const after = checkSource("/virtual/shadow-after.js", CONTROL);
    expect(after.signatures).toEqual(before.signatures);
    expect(after.issues.map((i) => i.code)).toEqual(before.issues.map((i) => i.code));
  });

  it("compareEntryFaces：控制夹具旧面与索引一致", () => {
    const old = [...listTopFunctions(CONTROL), ...listClassEntryNames(CONTROL)];
    const diff = compareEntryFaces(parseSource(CONTROL), old);
    expect(diff.added).toEqual([]);
    expect(diff.missing).toEqual([]);
  });
});

describe("ADR 0001 阶段 1 · 切片 3 索引普查面（默认开启）", () => {
  it("默认开启：segment 为 idx1，解构导出直接进入签名面", () => {
    expect(semanticIndexEntryFaceSegment()).toBe("idx1");
    const report = checkSource("/virtual/face-default.js", DESTRUCTURED);
    expect(report.signatures.map((s) => s.name)).toEqual(["a"]);
  });

  it("显式回退旧面：同一数组引用返回、不记录分歧", () => {
    const file = parseSource(DESTRUCTURED);
    const old = [...listTopFunctions(DESTRUCTURED, file), ...listClassEntryNames(DESTRUCTURED, file)];
    setSemanticIndexEntryFace(false);
    expect(semanticIndexEntryFaceSegment()).toBe("idx0");
    expect(resolveEntryFace(file, old)).toBe(old);
    expect(takeSemanticIndexShadow()).toBeUndefined();
  });

  it("默认切换补上解构导出入口，且不丢任何旧入口", () => {
    const src = `export function f() { return 1; }\nexport const { a } = { a: () => null.x };`;
    const file = parseSource(src);
    const old = [...listTopFunctions(src, file), ...listClassEntryNames(src, file)];
    expect(old).toContain("f");
    expect(old).not.toContain("a");
    const names = resolveEntryFace(file, old);
    expect(names).toContain("f"); // 旧入口不因切换消失
    expect(names).toContain("a"); // BUG-015 的解构导出被登记
    expect(compareEntryFaces(file, old).added).toContain("a");
  });

  it("索引为空时 fail-closed 回退旧面", () => {
    const src = `// nothing here\n`;
    const file = parseSource(src);
    const old = ["legacy"];
    expect(resolveEntryFace(file, old)).toEqual(["legacy"]);
  });

  it("显式切换前后：BUG-015 从假绿变真入口，且不新增诊断", () => {
    const src = `export const { a } = { a: () => 1 };`;
    setSemanticIndexEntryFace(false);
    const before = checkSource("/virtual/face-off.js", src);
    setSemanticIndexEntryFace(true);
    const after = checkSource("/virtual/face-on.js", src);
    expect(before.signatures.map((s) => s.name)).toEqual([]);
    expect(after.signatures.map((s) => s.name)).toContain("a");
    expect(after.issues.map((i) => i.code)).toEqual(before.issues.map((i) => i.code));
  });
});

describe("ADR 0001 阶段 1 · 切片 3 缓存键纪律", () => {
  const deps: LoadDepsFingerprint = {
    fp: "-", paths: [], contents: [], truncated: false, readError: false, gatedSidecars: [],
  };
  const opts: CheckOptions = {};

  it("checkMemoKey：索引面 / 旧面两档不互为陈旧命中", () => {
    setSemanticIndexEntryFace(true);
    const on = checkMemoKey("/abs/proj/main.js", CONTROL, opts, deps);
    const onAgain = checkMemoKey("/abs/proj/main.js", CONTROL, opts, deps);
    setSemanticIndexEntryFace(false);
    const off = checkMemoKey("/abs/proj/main.js", CONTROL, opts, deps);
    expect(on).toBe(onAgain);
    expect(off).not.toBe(on);
  });
});
