/**
 * Bug 1128（并发 review F20 / P2）—— Bug 997 对**具名函数表达式**（CJS 对象字面量）
 * 的修复不完整。
 *
 * 根因：`packages/core/src/algebra/export-slot.ts` 的 `cjsMemberSlotsOf` 用
 * `fnId ?? key`（具名函数表达式的**内层 id**）当普查键，而普查面
 * （`scan-top-functions.ts` 的 CJS 分支，#152/Bug 997 之后）早已改用
 * **成员键**（`pushFnFromInit(keyName, …)` ⇒ `fallbackName ?? r.id?.name`）
 * ⇒ 两侧口径分裂：
 *
 * - `module.exports = { greet: function inner(x) { … } }` ⇒ 普查名 = `greet`，
 *   但导出槽表里的键是 `inner` ⇒ `resolveExportSlotCall("greet")` 查不到 ⇒
 *   侧车契约**整个不绑定** ⇒ 只剩 `nudo:unproven-return` 警告，`greet` 签名
 *   退成 `unknown`（**假绿**：应报 `nudo:constraint-violated`）；
 * - 匿名 FE / 箭头 / 对象方法 / `exports.greet = function inner(){}` ⇒ 都走
 *   成员键 ⇒ 都报 `constraint-violated` ⇒ **行为不一致**；
 * - 碰撞：`{ a: function b(){return 1}, b: () => "bad" }` ⇒ 表里只有
 *   `b -> a` ⇒ 成员 `b` 被解析到成员 `a` 的函数（映射串了）。
 *
 * 修法：导出槽表**只用成员键**（普查名口径 = 成员键）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { pTrue } from "../pred.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";
import { makeFiles, sigOf } from "./nudo-constraints.ts";

/** 侧车：`greet` 的返回必须是 > 0 的数（源码返回 -1 ⇒ 应报 constraint-violated） */
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const greet = fn({ x: number() }, number().gt(0));
`;

const FILE = "/t/bug1128/D.js";

/** 跑一遍 check（同一份侧车 ⇒ 同一份契约面） */
function run(src: string) {
  const { loadModule } = makeFiles({ "/t/bug1128/D.nudo.js": SIDECAR });
  return checkSource(FILE, src, pTrue, { loadModule, fromFile: FILE });
}

/** issue 码集合（按出现顺序） */
const codesOf = (r: { issues: { code: string }[] }): string[] => r.issues.map((i) => i.code);

describe("Bug 1128 — CJS 对象字面量导出的普查键必须是**成员键**", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    takeRefineDiags();
    resetSidecarLoadFailureCache();
    takeInterfaceDiags();
    resetParseSourceCache();
    resetAbsCallBudget();
    resetEvalForkBudget();
  });

  it("具名函数表达式：侧车契约绑定 ⇒ 报 constraint-violated（修前：只有 unproven-return + unknown）", () => {
    const r = run(`module.exports = {
  greet: function inner(x) {
    return -1;
  },
};
`);
    expect(codesOf(r)).toContain("nudo:constraint-violated");
    // 契约绑定 ⇒ 签名不再是「不可解析」的 unknown
    expect(sigOf(r, "greet")).not.toBe("unknown");
    expect(sigOf(r, "greet")).toBe("-1");
  });

  it("与其它导出形态**同口径**（匿名 FE / 箭头 / 对象方法 / exports.greet = 具名 FE）", () => {
    const forms: Record<string, string> = {
      "匿名 FE": `module.exports = {
  greet: function (x) {
    return -1;
  },
};
`,
      箭头: `module.exports = {
  greet: (x) => -1,
};
`,
      对象方法: `module.exports = {
  greet(x) {
    return -1;
  },
};
`,
      "exports.greet = 具名 FE": `exports.greet = function inner(x) {
  return -1;
};
`,
      "具名 FE（对象字面量）": `module.exports = {
  greet: function inner(x) {
    return -1;
  },
};
`,
    };
    const seen = new Map<string, string[]>();
    for (const [label, src] of Object.entries(forms)) {
      seen.set(label, codesOf(run(src)));
    }
    // 匿名 FE 是基准（它一直是对的）
    const baseline = seen.get("匿名 FE");
    expect(baseline).toContain("nudo:constraint-violated");
    for (const [label, codes] of seen) {
      expect(codes, label).toEqual(baseline);
    }
  });

  it("成员键不串：{ a: function b(){…}, b: () => \"bad\" } ⇒ a / b 各归各", () => {
    const r = run(`module.exports = {
  a: function b() { return 1; },
  b: () => "bad",
};
`);
    // a ⇒ function b(){return 1} ⇒ 返回 1
    expect(sigOf(r, "a")).toBe("1");
    // b ⇒ 箭头 ⇒ 返回 "bad"
    expect(sigOf(r, "b")).toBe('"bad"');
  });
});
