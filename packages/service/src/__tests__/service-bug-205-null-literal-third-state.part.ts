/**
 * BUG-205 回归：精确推出的 `null` / `undefined` 字面量**不是**「引擎推不出」。
 *
 * 改前第三态判据只看 `shape.k === "unknown"`，而 `null` / `undefined` 字面量的
 * Abs 正是 `shape.k === "unknown"` + `term = lit(null|undefined)` +
 * `conf === "exact"` ⇒ 精确值被误判成推导失败，与 `--json` 面（`conf=exact`）
 * 和 check 签名面（`=> null`）三面互斥。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";
import { buildTestReport } from "../test-report.ts";
import { inferenceFailed } from "../analyzer-orchestrate-uncached-cases.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

type Report = ReturnType<typeof buildTestReport>;

function reportOf(src: string): Report {
  return withTmpProject("nudo-b205-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    return buildTestReport(file, analyzeFile(file, readFileSync(file, "utf-8"))!);
  });
}

const NULL_CASE = `/**
 * @nudo:case "null" () => lit(null)
 */
export function f() {
  return null;
}
`;

/** 求值器不支持的表达式 ⇒ 实测 Abs 是真 unknown（对照组）。 */
const UNKNOWN_CASE = `/**
 * @nudo:case "u" () => number()
 */
export function g(o) {
  const x = { a: 1 };
  (x.get)().a ||= 2;
  return x.a;
}
`;

describe("BUG-205 — 精确 null 字面量不判「推不出来」", () => {
  it("`=> lit(null)` 的精确结果被判定（不是 unchecked）", () => {
    const r = reportOf(NULL_CASE);
    const o = r.outcomes.find((x) => x.caseName === "null")!;
    expect(o.unchecked).toBe(false);
    expect(o.ok).toBe(true);
    expect(o.actual).toBe("null");
  });

  it("判据本体的对照组：真 unknown ⇒ 仍是推导失败", () => {
    const r = reportOf(UNKNOWN_CASE);
    const o = r.outcomes.find((x) => x.caseName === "u")!;
    expect(o.unchecked).toBe(true);
    expect(o.uncheckedReason).toBe("inference-failed");
  });

  it("inferenceFailed：lit null/undefined ⇒ false；无 term 的 unknown ⇒ true", () => {
    expect(inferenceFailed({ shape: { k: "unknown" }, term: { op: "lit", value: null }, conf: "exact" } as never)).toBe(false);
    expect(inferenceFailed({ shape: { k: "unknown" }, term: { op: "lit", value: undefined }, conf: "exact" } as never)).toBe(false);
    expect(inferenceFailed({ shape: { k: "unknown" }, conf: "exact" } as never)).toBe(true);
  });
});
