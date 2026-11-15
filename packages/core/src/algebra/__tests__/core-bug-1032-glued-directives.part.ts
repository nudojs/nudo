/**
 * Bug 1032：函数级指令的**粘连**形态此前在扫描层**整行不匹配且无 else 分支**
 * ⇒ **零诊断**。
 *
 * - `@nudo:assumed d <= max`（引理）⇒ 公理被丢弃 ⇒ 返回契约从「已证明」退回
 *   「未证明」，而唯一信号是**归因错误**的 `nudo:unproven-return`。
 * - `@nudo:invariantdp >= 0`（不变量）⇒ 同款无声蒸发。
 * - `@nudo:throwsTypeError`（抛错申报）⇒ 申报无声蒸发 ⇒ L2 门禁按「未申报」
 *   执法（假红），而用户以为申报生效了。
 *
 * 修复：扫描层**看得见**粘连形态（口径与族 28 的 Bug 980 一致）⇒
 * - 引理 / 不变量 ⇒ **坏段**通道 ⇒ `nudo:assume-invalid` / `nudo:invariant-invalid`
 * - 抛错申报 ⇒ `nudo:directive-syntax`
 * （**不另造新码**）
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

function check(src: string, file = "/t/bug-1032.js") {
  return checkSource(file, src, pTrue);
}

describe("Bug 1032：粘连的函数级指令必须发诊断", () => {
  it("@nudo:assumed → nudo:assume-invalid（error）", () => {
    const r = check(`
/**
 * @nudo:assumed d <= max
 */
export function f1032(d, max) {
  return d;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:assume-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("error");
    expect(bad[0]!.message).toContain("@nudo:assumed d <= max");
    expect(bad[0]!.line).toBe(3);
  });

  it("@nudo:invariantdp → nudo:invariant-invalid（warning）", () => {
    const r = check(`
/**
 * @nudo:invariantdp >= 0
 */
export function f1032b(dp) {
  return dp;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:invariant-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("warning");
    expect(bad[0]!.message).toContain("@nudo:invariantdp >= 0");
    expect(bad[0]!.line).toBe(3);
  });

  it("@nudo:throwsTypeError → nudo:directive-syntax（warning）", () => {
    const r = check(
      `
/**
 * @nudo:throwsTypeError
 */
export function f1032c(x) {
  throw new TypeError("boom");
}
`,
      "/t/bug-1032c.js",
    );
    const bad = r.issues.filter((i) => i.code === "nudo:directive-syntax");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("warning");
    expect(bad[0]!.message).toContain("@nudo:throwsTypeError");
    expect(bad[0]!.line).toBe(3);
  });

  it("合法形态零诊断（不误伤）", () => {
    const r = check(`
/**
 * @nudo:assume d <= max
 * @nudo:invariant dp >= 0
 * @nudo:throws TypeError
 */
export function ok(d, max, dp) {
  throw new TypeError("boom");
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:assume-invalid")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-invalid")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:directive-syntax")).toEqual([]);
  });
});
