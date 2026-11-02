/**
 * 转译产物「内部名卫生」闭环守卫（评审 #5）。
 *
 * 被钉住的事故形态：引擎内部临时名（`__` 前缀）若**绕过分配器写死**，
 * 与用户标识符撞名有两种失效——遮蔽（自信错值 ⇒ 闸门假绿）或重复声明
 * （产物非法 JS ⇒ `new Function` SyntaxError ⇒ 整模块 fail-closed ⇒
 * L2 假绿）。Bug 1058 / 1059 / 1127 / 1146 / 1149 / 1151 / 1159 全是
 * 这一族。本守卫把防线从「运行时撞名才炸」前移到 CI：
 *
 * - 对语料逐个 `transpileSource` → 用 `parseSource` 解析**产物** → walk
 *   全部声明位（VariableDeclarator / 函数与类声明 id / 形参 / catch 参数
 *   / import 说明符 / 标签名）收集绑定名；
 * - 减去**源码自身**声明的同名绑定（用户写 `__foo` 是合法 JS，不算引擎名）；
 * - 断言剩余的 `__` 前缀名全部命中已知白名单（每项注明来源文件）。
 *
 * ⇒ 将来任何人新增写死 `__` 名（不走 internalTmpName 分配器 / 不登记
 * 白名单）在本测试红，而不是运行时撞名 → 整模块 fail-closed。
 *
 * 语料面：differential 批次全量（all-batches.ts 的 21+ 个批次，与差分门禁
 * 同源）+ 下方的模块级语料（fork/switch/try/循环/类/对象/成员路径/async/
 * import 等协议路径，差分语料是函数体片段、覆盖不到模块级发射）×
 * `{}` / `{ disableAsyncGen: true }` 两变体。
 */
import { describe, it, expect } from "vitest";
import { parseSource } from "../parse-source.ts";
import { transpileSource } from "../index.ts";
import * as batches from "./differential/all-batches.ts";
import { sectionsOf } from "./differential/harness.ts";

// ---- 白名单（单一维护点）------------------------------------------------
//
// 匹配规则：`^(?:条目)(_\\d+)?$`——`_\\d+` 是 internalTmpName / safeTmpName
// 撞名避让后缀（Bug 1058 / 181：`__this` → `__this_1`）。条目里的 `\\d+`
// 是发射序号（StmtEmitState / tryTmpSeq 计数器）。**新增 `__` 名必须**：
// 走分配器（internalTmpName / internalTmpNameSet / forkTmpNames /
// switchTmpNames）且在此登记条目 + 来源，否则本守卫红。
const AVOID_SUFFIX = "(_\\d+)?";
const entry = (body: string): RegExp => new RegExp(`^(?:${body})${AVOID_SUFFIX}$`);

