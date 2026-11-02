/**
 * async-plan 判定表 ↔ 发射侧**对齐守卫**（评审 #6；钉 Bug 1139 类事故）。
 *
 * 事故形态：async 体的真挂起靠宿主生成器（`$asyncGen(function*(){…})` +
 * `await` 发射裸 `yield`）实现 ⇒ `yield` 必须落在生成器**体内联**位置。
 * `async-plan.ts` 的 await 位置表一旦与转译侧的 thunk 边界（分支臂 / 循环
 * 体 / 短路右臂 / 成员调用实参 / 成员赋值 / 循环判别式 / case 测试 / 早退
 * 守卫后续语句…）脱节，`yield` 落进嵌套箭头 ⇒ `new Function` SyntaxError
 * ⇒ **整个模块**编译失败 ⇒ 全部导出丢失 ⇒ L2 闸门零诊断 exit 0 **假绿**。
 *
 * 本守卫对 async-plan.ts 头注释列出的**全部 thunk 位形态**（每形态一条
 * 含 await 的样例）+ 全部 gen 级形态逐个：
 *
 * 1. `transpileSource`（**不开** disableAsyncGen）；
 * 2. 剥 runtime import 行（`RUNTIME_IMPORT_RE`——单一真值源）与 `export `
 *    前缀后经 `compileRuntimeModuleUnit` 编译（**编译即足够，不执行**——
 *    与 run.ts 模块体同口径：`$` 前缀运行时符号以形参注入）；
 * 3. 断言**编译通过**（双模式都跑：默认生成器模式 + disableAsyncGen 安全
 *    网模式），并按形态钉住**判定方向**（防守卫退化成「全都回落同步路径
 *    也绿」的空转）：
 *    - `gen`：生成器路径激活（`$asyncGen(` + 裸 `yield` ≥ 1）；
 *    - `fallback`：该体判定不可整体走生成器 ⇒ 无 `$asyncGen` / 裸 `yield`
 *      （`await` 退化为 `$await` 同步近似；无 await 表达式的 thunk 级
 *      for await 连 `$await` 也没有——同步驱动不发门）；
 *    - `mixed`：同文件多函数，两路径并存。
 *
 * 与 core-bug-1139-await-position-compile-fail.test.ts 的关系：该测试钉
 * Bug 1139 修复的回归面（表达式/语句位矩阵 + L2 闸门面）；本守卫按
 * async-plan.ts **头注释的形态清单**逐位对齐（含 for await 三级位置 /
 * 嵌套 async 边界 / async 生成器声明 / 双模式 / 方向钉），两侧语料独立
 * 维护——判定表加新臂时两处都要补样例。
 */
import { describe, it, expect } from "vitest";
import { transpileSource } from "../index.ts";
import { compileRuntimeModuleUnit } from "../exec/rt.ts";
import { RUNTIME_IMPORT_RE } from "../exec/transpile/runtime-import.ts";

/** 形态的预期判定方向（见文件头注释 3.）。 */
type Level = "gen" | "fallback" | "mixed";

/**
 * await 位置 × 预期方向。来源：transpile/async-plan.ts 头注释的判定口径
 * 清单（thunk 位全列 + gen 位抽样），每形态一条含 await（或 for await）
 * 的最小样例。
 */
