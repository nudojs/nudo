/**
 * Bug 141 回归（**for-await 元素域**面）：async generator 的元素域必须走
 * **元素侧表**（与同步 generator 同口径），不得落 asyncOnly 的 unknown
 * 快路径。
 *
 * 背景：async generator 装 @@asyncIterator 槽（无 @@iterator 槽）⇒
 * `for await` 走「仅异步可迭代」分支。此前该分支的元素域恒折 unknown
 * ⇒ 循环变量退 unknown ⇒ 累加值退 `number | unknown`（原生是精确 3）。
 * 这是一条**精度回退**（改前 async generator 被误编成同步 generator 时，
 * for-await 走同步元素面，累加值恰好精确）。
 *
 * 修法（core exec/runtime/containers/iterate.ts）：
 * - asyncOnly 分支：接收者是**生成器对象**（有生成器消费视图）⇒ 元素取
 *   侧表剩余条目（逐项 await），长度亦由侧表给出（sideIterLen 兜底读
 *   消费视图的剩余条目数——async generator 无 @@iterator 槽，
 *   matchIterElements 不命中）；
 * - 非生成器的仅异步可迭代对象元素域不可静态刻画 → 仍折 unknown。
 *
 * 本文件的断言与 Node 真实执行结果对齐（原生 ground truth 见各用例注释）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import type { Abs } from "../abs.ts";

/** 剥外层 promise（async 函数面：返回值恒 promise<内层>） */
function unwrapPromise(a: Abs): Abs {
  return a.shape.k === "eff" && a.shape.eff === "promise" ? a.shape.inner : a;
}

/** async 函数体的求值结果（剥 promise 后的字面量值） */
function v(src: string) {
  return litValue(unwrapPromise(call(src, "f").result));
}

const wrap = (body: string) => `export async function f() { ${body} }`;

describe("Bug 141 — async generator 的 for-await 元素域（走元素侧表）", () => {
  it("async generator（函数表达式面）：for-await 累加精确 3（原生 1+2=3）", () => {
    expect(
      v(
        wrap(
          `const g = async function*(){ yield 1; yield 2; }; let t = 0; for await (const v of g()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 3 });
  });

  it("async generator：三个 yield 累加精确 6（原生 1+2+3=6）", () => {
    expect(
      v(
        wrap(
          `const g = async function*(){ yield 1; yield 2; yield 3; }; let t = 0; for await (const v of g()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 6 });
  });

  it("async generator：单个 yield 精确 7", () => {
    expect(
      v(
        wrap(
          `const g = async function*(){ yield 7; }; let t = 0; for await (const v of g()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 7 });
  });

  it("async generator：字符串元素逐项拼接精确 \"ab\"（原生 \"ab\"）", () => {
    expect(
      v(
        wrap(
          `const g = async function*(){ yield "a"; yield "b"; }; let t = ""; for await (const v of g()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: "ab" });
  });

  it("async generator：空生成器 → 0 次迭代，精确 0（原生 0）", () => {
    expect(
      v(
        wrap(
          `const g = async function*(){ }; let t = 0; for await (const v of g()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 0 });
  });

  it("class async *m(){}：for-await 累加精确 3（原生 1+2=3）", () => {
    expect(
      v(
        wrap(
          `class A { async *m(){ yield 1; yield 2; } } let t = 0; for await (const v of new A().m()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 3 });
  });

  it("元素域不是 unknown（不得退成 number | unknown）", () => {
    const r = call(
      wrap(
        `const g = async function*(){ yield 1; yield 2; }; let t = 0; for await (const v of g()) t += v; return t;`,
      ),
      "f",
    );
    // 内层是精确 3（不是含 unknown 的并集）
    expect(litValue(unwrapPromise(r.result))).toEqual({ ok: true, value: 3 });
  });
});

describe("Bug 141 负控制：不得被本修复波及的邻近形态", () => {
  it("同步 generator 的 for-await（同步迭代器回退）仍是精确 3", () => {
    expect(
      v(
        wrap(
          `function* g(){ yield 1; yield 2; } let t = 0; for await (const v of g()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 3 });
  });

  it("数组的 for-await（同步回退）仍是精确 3", () => {
    expect(
      v(wrap(`let t = 0; for await (const v of [1, 2]) t += v; return t;`)),
    ).toEqual({ ok: true, value: 3 });
  });

  it("同步 generator 的 for-of（同步迭代面）仍是精确 3", () => {
    expect(
      v(wrap(`function* g(){ yield 1; yield 2; } let t = 0; for (const v of g()) t += v; return t;`)),
    ).toEqual({ ok: true, value: 3 });
  });

  it("普通 async 函数（非 generator）不受影响", () => {
    expect(v(wrap(`const h = async () => 5; return await h();`))).toEqual({
      ok: true,
      value: 5,
    });
  });

  it("非生成器的仅异步可迭代对象：元素域仍折 unknown（不得臆造元素）", () => {
    const r = call(
      wrap(
        `const ai = {}; ai[Symbol.asyncIterator] = function () {}; let s = 0; for await (const v of ai) { s += v; } return s;`,
      ),
      "f",
    );
    const inner = unwrapPromise(r.result);
    // 元素域不可静态刻画 ⇒ 累加器退 unknown（不是精确 0）
    expect(litValue(inner).ok).toBe(false);
    expect(inner.shape.k).not.toBe("prim");
  });

  it("async generator 的 next() 仍返 promise（Bug 141 主修复面不回归）", () => {
    expect(
      v(wrap(`const g = async function*(){ yield 1; }; return typeof g().next().then;`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("同步 generator 的 next() 仍返裸 iterResult（非 promise）", () => {
    expect(
      v(wrap(`function* g(){ yield 1; }; return g().next() instanceof Promise;`)),
    ).toEqual({ ok: true, value: false });
  });
});
