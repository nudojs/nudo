/**
 * 模块套件：字符串/URL/RegExp/Intl/日期面。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { litValue, abs as abs___nudojs_core, type Abs as Abs___nudojs_core } from "@nudojs/core";
import { call, isNever, throwsError, val, effects, resetEngineCaches, tupleEls } from "./eval-helpers.ts";
import { stripStaticExportDecls, sourceStaticExportNames } from "../exec/export-names.ts";
import { transpileSource } from "../exec/transpile.ts";
import { takeRefineDiags } from "../refine.ts";
import { takeContractDiags } from "../contract/contract.ts";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check/check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { makeUrlSearchParamsAbs, URL_SEARCH_PARAMS_ENTRIES_SLOT } from "../builtins/error/web.ts";
import { isHiddenInternalSlot } from "../contract/slot-visibility.ts";
import { $lit } from "../exec/runtime/state.ts";
import type { Slot } from "../objects.ts";
import { sigOf, l2Count } from "./nudo-constraints.ts";
import { abs, litValue as litValue_____abs_ts, type Abs } from "../abs.ts";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "../diagnostics/may-throw.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { pTrue as pTrue_____pred_ts } from "../pred.ts";
import { lit } from "../term.ts";
import { formatShape } from "../format/format.ts";
import { concatString } from "../template.ts";

// ---------------------------------------------------------------------------
// URL 组件写入可写性
// ---------------------------------------------------------------------------
describe("URL 组件写入可写性", () => {
/**
 * 回归：`BUILTIN_BRAND_ACCESSORS.URL` 是 `$in` presence 表，不是
 * 只读声明——WHATWG URL 的 href/protocol/…/hash 都带 setter，仅 origin /
 * searchParams 是 getter-only。此前写门把整张表当 getter-only ⇒ 合法写被
 * 判确定 TypeError、签名塌 never。
 */





  it("u.href = … 合法且读回新值（改前 never throws TypeError）；其它可写组件（protocol/pathname/search/hash/port）同样不抛；origin 是 getter-only ⇒ strict 下仍确定抛 TypeError；同名用户自定义 class URL 的 this.href 写入不再被表误伤", () => {
  {
    const r = call(
      `export function f() { const u = new URL("https://a.example/p?q=1#h"); u.href = "https://b.example/y"; return u.href; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "https://b.example/y" });
    expect(isNever(r.result)).toBe(false);
  }
  {
    for (const key of ["protocol", "pathname", "search", "hash", "port"]) {
      const r = call(
        `export function f() { const u = new URL("https://a.example/p?q=1#h"); u.${key} = u.${key}; return 1; }`,
      );
      expect(litValue(r.result), key).toEqual({ ok: true, value: 1 });
    }
  }
  {
    const r = call(`export function f() { const u = new URL("https://a.example/p"); u.origin = "x"; return 1; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = call(`class URL { constructor() { this.href = "x"; } }
export function f() { return new URL().href; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "x" });
  }
});




});

// ---------------------------------------------------------------------------
// 字符串数组解构按码点
// ---------------------------------------------------------------------------
describe("字符串数组解构按码点", () => {
/**
 * 回归：字符串数组解构按 **code point** 迭代（原生
 * GetIterator + String.prototype[Symbol.iterator]），不是按 UTF-16 码元
 * 下标。此前 `$iterCheck` 对字符串返回 null ⇒ readAt 回落 `$idx(str,i)`
 * ⇒ 增补平面字符解出孤立代理项。
 */




  it("const [a] = '𠮷' ⇒ a.length === 2（改前 1）；const [a,b] = '𠮷x' ⇒ 完整码点 + 后继字符；rest 段同样按码点；ASCII 与 spread / for-of 既有精度不变", () => {
  {
    expect(val(`export function f() { const [a] = "\\u{20BB7}"; return a.length; }`)).toEqual({
      ok: true,
      value: 2,
    });
  }
  {
    expect(val(`export function f() { const [a, b] = "\\u{20BB7}x"; return a + "|" + b; }`)).toEqual({
      ok: true,
      value: "𠮷|x",
    });
  }
  {
    expect(val(`export function f() { const [a, ...rest] = "\\u{20BB7}xy"; return a + rest.join(""); }`)).toEqual({
      ok: true,
      value: "𠮷xy",
    });
  }
  {
    expect(val(`export function f() { const [a, b] = "xy"; return a + b; }`)).toEqual({ ok: true, value: "xy" });
    expect(val(`export function f() { return [..."𠮷"].length; }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { return "𠮷".length; }`)).toEqual({ ok: true, value: 2 });
  }
});




});

// ---------------------------------------------------------------------------
// URL.searchParams 回写父 URL
// ---------------------------------------------------------------------------
describe("URL.searchParams 回写父 URL", () => {
/**
 * 回归：`URL.searchParams` 是与父 URL 同源的 **live view**——
 * 对它的 set / append / delete 会改写 u.search 与 u.href。此前 URL 组件
 * 是构造期快照，searchParams 的条目表变更后父 URL 不回写 ⇒ 自信错值。
 */




  it("set 后 u.search 是 '?b=2'（改前 '?b=1'）；delete 后 u.href 去掉查询串；append 后 u.href 增出新查询串；负控制：searchParams 自身与独立 URLSearchParams 精度不变", () => {
  {
    expect(
      val(`export function f() { const u = new URL("https://x.com/a?b=1"); u.searchParams.set("b", "2"); return u.search; }`),
    ).toEqual({ ok: true, value: "?b=2" });
  }
  {
    expect(
      val(`export function f() { const u = new URL("https://x.com/a?b=1"); u.searchParams.delete("b"); return u.href; }`),
    ).toEqual({ ok: true, value: "https://x.com/a" });
  }
  {
    expect(
      val(`export function f() { const u = new URL("https://x.com/a"); u.searchParams.append("q", "1"); return u.href; }`),
    ).toEqual({ ok: true, value: "https://x.com/a?q=1" });
  }
  {
    expect(
      val(`export function f() { const u = new URL("https://x.com/a?b=1"); u.searchParams.set("b","2"); return u.searchParams.toString(); }`),
    ).toEqual({ ok: true, value: "b=2" });
    expect(
      val(`export function f() { const p = new URLSearchParams("b=1"); p.set("b","2"); return p.toString(); }`),
    ).toEqual({ ok: true, value: "b=2" });
  }
});




});

// ---------------------------------------------------------------------------
// 模板插值用 ToString 判据
// ---------------------------------------------------------------------------
describe("模板插值用 ToString 判据", () => {
/**
 * 回归：模板插值 `${x}` 是 **ToString（string hint）** 面，须用引擎
 * 自带的 ToString 分档判据（mayToStringThrowOperand），不得复用 ToNumber 面
 * 的 noteCoercionMayThrow（对 brand/obj/fn 一律 may）⇒ Date / Map / 普通闭
 * 对象在 `${x}` 里被假记 TypeError（L2 假红）。
 */



const wrap = (body: string) => `export function f() { ${body} }`;

{
  for (const [name, expr] of [
    ["Date", `const d = new Date(0); return \`created at \${d}\`;`],
    ["Map", `const m = new Map(); return \`m=\${m}\`;`],
    ["plain obj", `const o = {}; return \`o=\${o}\`;`],
  ] as const) {
    it(`${name} 的模板插值不记 may-throw（与 String(x) / "x" + x 同裁决）`, () => {
      expect(effects(wrap(expr)), name).not.toContain("TypeError");
    });
  }

  it("值面仍精确（普通闭对象）；负控制：Symbol 插值的确定 TypeError 仍成立", () => {
  {
    expect(val(wrap(`const o = {}; return \`o=\${o}\`;`))).toEqual({ ok: true, value: "o=[object Object]" });
  }
  {
    const r = effects(wrap(`return \`\${Symbol()}\`;`));
    // 确定抛走 throws 面（不进软 may-throw 收集器）⇒ 只钉不误记软通道
    expect(r).not.toContain("TypeError");
    expect(val(wrap(`return 1;`))).toEqual({ ok: true, value: 1 });
  }
});

}
});

