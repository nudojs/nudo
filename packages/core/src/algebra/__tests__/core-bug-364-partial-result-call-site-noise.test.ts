/**
 * 族 07 收口片 Z —— `nudo:partial-result` 的 info 噪声（**产品面回归**）。
 *
 * Bug 364 把调用点验证接进产品路径（core/algebra/diagnostics.ts 的
 * `checkCallSite`）。接线时顺带把「被调方通用化结果的置信度」也挂到了
 * **每一个调用点**上 ⇒ `nudo:partial-result`（info）在产品面**复活**
 * （364 之前它是死码：产品路径从不产）：
 *   - 文档页 `getting-started/troubleshooting.md` 的 day0 场景从
 *     `2 error · 0 warning · 0 info · 2 fn` 漂到 `… · 1 info · 2 fn`
 *     （多出 `[INFO L9 scale] scale(...) result confidence partial`）；
 *   - 文档页 `guides/errors-vs-typescript.md` 从 `12 error · 0 warning ·
 *     1 info · 10 fn` 漂到 `… · 2 info · 10 fn`；
 *   - 真实包 `ms` 的每个导出各挂一条（同一件事报 N 次）。
 *
 * 修法：`checkCallSite` **不产** `nudo:partial-result`——被调方的精度问题
 * 不是**调用点**的问题（挂在每个调用点上只会把 info 面刷满）。
 *
 * 两侧都守住：
 * - 产品面（`checkSource`）**不**产 `nudo:partial-result`；
 * - **既有公共 API** `checkCall` **仍**产（`DIAG.partialResult` 与
 *   `checkCall` 里那段语义**一字不改**）——该码是公共 API 的既有语义。
 *
 * 反向闸：本钉在「族 07 接线前」的基线上必须红（`nudo:arg-count` 那条
 * 接线本身是 Bug 364 的产品承诺，钉住它 ⇒ 接线被整条拆掉时也会红）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, checkCall, pTrue, abs } from "../index.ts";
import { DIAG } from "../../internal.ts";

/** 文档页 `troubleshooting.md` 的 day0 场景（同一段源码） */
const DAY0 = [
  "export function scale(x) {",
  "  return x + 1;",
  "}",
  "",
  "export function formatName(first, last) {",
  '  return first + " " + last;',
  "}",
  "",
  "scale(5);",
  'formatName("Ada", "Lovelace");',
].join("\n");

/** Bug 364 的产品承诺：调用点验证面（实参个数）接线在产品路径里 */
const ARITY = ["export function add(a, b) {", "  return a + b;", "}", "add(1);"].join("\n");

const partialResults = (r: { issues: Array<{ code: string }> }): number =>
  r.issues.filter((i) => i.code === "nudo:partial-result").length;

describe("族 07 收口片 Z：nudo:partial-result 不得在产品调用点面产（info 噪声）", () => {
  it("诊断码本身仍在注册表里（公共 API 的既有语义不得删）", () => {
    expect(DIAG.partialResult).toBe("nudo:partial-result");
  });

  it("公共 API checkCall：partial 置信度 ⇒ 仍产 nudo:partial-result（info）", () => {
    const diags = checkCall(DAY0, "scale", [abs({ k: "prim", type: "number" }, undefined, undefined, "exact")]);
    const pr = diags.filter((d) => d.code === "nudo:partial-result");
    expect(pr.length).toBe(1);
    expect(pr[0]!.severity).toBe("info");
    expect(pr[0]!.message).toBe("scale(...) result confidence partial");
  });

  it("产品面：partial 置信度的被调方 ⇒ 不产 nudo:partial-result（修前 1 条 info）", () => {
    const r = checkSource("day0.js", DAY0, pTrue, { entryThrows: "off" });
    expect(partialResults(r)).toBe(0);
  });

  it("产品面：opaque 置信度的被调方 ⇒ 不产 nudo:partial-result", () => {
    const src = [
      "export function boom(x) {",
      "  return x.missing.deep;",
      "}",
      "boom(1);",
    ].join("\n");
    const r = checkSource("opaque.js", src, pTrue, { entryThrows: "off" });
    expect(partialResults(r)).toBe(0);
  });

  it("控制组：Bug 364 的调用点接线仍在（nudo:arg-count 照产）", () => {
    const r = checkSource("arity.js", ARITY, pTrue, { entryThrows: "off" });
    expect(r.issues.some((i) => i.code === "nudo:arg-count")).toBe(true);
  });
});