const ASYNC_SHAPES: ReadonlyArray<readonly [string, string, Level]> = [
  // ---- thunk 位（async-plan.ts 头注释逐项）----
  ["if 臂", `export async function f(c) { if (c) { return await 1; } return 2; }`, "fallback"],
  ["if-else 臂", `export async function f(c) { if (c) { return await 1; } else { return await 2; } }`, "fallback"],
  ["for 循环体", `export async function f(n) { for (let i = 0; i < n; i++) { g(await i); } }`, "fallback"],
  ["for-of 循环体", `export async function f(xs) { for (const x of xs) { g(await x); } }`, "fallback"],
  ["while 循环体", `export async function f(n) { while (n--) { g(await n); } }`, "fallback"],
  ["短路右臂 ||", `export async function f(c) { return c || (await 1); }`, "fallback"],
  ["短路右臂 &&", `export async function f(c) { return c && (await 1); }`, "fallback"],
  ["短路右臂 ??", `export async function f(c) { return c ?? (await 1); }`, "fallback"],
  ["三元两臂", `export async function f(c) { return c ? await 1 : await 2; }`, "fallback"],
  ["成员调用实参", `export async function f(o) { return o.m(await 1); }`, "fallback"],
  ["成员赋值右值", `export async function f(o) { o.x = await 1; }`, "fallback"],
  ["成员赋值计算键", `export async function f(o, k) { o[k] = await 1; }`, "fallback"],
  ["成员复合赋值", `export async function f(o) { o.x += await 1; }`, "fallback"],
  ["成员自增计算键", `export async function f(o) { o[await 1]++; }`, "fallback"],
  ["逻辑赋值右值", `export async function f(x) { x ||= await 1; }`, "fallback"],
  ["while 判别式", `export async function f(n) { while (n < await 1) { break; } }`, "fallback"],
  ["do-while 判别式", `export async function f(n) { do { break; } while (n < await 1); }`, "fallback"],
  ["for 判别式/步进式", `export async function f(n) { for (; n < await 1; g(2)) { break; } }`, "fallback"],
  ["case 测试", `export async function f(x) { switch (x) { case await 1: break; default: break; } }`, "fallback"],
  ["早退守卫后续语句", `export async function f(c) { if (!c) return null; const x = await 1; return x; }`, "fallback"],
  ["早抛守卫后续语句", `export async function f(c) { if (!c) throw new Error("x"); return await 1; }`, "fallback"],
  // ---- for await 三级位置 ----
  ["for await 生成器级（发挂起门）", `export async function f(it) { for await (const x of it) { g(x); } }`, "gen"],
  ["for await 在 if 臂（thunk 级）", `export async function f(c, it) { if (c) { for await (const x of it) { g(x); } } }`, "fallback"],
  ["for await 在循环体（thunk 级）", `export async function f(xs, it) { for (const y of xs) { for await (const x of it) { g(x); } } }`, "fallback"],
  ["for await 体内带 await（thunk 级）", `export async function f(it) { for await (const x of it) { g(await x); } }`, "fallback"],
  // ---- 嵌套边界（独立判定）----
  ["嵌套 async 函数声明（内层 thunk）", `export async function f(o) { async function inner() { return o.m(await 1); } return inner; }`, "fallback"],
  ["嵌套 async 箭头（内层 thunk）", `export async function f(o) { const inner = async () => o.m(await 1); return inner; }`, "fallback"],
  ["嵌套 async 对象方法（内层 thunk）", `export const o = { async m(x) { return x.m(await 1); } };`, "fallback"],
  ["嵌套 async 类方法（内层 thunk）", `export class C { async m(x) { return x.m(await 1); } }`, "fallback"],
  ["嵌套 async 箭头（内层 gen）", `export async function f(x) { const inner = async () => await x; return inner; }`, "gen"],
  // ---- gen 位（async-plan.ts：内联 ⇒ 可发 yield）----
  ["gen 级 await 变量初始化", `export async function f(x) { const y = await x; return y; }`, "gen"],
  ["gen 级标识符调用实参", `export async function f(x) { return k(await x); }`, "gen"],
  ["gen 级 for 初始化", `export async function f() { for (let i = await 1; i < 2; i++) { break; } }`, "gen"],
  ["gen 级 for-of 右值", `export async function f() { for (const x of await xs) { g(x); break; } }`, "gen"],
  ["gen 级 switch 判别式", `export async function f(x) { switch (await x) { case 1: break; default: break; } }`, "gen"],
  ["gen 级 try 块/catch/finally", `export async function f() { try { g(await 1); } catch (e) { g(2); } finally { g(3); } }`, "gen"],
  // ---- async 生成器声明（Bug 1072：$gen 第二实参 async 近似，同步驱动）----
  ["async 生成器声明", `export async function* ag(x) { yield await x; }`, "fallback"],
  // ---- 同文件多路径并存 ----
  [
    "多形态混合同文件",
    `const o = { m(x) { return x; } };
export async function gen(x) { const y = await x; return y; }
export async function thunk(p) { return o.m(await 1); }
export async function fa(it) { for await (const x of it) { g(x); } }
export function risky() { throw new Error("boom"); }`,
    "mixed",
  ],
];

