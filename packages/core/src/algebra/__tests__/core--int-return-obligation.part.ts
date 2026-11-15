/**
 * Bug 002 —— `number().int()` 的**返回**义务对非字面量返回值完全未检查（假绿）。
 *
 * `.int()` 是约束对象上的**数据标志**（`c.int === true`），不是 pred。
 * `constraintOnTermAbs` 把它编码成谓词（`eq(self % 1, 0)`），但后置通道的
 * `assertScalar` 走的是 `instantiateOnTerm`（**不**编码 int 标志）⇒
 * `number().int()` 的 `constraintPred` 只剩 `typeof(x) = "number"` ⇒
 * 「仅有 auto-typeof」的早退分支直接 `proved()` ⇒ 整性义务**从未被检查**。
 * 唯一生效的是字面量特判（`1.5` 报、`x + 0.5` 不报）。
 *
 * 修法：`assertScalar` 的约束谓词与 `constraintOnTermAbs` **同口径**合取整性
 * 编码；整性义务也算「带界义务」（`isBoundedEvidenceMissing`）⇒ 不可判定时
 * 落 `unprovable`（warning `nudo:unproven-return`），**不得伪装成功**。
 *
 * 钉住的行为：
 * - `return x + 0.5` 对 `intId` 返回契约：**不再假绿**（出 warning，无 error）；
 * - 整性可从前提传导：x 声明为 int ⇒ `return x` 零诊断；
 * - 整数字面量照旧放行；小数照旧 error；无整性证据的宽值域照旧 error。
 */
import { describe, it, expect } from "vitest";
import { issuesOf } from "./nudo-constraints.ts";

/** `@nudo:contract return …` 通道的诊断（与其它通道解耦） */
const returnIssues = (src: string, file: string) =>
  issuesOf(src, file).issues.filter((i) =>
    i.message.includes("@nudo:contract return"),
  );

describe("Bug 002 · number().int() 的返回义务必须真的被检查", () => {
  it("非字面量返回值（x + 0.5）不再假绿：出 unproven-return warning、无 error", () => {
    const ret = returnIssues(
      `
/**
 * @nudo:contract x intId
 * @nudo:contract return intId
 */
function halfOfId(x) {
  return x + 0.5;
}
`,
      "/t/bug002-half.js",
    );
    // 改前：零诊断（假绿）。改后：**不得**再静默通过。
    expect(ret).toHaveLength(1);
    expect(ret[0]!.severity).toBe("warning");
    expect(ret[0]!.code).toBe("nudo:unproven-return");
  });

  it("整性可从前提传导：x 声明为 int ⇒ `return x` 证得、零诊断", () => {
    const src = `
/**
 * @nudo:contract x intId
 * @nudo:contract return intOnly
 */
function idOf(x) {
  return x;
}
`;
    expect(returnIssues(src, "/t/bug002-id.js")).toEqual([]);
    expect(issuesOf(src, "/t/bug002-id2.js").issues.filter((i) => i.severity === "error")).toEqual(
      [],
    );
  });

  it("整数字面量返回照旧放行", () => {
    const src = `
/**
 * @nudo:contract return intOnly
 */
function two() {
  return 2;
}
`;
    expect(returnIssues(src, "/t/bug002-two.js")).toEqual([]);
  });

  it("小数返回照旧是 error（字面量特判不回归）", () => {
    const r = issuesOf(
      `
/**
 * @nudo:contract return intOnly
 */
function bad() {
  return 1.5;
}
`,
      "/t/bug002-1p5.js",
    );
    const err = r.issues.find((i) => i.severity === "error");
    expect(err).toBeDefined();
    expect(err!.expected).toContain("int");
  });

  it("值域只是裸 number（无整性证据）⇒ 出 unproven-return warning（改前静默 proved）", () => {
    const src = `
/**
 * @nudo:contract x num
 * @nudo:contract return intOnly
 */
function maybe(x) {
  return x;
}
`;
    const ret = returnIssues(src, "/t/bug002-maybe.js");
    expect(ret).toHaveLength(1);
    expect(ret[0]!.severity).toBe("warning");
    expect(ret[0]!.code).toBe("nudo:unproven-return");
    expect(
      issuesOf(src, "/t/bug002-maybe2.js").issues.filter((i) => i.severity === "error"),
    ).toEqual([]);
  });

  it("负控制：整数算术（x + 1，x 为 int）**不得**变成假红（整性不可判定 ⇒ warning 不上 error）", () => {
    const r = issuesOf(
      `
/**
 * @nudo:contract x intId
 * @nudo:contract return intOnly
 */
function next(x) {
  return x + 1;
}
`,
      "/t/bug002-next.js",
    );
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