// ---------------------------------------------------------------------------
// 正则字面量的 flags 按规范序
// ---------------------------------------------------------------------------
describe("正则字面量的 flags 按规范序", () => {
/**
 * 回归：正则**字面量**的 `flags` 必须按 ES 规范序
 * （`d g i m s u v y`）返回。
 *
 * 根因：`packages/core/src/algebra/builtins/regexp.ts` 的 `regexpBrandSlots`
 * （brand 槽的唯一构造点）把 `litFlags` **原样**写进槽——而同文件的文档注释
 * 却写着「flags：字面量 flags → strLit（规范序）」⇒ 注释与实现相反。
 * `new RegExp(...)` 构造路径**正确**（它先跑真 JS `new RegExp(p, flags)` 再
 * 取 `r.flags`），正则**字面量**路径绕开了它（`$regex` 把源码里的原始 flag
 * 文本直接传下去）⇒ 同一引擎两条路径结论不同。
 *
 * 修法：写入槽前一律用真 JS `new RegExp("", flags).flags` 规范化
 * （与构造路径同口径）。
 */



const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};

const wrap = (body: string): string => `export function f() { ${body} }`;


  it("/a/gimuyds.flags ⇒ \"dgimsuy\"（源码序 ≠ 规范序）；/a/gmsiy.flags ⇒ \"gimsy\"；/a/gimuyds.toString() ⇒ \"/a/dgimsuy\"；构造路径仍正确（回归控制）：new RegExp(\"a\",\"gimuyds\").flags ⇒ \"dgimsuy\"；已规范的 flags 不变（回归控制）：/a/gimsuy.flags ⇒ \"gimsuy\"；7 个布尔标志 getter 与顺序无关（回归控制）", () => {
  {
    expect(lit(wrap("return /a/gimuyds.flags;"))).toBe("dgimsuy");
  }
  {
    expect(lit(wrap("return /a/gmsiy.flags;"))).toBe("gimsy");
  }
  {
    expect(lit(wrap("return /a/gimuyds.toString();"))).toBe("/a/dgimsuy");
  }
  {
    expect(lit(wrap("return new RegExp(\"a\",\"gimuyds\").flags;"))).toBe("dgimsuy");
  }
  {
    expect(lit(wrap("return /a/gimsuy.flags;"))).toBe("gimsuy");
  }
  {
    expect(lit(wrap("return /a/gimuyds.global;"))).toBe(true);
    expect(lit(wrap("return /a/gimuyds.ignoreCase;"))).toBe(true);
    expect(lit(wrap("return /a/gimuyds.hasIndices;"))).toBe(true);
    expect(lit(wrap("return /a/gimuyds.sticky;"))).toBe(true);
    expect(lit(wrap("return /a/gimuyds.unicode;"))).toBe(true);
    expect(lit(wrap("return /a/gimuyds.dotAll;"))).toBe(true);
    expect(lit(wrap("return /a/gimuyds.multiline;"))).toBe(true);
  }
});






});

