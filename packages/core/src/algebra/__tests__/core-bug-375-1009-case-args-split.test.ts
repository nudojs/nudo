/**
 * Bug 375 / 1009 回归钉：check 面的 case 实参**切分**必须与共享单源
 * （parser 的 `splitTopLevelArgs` + JSDoc 续行前缀剥离）**同口径**。
 *
 * Bug 375（多行实参 ⇒ 整条见证被静默跳过）：
 *   共享单源 `scanCaseTags` 产出的 `argsText` **仍带 JSDoc 续行前缀 ` * `**
 *   ⇒ check 面不剥前缀 ⇒ 实参认不出 ⇒ 整条见证被静默跳过（假绿，exit 0）。
 *   同一见证写成**单行**则正常报红 ⇒ 症状取决于排版，不是契约。
 *
 * Bug 1009（`\` 被当转义 ⇒ 实参个数不同 ⇒ 违例见证被静默跳过）：
 *   check 面的**私有**切分器把 `\` 当转义 ⇒ `"a\", -1` 只切出 1 个实参
 *   ⇒ 第二个实参上的违例见证**根本不存在** ⇒ 被静默跳过
 *   ⇒ **L2 见证门禁假绿**；而 `nudo test`（共享单源）看到的是**另一个**
 *   实参列表（2 个）⇒ 两个面看到不同的世界。
 *
 * 改后：check 面剥续行前缀 + 按共享单源口径切分 ⇒ 实参个数与 `nudo test` 一致，
 * 违例见证必现在诊断里。
 *
 * R3（不静默 continue）：契约位上的实参**认不出**或**缺位** ⇒ 产可见诊断
 * （nudo:directive-syntax，warning 级）⇒ 不再静默跳过、也不再假绿。
 *
 * 负控制：同一见证写成单行仍报同一条（改前只多行形态假绿）。
 */
import { describe, it, expect } from "vitest";
import { issuesOf } from "./nudo-constraints.ts";

/** 取见证面（nudo:case-inconsistency）的全部诊断 */
function witnessIssues(src: string, file: string) {
  return issuesOf(src, file).issues.filter((i) => i.code === "nudo:case-inconsistency");
}

describe("Bug 375 — 多行 case 实参不再被静默跳过", () => {
  it("error: 多行实参的违例见证（改前整条见证被跳过 ⇒ 零诊断 / 假绿）", () => {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "neg" (
 *   -1
 * )
 */
function needsPositive(x) {
  return x;
}
`,
      "/t/case-375-multi.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.severity).toBe("error");
    expect(errs[0]!.message).toContain("neg");
    expect(errs[0]!.expected).toContain(">");
  });

  it("ok: 多行实参满足契约不报", () => {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "ok" (
 *   5
 * )
 */
function needsPositive(x) {
  return x;
}
`,
      "/t/case-375-multi-ok.js",
    );
    expect(errs).toEqual([]);
  });

  it("负控制: 同一见证写成单行仍报同一条（改前只多行形态假绿）", () => {
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
      "/t/case-375-single.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.expected).toContain(">");
  });
});

describe("Bug 1009 — `\\` 不是转义：实参个数与共享单源一致", () => {
  it("error: `\"a\\\", -1` 切 2 个实参 ⇒ 第二个实参的违例见证被检出", () => {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract y positive
 * @nudo:case "c" ("a\\", -1)
 */
function f(x, y) {
  return y;
}
`,
      "/t/case-1009-escaped.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.severity).toBe("error");
    expect(errs[0]!.message).toContain("c");
    expect(errs[0]!.expected).toContain(">");
  });

  it("负控制: 无转义引号的同形见证报同一条（改前两条都报 ⇒ 实参个数相同）", () => {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract y positive
 * @nudo:case "c" ("a", -1)
 */
function f(x, y) {
  return y;
}
`,
      "/t/case-1009-control.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.expected).toContain(">");
  });
});

describe("R3 — 实参认不出 / 缺位 ⇒ 可见诊断，不再静默 continue", () => {
  it("warning: 契约位上的实参认不出 ⇒ nudo:directive-syntax", () => {
    const r = issuesOf(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "c" (someIdentifier)
 */
function f(x) {
  return x;
}
`,
      "/t/case-r3-unparsable.js",
    );
    const d = r.issues.find((i) => i.code === "nudo:directive-syntax");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("warning");
    expect(d!.message).toContain("could not be parsed");
  });

  it("warning: 契约位上没有见证实参 ⇒ nudo:directive-syntax", () => {
    const r = issuesOf(
      `
/**
 * @nudo:contract y positive
 * @nudo:case "c" (1)
 */
function f(x, y) {
  return y;
}
`,
      "/t/case-r3-missing-arg.js",
    );
    const d = r.issues.find((i) => i.code === "nudo:directive-syntax");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("warning");
    expect(d!.message).toContain("no witness argument");
  });

  it("负控制: 无契约位的认不出实参不产见证面诊断（parser 面自行诊断）", () => {
    const r = issuesOf(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "c" (5)
 */
function f(x) {
  return x;
}
`,
      "/t/case-r3-control.js",
    );
    expect(r.issues.filter((i) => i.code === "nudo:directive-syntax")).toEqual([]);
  });

  it("负控制: 约束构建器实参（number()）是合法形态 ⇒ 跳过但**不产诊断**", () => {
    // 符号见证（一个域，不是具体值）⇒ 见证面无比对对象 ⇒ 跳过；
    // 它**不是**文法缺口 ⇒ 不得产 directive-syntax（否则 examples 假红）。
    const r = issuesOf(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "symbolic" (number())
 */
function f(x) {
  return x;
}
`,
      "/t/case-r3-builder.js",
    );
    expect(r.issues.filter((i) => i.code === "nudo:directive-syntax")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency")).toEqual([]);
  });
});
