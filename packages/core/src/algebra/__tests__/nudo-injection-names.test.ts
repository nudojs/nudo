/**
 * `__nudo*` 注入名 / 生成码局部名漂移守卫（runtime-import-surface 式钉法）。
 *
 * 引擎在生成码里使用两类 `__nudo*` 名字：
 * 1. **注入名**（12 个）：run.ts 以 NUDO_HOST_ARG_NAMES 作为模块体 new Function
 *    的**形参面**（实参按同序供给）；发射器在生成码里按名引用（`__nudoBindImport(…)`、
 *    `__nudoExportLazy(…)`、require 改写 `__nudoRequire(…)`…）。静默改名任一侧
 *    = 生成码 ReferenceError ⇒ 整模块 fail-closed（无诊断）——此前名单是真值
 *    但零守卫。
 * 2. **局部名**：发射器自分配的内部临时量 / 槽位 / 属性键（`__nudoTm_0`、
 *    `__nudoMpRoot`、`__nudoNonCtor`…）。撞用户标识符时经 internalTmpName 加
 *    `_\d+` 后缀避让（Bug 1058/1059/1127），序号族（`__nudoLv2`、`__nudoSw0_1`）
 *    带位序。
 *
 * 本测试四层钉：
 * - 名单恒等：NUDO_HOST_ARG_NAMES 与 12 名字面清单逐项同序（防手改真值源；
 *   序错位 = 实参错位）；
 * - 名单归类：每个注入名要么在「转译产物发射面」要么在「run.ts 包装层独占」
 *   （差集显式钉住——新增名必须显式归类）；
 * - 语料漂移：差分语料 + crafted 模块形态 × 4 变体的 transpileSource 产物里
 *   每个 `__nudo[A-Za-z0-9_]+` 出现 ∈ 注入名 ∪ 局部名白名单；
 * - 不空转：语料必须真的触发关键族（否则守卫退化）。
 */
import { describe, expect, it } from "vitest";
import { transpileSource } from "../exec/transpile.ts";
import { NUDO_HOST_ARG_NAMES } from "../exec/run.ts";
import * as allBatches from "./differential/all-batches.ts";

/** 转译产物里**发射器按名引用**的注入名（host 形参的真值消费面） */
const EMITTED_HOST_ARGS: readonly string[] = [
  "__nudoBindImport",
  "__nudoBindNamespace",
  "__nudoRegisterImportRefresh",
  "__nudoRequire",
  "__nudoRequireOptional",
  "__nudoExport",
  "__nudoExportLazy",
  "__nudoExportStar",
];

/** run.ts 模块包装 / 绑定注入层独占的注入名（transpileSource 产物恒不出现） */
const WRAPPER_ONLY_HOST_ARGS: readonly string[] = [
  "__nudoModules", // 模块图（hostArgs 直供，无发射器引用）
  "__nudoReplaces", // @nudo:replace 注入表（run.ts 拼 `const n = __nudoReplaces[n]`）
  "__nudoEnv", // env/mock 合并表（run.ts 拼 `let k = __nudoEnv[k]`）
  "__nudoExports", // 动态导出表（run.ts 末尾 ret 骨架消费）
];

/**
 * 生成码**局部名**基名（实际名可带 `_\d+` 避让后缀）。发射点：
 * - run.ts 模块单元骨架：__nudoRet / __nudoK / __nudoGet / __nudoV / __nudoD /
 *   __nudoSlot / __nudoHidden / __nudoCjsOrig / __nudoCjsThis；
 * - statement.ts / fn-body.ts：__nudoArgs（arguments 槽）/ __nudoFnRet（函数体
 *   catch 载体）/ __nudoRet（try 内 return 载体）/ __nudoDwFirst（do-while 首轮
 *   标记）/ __nudoDefaultFn / __nudoDefaultClass（匿名默认导出合成名）/
 *   __nudoNonCtor（函数声明非构造标记属性）；
 * - call.ts：__nudoDefR / __nudoReArgs；optional-chain.ts：__nudoDelP / __nudoDelK /
 *   __nudoDelN / __nudoDelR；operators.ts：__nudoDelP / __nudoDelK / __nudoDelD；
 * - member-path.ts / assignment.ts：__nudoMp* 族（Root/Val/Old/New/Res/DelK/Obj/Key）；
 * - object.ts：__nudoObjBase / __nudoProtoBox；transpile.ts：__nudoRefreshKeep
 *   （live import refresh 的模块域强持有）。
 */
