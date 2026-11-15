/**
 * Bug 371 回归钉：`@nudo:case` 见证**从不与字段级 / shape 契约比对**
 * ⇒ 违反契约的见证**静默放行**（假绿，exit 0）。
 *
 * 改前有**两条独立**机制，任一条都足以让违例见证消失（只修一条不够）：
 * ① 字段级 / shape 契约**整条跳过**：`if (entry.constraint.fields) continue;`
 *    ⇒ 带 `fields` 的契约在见证面零义务；
 * ② 非字面量实参（对象 / 数组）**归一成 unknown 后静默 continue**
 *    ⇒ 对象 / 数组见证对任何契约都零义务。
 *
 * 改后：对象 / 数组字面量解析成真 Abs（obj / tuple），shape 契约**逐字段**
 * 对账；缺字段 → `missing field <path>`；字段 prim 不符 → `typeof <path> = "<prim>"`
 * （文案口径对齐调用点面 scan/literal-shapes.ts）。
 *
 * 负控制：满足契约的见证不报；既有标量通道（bounds / int / eq）输出零改动。
 */
import { describe, it, expect } from "vitest";
import { issuesOf } from "./nudo-constraints.ts";

/** 取见证面（nudo:case-inconsistency）的全部诊断 */
function witnessIssues(src: string, file: string) {
  return issuesOf(src, file).issues.filter((i) => i.code === "nudo:case-inconsistency");
}

describe("Bug 371 — case 见证与字段级 / shape 契约对账", () => {
  it("error: 对象见证 ⊭ 标量契约（number()）——改前机制②归一成 unknown 后静默跳过", () => {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a num
 * @nudo:case "bad" ({ a: "x" })
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-scalar.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.severity).toBe("error");
    expect(errs[0]!.message).toContain("bad");
    expect(errs[0]!.expected).toContain("number");
  });

  it("error: shape 契约的字段类型不符——改前机制①把 fields 契约整条跳过", () => {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a userShape
 * @nudo:case "bad" ({ id: "x", name: "n" })
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-field-type.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.severity).toBe("error");
    expect(errs[0]!.expected).toBe('typeof id = "number"');
  });

  it("error: shape 契约缺字段 → missing field <path>", () => {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a userShape
 * @nudo:case "miss" ({ name: "n" })
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-missing.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.severity).toBe("error");
    expect(errs[0]!.expected).toBe("missing field id");
  });

  it("error: 嵌套 shape 的字段违例（路径逐段下钻）", () => {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a orderShape
 * @nudo:case "bad" ({ user: { id: "x", name: "n" }, tags: [] })
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-nested.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.expected).toBe('typeof user.id = "number"');
  });

  it("error: shape 契约的字段数值界违例", () => {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a userShape
 * @nudo:case "bad" ({ id: 0, name: "n" })
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-bound.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.severity).toBe("error");
  });

  it("ok: 满足 shape 契约的见证不报", () => {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a userShape
 * @nudo:case "ok" ({ id: 7, name: "n" })
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-ok.js",
    );
    expect(errs).toEqual([]);
  });

  it("ok: 满足标量契约的对象见证不报（any() 通吃结构）", () => {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a num
 * @nudo:case "bad" (5)
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-scalar-ok.js",
    );
    expect(errs).toEqual([]);
  });

  it("负控制: 既有标量通道输出零改动（bounds 违例仍报 x > 0）", () => {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "neg" (-1)
 */
function needsPositive(x) {
  return x;
}
`,
      "/t/case-371-scalar-bounds.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.expected).toContain(">");
  });
});
