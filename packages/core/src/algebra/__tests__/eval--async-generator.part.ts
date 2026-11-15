// MERGED (topic-related bug pins): eval-bug-141-async-generator.test.ts + eval-bug-141-async-iter-elems.test.ts + eval-bug-141-decl-async-generator.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { litValue, type Abs } from "../abs.ts";
import { call } from "./eval-helpers.ts";

describe("[merged] eval-bug-141-async-generator.test.ts", () => {
/**
 * Bug 141 回归：async generator 的 **async 面**。
 *
 * ES 语义：`async function*`（及 `async *` 方法）返回 AsyncGenerator——
 * next()/return()/throw() 返回 **promise**（promise<iterResult>）、装
 * `@@asyncIterator` 自返方法、`Object.prototype.toString` 折
 * "[object AsyncGenerator]"，且**不**有 `@@iterator`（同步迭代面缺席）。
 *
 * 修复前：async generator 与同步 generator 同编（$gen 同步协议对象）——
 * next() 返回裸 iterResult（无 then）、无 @@asyncIterator、tag 折
 * "[object Object]"。
 *
 * 覆盖面：函数**表达式**面与 class **方法**面（async generator 声明面
 * `async function* g(){}` 走 transpile/stmt/statement.ts 的声明分支——
 * 不在本批修复范围，见交付报告）。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 141 — async generator：async 面（promise 迭代协议）", () => {
  describe("函数表达式面", () => {
    it("next() 返回 promise（typeof next().then === function）", () => {
      expect(
        v(wrap(`const g = async function*(){ yield 1; }; return typeof g().next().then;`)),
      ).toEqual({ ok: true, value: "function" });
    });

    it("next() 的结果是 Promise 实例", () => {
      expect(
        v(wrap(`const g = async function*(){ yield 1; }; return g().next() instanceof Promise;`)),
      ).toEqual({ ok: true, value: true });
    });

    it("装 @@asyncIterator 自返方法", () => {
      expect(
        v(wrap(`const g = async function*(){ yield 1; }; return typeof g()[Symbol.asyncIterator];`)),
      ).toEqual({ ok: true, value: "function" });
    });

    it("Object.prototype.toString 折 [object AsyncGenerator]", () => {
      expect(
        v(
          wrap(
            `const g = async function*(){ yield 1; }; return Object.prototype.toString.call(g());`,
          ),
        ),
      ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
    });

    it("同步迭代面缺席（原生无 @@iterator）", () => {
      expect(
        v(wrap(`const g = async function*(){ yield 1; }; return typeof g()[Symbol.iterator];`)),
      ).toEqual({ ok: true, value: "undefined" });
    });
  });

  describe("class 方法面", () => {
    it("async *m(){}：next() 返回 promise", () => {
      expect(
        v(wrap(`class A { async *m(){ yield 1; } } return typeof new A().m().next().then;`)),
      ).toEqual({ ok: true, value: "function" });
    });

    it("async *m(){}：装 @@asyncIterator", () => {
      expect(
        v(
          wrap(
            `class A { async *m(){ yield 1; } } return typeof new A().m()[Symbol.asyncIterator];`,
          ),
        ),
      ).toEqual({ ok: true, value: "function" });
    });

    it("async *m(){}：tag 折 [object AsyncGenerator]", () => {
      expect(
        v(
          wrap(
            `class A { async *m(){ yield 1; } } return Object.prototype.toString.call(new A().m());`,
          ),
        ),
      ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
    });
  });

  describe("负控制：同步 generator 不得回归", () => {
    it("next() 仍是裸函数（非 promise）", () => {
      expect(v(wrap(`function* g(){ yield 1; } return typeof g().next;`))).toEqual({
        ok: true,
        value: "function",
      });
    });

    it("同步 generator 仍有 @@iterator", () => {
      expect(v(wrap(`function* g(){ yield 1; } return typeof g()[Symbol.iterator];`))).toEqual({
        ok: true,
        value: "function",
      });
    });

    it("同步 generator 的 next() 不是 promise", () => {
      expect(
        v(wrap(`function* g(){ yield 1; } return g().next() instanceof Promise;`)),
      ).toEqual({ ok: true, value: false });
    });
  });
});
});

describe("[merged] eval-bug-141-async-iter-elems.test.ts", () => {
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
});

describe("[merged] eval-bug-141-decl-async-generator.test.ts", () => {
/**
 * Bug 141 回归（续作）：async generator 的**声明面**
 * （`async function* g(){}` 语句形态）。
 *
 * ES 语义：`async function*` 返回 AsyncGenerator——next()/return()/throw()
 * 返回 **promise**、装 `@@asyncIterator` 自返方法、`Object.prototype.toString`
 * 折 "[object AsyncGenerator]"，且**不**有 `@@iterator`（同步迭代面缺席）。
 *
 * 修复前：声明面仍被编成**同步** generator（`$gen(() => {…})` 未透 async 位）
 * ⇒ next() 返回裸 iterResult（无 then）、无 @@asyncIterator、tag 折
 * "[object Object]"，且错误地带上了同步迭代面（@@iterator）。
 *
 * 声明面与函数**表达式**面 / class **方法**面（已修，见
 * eval--async-generator.part.ts）同属一条语义线；本文件只补声明面。
 *
 * 不变量（负控制钉住）：同步 generator 声明仍是同步协议（无 then、有
 * @@iterator）；async **函数**（非 generator）声明仍返回 promise。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 嵌套声明（函数体内的 `async function* g(){}`） */
const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 141 — async generator 声明面：async 面（promise 迭代协议）", () => {
  it("嵌套声明：next() 返回 promise（typeof next().then === function）", () => {
    expect(
      v(wrap(`async function* g(){ yield 1; } return typeof g().next().then;`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("嵌套声明：next() 的结果是 Promise 实例", () => {
    expect(
      v(wrap(`async function* g(){ yield 1; } return g().next() instanceof Promise;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("嵌套声明：装 @@asyncIterator 自返方法", () => {
    expect(
      v(wrap(`async function* g(){ yield 1; } return typeof g()[Symbol.asyncIterator];`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("嵌套声明：Object.prototype.toString 折 [object AsyncGenerator]", () => {
    expect(
      v(
        wrap(
          `async function* g(){ yield 1; } return Object.prototype.toString.call(g());`,
        ),
      ),
    ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
  });

  it("嵌套声明：同步迭代面缺席（原生无 @@iterator）", () => {
    expect(
      v(wrap(`async function* g(){ yield 1; } return typeof g()[Symbol.iterator];`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("模块级声明：next() 返回 promise", () => {
    expect(
      v(`async function* g(){ yield 1; }
         export function f() { return typeof g().next().then; }`),
    ).toEqual({ ok: true, value: "function" });
  });

  it("模块级声明：装 @@asyncIterator + tag 折 [object AsyncGenerator]", () => {
    expect(
      v(`async function* g(){ yield 1; }
         export function f() { return Object.prototype.toString.call(g()); }`),
    ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
  });
});

describe("Bug 141 — 负控制：同步 generator / async 函数声明不得回归", () => {
  it("同步 generator 声明：next() 不是 promise", () => {
    expect(
      v(wrap(`function* g(){ yield 1; } return g().next() instanceof Promise;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("同步 generator 声明：仍有 @@iterator", () => {
    expect(
      v(wrap(`function* g(){ yield 1; } return typeof g()[Symbol.iterator];`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("同步 generator 声明：next() 仍是裸函数（无 then）", () => {
    expect(
      v(wrap(`function* g(){ yield 1; } return typeof g().next().then;`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("async 函数（非 generator）声明：仍返回 promise", () => {
    expect(
      v(wrap(`async function g(){ return 1; } return typeof g().then;`)),
    ).toEqual({ ok: true, value: "function" });
  });
});
});
