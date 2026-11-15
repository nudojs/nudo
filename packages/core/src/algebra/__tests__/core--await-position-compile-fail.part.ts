/**
 * Bug 1139 回归 —— `await` 的**位置表**与转译侧脱节 ⇒ `yield` 落进嵌套箭头
 * ⇒ `new Function` SyntaxError ⇒ **整个模块**编译失败 ⇒ 全部导出丢失
 * ⇒ L2 闸门（`nudo:entry-may-throw`）看不到任何入口 ⇒ **零诊断 + exit 0**
 * ⇒ **CI 闸门假绿**（合法代码与违约代码都判绿）。
 *
 * 机理：async 体的真挂起靠**宿主生成器**（`function*(){…}` + `await` 发射
 * `yield`）实现 ⇒ `yield` 必须落在生成器**体内联**位置。转译侧把若干操作数
 * 包进**宿主 thunk**（`() => {…}` / `() => [args]`）——`yield` 落在里面是
 * 语法错误。`async-plan.ts` 的位置表此前只把「分支臂 / 循环体 / 短路右臂 /
 * 三元两臂」判为 thunk，漏了：
 *
 * - **成员调用的实参**（`o.m(await 1)`）——Bug 152 的求值序（成员读先于
 *   实参求值）把实参包进 `$invoke` 内部的 `() => [args]`；
 * - **成员赋值的接收者 / 计算键 / 右值**（`o.x = await 1` / `o[k] = v`）——
 *   member-path 的读改写 IIFE **体**内；
 * - **标识符/成员自增的计算键**（`o[await k]++`）；
 * - **逻辑赋值的右值**（`x ||= await 1`）——`$fork` 臂内；
 * - **循环判别式与步进式**（`while (i < await 1)` / `for(;;i += await 1)`）；
 * - **switch 的 case 测试**（`case await 1:`）；
 * - **早退守卫之后的后续语句**（`if (!c) return null; … await …`）——
 *   转译侧把它们搬进 `$fork` 的 alt 臂（宿主 thunk）。
 *
 * 修法（两处，缺一不可）：
 * 1. **位置表补齐**（`async-plan.ts`）：上列位置一律判 thunk ⇒ 该 async 体
 *    回落 `$async` 同步路径（`await` → `$await`）⇒ 产物是**合法 JS**。
 * 2. **安全网**（`run.ts`）：生成器模式编译失败（SyntaxError）时**关闭
 *    asyncGen 重试一次** ⇒ 纵有未来新增的脱节位置，模块也**编译得出来**
 *    ⇒ 导出可见 ⇒ 闸门照常判定（宁可少精确，不可整模块消失）。
 *
 * 断言口径：
 * - **产物面**：每个 `await` 位置的转译产物都**能编译**（`new Function`）。
 * - **闸门面**：整模块不再 fail-closed ⇒ 同文件的其它导出（`risky()`）仍报
 *   `nudo:entry-may-throw`（error 级）⇒ 修前该诊断消失（假绿）。
 */
import { describe, it, expect } from "vitest";
import { transpileSource, checkSource, pTrue } from "../index.ts";
import { l2Count, sigOf } from "./nudo-constraints.ts";

/**
 * 转译产物能否编译（`new Function`）。
 *
 * 产物首行是 runtime import（`import { … } from "@nudojs/core/exec";`）——
 * 剥掉它，把 runtime 绑定名当形参传进 `new Function`（与求值引擎同口径：
 * runtime 绑定由宿主注入）。`export` 前缀也要剥（`new Function` 体不是模块）。
 */