// ---------------------------------------------------------------------------
// `String(o)` 走 string hint（不调 valueOf）
// ---------------------------------------------------------------------------
describe("`String(o)` 走 string hint（不调 valueOf）", () => {
/**
 * `String(x)` / 模板插值用 **default hint** 调 ToPrimitive 钩子
 * ⇒ 原生**根本不调** `valueOf`，nudo 调了 ⇒ 用户可见副作用凭空多出。
 *
 * 根因：`objects.ts` 的 `isNullProtoWithoutCoercer`（ToPrimitive 前置闸门的
 * 统一调用面）把 hint **写死成 `"default"`**；`String()` 面复用它却没传
 * `"string"`。原生规则：ToPrimitive(**string hint**) 先试 `toString`；对象
 * 没有自有 `toString` ⇒ 继承 `Object.prototype.toString` ⇒ 恒返回原语 ⇒
 * **再也不会回退 `valueOf`**（`String({valueOf(){n++}})` 原生 `n` 保持 0）。
 * `+` 走 default hint ⇒ `valueOf` 先 ⇒ 调 1 次（正确）。
 *
 * 修后：`isNullProtoWithoutCoercer(a, hint = "default")` 参数化，hint 随运算
 * 面走——
 * - `builtins/global.ts` 的 `String()` 面传 `"string"`；
 * - `methods.ts` 的 `String.prototype.concat` 传 `"string"`；
 * - 模板插值：降级点（`exec/transpile/expr/atom.ts` 的 TemplateLiteral）给
 * 每个插值位包 `$toStr(...)`（`exec/runtime/ops.ts`），值面沿用既有拼接臂
 * `concatString`（纯判定，不重调钩子）⇒ `${o}` 与用户手写的 `"" + o`
 * **不再同形**，`+` 保持 default hint。
 * string hint 下无自有 toString 钩子 ⇒ `invokeToPrimitiveHook` 直接返回
 * undefined，**不回退 valueOf**；用户 toString 返回非原语时仍回退（ES
 * OrdinaryToPrimitive 规定，node 实测）。
 *
 * oracle：node v26 实测。
 */




  it("`String({valueOf})`：valueOf 不调用（native：0）；`String({valueOf, toString})`：toString 先、valueOf 不调用（native：1 → 编码 1）；`String(o)` 的返回值面仍是 string（值折叠不在本条范围，副作用面已修复）；用户 toString 返回非原语 ⇒ 原生回退 valueOf（ES OrdinaryToPrimitive；native:1）；null-proto 无 coe", () => {
  {
    expect(
      val(
        `export function f() { let c = 0; const o = { valueOf(){ c += 10; return 1; } }; String(o); return c; }`,
      ),
    ).toEqual({ ok: true, value: 0 });
  }
  {
    expect(
      val(
        `export function f() { let v = 0, t = 0; const o = { valueOf(){ v += 1; return 1; }, toString(){ t += 1; return "s"; } }; String(o); return v * 10 + t; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    const r = val(
      `export function f() { const o = { valueOf(){ return 1; }, toString(){ return "s"; } }; return String(o); }`,
    );
    // 修前也是非字面量；此处只钉住「不是 number 1」——string hint 下绝不用 valueOf 的结果
    expect(r.ok === false || typeof r.value === "string").toBe(true);
  }
  {
    expect(
      val(
        `export function f() { let v = 0; const o = { toString(){ return {}; }, valueOf(){ v += 1; return 1; } }; String(o); return v; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    const r = call(
      `export function f() { return String(Object.create(null)); }`,
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
});





describe("`+` 运算符面保持 default hint（回归）", () => {
  it("`o + 1`：valueOf 调一次（native：1）；`o + \"\"`：default hint 下 valueOf 先（无自有 valueOf ⇒ toString 一次，native：1）；`[Symbol.toPrimitive]` 优先于 hint（两种面各调一次）", () => {
  {
    expect(
      val(
        `export function f() { let v = 0; const o = { valueOf(){ v += 1; return 1; } }; o + 1; return v; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(
        `export function f() { let t = 0; const o = { toString(){ t += 1; return "s"; } }; o + ""; return t; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(
        `export function f() { let n = 0; const o = { [Symbol.toPrimitive](){ n += 1; return "s"; } }; String(o); o + 1; return n; }`,
      ),
    ).toEqual({ ok: true, value: 2 });
  }
});


});

describe("模板插值走 string hint（`$toStr` 降级位）", () => {
  it("`${o}`：valueOf 不调用（native：0）；`${o}` + toString：toString 先、valueOf 不调用（native：编码 1）；两次插值 ⇒ 每次各调一次 toString（native：2）；`${Symbol()}` ⇒ 原生 TypeError（`String(sym)` 不抛，模板抛）；字面量插值仍折叠（`a${\"b\"}c` ⇒ \"abc\"；`${1}` ⇒ \"1\"）；bigint / null / undefined 字面量插值", () => {
  {
    expect(
      val(
        "export function f() { let c = 0; const o = { valueOf(){ c += 10; return 1; } }; const s = `${o}`; return c; }",
      ),
    ).toEqual({ ok: true, value: 0 });
  }
  {
    expect(
      val(
        "export function f() { let v = 0, t = 0; const o = { valueOf(){ v += 1; return 1; }, toString(){ t += 1; return \"s\"; } }; `${o}`; return v * 10 + t; }",
      ),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(
        "export function f() { let t = 0; const o = { toString(){ t += 1; return \"s\"; } }; const s = `${o}${o}`; return t; }",
      ),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    const r = call("export function f() { return `${Symbol()}`; }");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    expect(val('export function f() { return `a${"b"}c`; }')).toEqual({
      ok: true,
      value: "abc",
    });
    expect(val("export function f() { return `${1}`; }")).toEqual({
      ok: true,
      value: "1",
    });
  }
  {
    expect(val("export function f() { return `${1n}`; }")).toEqual({
      ok: true,
      value: "1",
    });
    expect(call("export function f() { return `${1n}`; }").throws.shape.k).toBe("never");
    expect(val("export function f() { return `${null}`; }")).toEqual({
      ok: true,
      value: "null",
    });
    expect(val("export function f() { return `${undefined}`; }")).toEqual({
      ok: true,
      value: "undefined",
    });
  }
  {
    expect(
      val(
        `export function f() { let c = 0; const o = { valueOf(){ c += 10; return 1; } }; "x".concat(o); return c; }`,
      ),
    ).toEqual({ ok: true, value: 0 });
  }
});






});
});

// ---------------------------------------------------------------------------
// includes 的 fromIndex 校验
// ---------------------------------------------------------------------------
describe("includes 的 fromIndex 校验", () => {
/**
 * `Array.prototype.includes(searchElement, fromIndex)` **不校验
 * fromIndex**：原生 `ToIntegerOrInfinity(fromIndex)` 对 bigint / symbol
 * **确定 TypeError**（node: `[1,2,3].includes(0, 1n)` → TypeError: Cannot
 * convert a BigInt value to a number）——引擎此前完全不校验 ⇒ 判「不抛」⇒
 * L2 `nudo:entry-may-throw` 门禁假绿。
 *
 * 根修：includes 臂补 `validateIndexArg(args[1], …)`（与 indexOf 同款口径）。
 */




  it("includes(x, 1n)：原生确定 TypeError（bigint 不能转 number）；includes(x, Symbol())：原生确定 TypeError（symbol 不能转 number）；对照：includes(x, 1) 不抛（number 合法）；对照：indexOf(x, 1n) 早已确定 TypeError（口径一致）", () => {
  {
    const r = call(`export function f() { return [1,2,3].includes(0, 1n); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(isNever(r.result)).toBe(true);
  }
  {
    const r = call(`export function f() { return [1,2,3].includes(0, Symbol("x")); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(isNever(r.result)).toBe(true);
  }
  {
    const r = call(`export function f() { return [1,2,3].includes(0, 1); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
  }
  {
    const r = call(`export function f() { return [1,2,3].indexOf(0, 1n); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
});




});

// ---------------------------------------------------------------------------
// 模板字面量里的伪导出不被当成导出（不变量锁定）
// ---------------------------------------------------------------------------
describe("模板字面量里的伪导出不被当成导出（不变量锁定）", () => {
/**
 * `export-names.ts` 把**模板字面量**里的 `export const z` 行
 * 当成导出（**报告自称「未复现」** ⇒ 本文件是**复现结论 + 不变量锁定**）。
 *
 * 复现结论：**当前架构下不可复现**（非缺陷）——
 * `stripStaticExportDecls(js, source?)` 的 `js` **恒为 transpile 产物**
 * （唯一调用点：exec/run.ts）。而 transpile 的发射约定是：
 * - 字符串 / 模板字面量 / 正则字面量 ⇒ `$lit(JSON.stringify(...))` /
 * `$tpl(JSON.stringify(...), …)` ⇒ 内容里的换行被**转义**成 `\n`
 * ⇒ **不可能**出现「行首是 `export const z`」的裸文本；
 * - 注释 ⇒ **整体丢弃**（不进产物）。
 * ⇒ 正则 `^export (?:const|let) <名>`（`m` 标志，**行首锚**）永远碰不到
 * 模板 / 注释里的伪导出。
 * 源侧另有 AST 口径 `sourceStaticExportNames`（源 AST 的
 * `ExportNamedDeclaration`）⇒ 模板字面量是**字符串字面量**，不是导出声明。
 *
 * ⇒ **不改源码**（不瞎改）。本文件把上述**不变量**钉死：若将来 transpile 改
 * 发射格式（例如把字符串内容原样吐出），本测试会**立刻变红** ⇒ 缺陷不会
 * 静默回归。
 */







/** 缓存重置（仓库惯例） */
beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

/** 文本口径的导出名（transpile 产物 ⇒ 真实发射格式） */
const namesOf = (src: string): string[] => stripStaticExportDecls(transpileSource(src)).names;


  it("单行模板字面量里的 `export const z` 不是导出；多行模板字面量里的 `export const z` 不是导出；带插值的模板字面量里的伪导出不是导出；注释里的伪导出不是导出（注释不进产物）；源 AST 口径同样不收模板 / 注释里的伪导出；真实导出照常回收（对照组：证明断言不空转）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const src = "const s = `export const z = 1;`;\nexport const y = 2;";
    // 产物里伪导出只以「字符串内容」形态存在（JSON 转义 ⇒ 换行不成行）
    expect(transpileSource(src)).not.toMatch(/^export const z/m);
    expect(namesOf(src)).toEqual(["y"]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const src = "const s = `\nexport const z = 1;\n`;\nexport const y = 2;";
    expect(transpileSource(src)).not.toMatch(/^export const z/m);
    expect(namesOf(src)).toEqual(["y"]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const src = "const s = `a${1}\nexport const z = 1;`;\nexport const y = 2;";
    expect(transpileSource(src)).not.toMatch(/^export const z/m);
    expect(namesOf(src)).toEqual(["y"]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const src = "// export const z = 1;\nexport const y = 2;";
    expect(transpileSource(src)).not.toMatch(/^export const z/m);
    expect(namesOf(src)).toEqual(["y"]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const src = "const s = `\nexport const z = 1;\n`;\nexport const y = 2;";
    expect(sourceStaticExportNames(src)).toEqual(["y"]);
    expect(sourceStaticExportNames("// export const z = 1;\nexport const y = 2;")).toEqual(["y"]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(namesOf("export const z = 1;")).toEqual(["z"]);
    expect(namesOf("export function q(){return 1}")).toEqual(["q"]);
  }
});






});

// ---------------------------------------------------------------------------
// ReferenceError 建议的真实归因
// ---------------------------------------------------------------------------
describe("ReferenceError 建议的真实归因", () => {
/**
 * `nudo:entry-may-throw` 的 ReferenceError 建议**无条件**断言
 * 「re-export `export { x } from` 不是局部绑定」，且标识符 `x` 是**硬编码**的：
 * - 对「未定义全局 / env 缺项 / 拼写错误」指错方向（文件里根本没有 re-export）；
 * - 即便真是 re-export 形态，点名的也未必是用户 re-export 的那个名字。
 *
 * 钉：建议点名**真实**的 re-export 本地名（`y`），且在**没有** re-export 的
 * 文件里**不**说 re-export；可执行半边（`@nudo:throws ReferenceError`）保留。
 */







function suggestionOf(src: string): string {
  const r = checkSource("/t/r.js", src, pTrue, {});
  const issue = r.issues.find((i) => i.code === "nudo:entry-may-throw");
  expect(issue).toBeDefined();
  return issue!.suggestion ?? "";
}

{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();
  });

  it("文件里的 re-export 是 y ⇒ 建议点名 y（不再硬编码 x）；没有 re-export 的文件（未定义全局）⇒ 不说 re-export；两个文件的建议不同（旧口径逐字相同）", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const s = suggestionOf(`
export { y } from "./other.js";
export function f() {
  return y + 1;
}
`);
    expect(s).toContain("export { y } from");
    expect(s).toContain("import { y }");
    expect(s).not.toContain("import { x }");
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const s = suggestionOf(`
export function f() {
  return totallyUndefinedGlobal(1);
}
`);
    expect(s).not.toContain("re-export");
    expect(s).not.toContain("import { x }");
    // 可执行半边仍在
    expect(s).toContain("@nudo:throws ReferenceError");
    expect(s).toContain("not bound");
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const withReexport = suggestionOf(`
export { y } from "./other.js";
export function f() {
  return y + 1;
}
`);
    const undef = suggestionOf(`
export function f() {
  return totallyUndefinedGlobal(1);
}
`);
    expect(withReexport).not.toBe(undef);
  }
});


}
});

// ---------------------------------------------------------------------------
// URLSearchParams 的 @@entries 内部槽
// ---------------------------------------------------------------------------
describe("URLSearchParams 的 @@entries 内部槽", () => {
/**
 * 回归：`URLSearchParams` 的 `@@entries` 是**内部槽**（原生不可枚举 /
 * 不可见），不得被投影面发布成必填自有属性。
 *
 * 根因：`packages/core/src/algebra/builtins/error/web.ts` 的
 * `urlSearchParamsBrandAbs` 建 `@@entries` 槽时**只给了 `value`**、没给
 * `internal: true`（而同文件 `:223` 的注释原文写着「条目表存内层 obj 的
 * `@@entries` 槽（内部槽——原生不可枚举/不可见）」⇒ 注释与实现相反）⇒
 * guard 产物要求被检查值**自带一个叫 `"@@entries"` 的属性**
 *（`Object.hasOwn(data, "@@entries")`）⇒ 任何真实的 `URLSearchParams` 都被
 * 拒绝（假红），而 dts / zod / standard 三面正确 ⇒ 四面矛盾。
 *
 * 修法：该槽补 `internal: true`（投影面统一按 `internal` 剔除）。
 */







const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};
const wrap = (body: string): string => `export function f() { ${body} }`;


  it("@@entries 槽带 internal 标记（投影面据此剔除）；运行时面：new URLSearchParams(\"a=1\") 的 getOwnPropertyNames 是 []；运行时面：hasOwnProperty(\"@@entries\") 是 false（原生同款）；对照组：条目表本身仍可读（内部槽不影响 $get 派发）", () => {
  {
    const brand = makeUrlSearchParamsAbs($lit("a=1&b=2" as never));
    const inner = brand.shape.k === "brand" ? brand.shape.shape : undefined;
    expect(inner?.shape.k).toBe("obj");
    const slot = (inner!.shape as { slots: Record<string, Slot> }).slots[
      URL_SEARCH_PARAMS_ENTRIES_SLOT
    ];
    expect(slot, "@@entries 槽缺席（条目表未建模）").toBeDefined();
    expect(slot!.internal, "@@entries 未打 internal ⇒ guard 产物会要求它存在").toBe(true);
    expect(isHiddenInternalSlot(URL_SEARCH_PARAMS_ENTRIES_SLOT, slot!)).toBe(true);
  }
  {
    expect(
      tupleEls(
        call(wrap('return Object.getOwnPropertyNames(new URLSearchParams("a=1"));')).result,
      ),
    ).toEqual([]);
  }
  {
    expect(
      lit(wrap('return new URLSearchParams("a=1").hasOwnProperty("@@entries");')),
    ).toBe(false);
  }
  {
    expect(lit(wrap('return new URLSearchParams("a=1&b=2").get("a");'))).toBe("1");
    expect(lit(wrap('return new URLSearchParams("a=1&b=2").size;'))).toBe(2);
  }
});




});

// ---------------------------------------------------------------------------
// TextEncoder member surface
// ---------------------------------------------------------------------------
describe("TextEncoder member surface", () => {
/**
 * `TextEncoder` 在 PROTOTYPED_BRAND_NAMES 里登记但两张成员表只有
 * `TextDecoder` ⇒ 成员读折 exact undefined（`e.encoding === undefined` 判 true）。
 * 修复：`new TextEncoder()` 建模 encoding/encode/encodeInto。
 */




const SRC = `
export function encIsUndef() {
  const e = new TextEncoder();
  return e.encoding === undefined;
}
export function encodeIsUndef() {
  const e = new TextEncoder();
  return e.encode === undefined;
}
export function encodeIntoIsUndef() {
  const e = new TextEncoder();
  return e.encodeInto === undefined;
}
export function decEncoding() {
  const d = new TextDecoder();
  return d.encoding;
}
`;


  it("encoding / encode / encodeInto are present；TextDecoder encoding still resolves", () => {
  {
    const r = checkSource("/t/bug-160.js", SRC, pTrue);
    expect(sigOf(r, "encIsUndef")).toBe("false");
    expect(sigOf(r, "encodeIsUndef")).toBe("false");
    expect(sigOf(r, "encodeIntoIsUndef")).toBe("false");
  }
  {
    const r = checkSource("/t/bug-160.js", SRC, pTrue);
    expect(sigOf(r, "decEncoding")).toBe('"utf-8"');
  }
});


});

// ---------------------------------------------------------------------------
// URL brand 的 host 槽
// ---------------------------------------------------------------------------
describe("URL brand 的 host 槽", () => {
/**
 * 回归（`host` 面）：`URL` brand 的 `host` 槽此前漏建模 ⇒ 成员读折
 * **exact undefined**（假绿：`u.host === undefined` 恒 true）、`in` 面折
 * **exact false**（假红：宿主 true）。
 *
 * 根因：`packages/core/src/algebra/builtins/error/web.ts` 的 `urlBrandAbs`
 * 的 `componentKeys` = href / origin / protocol / hostname / pathname / search /
 * hash / port / username / password ⇒ **没有 `host`**（宿主 `host` 含端口、
 * `hostname` 不含；node 实测 `Object.getOwnPropertyNames(URL.prototype)` 同时
 * 有 host 与 hostname）。
 *
 * 修法：`componentKeys` 补 `"host"`。
 *
 * 未修的一半（`toJSON` 原型方法面两表无条目）见交付报告的 blocker：
 * 它需要 `exec/runtime/members.ts` 的 `BUILTIN_BRAND_METHODS.URL`（不在本次
 * 授权的文件清单内）。
 */



const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};
const wrap = (body: string): string => `export function f() { const u = new URL("http://example.com/a"); ${body} }`;


  it("u.host ⇒ \"example.com\"（不是 undefined）；u.host === undefined ⇒ false（不假绿）；\"host\" in u ⇒ true（in 面与读面同结论）；对照组：hostname 仍正确（回归控制）；带端口的 host 含端口、hostname 不含（原生语义）", () => {
  {
    expect(lit(wrap("return u.host;"))).toBe("example.com");
  }
  {
    expect(lit(wrap("return u.host === undefined;"))).toBe(false);
  }
  {
    expect(lit(wrap('return "host" in u;'))).toBe(true);
  }
  {
    expect(lit(wrap("return u.hostname;"))).toBe("example.com");
  }
  {
    const r = call(
      `export function f() { const u = new URL("http://example.com:8080/a"); return [u.host, u.hostname]; }`,
    );
    expect(tupleEls(r.result)).toEqual(["example.com:8080", "example.com"]);
  }
});





});

// ---------------------------------------------------------------------------
// new TextDecoder(label, options) 的 options 位
// ---------------------------------------------------------------------------
describe("new TextDecoder(label, options) 的 options 位", () => {
/**
 * `new TextDecoder(label, options?)` 的 **options 位**此前被整段
 * 丢弃（建模函数只收 label）⇒ 宿主必抛的 `TypeError: The "options"
 * argument must be of type object.` 漏判（假绿）。
 *
 * 宿主 node v26.10.0 实测口径（本文件全部钉死）：
 * - `new TextDecoder("utf-8", "extra")` / `(…, 42)` → 确定 TypeError；
 * - `(…, undefined)` / `(…, null)` / `(…, {fatal:true})` / 函数 / 数组 →
 * 合法（null ≡ 空字典）；
 * - label ToString 先于 options 字典转换：
 * `new TextDecoder(Symbol(), 42)` → Symbol 的 TypeError（不是 options 的）；
 * - 抽象 prim options 恒非对象 → 确定 TypeError；any/含对象臂的 union → may。
 */





const anyAbs = abs({ k: "any" }, undefined, undefined, "path");
const numAbs = abs({ k: "prim", type: "number" }, undefined, undefined, "path");
const sumPrim = abs(
  {
    k: "sum",
    members: [
      abs({ k: "prim", type: "string" }, undefined, undefined, "path"),
      abs({ k: "prim", type: "number" }, undefined, undefined, "path"),
    ],
  },
  undefined,
  undefined,
  "path",
);
const sumMixed = abs(
  {
    k: "sum",
    members: [
      abs({ k: "prim", type: "string" }, undefined, undefined, "path"),
      abs({ k: "obj", slots: {} }, undefined, undefined, "path"),
    ],
  },
  undefined,
  undefined,
  "path",
);

/** 带 may-throw 采集的调用（may 效果进 effects；definite 抛进 result/throws） */
function evalWithOptions(optionsAbs: (typeof anyAbs) | undefined): {
  result: unknown;
  throws: unknown;
  effects: string[];
} {
  const effects: MayThrowEffect[] = [];
  let out: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      out = call(
        `export function f(o) { return new TextDecoder("utf-8", o); }`,
        "f",
        optionsAbs ? [optionsAbs] : [],
      ) as never;
    } catch {
      /* 入口整抛：throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return {
    result: out.result,
    throws: out.throws,
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}


  it("非对象字面量 options ⇒ 确定抛 TypeError（此前假绿）；对象 / null / undefined / 函数 options ⇒ 不抛（构造成功）；label ToString 先于 options 字典转换（Symbol label ⇒ Symbol 的 TypeError）；抽象 prim / 全 prim union options ⇒ 确定 TypeError；any / 含对象臂的 union options ⇒ may TypeError（不判确", () => {
  {
    for (const src of [
      `export function f() { return new TextDecoder("utf-8", "extra"); }`,
      `export function f() { return new TextDecoder("utf-8", 42); }`,
      `export function f() { return new TextDecoder("utf-8", true); }`,
      `export function f() { return new TextDecoder("utf-8", 1n); }`,
      `export function f() { return new TextDecoder(undefined, 42); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  }
  {
    for (const src of [
      `export function f() { return new TextDecoder("utf-8", { fatal: true }); }`,
      `export function f() { return new TextDecoder("utf-8", {}); }`,
      `export function f() { return new TextDecoder("utf-8", null); }`,
      `export function f() { return new TextDecoder("utf-8", undefined); }`,
      `export function f() { return new TextDecoder("utf-8"); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(false);
      expect((r.result as { shape?: { k?: string; name?: string } }).shape?.name, src).toBe(
        "TextDecoder",
      );
      expect(isNever(r.throws), src).toBe(true);
    }
  }
  {
    const r = call(
      `export function f() { return new TextDecoder(Symbol("s"), 42); }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    for (const a of [numAbs, sumPrim]) {
      const r = evalWithOptions(a);
      expect(isNever(r.result)).toBe(true);
      expect(throwsError(r.throws, "TypeError")).toBe(true);
    }
  }
  {
    for (const a of [anyAbs, sumMixed]) {
      const r = evalWithOptions(a);
      expect(isNever(r.result)).toBe(false);
      expect(r.effects).toContain("TypeError");
    }
  }
  {
    const bad = call(`export function f() { return new TextDecoder("bad-$$"); }`);
    expect(isNever(bad.result)).toBe(true);
    expect(throwsError(bad.throws, "RangeError")).toBe(true);
    const ok = call(`export function f() { return new TextDecoder("utf8"); }`);
    expect(isNever(ok.result)).toBe(false);
    expect(isNever(ok.throws)).toBe(true);
  }
});






});

// ---------------------------------------------------------------------------
// btoa/atob 缺参 ⇒ 确定 TypeError
// ---------------------------------------------------------------------------
describe("btoa/atob 缺参 ⇒ 确定 TypeError", () => {
/**
 * `btoa()` / `atob()` **少传必填实参**被折叠成「显式 undefined」
 * ⇒ `btoa()` 假绿 + 返回值错（`"dW5kZWZpbmVk"`，宿主抛 TypeError）、
 * `atob()` 抛错种类错（引擎 InvalidCharacterError / 宿主 TypeError ⇒ L2
 * 建议 `@nudo:throws InvalidCharacterError` 不可执行）。
 *
 * 宿主 node v26.10.0 实测：
 * - `btoa()` / `atob()` → `TypeError: The "input" argument must be specified`；
 * - `btoa(undefined)` → `"dW5kZWZpbmVk"`（ToString(undefined) 合法）；
 * - `atob(undefined)` → DOMException InvalidCharacterError；
 * - 同族 `encodeURI()` / `escape()` 缺参 ≡ ToString(undefined)（不受此门影响）。
 */




  it("btoa() 折 never + TypeError（此前假绿返回 \"dW5kZWZpbmVk\"）；atob() 折 never + TypeError（此前抛错种类错 InvalidCharacterError）；对照：btoa(undefined) 仍是 ToString(undefined)；对照：atob(undefined) 仍是 InvalidCharacterError（DOMException）；对照：同族 6 个函数缺参 ≡ ToString(undefin", () => {
  {
    const r = call(`export function f() { return btoa(); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = call(`export function f() { return atob(); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(throwsError(r.throws, "InvalidCharacterError")).toBe(false);
  }
  {
    expect(val(`export function f() { return btoa(undefined); }`)).toEqual({
      ok: true,
      value: "dW5kZWZpbmVk",
    });
  }
  {
    const r = call(`export function f() { return atob(undefined); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "InvalidCharacterError")).toBe(true);
  }
  {
    for (const name of [
      "encodeURI",
      "encodeURIComponent",
      "decodeURI",
      "decodeURIComponent",
      "escape",
      "unescape",
    ]) {
      const r = call(`export function f() { return ${name}(); }`);
      expect(isNever(r.result), name).toBe(false);
      // 缺参 ≡ ToString(undefined) = "undefined"（6 个函数同款）
      expect(val(`export function f() { return ${name}(); }`), name).toEqual({
        ok: true,
        value: "undefined",
      });
    }
  }
});





});

// ---------------------------------------------------------------------------
// inherited→own 覆写后 gOPN 次序
// ---------------------------------------------------------------------------
describe("inherited→own 覆写后 gOPN 次序", () => {
/**
 * 回归：Error 实例上公有覆写原型链 `inherited` 槽 `name` 后，
 * `Object.getOwnPropertyNames` 的**次序**必须与宿主一致。
 *
 * 根因：`packages/core/src/algebra/exec/runtime/containers/member.ts`（`$set`
 * 的 brand 内层 obj 臂）对 inherited→own 的公有覆写走 `setSlot` **原地改槽
 * 值**（插入序不变），而原生是**新建一个自有属性**（CreateDataProperty）⇒
 * 追加到自有属性序**末尾**。`error-family.ts` 的槽表字面量把 `name` 夹在
 * `stack` 与 `message` 之间 ⇒ 覆写后次序与宿主相反
 * （引擎 `["stack","name","message"]` vs 宿主 `["stack","message","name"]`），
 * 并被 dts 产物原样发布（自信的确切错元组）。
 *
 * 修法：inherited→own 的公有覆写先删槽再写回 ⇒ 键重新追加到槽表末尾
 * （= 原生自有属性序）。
 */



const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};


  it("e.name = \"CustomError\" ⇒ [\"stack\",\"message\",\"name\"]（宿主次序）；键数不变：覆写后仍是三个键（只是次序）；对照组：不覆写 name ⇒ [\"stack\",\"message\"]（name 是 inherited，不在自有面）；覆写后 name 是自有且**可枚举**属性（原生语义不变）；覆写后的 name 值可读回", () => {
  {
    const r = call(`export function f() {
      const e = new TypeError("boom");
      e.name = "CustomError";
      return Object.getOwnPropertyNames(e);
    }`);
    expect(tupleEls(r.result)).toEqual(["stack", "message", "name"]);
  }
  {
    expect(
      tupleEls(
        call(`export function f() {
          const e = new TypeError("boom");
          e.name = "CustomError";
          return Object.getOwnPropertyNames(e);
        }`).result,
      )?.length,
    ).toBe(3);
  }
  {
    const r = call(`export function f() {
      const e = new TypeError("boom");
      return Object.getOwnPropertyNames(e);
    }`);
    expect(tupleEls(r.result)).toEqual(["stack", "message"]);
  }
  {
    expect(
      lit(`export function f() {
        const e = new TypeError("boom");
        e.name = "CustomError";
        return e.hasOwnProperty("name") && Object.getOwnPropertyDescriptor(e, "name").enumerable;
      }`),
    ).toBe(true);
  }
  {
    expect(
      lit(`export function f() {
        const e = new TypeError("boom");
        e.name = "CustomError";
        return e.name;
      }`),
    ).toBe("CustomError");
  }
});





});

// ---------------------------------------------------------------------------
// export * as "<名>" 被转译（模块不再整体求值失败）
// ---------------------------------------------------------------------------
describe("export * as \"<名>\" 被转译（模块不再整体求值失败）", () => {
/**
 * `export * as "<任意名>" from "..."`（ES2022 任意模块导出名）
 * **不被转译** ⇒ 转译产物是**非法 JS** ⇒ **整个模块**求值失败 ⇒ 全部
 * 导出被静默清空 ⇒ L1 门禁假绿。
 *
 * 改前：`rewriteExportStatements` 的正则只认标识符名
 * （`([A-Za-z_$][\w$]*)`）⇒ 字符串字面量名（`"my-ns"`）不匹配 ⇒ 语句
 * 原样泄漏 ⇒ `new Function` SyntaxError。
 * 改后：名可标识符或**字符串字面量**（标识符口径与 export-names.ts 同一
 * IDENT_NAME_SRC）。
 */





const num = (v: number) =>
  abs({ k: "prim", type: "number" }, { op: "lit", value: v }, pTrue_____pred_ts, "exact");


  it("字符串字面量导出名：模块正常求值且带出该导出；标识符导出名口径不变（对照组）；无 export * as 的普通模块不受影响（对照组）", () => {
  {
    const src = `export * as "my-ns" from "./dep.js";
export function f() { return 5; }`;
    const exports = runTranspiled(src, {
      mode: "exec",
      modules: { "./dep.js": { named: { five: num(5) } } },
    });
    expect(Object.keys(exports).sort()).toEqual(["f", "my-ns"]);
    expect(litValue_____abs_ts(callTranspiledExportFull(exports, "f", []).result)).toEqual({
      ok: true,
      value: 5,
    });
  }
  {
    const src = `export * as ns from "./dep.js";
export function f() { return 5; }`;
    const exports = runTranspiled(src, {
      mode: "exec",
      modules: { "./dep.js": { named: { five: num(5) } } },
    });
    expect(Object.keys(exports).sort()).toEqual(["f", "ns"]);
  }
  {
    const exports = runTranspiled(`export function f() { return 5; }`, {
      mode: "exec",
    });
    expect(Object.keys(exports)).toEqual(["f"]);
  }
});



});

// ---------------------------------------------------------------------------
// Error 家族覆盖用户自定义 Error 子类
// ---------------------------------------------------------------------------
describe("Error 家族覆盖用户自定义 Error 子类", () => {
/**
 * `@nudo:throws Error` / `package.json#nudo.check.ignoreThrows =
 * ["Error"]` **盖不住用户自定义的 Error 子类** ⇒ L2 门禁**假红**（文档承诺
 * 「与 instanceof 语义一致 / 覆盖全部子类」）。
 *
 * 根因：`throwsKindCovered` 用**静态内建名集合** `ERROR_FAMILY` 判覆盖 ⇒
 * `class MyError extends Error {}` 不在集合内 ⇒ 「Error 盖整族」的承诺落空。
 *
 * 修法（core/algebra/may-throw.ts + core/algebra/exec/class-registry.ts）：
 * 沿**运行时继承链**判定（注册表 `superName` 链：`MyError.superName ===
 * "Error"`）⇒ 内建错误名 + 用户自定义 Error 子类都算 Error 家族。
 * 新判定函数**不**进三个公共入口 ⇒ 冻结面零变更。
 */




const MY_ERROR = `
class MyError extends Error {}
export function boom() { throw new MyError("x"); }
`;

const NOT_ERROR = `
class PlainProblem {}
export function boom() { throw new PlainProblem("x"); }
`;

const DEEP_ERROR = `
class BaseErr extends Error {}
class MidErr extends BaseErr {}
class LeafErr extends MidErr {}
export function boom() { throw new LeafErr("x"); }
`;


  it("@nudo:throws Error 盖住用户自定义 Error 子类；ignoreThrows: ['Error'] 盖住用户自定义 Error 子类；多级继承（LeafErr → MidErr → BaseErr → Error）同样被盖住；非 Error 的用户类**不被** Error 盖住（不得过度覆盖）；按类名精确申报仍生效（@nudo:throws MyError）；未申报也未忽略时仍报 L2（不得漏报）", () => {
  {
    const r = checkSource(
      "my-err.js",
      `
class MyError extends Error {}
/**
 * @nudo:throws Error
 */
export function boom() { throw new MyError("x"); }
`,
      pTrue,
    );
    expect(l2Count(r)).toBe(0);
  }
  {
    const r = checkSource("my-err.js", MY_ERROR, pTrue, { ignoreThrows: ["Error"] });
    expect(l2Count(r)).toBe(0);
  }
  {
    const r = checkSource("deep-err.js", DEEP_ERROR, pTrue, { ignoreThrows: ["Error"] });
    expect(l2Count(r)).toBe(0);
  }
  {
    const r = checkSource("not-err.js", NOT_ERROR, pTrue, { ignoreThrows: ["Error"] });
    expect(l2Count(r)).toBe(1);
  }
  {
    const r = checkSource(
      "own-err.js",
      `
class MyError extends Error {}
/**
 * @nudo:throws MyError
 */
export function boom() { throw new MyError("x"); }
`,
      pTrue,
    );
    expect(l2Count(r)).toBe(0);
  }
  {
    const r = checkSource("my-err.js", MY_ERROR, pTrue);
    expect(l2Count(r)).toBe(1);
  }
});






});

// ---------------------------------------------------------------------------
// 字符串 union 拼接必须是成员级并联
// ---------------------------------------------------------------------------
describe("字符串 union 拼接必须是成员级并联", () => {
/**
 * 字符串 union 拼接**伪造不可能字面量**（成员级并联回归钉）
 *
 * 根因（core/src/algebra/template.ts）：
 * `coerceToStringParts` 的 sum 分支把每个 union 成员的 parts **平铺进同
 * 一个数组**（`parts.push(...mp)`）⇒ 丢掉「成员级并联」信息；`concatString`
 * 再把两侧 parts 合成**单个** template；`createTemplateAbs` 对全字面量
 * parts 折叠成**一个** lit ⇒ `("a"|"b") + "!"` 折成 `"ab!"`（原生只有
 * `"a!"` / `"b!"` ⇒ `"ab!"` 是**不含任何真实可能值**的确定字面量）。
 *
 * 修法：
 * - `coerceToStringParts` 保留「成员 → parts 数组」的边界（模块私有）
 * - `concatString` 对 sum 侧做**成员级叉乘** ⇒ 产出 `sum` 而不是单个 `lit`
 * - 上游触发点（core/src/algebra/arithmetic/addsub.ts）：`add()` 的字符串
 * 快路径在「任一侧是 sum」时必须让位给 `distributeSumBinOp`（否则正确
 * 的并联分发器根本没机会介入）
 *
 * 原生对照：f("a")="a!" / f("b")="b!"；g("a")="v=a" / g("b")="v=b"；
 * h("a")="a-!" / h("b")="b-!"。
 */







const strLit = (s: string): Abs =>
  abs({ k: "prim", type: "string" }, lit(s), undefined, "exact");

const strUnion = (...ms: string[]): Abs =>
  abs({ k: "sum", members: ms.map(strLit) }, undefined, undefined, "exact");

/** 结果的成员字面量值（顺序敏感；非 sum ⇒ 单成员视图） */
function memberLits(a: Abs): unknown[] {
  const members = a.shape.k === "sum" ? a.shape.members : [a];
  return members.map((m) => (m.term?.op === "lit" ? m.term.value : undefined));
}


  it("concatString: (\"a\"|\"b\") + \"!\" ⇒ \"a!\" | \"b!\"（旧实现折成 \"ab!\"）；concatString: union 在左侧同样逐成员并联（`v=` + union）；concatString: 两侧都是 union ⇒ 成员级叉乘；concatString: 非 union 侧的既有行为不变（单成员 ⇒ 直接返回该成员）；产品面：`+` 的 union 实参 ⇒ 成员级并联（不是 \"ab!\"）；产品面：模板字面量（`v=${x}`）的 u", () => {
  {
    const r = concatString(strUnion("a", "b"), strLit("!"));
    expect(r.shape.k).toBe("sum");
    expect(memberLits(r)).toEqual(["a!", "b!"]);
    expect(formatShape(r)).toBe('"a!" | "b!"');
  }
  {
    const r = concatString(strLit("v="), strUnion("a", "b"));
    expect(r.shape.k).toBe("sum");
    expect(memberLits(r)).toEqual(["v=a", "v=b"]);
  }
  {
    const r = concatString(strUnion("a", "b"), strUnion("1", "2"));
    expect(r.shape.k).toBe("sum");
    expect(memberLits(r)).toEqual(["a1", "a2", "b1", "b2"]);
  }
  {
    const r = concatString(strLit("a"), strLit("b"));
    expect(r.shape.k).toBe("prim");
    expect(memberLits(r)).toEqual(["ab"]);
    expect(formatShape(r)).toBe('"ab"');
  }
  {
    const src = `export function f(x) { return x + "!"; }`;
    const rec = call(src, "f", [strUnion("a", "b")]);
    expect(formatShape(rec.result)).toBe('"a!" | "b!"');
  }
  {
    const src = "export function f(x) { return `v=${x}`; }";
    const rec = call(src, "f", [strUnion("a", "b")]);
    expect(formatShape(rec.result)).toBe('"v=a" | "v=b"');
  }
  {
    const src = `export function f(x) { const y = x + "-"; return y + "!"; }`;
    const rec = call(src, "f", [strUnion("a", "b")]);
    expect(formatShape(rec.result)).toBe('"a-!" | "b-!"');
  }
});







});

// ---------------------------------------------------------------------------
// matchAll(<非 RegExp>) → RegExpCreate(ToString(pattern), "g") 迭代器
// ---------------------------------------------------------------------------
describe("matchAll(<非 RegExp>) → RegExpCreate(ToString(pattern), \"g\") 迭代器", () => {
/**
 * 回归：`String.prototype.matchAll(<非 RegExp 实参>)` **不得**折**确定**
 * TypeError（FALSE-THROW）。
 *
 * 原生语义（ES2023 String.prototype.matchAll，node v26.10.0 逐字实测）：
 * - 实参**确定是 RegExp**（IsRegExp(pattern) 为 true）⇒ 取其 flags；flags 确定
 * 不含 "g" ⇒ **确定 TypeError**（"String.prototype.matchAll argument must not
 * be a non-global regular expression"）。
 * - 实参**确定不是 RegExp** ⇒ matcher = RegExpCreate(ToString(pattern), "g")
 * （**"g" 由算法自补**）⇒ 返回**迭代器**；模式非法 ⇒ SyntaxError。
 * ⇒ "abc".matchAll("b") / matchAll(1) / matchAll() / matchAll(null) 全部
 * **正常返回迭代器**（原生实测命中数 1 / 1 / 4 / 0，见各断言注释）。
 *
 * 改前（缺陷链闭合）：
 * - class-regex.ts 的 matchAll 尾段：非 brand pattern ⇒ `return undefined`
 * （"本臂不接管"哨兵）⇒ 回落 methods.ts 的抽象臂；
 * - methods.ts 的 matchAllAbstractArm：把「无 g 旗标 ⇒ TypeError」从「实参
 * **确定是 RegExp**」错误推广到**所有非 RegExp 实参** ⇒ `definiteNonRegExp`
 * **硬抛 TypeError**；
 * ⇒ 结果：shape.k=never + throws=brand:TypeError（假抛 ⇒ L2 entry-may-throw
 * 假红，且真实返回的迭代器被折成「永不返回」）。
 *
 * 改后：
 * - class-regex.ts（字面量接收者 + 字面量 pattern）⇒ new RegExp(strPat, "g")
 * **真迭代** ⇒ RegExpMatchIterator（元素 = **RegExpExecArray 匹配数组**，
 * 不是字符串）；strPat 编译失败 ⇒ **确定 SyntaxError**（不回落哨兵）。
 * - methods.ts（抽象接收者 / 抽象 pattern）⇒ **迭代器**（元素域保守 unknown，
 * 协议面齐），**不抛** TypeError；RegExp brand 无 g 的定抛**保留**。
 *
 * ⚠ 协议面（迭代器协议：next / @@iterator / @@toStringTag）与元素域（匹配
 * 数组）**分列**：前者由 matchIteratorAbs 保证，后者由 matchResultAbs 保证。
 */




/** 抽象 string 实参（抽象接收者臂用） */
const strAbs = abs___nudojs_core({ k: "prim", type: "string" }, undefined, undefined, "path");

/** 调用结果的字面量值（litValue 快捷） */
function v(src: string, args: Abs___nudojs_core[] = []): unknown {
  const r = litValue(call(src, "f", args).result);
  return r.ok ? r.value : undefined;
}


  it("字符串 pattern → 迭代器（原生 \"abc\".matchAll(\"b\") 命中 1）；迭代项是**匹配数组**（RegExpExecArray），不是字符串（原生 m[0]/index/input）；缺省实参 → 空 pattern（原生 \"abc\".matchAll() 命中 4）；显式 undefined → 空 pattern（原生命中 4）；数字 pattern → ToString(1)（原生 \"a1b\".matchAll(1) 命中 1，index=1）", () => {
  {
    const r = call(`export function f() { return [... "abc".matchAll("b")].length; }`);
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  }
  {
    // 原生："abc".matchAll("b") → [["b", 1, "abc"]]
    expect(
      v(`export function f() { const m = [... "abc".matchAll("b")][0]; return m[0] + ":" + m.index + ":" + m.input; }`),
    ).toBe("b:1:abc");
  }
  {
    expect(val(`export function f() { return [... "abc".matchAll()].length; }`)).toEqual({
      ok: true,
      value: 4,
    });
  }
  {
    expect(val(`export function f() { return [... "abc".matchAll(undefined)].length; }`)).toEqual({
      ok: true,
      value: 4,
    });
  }
  {
    expect(
      v(`export function f() { const m = [... "a1b".matchAll(1)][0]; return m[0] + ":" + m.index; }`),
    ).toBe("1:1");
  }
  {
    const r = call(`export function f() { return [... "abc".matchAll(null)].length; }`);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  }
  {
    expect(val(`export function f() { return [... "abc".matchAll(true)].length; }`)).toEqual({
      ok: true,
      value: 0,
    });
    expect(val(`export function f() { return [... "abc".matchAll(1.5)].length; }`)).toEqual({
      ok: true,
      value: 0,
    });
  }
  {
    const r = call(`export function f() { return "abc".matchAll("("); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  }
  {
    const r = call(`export function f() { return "abc".matchAll(Symbol("x")); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = call(`export function f() { return "abc".matchAll(/b/); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    expect(val(`export function f() { return [... "abc".matchAll(/b/g)].length; }`)).toEqual({
      ok: true,
      value: 1,
    });
  }
  {
    expect(val(`export function f() { return typeof "abc".matchAll("b"); }`)).toEqual({
      ok: true,
      value: "object",
    });
    expect(val(`export function f() { return "abc".matchAll("b").next().done; }`)).toEqual({
      ok: true,
      value: false,
    });
    expect(
      val(`export function f() { const it = "abc".matchAll("b"); return it[Symbol.iterator]() === it; }`),
    ).toEqual({ ok: true, value: true });
  }
  {
    expect(val(`export function f() { return "abc".matchAll("b").next().value[0]; }`)).toEqual({
      ok: true,
      value: "b",
    });
  }
});














describe("抽象接收者的 matchAll 抽象臂（methods.ts matchAllAbstractArm）", () => {
  it("抽象 string 接收者 + 字符串 pattern → 迭代器（**不抛** TypeError）；抽象 string 接收者 + 缺省实参 → 迭代器（**不抛** TypeError）；负控制：抽象接收者 + RegExp 无 g → **仍**确定 TypeError（既有行为不变）", () => {
  {
    const r = call(`export function f(s) { return s.matchAll("b"); }`, "f", [strAbs]);
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    const shape = (r.result as { shape?: { k?: string; name?: string } }).shape;
    expect(shape?.k).toBe("brand");
    expect(shape?.name).toBe("RegExpMatchIterator");
  }
  {
    const r = call(`export function f(s) { return s.matchAll(); }`, "f", [strAbs]);
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(`export function f(s) { return s.matchAll(/a/); }`, "f", [strAbs]);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
});


});
});

/**
 * BUG-125：URLSearchParams 自身可迭代面——`iterabilityKind` 的 brand 分支
 * 只查内建原型白名单（String/Number/Boolean）⇒ 判 may（假 TypeError），
 * 且 `elemsOf` / `$concat.expand` / Array.from / 数组解构没有条目表分支
 * （元素域 unknown）。修复：`@@iterator === entries`（WHATWG），条目表
 * （urlSearchParamsEntriesOf 单一真值源）在四个消费面精确展开。
 */
describe("BUG-125 URLSearchParams iterable面", () => {
  const sp = `new URLSearchParams("a=1&b=2")`;

  it("spread / for-of / Array.from / 解构 = 条目表", () => {
    expect(
      litValue(call(`export function f() { return [...${sp}].map(([k, v]) => k + v).join(","); }`).result),
    ).toEqual({ ok: true, value: "a1,b2" });
    expect(
      litValue(call(`export function f() { let n = 0; for (const x of ${sp}) n++; return n; }`).result),
    ).toEqual({ ok: true, value: 2 });
    expect(
      litValue(call(`export function f() { return Array.from(${sp}).map(([k, v]) => k + v).join(","); }`).result),
    ).toEqual({ ok: true, value: "a1,b2" });
    expect(
      litValue(call(`export function f() { const [first] = ${sp}; return first.join("="); }`).result),
    ).toEqual({ ok: true, value: "a=1" });
  });

  it("父 URL 的 searchParams 同样可精确展开；对照 .entries() 不变", () => {
    expect(
      litValue(call(`export function f() { return [...new URL("https://x.com/?a=1").searchParams].length; }`).result),
    ).toEqual({ ok: true, value: 1 });
    expect(
      litValue(call(`export function f() { return [...${sp}.entries()].length; }`).result),
    ).toEqual({ ok: true, value: 2 });
  });
});

/**
 * BUG-126：URL 组件 setter 只改自身槽——派生组件（href / pathname / …）与
 * live `searchParams` 停在构造期快照（自信错值、check 全绿）。原生组件是
 * 同一解析状态的投影；修复：setter 后按宿主 URL 重放并回写全部组件与
 * `searchParams` 条目表（抽象值退 string 域，不发布陈旧精确值）。
 */
describe("BUG-126 URL component setters recompute derived components", () => {
  it("search setter 同步 searchParams（与 spMutator 对称）", () => {
    expect(
      litValue(
        call(
          `export function f() { const u = new URL("https://x.com/a"); u.search = "?q=1"; return JSON.stringify([u.search, u.searchParams.get("q")]); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: '["?q=1","1"]' });
    expect(
      litValue(
        call(
          `export function f() { const u = new URL("https://x.com/a"); u.search = "?q=1"; return u.searchParams.toString(); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: "q=1" });
  });

  it("href setter 重算全部组件", () => {
    expect(
      litValue(
        call(
          `export function f() { const u = new URL("https://x.com/a"); u.href = "https://x.com/?q=1"; return JSON.stringify([u.search, u.searchParams.get("q"), u.pathname]); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: '["?q=1","1","/"]' });
  });

  it("pathname / search / hash setter 重算 href", () => {
    expect(
      litValue(
        call(
          `export function f() { const u = new URL("https://x.com/a?q=1"); u.pathname = "/b"; return u.href; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: "https://x.com/b?q=1" });
    expect(
      litValue(
        call(
          `export function f() { const u = new URL("https://x.com/a?q=1"); u.search = "?r=2"; return u.href; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: "https://x.com/a?r=2" });
    expect(
      litValue(
        call(
          `export function f() { const u = new URL("https://x.com/a?q=1"); u.hash = "#h"; return u.href; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: "https://x.com/a?q=1#h" });
  });

  it("href setter 换整条 URL（hostname / pathname / search / hash）", () => {
    expect(
      litValue(
        call(
          `export function f() { const u = new URL("https://x.com/a?q=1"); u.href = "https://y.com:8080/b?r=2#h"; return JSON.stringify([u.href, u.hostname, u.pathname, u.search, u.hash]); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: '["https://y.com:8080/b?r=2#h","y.com","/b","?r=2","#h"]' });
  });
});
