/**
 * Bug 997 —— CJS 成员赋值用**具名函数表达式**时，普查名取**内层函数 id** 而不是
 * **导出槽名** ⇒ **侧车契约整个不绑定** ⇒ L1 门禁**假绿**（零诊断）；且
 * `nudo check` 的签名表里**导出符号整个消失**（只剩内层名）、`nudo contract
 * --draft` 报 0 个可草拟导出 ⇒ CLI 各面互相矛盾。
 *
 * 根因：`scan-top-functions.ts` 的 `pushFnFromInit` 写的是 `r.id?.name ?? fallbackName`
 * （内层 id 优先）；service 侧 `analyzer-ast.ts` 的 `namedFnExprId(fn) ??
 * assignmentChainName(expr)` 同。
 *
 * 修法：**导出槽名优先**（`fallbackName ?? r.id?.name`）—— 内层 id 不是导出槽名，
 * 取它会让侧车契约（键 = 导出槽名）整个查不到。
 */
import { describe, it, expect } from "vitest";
import { listTopFunctions } from "../scan.ts";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";
import { issuesOf, makeFiles } from "./nudo-constraints.ts";

const NAMED_FN_EXPR = `exports.greet = function inner() {
  return "hi";
};
`;

const ANON_FN_EXPR = `exports.greet = function () {
  return "hi";
};
`;

const OBJ_LITERAL = `module.exports = {
  greet: function inner() {
    return "hi";
  },
};
`;

describe("Bug 997 — CJS 普查名取导出槽名，不取内层函数 id", () => {
  it("成员赋值 + 具名函数表达式 ⇒ 普查名是导出槽名", () => {
    expect(listTopFunctions(NAMED_FN_EXPR)).toEqual(["greet"]);
  });

  it("成员赋值 + 匿名函数表达式 ⇒ 普查名是导出槽名（对照）", () => {
    expect(listTopFunctions(ANON_FN_EXPR)).toEqual(["greet"]);
  });

  it("对象字面量成员 + 具名函数表达式 ⇒ 普查名是导出槽名（键名）", () => {
    expect(listTopFunctions(OBJ_LITERAL)).toEqual(["greet"]);
  });

  it("侧车契约按导出槽名绑定 ⇒ 契约义务真的执法（不假绿）", () => {
    // 侧车 `greet` 槽上的契约：返回 number() —— 实现返回 "hi" ⇒ 违例
    const src = `exports.greet = function inner() {
  return "hi";
};
`;
    const sidecar = `import { fn, number } from "@nudojs/core";
export const greet = fn({}, number());
`;
    const { loadModule } = makeFiles({ "/t/b997/D.nudo.js": sidecar });
    const r = checkSource("/t/b997/D.js", src, pTrue, { loadModule, fromFile: "/t/b997/D.js" });
    // 普查名是 greet（不是 inner）⇒ 侧车契约绑定得上 ⇒ 违例被报出来
    expect(r.signatures.some((s) => s.name === "greet")).toBe(true);
    expect(r.signatures.some((s) => s.name === "inner")).toBe(false);
    expect(
      r.issues.some(
        (i) => i.code === "nudo:constraint-violated" && /greet/.test(i.message),
      ),
    ).toBe(true);
  });
});
