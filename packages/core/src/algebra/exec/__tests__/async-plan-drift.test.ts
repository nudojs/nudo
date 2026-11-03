import { describe, expect, it } from "vitest";
import { parse } from "@babel/parser";
import type { Node } from "@babel/types";
import { asyncBodyPlan } from "../transpile/async-plan.ts";
import { transpileModule } from "../transpile.ts";

/**
 * async-plan 对齐 drift-gate（Bug 1139 家族防护）。
 *
 * `async-plan.ts` 是对**发射器结构知识**（哪些位置会把 await 包进宿主 thunk）
 * 的手工镜像表——历史上两者脱节过（Bug 1139：表判 gen 而发射侧包 thunk ⇒
 * `yield` 落进嵌套箭头 ⇒ `new Function` SyntaxError ⇒ 整模块假绿）。
 * run.ts 已有 SyntaxError → disableAsyncGen 重试的安全网（灾难形态已消除），
 * 但表判错仍会**静默**退化为同步近似（精度无声丢失）——本测试把两类判错
 * 都变成红：
 *
 * 1. **表本身**：每个位置类别的 allSafe 判定与表头文档逐行互钉（GEN ⇒ true，
 *    THUNK ⇒ false）。
 * 2. **表 ↔ 发射器对齐（V8 oracle）**：表判 allSafe 的体，转译产物必须真的
 *    能被 `new Function` 编译——若发射器把某位置包进了宿主 thunk，`yield`
 *    落进嵌套箭头，V8 编译器自己报 SyntaxError（ESM 源 ⇒ strict 前缀 ⇒
 *    yield-as-identifier 不合法）。**编译器即对齐判据**，无须文本检查。
 * 3. THUNK 体走同步路径（$await thunk），产物同样必须可编译——钉住
 *    disableAsyncGen 兜底路径的可用性。
 * 4. 四个 asyncBodyPlan 消费面（函数体 / 对象方法 / 类方法 / 顶层 await）
 *    各钉一条真挂起产物可编译。
 */

/** 生成器级（gen）：await 内联在生成器体里 ⇒ 可发射 yield ⇒ allSafe */
const GEN: ReadonlyArray<readonly [label: string, body: string]> = [
  ["语句表达式", `await x; await y;`],
  ["if 测试（内联）", `if (await x) {}`],
  ["嵌套块", `{ await x; }`],
  ["try 块", `try { await x; } catch {}`],
  ["catch 体", `try {} catch { await x; }`],
  ["finally 体", `try {} finally { await x; }`],
  ["for init", `for (let i = await x; i < 3; i++) {}`],
  ["for-of 右值", `for (const v of await x) {}`],
  ["for-in 右值", `for (const k in await x) {}`],
  ["逻辑与左", `if (await x && y) {}`],
  ["三元测试", `if ((await x) ? 1 : 2) {}`],
  ["标识符调用实参", `k(await x);`],
  ["标识符赋值右值", `x = await y;`],
  ["标识符复合赋值右值", `x += await y;`],
  ["switch 判别式", `switch (await x) { case 1: break; }`],
  ["return 实参", `return await x;`],
  ["for await 循环本身", `for await (const v of xs) {}`],
];

/** 宿主 thunk 级：await 被包进箭头 ⇒ 不可发射 yield ⇒ !allSafe */
const THUNK: ReadonlyArray<readonly [label: string, body: string]> = [
  ["if 臂", `if (c) { await x; }`],
  ["if 臂（无块）", `if (c) await x;`],
  ["while test", `while (await x) {}`],
  ["while 体", `while (c) { await x; }`],
  ["do 体", `do { await x; } while (c);`],
  ["for test", `for (; await x; ) {}`],
  ["for update", `for (; c; await x) {}`],
  ["for 体", `for (; ; ) { await x; }`],
  ["for-of 体", `for (const v of xs) { await x; }`],
  ["for-in 体", `for (const k in o) { await x; }`],
  ["for await 体", `for await (const v of xs) { await x; }`],
  ["switch case 测试", `switch (c) { case await x: break; }`],
  ["switch 臂", `switch (c) { case 1: await x; break; }`],
  ["逻辑与右", `if (c && (await x)) {}`],
  ["逻辑或右", `if (c || (await x)) {}`],
  ["空值合并右", `if (c ?? (await x)) {}`],
  ["三元臂（真）", `c ? await x : 2;`],
  ["三元臂（假）", `c ? 1 : await x;`],
  ["成员调用实参", `o.m(await x);`],
  ["成员赋值右值", `o.x = await y;`],
  ["成员赋值计算键", `o[await k] = 1;`],
  ["成员赋值接收者", `(await o).x = 1;`],
  ["成员自增计算键", `o[await k]++;`],
  ["逻辑赋值右值", `o.x ??= await y;`],
  ["早退守卫后续语句", `if (!c) return 1; await x;`],
  ["gen 与 thunk 混合（一票否决）", `await x; if (c) { await y; }`],
];

