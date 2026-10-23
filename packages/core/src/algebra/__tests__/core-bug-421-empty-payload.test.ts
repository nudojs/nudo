/**
 * Bug 421：`@nudo:assume` / `@nudo:invariant` 的**空载荷**此前**零诊断**。
 *
 * 根因：段扫描用严格正则 `^@nudo:assume\s+(.+)$`（载荷非空）⇒ 空载荷行
 * **整行不匹配**且**无 else 分支** ⇒ 段列表为空 ⇒ 消费方（check）连一条
 * bad 段都拿不到 ⇒ 用户的引理/不变量**无声丢失**（返回契约从「已证明」退回
 * 「未证明」，唯一信号是**归因错误**的 nudo:unproven-return）。
 *
 * 修复：空载荷产出**坏段**（raw = ""）⇒ 既有的 `nudo:assume-invalid` /
 * `nudo:invariant-invalid` 通道自然接管（**不另造新码**）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

function check(src: string) {
  return checkSource("/t/bug-421.js", src, pTrue);
}

describe("Bug 421：空载荷的 assume / invariant 必须发诊断", () => {
  it("@nudo:assume 空载荷 → nudo:assume-invalid（error）", () => {
    const r = check(`
/**
 * @nudo:assume
 */
export function f421(x) {
  return x;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:assume-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("error");
    expect(bad[0]!.message).toContain("malformed @nudo:assume");
    expect(bad[0]!.fn).toBe("f421");
    // 位置 = 出错指令行（不是文件首行 / 函数声明行）
    expect(bad[0]!.line).toBe(3);
  });

  it("@nudo:invariant 空载荷 → nudo:invariant-invalid（warning）", () => {
    const r = check(`
/**
 * @nudo:invariant
 */
export function f421b(dp) {
  return dp;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:invariant-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("warning");
    expect(bad[0]!.message).toContain("malformed @nudo:invariant");
    expect(bad[0]!.line).toBe(3);
  });

  it("空载荷（纯空白）与合法载荷不回归", () => {
    const r = check(`
/**
 * @nudo:assume
 */
export function empty(x) {
  return x;
}
/**
 * @nudo:assume d <= max
 */
export function ok(d, max) {
  return d;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:assume-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.fn).toBe("empty");
  });

  it("合法 assume / invariant 零诊断（不误伤）", () => {
    const r = check(`
/**
 * @nudo:assume d <= max
 */
export function ok(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:assume-invalid")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-invalid")).toEqual([]);
  });
});