function compiles(src: string): { ok: boolean; error?: string } {
  const out = transpileSource(src, { source: src });
  const lines = out.split("\n");
  const impLine = lines.find((l) => l.startsWith("import ")) ?? "";
  const m = impLine.match(/\{([^}]*)\}/);
  const names = m
    ? m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const body = out.replace(impLine, "").replace(/^export /gm, "");
  try {
    // eslint-disable-next-line no-new-func
    new Function(...names, body);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** async 函数的 await 位置矩阵（表达式位） */
const EXPR_SLOTS: Array<[string, string]> = [
  ["变量初始化", "const x = AWAIT; return x;"],
  ["return 实参", "return AWAIT;"],
  ["标识符调用实参", "return k(AWAIT);"],
  ["成员调用实参", "return o.m(AWAIT);"],
  ["成员调用实参（嵌套）", "return o.m(k(AWAIT));"],
  ["计算成员读", "return o[AWAIT];"],
  ["成员赋值右值", "o.x = AWAIT;"],
  ["成员赋值计算键", "o[AWAIT] = 1;"],
  ["成员复合赋值", "o.x += AWAIT;"],
  ["标识符赋值", "x = AWAIT;"],
  ["标识符复合赋值", "x += AWAIT;"],
  ["逻辑赋值", "x ||= AWAIT;"],
  ["逻辑与赋值", "x &&= AWAIT;"],
  ["空值合并赋值", "x ??= AWAIT;"],
  ["成员自增计算键", "o[AWAIT]++;"],
  ["数组元素", "const a = [AWAIT]; return a;"],
  ["对象字面量值", "const o2 = { a: AWAIT }; return o2;"],
  ["模板字面量", "return `${AWAIT}`;"],
  ["new 实参", "return new C(AWAIT);"],
  ["spread 实参", "return k(...AWAIT);"],
  ["二元左", "return AWAIT + 1;"],
  ["二元右", "return 1 + AWAIT;"],
  ["一元", "return !AWAIT;"],
  ["typeof", "return typeof AWAIT;"],
  ["三元测试", "return AWAIT ? 1 : 2;"],
  ["三元真臂", "return 1 ? AWAIT : 2;"],
  ["三元假臂", "return 1 ? 2 : AWAIT;"],
  ["短路左", "return AWAIT || 1;"],
  ["短路右", "return 1 || AWAIT;"],
  ["与左", "return AWAIT && 1;"],
  ["与右", "return 1 && AWAIT;"],
  ["空值合并左", "return AWAIT ?? 1;"],
  ["空值合并右", "return 1 ?? AWAIT;"],
];

/** async 函数的 await 位置矩阵（语句位） */
const STMT_SLOTS: Array<[string, string]> = [
  ["if 测试", "if (AWAIT) { g(); }"],
  ["if 臂", "if (x) { return AWAIT; }"],
  ["if-else 臂", "if (x) { return AWAIT; } else { return 2; }"],
  ["while 判别式", "while (AWAIT) { break; }"],
  ["do-while 判别式", "do { break; } while (AWAIT);"],
  ["for 判别式", "for (; AWAIT; ) { break; }"],
  ["for 步进式", "for (;; AWAIT) { break; }"],
  ["for 初始化", "for (let i = AWAIT; i < 2; i++) { break; }"],
  ["for-of 右值", "for (const x of AWAIT) { break; }"],
  ["for-in 右值", "for (const k in AWAIT) { break; }"],
  ["switch 判别式", "switch (AWAIT) { default: break; }"],
  ["case 测试", "switch (x) { case AWAIT: break; default: break; }"],
  ["try 块", "try { const x = AWAIT; } catch (e) { }"],
  ["catch 体", "try { } catch (e) { const x = AWAIT; }"],
  ["throw 实参", "throw AWAIT;"],
  ["标签语句", "lbl: g(AWAIT);"],
  ["裸块", "{ const x = AWAIT; }"],
  ["早退守卫之后", "if (!c) return null; const x = AWAIT; return x;"],
  ["早抛守卫之后", "if (!c) throw new Error('x'); const x = AWAIT; return x;"],
  ["守卫块形态", "if (!c) { return null; } const x = AWAIT; return x;"],
  ["守卫在嵌套块", "{ if (!c) return null; const x = AWAIT; return x; }"],
];

/** 触发源（async 函数 + await 占位） */
function srcOf(slot: string): string {
  return `export async function f() { ${slot.replace(/AWAIT/g, "await 1")} }\n`;
}

describe("Bug 1139 — await 位置表与转译侧对齐（模块不得整份编译失败）", () => {
  for (const [name, slot] of [...EXPR_SLOTS, ...STMT_SLOTS]) {
    it(`表达式位/语句位：${name} ⇒ 转译产物可编译`, () => {
      const r = compiles(srcOf(slot));
      expect(r.ok, `${name}: ${r.error ?? ""}`).toBe(true);
    });
  }

  it("闸门面：整模块不再 fail-closed ⇒ 其它导出的 L2 门禁仍触发", () => {
    // 修前：`o.m(await 1)` 让**整个模块**编译失败 ⇒ `risky` 的
    // `nudo:entry-may-throw` 消失（零诊断 + exit 0 ⇒ 假绿）。
    const src = `const o = { m(x) { return x; } };
export async function f() { return o.m(await 1); }
export function risky() { throw new Error("boom"); }`;
    const r = checkSource("/t/async-await-pos.js", src, pTrue, {});
    expect(l2Count(r, "risky")).toBe(1);
    // async 导出本身可见（不是 opaque/unknown 消失）
    expect(sigOf(r, "f")).not.toBe("(missing)");
  });

  it("闸门面：常见的 fetch 形态（早退守卫 + await）不再整模块假绿", () => {
    const src = `export async function load(id) {
  if (!id) return null;
  const res = await fetch("/x/" + id);
  return res.json();
}
export function risky() { throw new Error("boom"); }`;
    const r = checkSource("/t/async-await-guard.js", src, pTrue, {});
    expect(l2Count(r, "risky")).toBe(1);
    expect(sigOf(r, "load")).not.toBe("(missing)");
  });

  it("安全网：关闭 asyncGen 后同一份源仍能编译（生成器路径的兜底）", () => {
    const src = `export async function f() { return o.m(await 1); }`;
    const out = transpileSource(src, { source: src, disableAsyncGen: true });
    expect(out).toContain("$await(");
    expect(out).not.toContain("(yield ");
  });

  it("位置表：成员调用实参 / 成员赋值 / 循环判别式 / case 测试 / 守卫之后 ⇒ 判 thunk", () => {
    // 直接钉 `asyncBodyPlan` 的判定（产物面的行为由上面的矩阵覆盖）。
    const cases: Array<[string, boolean]> = [
      // [源片段, 是否应回落 $async（即位置表判 thunk ⇒ allSafe=false）]
      ["return o.m(await 1);", true],
      ["return k(await 1);", false],
      ["o.x = await 1;", true],
      ["x = await 1;", false],
      ["x ||= await 1;", true],
      ["while (i < await 1) { break; }", true],
      ["switch (x) { case await 1: break; }", true],
      ["if (!c) return null; const z = await 1; return z;", true],
      ["const z = await 1; return z;", false],
    ];
    for (const [frag, expectThunk] of cases) {
      const src = `export async function f() { ${frag} }`;
      const out = transpileSource(src, { source: src });
      const generatorMode = out.includes("$asyncGen(function*");
      expect(generatorMode, `${frag} ⇒ 生成器路径应=${!expectThunk}`).toBe(!expectThunk);
    }
  });
});
