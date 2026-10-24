/**
 * Bug 1033：`!! throws` 的**位置信息在扫描阶段丢失** ⇒ 散文行、case **名字**
 * 字符串内部都被读成**函数级**抛错申报 ⇒ `filterGateThrows` 把实际抛错
 * **全部放行** ⇒ L2 `nudo:entry-may-throw` 门禁被**静默关掉**（假绿、零诊断），
 * 而签名面仍打印 `throws TypeError` ⇒ **两面打架**。
 *
 * 修复：位置锚收紧——`!! throws` 只在**指令位置**上采信：
 * 1. `@nudo:case` 行的**实参括号之后**（case 名 / 实参内部的同形文本不算）；
 * 2. case 行的**续行**（该行以 `!!` 开头）。
 * 兜底：只有**显式** `!! throws`（无 kind）才产出「任意 throw」（`*`）⇒ `"*"`
 * 不再来自误读。
 *
 * ⚠ 门禁消费点（check.ts / may-throw.ts）**只读不改**——本文件钉的是
 * 「扫描层的锚」+「门禁不再被静默关掉」+「文档化形态仍然有效」。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, scanThrowsDecl, extractDeclaredThrows } from "../index.ts";

function check(src: string, file = "/t/bug-1033.js") {
  return checkSource(file, src, pTrue);
}

describe("Bug 1033：`!! throws` 的位置锚收紧", () => {
  it("散文行里的 `!! throws` 不再被读成函数级申报", () => {
    expect(scanThrowsDecl(["Note: this helper uses !! throws"])).toBeUndefined();
    expect(scanThrowsDecl(["Note: this helper uses !! throws internally"])).toBeUndefined();
  });

  it("case 名内部的 `!! throws` 不再被读成函数级申报", () => {
    expect(scanThrowsDecl(['@nudo:case "regression: !! throws" (1)'])).toBeUndefined();
  });

  it("文档化的 case 后缀形态仍然有效（护栏：不得删掉后缀申报）", () => {
    expect(scanThrowsDecl(['@nudo:case "neg" (0) !! throws'])).toBe("*");
    expect(scanThrowsDecl(['@nudo:case "neg" (0) !! throws Error'])).toBe("Error");
    // 续行形态（case 行的下一行单独写 `!! throws [Kind]`）
    expect(scanThrowsDecl(['@nudo:case "neg" (0)', "!! throws Error"])).toBe("Error");
    // 函数级 `@nudo:throws` 不受影响
    expect(scanThrowsDecl(["@nudo:throws TypeError"])).toBe("TypeError");
  });

  it("extractDeclaredThrows：误读形态无申报 / 文档化形态有申报", () => {
    const prose = `/**
 * Note: this helper uses !! throws
 */
export function f(x) {
  throw new TypeError("boom");
}
`;
    expect(extractDeclaredThrows(prose, "f")).toBeUndefined();

    const cased = `/**
 * @nudo:case "neg" (0) !! throws
 */
export function g(x) {
  throw new TypeError("boom");
}
`;
    expect(extractDeclaredThrows(cased, "g")).toBe("*");
  });

  it("L2 门禁：散文形态不再静默关掉（entry-may-throw 重新执法）", () => {
    const r = check(`
/**
 * Note: this helper uses !! throws
 */
export function f(x) {
  throw new TypeError("boom");
}
`);
    const l2 = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
    expect(l2).toHaveLength(1);
    // 签名面仍打印 throws TypeError ⇒ 门禁面与签名面**不再打架**
    expect(r.signatures.find((s) => s.name === "f")?.display).toContain("throws TypeError");
  });

  it("L2 门禁：case 名内部的形态同样执法", () => {
    const r = check(`
/**
 * @nudo:case "regression: !! throws" (1)
 */
export function g(x) {
  throw new TypeError("boom");
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toHaveLength(1);
  });

  it("护栏：文档化的 case 后缀申报仍然放行该入口（门禁不报）", () => {
    const r = check(
      `
/**
 * @nudo:case "neg" (0) !! throws
 */
export function h(x) {
  throw new TypeError("boom");
}
`,
      "/t/bug-1033h.js",
    );
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
  });
});
