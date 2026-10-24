/**
 * Bug 1121 —— `export-names.ts` 把**模板字面量**里的 `export const z` 行
 * 当成导出（**报告自称「未复现」** ⇒ 本文件是**复现结论 + 不变量锁定**）。
 *
 * 复现结论：**当前架构下不可复现**（非缺陷）——
 *   `stripStaticExportDecls(js, source?)` 的 `js` **恒为 transpile 产物**
 *   （唯一调用点：exec/run.ts）。而 transpile 的发射约定是：
 *     - 字符串 / 模板字面量 / 正则字面量 ⇒ `$lit(JSON.stringify(...))` /
 *       `$tpl(JSON.stringify(...), …)` ⇒ 内容里的换行被**转义**成 `\n`
 *       ⇒ **不可能**出现「行首是 `export const z`」的裸文本；
 *     - 注释 ⇒ **整体丢弃**（不进产物）。
 *   ⇒ 正则 `^export (?:const|let) <名>`（`m` 标志，**行首锚**）永远碰不到
 *     模板 / 注释里的伪导出。
 *   源侧另有 AST 口径 `sourceStaticExportNames`（源 AST 的
 *   `ExportNamedDeclaration`）⇒ 模板字面量是**字符串字面量**，不是导出声明。
 *
 * ⇒ **不改源码**（不瞎改）。本文件把上述**不变量**钉死：若将来 transpile 改
 *   发射格式（例如把字符串内容原样吐出），本测试会**立刻变红** ⇒ 缺陷不会
 *   静默回归。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { stripStaticExportDecls, sourceStaticExportNames } from "../exec/export-names.ts";
import { transpile } from "../exec/transpile.ts";
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

/** 文本口径的导出名（transpile 产物 ⇒ 真实发射格式） */
const namesOf = (src: string): string[] => stripStaticExportDecls(transpile(src)).names;

describe("Bug 1121 — 模板字面量里的伪导出不被当成导出（不变量锁定）", () => {
  it("单行模板字面量里的 `export const z` 不是导出", () => {
    const src = "const s = `export const z = 1;`;\nexport const y = 2;";
    // 产物里伪导出只以「字符串内容」形态存在（JSON 转义 ⇒ 换行不成行）
    expect(transpile(src)).not.toMatch(/^export const z/m);
    expect(namesOf(src)).toEqual(["y"]);
  });

  it("多行模板字面量里的 `export const z` 不是导出", () => {
    const src = "const s = `\nexport const z = 1;\n`;\nexport const y = 2;";
    expect(transpile(src)).not.toMatch(/^export const z/m);
    expect(namesOf(src)).toEqual(["y"]);
  });

  it("带插值的模板字面量里的伪导出不是导出", () => {
    const src = "const s = `a${1}\nexport const z = 1;`;\nexport const y = 2;";
    expect(transpile(src)).not.toMatch(/^export const z/m);
    expect(namesOf(src)).toEqual(["y"]);
  });

  it("注释里的伪导出不是导出（注释不进产物）", () => {
    const src = "// export const z = 1;\nexport const y = 2;";
    expect(transpile(src)).not.toMatch(/^export const z/m);
    expect(namesOf(src)).toEqual(["y"]);
  });

  it("源 AST 口径同样不收模板 / 注释里的伪导出", () => {
    const src = "const s = `\nexport const z = 1;\n`;\nexport const y = 2;";
    expect(sourceStaticExportNames(src)).toEqual(["y"]);
    expect(sourceStaticExportNames("// export const z = 1;\nexport const y = 2;")).toEqual(["y"]);
  });

  it("真实导出照常回收（对照组：证明断言不空转）", () => {
    expect(namesOf("export const z = 1;")).toEqual(["z"]);
    expect(namesOf("export function q(){return 1}")).toEqual(["q"]);
  });
});