/**
 * 裸 `yield` 计数（生成器体内联挂起点）。`$yield` / `$yieldStar` 是运行时
 * **运算符名**（import 行 / `$gen` 体里的调用），不是挂起——排除（前导
 * `$` 或标识符字符的 yield 词形不算）。
 */
function rawYieldCount(body: string): number {
  return (body.match(/(?<![$\w])yield\b/g) ?? []).length;
}

/**
 * 转译 + 宿主编译。剥 runtime import 行（RUNTIME_IMPORT_RE——与 run.ts
 * 同一真值源）与 `export ` 前缀（`new Function` 体不是模块）后经
 * `compileRuntimeModuleUnit` 编译——只编译不执行（SyntaxError 即守卫红）。
 */
function compileCheck(
  src: string,
  disableAsyncGen: boolean,
): { ok: boolean; error?: string; body: string } {
  const out = transpileSource(src, {
    source: src,
    ...(disableAsyncGen ? { disableAsyncGen: true } : {}),
  });
  const body = out.replace(RUNTIME_IMPORT_RE, "").replace(/^export (default )?/gm, "");
  try {
    compileRuntimeModuleUnit(body);
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), body };
  }
}

describe("async-plan 对齐守卫：await 位置形态 ⇒ 产物可编译 + 判定方向钉住", () => {
  it("语料非空转：覆盖 async-plan.ts 头注释全部 thunk 位 + gen 位 + 边界", () => {
    expect(ASYNC_SHAPES.length).toBeGreaterThanOrEqual(30);
    expect(ASYNC_SHAPES.filter(([, , lv]) => lv === "gen").length).toBeGreaterThanOrEqual(8);
    expect(ASYNC_SHAPES.filter(([, , lv]) => lv === "fallback").length).toBeGreaterThanOrEqual(20);
    expect(ASYNC_SHAPES.filter(([, , lv]) => lv === "mixed").length).toBeGreaterThanOrEqual(1);
  });

  for (const [name, src, level] of ASYNC_SHAPES) {
    it(`${name} ⇒ 双模式可编译（${level}）`, () => {
      // 两种模式都必须是合法 JS：默认生成器模式（判定表脱节时这里炸
      // SyntaxError）+ disableAsyncGen 安全网模式（run.ts 重试路径）。
      for (const disable of [false, true]) {
        const r = compileCheck(src, disable);
        expect(r.ok, `${name}（disableAsyncGen=${disable}）：${r.error ?? ""}`).toBe(true);
      }
      // 安全网模式全局关生成器路径：任何形态都不该再出现 $asyncGen/裸 yield。
      const sync = compileCheck(src, true);
      expect(sync.body.includes("$asyncGen("), `${name}：disableAsyncGen 下不得有 $asyncGen`).toBe(false);
      expect(rawYieldCount(sync.body), `${name}：disableAsyncGen 下不得有裸 yield`).toBe(0);
      // 默认模式按形态钉判定方向（防「全部回落同步也绿」的空转）。
      const gen = compileCheck(src, false);
      if (level === "gen") {
        expect(gen.body.includes("$asyncGen("), `${name}：应走生成器路径`).toBe(true);
        expect(rawYieldCount(gen.body), `${name}：应有裸 yield 挂起点`).toBeGreaterThan(0);
      } else if (level === "fallback") {
        expect(gen.body.includes("$asyncGen("), `${name}：thunk 位 await 不得走生成器路径`).toBe(false);
        expect(rawYieldCount(gen.body), `${name}：thunk 位不得出现裸 yield`).toBe(0);
      } else {
        expect(gen.body.includes("$asyncGen("), `${name}：gen 函数应走生成器路径`).toBe(true);
        expect(rawYieldCount(gen.body), `${name}：gen 函数应有裸 yield`).toBeGreaterThan(0);
        expect(gen.body.includes("$await("), `${name}：thunk 函数应回落 $await`).toBe(true);
      }
    });
  }
});