/** [正则, 样例名, 来源] —— 样例用于自检正则没写坏（锚点 / 转义笔误）。 */
const KNOWN_INTERNAL_NAMES: ReadonlyArray<readonly [RegExp, string, string]> = [
  // ---- emit.ts：fork 协议分配器 forkTmpNames（Bug 1151-b）----
  [entry("__fk\\d+(_set)?_.+"), "__fk1_set_x", "emit.ts forkTmpNames（__fk<i>_<绑定名> / __fk<i>_set_<绑定名>）"],
  [entry("__cont|__fkT|__fkR|__fkCons|__fkArmMemo|__fkCopyMemo"), "__fkT", "emit.ts forkTmpNames 单例（cont/test/result/构造臂/memo）"],
  // ---- emit.ts：switch 协议分配器 switchTmpNames（Bug 1151-b）----
  // 注意臂 set 标志是 `__sw${i}set_${n}`（set 前**无**下划线——与 fork 族
  // `__fk${i}_set_${n}` 的历史形态不一致，勿「顺手统一」）。
  [entry("__sw\\d+(set)?_.+"), "__sw0_x", "emit.ts switchTmpNames（__sw<i>_<绑定名> / __sw<i>set_<绑定名>）"],
  [entry("__swD|__swR|__p"), "__p", "emit.ts switchTmpNames 单例（判别式/结果/join 数组 __p）"],
  // ---- stmt/statement.ts：switch 面（internalTmpName / internalTmpNameSet，Bug 1159）----
  [
    entry("__swT|__swTV|__swTD|__swAllDone|__swTestRead|__swEval|__swEvalAll|__swI|__swJ|__swArmMemo|__swCopyMemo|__swRefreshMemo"),
    "__swAllDone",
    "stmt/statement.ts switch 发射（case 测试机制 / 共享体 / memo）",
  ],
  // ---- 序号族（StmtEmitState 袋 + tryTmpSeq；statement.ts / fn-body.ts）----
  [entry("__swBody\\d+|__nudoSw\\d+|__fir\\d+|__nudoLv\\d+"), "__nudoSw0", "stmt/statement.ts + fn-body.ts（switch 共享体/标签/for-in 接收者/循环变量槽，StmtEmitState 序号）"],
  [entry("__nudoTm_\\d+|__nudoE_\\d+"), "__nudoTm_0", "stmt/statement.ts try 临时（tryTmpSeq 计数器）"],
  [entry("__(soft|cv|rethrow|post)___nudoTm_\\d+|__xs(___nudoTm_\\d+)?"), "__cv___nudoTm_0", "stmt/statement.ts try 软效果槽（`__<tag>_${markName}` 复合，markName=__nudoTm_<n>）"],
  // ---- stmt/statement.ts 杂项 ----
  [entry("__e"), "__e", "stmt/statement.ts:428 标签循环 break 重抛的 catch 绑定（写死）"],
  [entry("__lp"), "__lp", "stmt/statement.ts 循环 pack 载体"],
  [entry("__n"), "__n", "stmt/statement.ts 解构/序号基名"],
  [
    entry("__nudoRet|__nudoFnRet|__nudoDwFirst|__nudoDefaultFn|__nudoDefaultClass|__nudoNonCtor|__packCopyMemo"),
    "__nudoRet",
    "stmt/statement.ts + fn-body.ts（返回载体/默认导出名/非构造守卫/pack memo）",
  ],
  // ---- expr 家族 ----
  [entry("__v|__k"), "__v", "expr/object.ts V/K_BASE + class-emit.ts SETTER_V_BASE + expr/assignment.ts ASSIGN_V_BASE"],
  [entry("__nudoObjBase|__nudoProtoBox|__nudoP"), "__nudoObjBase", "expr/object.ts（__proto__ 载体 / proto 盒 / 计算键载体）"],
  [entry("__old|__test|__r|__sc\\d+"), "__sc0", "expr/operators.ts + short-circuit.ts + assignment.ts（旧值槽/测试载体/短路族 __sc<n>）"],
  [entry("__oc"), "__oc", "expr/optional-chain.ts 可选链载体"],
  [entry("__d"), "__d", "expr/assignment.ts 解构基名"],
  [entry("__nudoDelK|__nudoDelN|__nudoDelP|__nudoDelR"), "__nudoDelK", "expr/operators.ts + optional-chain.ts DEL_* 基名（delete 协议）"],
  [entry("__nudoDefR"), "__nudoDefR", "expr/call.ts DEF_R_BASE（默认参求值结果）"],
  [entry("__nudoReArgs"), "__nudoReArgs", "expr/call.ts + optional-chain.ts（rest 重排实参）"],
  [entry("__rest_raw|__mutRet|__allArgs|__nudoArgs|__margs"), "__rest_raw", "expr/function.ts + emit.ts + class-emit.ts（rest 原始/mutator 返回/实参族）"],
  [entry("__nudoMp(Root|Val|Old|New|Res|DelK)|__nudoMp[KCP]\\d+"), "__nudoMpK0", "member-path.ts（成员路径根/键/持有者/值/旧值/写回/delete 键）"],
  // ---- class-emit.ts ----
  [entry("__nab|__nabs"), "__nab", "class-emit.ts（new/absnew 载体）"],
  // ---- helpers.ts ----
  [entry("__this"), "__this", "helpers.ts thisCarrierOf（Bug 1160 this 载体基名）"],
];

// ---- 语料 ---------------------------------------------------------------

/**
 * 模块级语料：fork / switch / try / 循环 / 解构 / 类 / 对象字面量 / 成员
 * 路径 / async / import / CJS / this——差分语料是函数体片段，这些协议路径
 * 需要**模块顶层**发射才走到。
 */