const wrapFn = (body: string): string =>
  `export async function f(x, y, c, k, o, xs) {\n${body}\n}`;

const parseBody = (src: string): Node => {
  const file = parse(wrapFn(src), { sourceType: "module" });
  const stmt = file.program.body[0];
  const decl =
    stmt?.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
  if (decl?.type !== "FunctionDeclaration" || !decl.body) {
    throw new Error("fixture 形态错误：首语句须是函数声明");
  }
  return decl.body;
};

/** V8 编译 oracle：产物作为普通函数体编译——yield 落在嵌套箭头即 SyntaxError。
 * 走 run.ts 同款 host 形态（export lowering 为 __nudoExports、无 import 行）；
 * 运行时名字由宿主注入形参承接，此处是自由变量，`new Function` 编译无碍。 */
const compiles = (source: string): boolean => {
  const { code } = transpileModule(source, {
    target: "host",
    runtimeImport: null,
    source,
  });
  try {
    new Function(code);
    return true;
  } catch (e) {
    if (e instanceof SyntaxError) return false;
    throw e;
  }
};

describe("async-plan 表逐行互钉（Bug 1139 drift-gate）", () => {
  for (const [label, body] of GEN) {
    it(`gen：${label} ⇒ allSafe`, () => {
      const plan = asyncBodyPlan(parseBody(body));
      expect(plan.hasAwait, `${label} 应检出 await`).toBe(true);
      expect(plan.allSafe, `${label} 表判 gen——若此处翻红，先查表头文档与发射器谁对`).toBe(true);
    });
  }
  for (const [label, body] of THUNK) {
    it(`thunk：${label} ⇒ !allSafe`, () => {
      const plan = asyncBodyPlan(parseBody(body));
      expect(plan.hasAwait, `${label} 应检出 await`).toBe(true);
      expect(plan.allSafe, `${label} 表判 thunk——若此处翻红，先查表头文档与发射器谁对`).toBe(false);
    });
  }
  it("无 await 体 ⇒ !hasAwait 且 allSafe", () => {
    const plan = asyncBodyPlan(parseBody(`return x + 1;`));
    expect(plan.hasAwait).toBe(false);
    expect(plan.allSafe).toBe(true);
  });
  it("disableAsyncGen 强制同步路径", () => {
    const plan = asyncBodyPlan(parseBody(`await x;`), true);
    expect(plan.allSafe).toBe(false);
  });
});

describe("表 ↔ 发射器对齐（V8 编译 oracle）", () => {
  for (const [label, body] of GEN) {
    it(`gen 产物可编译（yield 确在生成器级）：${label}`, () => {
      expect(compiles(wrapFn(body)), `${label} 表判 gen 但产物编译失败——表与发射器脱节（Bug 1139 形态）`).toBe(true);
    });
  }
  for (const [label, body] of THUNK) {
    it(`thunk 产物可编译（同步兜底路径可用）：${label}`, () => {
      expect(compiles(wrapFn(body)), `${label} 同步路径产物编译失败`).toBe(true);
    });
  }
});

describe("四个 asyncBodyPlan 消费面（真挂起产物可编译）", () => {
  it("对象方法体（object.ts 消费面）", () => {
    expect(compiles(`export const o = { async m() { await x; } };`)).toBe(true);
  });
  it("类方法体（class-emit.ts 消费面）", () => {
    expect(compiles(`export class A { async m() { await x; } }`)).toBe(true);
  });
  it("顶层 await（statement.ts 消费面）", () => {
    expect(compiles(`const v = await x; export const w = v;`)).toBe(true);
  });
  it("顶层 await 落 thunk 位（同步兜底可编译）", () => {
    expect(compiles(`if (c) { await x; } export const w = 1;`)).toBe(true);
  });
});
