/**
 * BUG-282 回归：`@nudo:case` 的**见证作用域**不得与 `@nudo:contract` 的
 * **契约作用域**按裸名字混在一起。
 *
 * 根因：`packages/core/src/algebra/check-case-scan.ts` 的 `scanCaseInconsistency`
 * 遍历 `listFnDirectiveScopes(file)`，只按 `knownFns.includes(scope.name)` 做
 * **裸名字匹配**（无 depth 裁决）⇒ 导出函数体内**同名**辅助函数上的
 * `@nudo:case` 见证被拿去对着**外层**函数的 `@nudo:contract` 执法 ⇒
 * `nudo:case-inconsistency`（error）⇒ 门禁**假红 / exit 1**。
 * 契约面走的是 `findFnDirectiveScope`（同名取**词法最浅**）——两面用相反的
 * 同名裁决 ⇒ 见证与契约串了作用域。
 *
 * 修法：case 面与契约面同款 depth 裁决（同名 scope 中只有最浅者参与契约对账）。
 */
import { describe, it, expect } from "vitest";
import { issuesOf } from "./nudo-constraints.ts";

const caseIssues = (src: string, path: string) =>
  issuesOf(src, path).issues.filter((i) => i.code === "nudo:case-inconsistency");

describe("BUG-282：同名嵌套函数的 case 见证不对外层契约负责", () => {
  it("内层同名 function f() 的见证 ⇒ 不报 case-inconsistency", () => {
    const r = caseIssues(
      `/**
 * @nudo:contract x positive
 */
export function f(x) {
  /** @nudo:case "inner" (-1) */
  function f() { return 1; }
  return f() + x;
}
`,
      "/t/bug-282-a.js",
    );
    expect(r).toEqual([]);
  });

  it("对照组 1：内层函数改名 g ⇒ 同样不报（单变量对照）", () => {
    const r = caseIssues(
      `/**
 * @nudo:contract x positive
 */
export function f(x) {
  /** @nudo:case "inner" (-1) */
  function g() { return 1; }
  return g() + x;
}
`,
      "/t/bug-282-b.js",
    );
    expect(r).toEqual([]);
  });

  it("对照组 2：外层函数自己的违例见证仍报 error（不因修复而假绿）", () => {
    const r = caseIssues(
      `/**
 * @nudo:contract x positive
 * @nudo:case "outer-bad" (-1)
 */
export function f(x) {
  return x;
}
`,
      "/t/bug-282-c.js",
    );
    expect(r.length).toBe(1);
    expect(r[0]!.severity).toBe("error");
    expect(r[0]!.message).toContain("outer-bad");
  });

  it("对照组 3：外层函数自己的合规见证不报", () => {
    const r = caseIssues(
      `/**
 * @nudo:contract x positive
 * @nudo:case "outer-ok" (5)
 */
export function f(x) {
  return x;
}
`,
      "/t/bug-282-d.js",
    );
    expect(r).toEqual([]);
  });
});