const MODULE_CORPUS: readonly string[] = [
  // fork 协议（if/else/三元/短路/早退的自由写快照与 join）
  `export function f1(c, x) { let y = x; if (c) { y = y + 1; } else { y = y - 1; } return y; }`,
  `export function f2(c, x) { let y = x; if (c) { y = 1; } return y + 2; }`,
  `export function f3(c, x) { return c ? ((x = 1), x) : ((x = 2), x); }`,
  `export function f4(c, x) { return (c && (x = 1)) || (x = 2); }`,
  `export function f5(c) { if (!c) return null; let y = 2; return y; }`,
  // switch 协议（自由写 join + fallthrough + 共享体）
  `export function s1(x, v) { let y = v; switch (x) { case 1: y = 1; break; case 2: y = 2; break; default: y = 3; } return y; }`,
  `export function s2(x, v) { let y = v; switch (x) { case 1: y = 1; case 2: y = y + 1; break; } return y; }`,
  // 循环族（__nudoLv / __fir / 标签）
  `export function l1(n) { let s = 0; for (let i = 0; i < n; i++) { s += i; } return s; }`,
  `export function l2(o) { let r = null; for (const k in o) { r = k; } return r; }`,
  `export function l3(xs) { let s = 0; for (const x of xs) { s += x; } return s; }`,
  `export function l4(n) { let i = 0; while (i < n) { i++; } return i; }`,
  `export function l5(n) { let i = 0; do { i++; } while (i < n); return i; }`,
  `export function l6(xs) { outer: for (const x of xs) { for (const y of x) { if (y) continue outer; break outer; } } return 1; }`,
  // try 族（__nudoTm_ / __nudoE_ / __soft___nudoTm_ 复合槽）
  `export function t1() { try { g(); } catch (e) { return 1; } finally { h(); } }`,
  `export function t2() { try { try { g(); } finally { h(); } } catch (e) { throw e; } }`,
  `export function t3(x) { try { return x; } catch { return 2; } }`,
  // 解构 / rest / 默认值
  `export function d1({ a, b: { c } }, [dd, ...e] = [], f2 = 2, ...rest) { return [a, c, dd, e, f2, rest]; }`,
  // 类（私有/静态/静态块/访问器/计算成员/继承/super/NamedEvaluation）
  `class A { #x = 1; static s = 2; static { A.t = 1; } get g() { return 1; } set g(v) { this.#x = v; } [Symbol.iterator]() { return this; } }`,
  `class B extends A { constructor() { super(); } m() { return super.m; } static m2() { return super.m2; } }`,
  `export const C = class Named { m() { return Named; } };`,
  // 对象字面量（__proto__ / spread / 计算键 / 访问器 / 异步与生成器方法）
  `export const o1 = { __proto__: pp, a: 1, ...spread1, [kk]: 2, get b() { return 2; }, set b(v) {}, async am() { return 1; }, *gm() { yield 1; } };`,
  // 成员路径 / 复合赋值 / 自增 / delete
  `export function m1(o, k, v) { o.a.b[k] = v; delete o.a?.[k]; delete o.p?.q; o[k] += 1; o[k]++; return o; }`,
  // async / for await / async generator / generator（双变体跑）
  `export async function a1(x) { const y = await x; return y; }`,
  `export async function a2(o) { return o.m(await 1); }`,
  `export async function a3(it) { for await (const x of it) { g(x); } }`,
  `export async function* a4(x) { yield await x; }`,
  `export function* g1() { yield 1; yield* xs; }`,
  // this 载体（__this）
  `export const obj = { m() { return this.x; }, n() { return () => this.m(); } };`,
  // import / export / CJS 面
  `import { a, b as c } from "./m.js"; import dd from "./n.js"; import * as ns from "./p.js"; export const e = a + c + dd + ns.q;`,
  `export default function df() { return 1; }`,
  `const a2 = 1; export { a2 as r };`,
  `const mod = require("./cjs.js"); module.exports = mod;`,
  // arguments / 杂项
  `export function ar() { return arguments.length; }`,
  `export const tpl = \`a\${1 + 2}b\`; export const rgx = /ab+c/g;`,
];

/**
 * 摘录自 __tests__/runtime-import-surface.test.ts 的 CORPUS（该文件未导出；
 * 摘录覆盖差分语料没有的构造：import 绑定再赋值 / 自由 arguments /
 * import.meta / 动态 import / 稀疏数组）。**快照摘录**——不要求与源文件
 * 同步，本守卫只关心 `__` 前缀声明位，语料漂移不影响守卫语义。
 */