const LOCAL_BASES: readonly string[] = [
  "__nudoRet",
  "__nudoK",
  "__nudoGet",
  "__nudoV",
  "__nudoD",
  "__nudoSlot",
  "__nudoHidden",
  "__nudoCjsOrig",
  "__nudoCjsThis",
  "__nudoArgs",
  "__nudoFnRet",
  "__nudoDwFirst",
  "__nudoDefaultFn",
  "__nudoDefaultClass",
  "__nudoDefR",
  "__nudoReArgs",
  "__nudoDelP",
  "__nudoDelK",
  "__nudoDelD",
  "__nudoDelN",
  "__nudoDelR",
  "__nudoObjBase",
  "__nudoProtoBox",
  "__nudoNonCtor",
  "__nudoRefreshKeep",
];

/** 带位序的局部名族（正则锚定：前缀 + 数字 + 可选 `_\d+` 避让后缀） */
const LOCAL_FAMILIES: readonly RegExp[] = [
  /^__nudoTm_\d+(?:_\d+)?$/, // try 标记（statement.ts）
  /^__nudoE_\d+(?:_\d+)?$/, // catch 载体（statement.ts）
  /^__nudoLv\d+(?:_\d+)?$/, // for 主路径循环变量捕获槽（statement.ts）
  /^__nudoSw\d+(?:_\d+)?$/, // switch break 标签（statement.ts）
  /^__nudoMp[A-Za-z0-9]*(?:_\d+)?$/, // 成员路径临时量族（member-path.ts / assignment.ts，含 K{i}/C{i}/P{i}）
  /^__nudoP\d+$/, // proto 段链属性键（object.ts，JSON 字符串键——无避让后缀）
];

/** 生成码词形 ∈ 注入名 ∪ 局部名白名单？ */
function isKnownNudoName(tok: string): boolean {
  if ((NUDO_HOST_ARG_NAMES as readonly string[]).includes(tok)) return true;
  if (LOCAL_BASES.some((b) => tok === b || new RegExp(`^${b}_\\d+$`).test(tok))) return true;
  return LOCAL_FAMILIES.some((re) => re.test(tok));
}

