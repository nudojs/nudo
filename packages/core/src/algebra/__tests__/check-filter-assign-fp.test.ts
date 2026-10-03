import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

/**
 * 回归：OSS 语料 semver/bin/semver.js L109 的 L1 FP（2026-10-03 main 红）。
 *
 * 形态：循环内 push 的可变绑定在出口是 `[] | [unknown]`（push-join sum），
 * 随后重赋 `versions.map(...).filter(...)`。两个失真源叠加曾报
 * nudo:assign-mismatch：
 * 1. filter 对空元组返回 `unknown[]`（无界长度——filter 不增元素，失真）；
 *    对不确定谓词的小元组返回无界 arr 而非有界子序列和。
 * 2. widenForAssign 无 sum 分支：全数组成员的 sum 不按 tuple 分支同口径
 *    拓宽（可变绑定持数组后赋任意数组是合法 JS）。
 *
 * 修复后：filter 空元组 → `[]`；不确定谓词 ≤3 元组 → 精确子集和；
 * 全数组 sum → 拓宽为单 arr。本用例两门齐绿。
 */

function errorCodes(path: string, source: string): string[] {
  const r = checkSource(path, source, pTrue, { entryThrows: "off" });
  return r.issues.filter((i) => i.severity === "error").map((i) => i.code);
}

describe("check: loop push-join binding reassigned to filter result (semver shape)", () => {
  it("map(...).filter(...) reassignment must not assign-mismatch", () => {
    const codes = errorCodes(
      "semver-shape.js",
      [
        "const argv = process.argv.slice(2)",
        "let versions = []",
        "const range = []",
        "const main = () => {",
        "  while (argv.length) {",
        "    let a = argv.shift()",
        "    switch (a) {",
        "      case '-r':",
        "        range.push(argv.shift())",
        "        break",
        "      default:",
        "        versions.push(a)",
        "        break",
        "    }",
        "  }",
        "  versions = versions.map((v) => v).filter((v) => v)",
        "  if (!versions.length) {",
        "    return 1",
        "  }",
        "  return 0",
        "}",
        "main()",
      ].join("\n"),
    );
    expect(codes).toEqual([]);
  });

  it("direct filter reassignment must not assign-mismatch", () => {
    const codes = errorCodes(
      "filter-reassign.js",
      [
        "const argv = process.argv.slice(2)",
        "let versions = []",
        "const main = () => {",
        "  while (argv.length) {",
        "    versions.push(argv.shift())",
        "  }",
        "  versions = versions.filter((v) => v)",
        "  return versions.length",
        "}",
        "main()",
      ].join("\n"),
    );
    expect(codes).toEqual([]);
  });

  it("filter reassignment still flags genuinely incompatible element rewrite", () => {
    // 拓宽是「数组→数组」的同伦：元素改型（数组→标量）仍必须报
    const codes = errorCodes(
      "filter-retypes.js",
      [
        "const argv = process.argv.slice(2)",
        "let versions = []",
        "const main = () => {",
        "  while (argv.length) {",
        "    versions.push(argv.shift())",
        "  }",
        "  versions = 42",
        "  return versions",
        "}",
        "main()",
      ].join("\n"),
    );
    expect(codes).toContain("nudo:assign-mismatch");
  });
});