const CORPUS_EXCERPT: readonly string[] = [
  `import {k} from "./m.js"; k = 1;`,
  `import {k} from "./m.js"; function f() { k ||= 1; }`,
  `const f = () => arguments.length;`,
  `const u = import.meta.url;`,
  `async function f() { return await import("./x.js"); }`,
  `const a = [1, , 3]; const b = [...xs];`,
  `function f(x) { if (typeof x === "string") return x; if (x != null) return x; return 1; }`,
  `const o = { a: 1, m() { return this.a; }, get b() { return 2; }, ...rest };`,
  `function f() { try { g(); } catch { h(); } }`,
  `export function f() { return 1; } export const k = 2; export default 3;`,
];

const OPTION_VARIANTS = [{}, { disableAsyncGen: true }] as const;

// ---- 产物声明位收集 -----------------------------------------------------

type AnyNode = Record<string, unknown> & { type: string };
const SKIP_KEYS = new Set(["loc", "start", "end", "leadingComments", "trailingComments", "range"]);

function isNode(v: unknown): v is AnyNode {
  return !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as AnyNode).type === "string";
}

/** 绑定模式（形参 / 解构）→ 名字。 */
function patternNames(p: unknown, out: Set<string>): void {
  if (!isNode(p)) return;
  switch (p.type) {
    case "Identifier":
      out.add(p.name as string);
      return;
    case "ObjectProperty":
      patternNames(p.value, out);
      return;
    case "ObjectPattern":
      for (const prop of (p.properties as unknown[]) ?? []) patternNames(prop, out);
      return;
    case "ArrayPattern":
      for (const el of (p.elements as Array<unknown>) ?? []) if (el) patternNames(el, out);
      return;
    case "AssignmentPattern":
      patternNames(p.left, out);
      return;
    case "RestElement":
      patternNames(p.argument, out);
      return;
    default:
      return;
  }
}

const FUNC_LIKE = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

/**
 * 全部**声明位**绑定名：VariableDeclarator id / 函数与类声明 id / 函数形参
 * / catch 参数 / import 说明符 local / 标签名（标签不是绑定，但同属引擎
 * 引入 `__` 名的位置——`__nudoSw<n>` 是标签）。非声明位的引用（`__v` 读
 * 点、`$assignRecord` 调用等）不收集。
 */
function collectBindingNames(root: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    if (!isNode(n)) return;
    switch (n.type) {
      case "VariableDeclarator":
        patternNames(n.id, out);
        break;
      case "FunctionDeclaration":
      case "ClassDeclaration":
      case "ClassExpression":
        if (isNode(n.id) && n.id.type === "Identifier") out.add(n.id.name as string);
        break;
      case "CatchClause":
        patternNames(n.param, out);
        break;
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
        patternNames(n.local, out);
        break;
      case "LabeledStatement":
        if (isNode(n.label) && n.label.type === "Identifier") out.add(n.label.name as string);
        break;
      default:
        break;
    }
    if (FUNC_LIKE.has(n.type)) {
      for (const p of (n.params as unknown[]) ?? []) patternNames(p, out);
    }
    for (const [k, v] of Object.entries(n)) {
      if (SKIP_KEYS.has(k)) continue;
      walk(v);
    }
  };
  walk(root);
  return out;
}

function isKnownInternalName(name: string): boolean {
  return KNOWN_INTERNAL_NAMES.some(([re]) => re.test(name));
}

/** 单条语料的检查结果：引擎引入的未知 `__` 名（应恒空）。 */
function unknownInternalNamesOf(src: string, opts: Record<string, unknown>): string[] {
  const out = transpileSource(src, { source: src, ...opts });
  const productNames = collectBindingNames(parseSource(out));
  const srcNames = collectBindingNames(parseSource(src));
  return [...productNames].filter((n) => n.startsWith("__") && !srcNames.has(n) && !isKnownInternalName(n)).sort();
}

// ---- 守卫 -----------------------------------------------------------------

