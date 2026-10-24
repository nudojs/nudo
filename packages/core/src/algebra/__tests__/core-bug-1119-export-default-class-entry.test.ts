/**
 * Bug 1119 回归 —— `export default C`（**标识符**形态）的类**入口**被漏
 * ⇒ 构造器必抛在 L2 `nudo:entry-may-throw` 闸门**看不见** ⇒ **假绿**。
 *
 * 根因（scan-top-functions.ts，`listClassEntryNames`）：
 *   `d.type === "Identifier"` 分支读 `d.id?.name` —— Babel 的 `Identifier`
 *   节点字段是 **`name`**（`id` 是 `Identifier` **上的** `id` 字段，不存在）
 *   ⇒ `localName` 恒为 undefined ⇒ `export default C` 的类**不在入口表**。
 *
 * 对照：`export class C` / `export default class C` / `export { C }` 三种形态
 * 走**别的分支** ⇒ 一直是对的 ⇒ 只有「本地类 + `export default <标识符>`」
 * 这一形态漏掉（形态覆盖不全 ⇒ 闸门假绿）。
 *
 * 修法：读 `d.name`（并把 `name?: string` 补进节点类型）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";
import { listClassEntryNames } from "../scan-top-functions.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";

/** 缓存重置（仓库惯例） */
beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  takeRefineDiags();
  takeInterfaceDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
});

/** 本地类 + `export default <标识符>`；构造器**无条件抛** */
const DEFAULT_CTOR_THROW = `class C {
  constructor(x) { throw new Error("boom"); }
  describe() { return "a"; }
}
export default C;
`;

/** 同形但构造器**不抛** ⇒ 不得凭空造出 L2（不假红） */
const DEFAULT_CTOR_OK = `class D {
  constructor(x) { this.v = x; }
  describe() { return this.v; }
}
export default D;
`;

describe("Bug 1119 — `export default C` 的类入口不再漏", () => {
  it("类入口清单含 `export default C`（修前：空清单）", () => {
    expect(listClassEntryNames(DEFAULT_CTOR_THROW)).toEqual(["C"]);
  });

  it("导出形态覆盖齐全（回归护栏：其余三种形态不变）", () => {
    expect(listClassEntryNames("export class E { m() { return 1; } }")).toEqual(["E"]);
    expect(listClassEntryNames("export default class F { m() { return 1; } }")).toEqual(["F"]);
    expect(listClassEntryNames("class G { m() { return 1; } }\nexport { G };")).toEqual(["G"]);
    // 非导出类**不是**入口（`new C()` 不是该模块的公开面）
    expect(listClassEntryNames("class H { m() { return 1; } }")).toEqual([]);
  });

  it("端到端：构造器必抛必须报在类入口上（修前：零诊断 ⇒ 假绿）", () => {
    const r = checkSource("/t/bug-1119-ctor.js", DEFAULT_CTOR_THROW, pTrue, {});
    const l2 = r.issues.filter((i) => i.code === "nudo:entry-may-throw" && i.fn === "C");
    expect(l2).toHaveLength(1);
    expect(l2[0]!.severity).toBe("error");
    expect(l2[0]!.message).toContain("may throw Error");
  });

  it("端到端：构造器不抛 ⇒ 零 L2（不凭空造诊断）", () => {
    const r = checkSource("/t/bug-1119-ok.js", DEFAULT_CTOR_OK, pTrue, {});
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
  });
});