/** 生成代码里的 `__nudo*` 词形（跳过注释行——与 runtime-import-surface 同口径）。 */
function emittedNudoNames(code: string): Set<string> {
  const out = new Set<string>();
  for (const line of code.split("\n")) {
    if (/^\s*\/\//.test(line)) continue;
    for (const m of line.matchAll(/__nudo[A-Za-z0-9_]+/g)) out.add(m[0]);
  }
  return out;
}

describe("__nudo* 注入名 / 生成码局部名漂移守卫", () => {
  it("注入名单单一真值源：NUDO_HOST_ARG_NAMES 与 12 名字面清单同序恒等", () => {
    // 顺序也是契约：hostArgs 按同序 map 供给实参——序错位 = 值错位（无诊断）。
    expect([...NUDO_HOST_ARG_NAMES]).toEqual([
      "__nudoModules",
      "__nudoBindImport",
      "__nudoBindNamespace",
      "__nudoRegisterImportRefresh",
      "__nudoReplaces",
      "__nudoRequire",
      "__nudoRequireOptional",
      "__nudoEnv",
      "__nudoExport",
      "__nudoExportLazy",
      "__nudoExportStar",
      "__nudoExports",
    ]);
    expect(new Set(NUDO_HOST_ARG_NAMES).size).toBe(NUDO_HOST_ARG_NAMES.length);
  });

  it("每个注入名显式归类：发射面 ∪ 包装层独占 = 名单（差集双向钉住）", () => {
    const classified = new Set([...EMITTED_HOST_ARGS, ...WRAPPER_ONLY_HOST_ARGS]);
    const inList = new Set(NUDO_HOST_ARG_NAMES);
    const unclassified = [...inList].filter((n) => !classified.has(n)).sort();
    expect(unclassified, `注入名未归类：${unclassified.join(", ")}`).toEqual([]);
    const notInList = [...classified].filter((n) => !inList.has(n)).sort();
    expect(notInList, `归类集合里的名字不在注入名单：${notInList.join(", ")}`).toEqual([]);
    // 两个归类集合不相交（同属两侧 = 分类失效）
    expect(EMITTED_HOST_ARGS.filter((n) => WRAPPER_ONLY_HOST_ARGS.includes(n))).toEqual([]);
  });

  it("transpileSource 产物里的每个 __nudo* 词形都在白名单（语料漂移守卫）", () => {
    const emitted = new Set<string>();
    let transpiled = 0;
    for (const src of corpusSources()) {
      for (const opts of OPTION_VARIANTS) {
        let code: string;
        try {
          code = transpileSource(src, opts);
        } catch {
          continue; // 语料里 unsupported 形态由差分/eval 门禁负责（此处只扫产物）
        }
        transpiled++;
        for (const n of emittedNudoNames(code)) emitted.add(n);
      }
    }
    // 语料没有整体退化成「全部 unsupported」（否则本守卫空转）
    expect(transpiled).toBeGreaterThan(1000);
    const unknown = [...emitted].filter((n) => !isKnownNudoName(n)).sort();
    expect(
      unknown,
      `发射了白名单外的 __nudo* 名（新发射点必须显式归类 LOCAL_BASES/LOCAL_FAMILIES 或注入名）：${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("语料覆盖不空转：关键注入名与局部名族必须真的出现", () => {
    const emitted = new Set<string>();
    for (const src of corpusSources()) {
      for (const opts of OPTION_VARIANTS) {
        try {
          for (const n of emittedNudoNames(transpileSource(src, opts))) emitted.add(n);
        } catch {
          /* unsupported 语料不在本层负责 */
        }
      }
    }
    // 8 个发射器引用的注入名全部要被语料触发（host target 变体承担模块面）
    for (const n of EMITTED_HOST_ARGS) {
      expect(emitted.has(n), `语料未触发注入名 ${n}（扩展 crafted 语料或查发射点）`).toBe(true);
    }
    // 局部名各族至少一个代表（序号族按前缀判定）
    const mustSee: readonly [string, string][] = [
      ["__nudoTm_0", "try 标记"],
      ["__nudoE_0", "catch 载体"],
      ["__nudoRet", "try return 载体/导出骨架"],
      ["__nudoArgs", "arguments 槽"],
      ["__nudoFnRet", "函数体 catch 载体"],
      ["__nudoLv0", "for 循环变量捕获槽"],
      ["__nudoSw0", "switch break 标签"],
      ["__nudoDwFirst", "do-while 首轮标记"],
      ["__nudoMpRoot", "成员路径临时量族"],
      ["__nudoMpObj", "不可重绑根复合赋值临时量"],
      ["__nudoReArgs", "rest 实参载体"],
      ["__nudoDefR", "默认结果载体"],
      ["__nudoDelP", "delete 载体族"],
      ["__nudoDelD", "不可重绑根 delete 载体"],
      ["__nudoObjBase", "动态计算键访问器仲裁载体"],
      ["__nudoNonCtor", "函数声明非构造标记"],
      ["__nudoDefaultFn", "匿名默认导出合成名"],
      ["__nudoProtoBox", "proto 段链载体"],
      ["__nudoRefreshKeep", "live import refresh 持有"],
    ];
    for (const [name, what] of mustSee) {
      expect(emitted.has(name), `语料未触发局部名 ${name}（${what}）`).toBe(true);
    }
  });
});

const OPTION_VARIANTS: readonly object[] = [
  {},
  { recordPositions: true },
  { target: "host" },
  { disableAsyncGen: true },
] as const;

/** crafted 模块形态：注入名/局部名的发射触发面（import/export/require/try/
 *  for-of/class/private/匿名默认导出/计算键/可选拈 require…）。 */
const CRAFTED: readonly string[] = [
  // 模块面：import / export / re-export / star / default / namespace / 动态 import
  `import { a, b as c } from "./m.js"; import d from "./m.js"; import * as ns from "./m.js";\nexport const k = a + c + d + ns.x;`,
  `export { a, b } from "./m.js"; export * from "./n.js"; export * as ns2 from "./p.js";`,
  `export default function f() { return 1; }`,
  `export default function () { return 2; }`,
  `export default class {}`,
  `export default class K {}\nexport let live = 1; export function bump() { live = 2; }`,
  `import { a } from "./m.js";\nexport { a as re };`,
  // CJS：require / 可选 require / exports 面 / 顶层 this
  `const p = require("path"); const j = p.join("a", "b"); exports.r = j;`,
  `let m;\ntry { m = require("a"); } catch { m = require("b"); }\nexport const mm = m;`,
  `module.exports = { a: 1, b: 2 };`,
  `this.top = 1; exports.x = this.top;`,
  // try/catch/finally（标记/载体）+ do-while + for 族 + switch + 标签
  `export function f() { try { g(); } catch (e) { return e; } finally { h(); } }`,
  `export function f() { try { if (x) return 1; } catch { return 2; } }`,
  `export function f(xs, o) { for (const x of xs) { if (x) continue; } for (const k in o) { void k; } for (let i = 0; i < 3; i++) { void i; } let j = 0; do { j--; } while (j > 0); switch (j) { case 0: break; default: break; } }`,
  `outer: for (const x of xs) { for (const y of x) { continue outer; } }`,
  // 解构（成员目标 / 默认值 / 嵌套 / 不可重绑根回退臂）
  `export function f(o, src) { ({ a: o.x, b: [o.y, { c: o.z } = {}] } = src); }`,
  `export function f(getO, src) { [getO().x, getO()[0], getO()["s"], getO()[kk()]] = src; }`,
  // symbol 键写 / 计算 / 私有 / super / arguments / 生成器 / async
  `export function f(o, v) { o[Symbol.iterator] = v; o[k] = v; }`,
  `class A { #x = 1; m(v) { this.#x = v; } static #s = 2; static sm() { return A.#s; } }`,
  `class B extends Object { m(v) { super.x = v; return super.toString(); } }`,
  `export function f() { return arguments.length; }`,
  `export function* g() { yield 1; yield* [2, 3]; try { yield 4; } finally { yield 5; } }`,
  `export async function f(x) { const y = await x; return y; }`,
  // 数组 mutator / 可选链 / delete（含不可重绑根）/ in / instanceof
  `export function f(a, o) { a.push(1); a.pop(); a.splice(0, 1); a.reverse(); a.fill(0); a.copyWithin(0, 1); a.sort(); return a.concat([1], a.with(0, 9)); }`,
  `export function f(o) { return o?.a?.[k]?.() ?? o?.b; }`,
  `export function f(o, k) { delete o[k]; delete o?.x; const d = delete getO().x; return (k in o) + d; }`,
  // 复合计算键成员赋值（__nudoMpKey / __nudoMpObj）与表达式位 delete（__nudoDelD）
  `export function f(o, k, v) { o[k] += 1; getO()[k] *= 2; return v; }`,
  // 对象字面量：计算键 / 动态计算键访问器 / __proto__ 段链 / 方法 / 访问器
  `export const o = { [k]: 1, [k2]() { return this[k]; }, __proto__: base, m() { return 2; } };`,
  `export const o = { get [ka]() { return 1; }, [kb]: 2, set [kc](v) { void v; }, [kd]: 4 };`,
  // defineProperty / defineProperties / Object.assign
  `export function f(o) { Object.defineProperty(o, "x", { value: 1 }); Object.defineProperties(o, { y: { value: 2 } }); Object.assign(o, { z: 3 }); return o; }`,
  // 用户撞名 __nudo* 临时名（避让后缀面：引擎临时量加 _N）
  `const __nudoMpRoot = 1, __nudoArgs = 2, __nudoRet = 3, __nudoLv0 = 4, __nudoSw0 = 5, __nudoTm_0 = 6, __nudoE_0 = 7; export function f(o, v) { o.x = v; o[k] = v; try { g(); } catch (e) { return __nudoRet; } for (const q of qs) { switch (q) { case 1: break; } } return __nudoMpRoot + __nudoArgs; }`,
  // 顶层 await / import.meta
  `export const u = import.meta.url;`,
  `async function top() { return await import("./x.js"); }\nexport { top };`,
];

function corpusSources(): string[] {
  const bodies: string[] = [];
  for (const mod of Object.values(allBatches)) {
    for (const v of Object.values(mod as Record<string, unknown>)) {
      if (Array.isArray(v)) bodies.push(...(v as string[]));
    }
  }
  // 差分语料是语句体（隐式 return）——与差分 harness 同形包装成模块函数
  return [...bodies.map((b) => `export function __run() {\n${b}\n}`), ...CRAFTED];
}