describe("转译产物内部名卫生（__ 前缀声明位 ⊆ 已知白名单）", () => {
  it("白名单自检：每条正则命中自己的样例（锚点/转义笔误即红）", () => {
    for (const [re, sample] of KNOWN_INTERNAL_NAMES) {
      expect(re.test(sample), `${re} 应命中样例 ${sample}`).toBe(true);
    }
    // 避让后缀形态（Bug 1058/181：撞名 → 基名_1）也必须命中
    expect(isKnownInternalName("__this_1")).toBe(true);
    expect(isKnownInternalName("__fk0_x_2")).toBe(true);
    // 两族 set 标志的历史形态（fork 带 _、switch 不带——见上）都必须命中
    expect(isKnownInternalName("__fk1_set_x")).toBe(true);
    expect(isKnownInternalName("__sw1set_x")).toBe(true);
    // 未登记的**新**名必须红（守卫的检出面自检）
    expect(isKnownInternalName("__oopsTmp")).toBe(false);
    expect(isKnownInternalName("__swNewThing")).toBe(false);
  });

  it("模块级语料：协议路径的内部名全部在白名单（双变体）", () => {
    const unknown: string[] = [];
    for (const src of [...MODULE_CORPUS, ...CORPUS_EXCERPT]) {
      for (const opts of OPTION_VARIANTS) {
        unknown.push(...unknownInternalNamesOf(src, opts).map((n) => `${n} @ ${src.slice(0, 48)}`));
      }
    }
    expect(unknown, `未登记的引擎内部名（走分配器并更新白名单）：\n${unknown.join("\n")}`).toEqual([]);
  });

  const batchMods = Object.entries(batches) as Array<[string, Record<string, unknown>]>;

  it("差分语料批次存在且非空（守卫不空转的前提）", () => {
    expect(batchMods.length).toBeGreaterThanOrEqual(20);
    let bodies = 0;
    for (const [, mod] of batchMods) {
      for (const [, corpus] of sectionsOf(mod)) bodies += corpus.length;
    }
    // 2026-11 基线 ≈ 9470 条；显著收缩 = 语料被误删
    expect(bodies).toBeGreaterThan(5000);
  });

  describe("差分批次逐批", () => {
    let engineNameSites = 0;
    const uniqueNames = new Set<string>();
    const transpileFailures = new Map<string, number>();

    for (const [batchName, mod] of batchMods) {
      it(`${batchName}：产物 __ 声明位 ⊆ 白名单`, () => {
        const unknown: string[] = [];
        for (const [section, corpus] of sectionsOf(mod)) {
          for (const body of corpus) {
            // 与差分 harness 同款包裹（export function ⇒ ESM strict）
            const src = `export function __run() {\n${body}\n}`;
            let names: string[];
            try {
              names = [...collectBindingNames(parseSource(transpileSource(src, { source: src })))];
            } catch {
              // 少数差分语料本身不是合法 JS（两侧都抛、差分门禁按 THROW 对账）
              // ——按节计数钉住，新增失败（引擎回归 fail-closed）也会红。
              transpileFailures.set(section, (transpileFailures.get(section) ?? 0) + 1);
              continue;
            }
            const srcNames = collectBindingNames(parseSource(src));
            for (const n of names) {
              if (!n.startsWith("__") || srcNames.has(n)) continue;
              engineNameSites++;
              uniqueNames.add(n);
              if (!isKnownInternalName(n)) unknown.push(`${n} @ [${section}] ${body.slice(0, 60)}`);
            }
          }
        }
        expect(unknown, `未登记的引擎内部名：\n${unknown.join("\n")}`).toEqual([]);
      }, 60_000);
    }

    // 统计断言放同一个 describe 里借执行顺序（it 按序跑）——防语料退化成
    // 空集时上面的批次断言假绿。
    it("覆盖面统计：__ 声明位与唯一名非空转", () => {
      // 2026-11 基线：声明位 ≈ 7800、唯一名 ≈ 190
      expect(engineNameSites).toBeGreaterThan(3000);
      expect(uniqueNames.size).toBeGreaterThan(120);
      // 已知的差分语料解析失败节（本身不是合法 JS；新增失败 = 引擎回归）
      expect(Object.fromEntries(transpileFailures)).toEqual({
        corpus13: 1,
        stmtEdge: 1,
        regex16: 1,
        assignB: 1,
        corpus6: 1,
      });
    });
  });
});
