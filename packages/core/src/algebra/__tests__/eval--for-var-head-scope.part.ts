/**
 * Bug 163 回归：`for (var x of …)` / `for (var k in …)` 的**头绑定作用域**。
 *
 * ES 语义（ForIn/OfHeadEvaluation）：
 * - `var` 头是**函数级**绑定（提升到函数体/模块体顶部）——循环**共享同一
 *   个绑定**，循环**之后仍可见**，且值 = 最后一次迭代的项；
 * - `let` / `const` 头是**块级、每轮新绑定**（per-iteration）——循环后
 *   不可见，闭包各捕获各的轮次值。
 *
 * 修复前：头绑定一律实现成「回调形参」⇒ ① 形参遮蔽函数级 `var` 槽 ⇒
 * 循环外读 `x` 恒 `undefined`；② 每轮是**新形参绑定** ⇒ 闭包捕获值错
 * （原生 `var` 共享 ⇒ 全部看到末轮值）。
 *
 * 不变量（负控制钉住）：`let` / `const` 头的 per-iteration 语义不变；
 * `var` 头在**循环体内**可见；模块级 `var` 头同样提升。
 */
import { describe, it, expect } from "vitest";
import { litValue, checkSource, pTrue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { l2Count, sigOf, sidecarOpts } from "./nudo-constraints.ts";

/** 引擎求值结果字面量值 */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 原生 oracle（new Function，strict ESM 语义） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 163 — for (var x of …) 头绑定是函数级共享绑定", () => {
  it("循环后 var 头仍可见（typeof x === number）", () => {
    const src = wrap(`for (var x of [1,2]) {} return typeof x;`);
    expect(v(src)).toEqual({ ok: true, value: "number" });
    expect(native(`for (var x of [1,2]) {} return typeof x;`)).toBe("number");
  });

  it("循环后 var 头持有末轮值", () => {
    const src = wrap(`for (var x of [1,2]) {} return x;`);
    expect(v(src)).toEqual({ ok: true, value: 2 });
    expect(native(`for (var x of [1,2]) {} return x;`)).toBe(2);
  });

  it("for (var k in …) 头同样是函数级绑定", () => {
    const src = wrap(`for (var k in {a:1}) {} return typeof k;`);
    expect(v(src)).toEqual({ ok: true, value: "string" });
    expect(native(`for (var k in {a:1}) {} return typeof k;`)).toBe("string");
  });

  it("for (var k in …) 头持有末轮键", () => {
    const src = wrap(`for (var k in {a:1,b:2}) {} return k;`);
    expect(v(src)).toEqual({ ok: true, value: "b" });
    expect(native(`for (var k in {a:1,b:2}) {} return k;`)).toBe("b");
  });

  it("var 头共享同一绑定（闭包全部看到末轮值）", () => {
    const src = wrap(`const fs=[]; for (var x of [1,2]) fs.push(()=>x); return fs.map(f=>f()).join(",");`);
    expect(v(src)).toEqual({ ok: true, value: "2,2" });
    expect(native(`const fs=[]; for (var x of [1,2]) fs.push(()=>x); return fs.map(f=>f()).join(",");`)).toBe(
      "2,2",
    );
  });

  it("for (var k in …) 头共享同一绑定（闭包看到末轮键）", () => {
    const src = wrap(`const fs=[]; for (var k in {a:1}) fs.push(()=>k); return fs.map(f=>f()).join(",");`);
    expect(v(src)).toEqual({ ok: true, value: "a" });
  });

  it("var 头在循环体内可见（逐轮读到当轮项）", () => {
    const src = wrap(`let seen=[]; for (var x of [1,2]) { seen.push(x); } return seen.join(",")+"|"+x;`);
    expect(v(src)).toEqual({ ok: true, value: "1,2|2" });
    expect(native(`let seen=[]; for (var x of [1,2]) { seen.push(x); } return seen.join(",")+"|"+x;`)).toBe(
      "1,2|2",
    );
  });

  it("var 头可再赋（var 是可写绑定）", () => {
    const src = wrap(`for (var x of [1,2]) { x = x + 10; } return x;`);
    expect(v(src)).toEqual({ ok: true, value: 12 });
  });

  it("var 头解构：子名同样是函数级绑定（末轮值）", () => {
    const src = wrap(`for (var {a} of [{a:1},{a:2}]) {} return a;`);
    expect(v(src)).toEqual({ ok: true, value: 2 });
    expect(native(`for (var {a} of [{a:1},{a:2}]) {} return a;`)).toBe(2);
  });

  it("var 头解构：子名在循环后仍可见", () => {
    const src = wrap(`for (var {a} of [{a:1}]) {} return typeof a;`);
    expect(v(src)).toEqual({ ok: true, value: "number" });
  });

  it("嵌套块里的 var 头仍是函数级绑定", () => {
    const src = wrap(`{ for (var y of [1,2]) {} } return typeof y;`);
    expect(v(src)).toEqual({ ok: true, value: "number" });
    expect(native(`{ for (var y of [1,2]) {} } return typeof y;`)).toBe("number");
  });
});

describe("Bug 163 — 产品面：nudo check 签名不再折出 undefined", () => {
  const NUDO_SRC = `
export const numArr = array(number());
export const numOrUndef = union(number(), lit(undefined));
`;
  const opts = sidecarOpts("std163c", NUDO_SRC, "/t/b163.js");
  const IMP = `/// @nudo:import { numArr, numOrUndef } from "./std163c.nudo.js"\n`;

  it("for (var x of items) 后的 x 折出 number 臂（不再是恒 undefined）", () => {
    const r = checkSource(
      "/t/b163.js",
      IMP +
        `
/**
 * @nudo:contract items numArr
 */
export function f(items) {
  for (var x of items) {}
  return x;
}
`,
      pTrue,
      opts,
    );
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "f")).toMatch(/number/);
    expect(sigOf(r, "f")).not.toMatch(/=> undefined$/);
  });
});

describe("Bug 163 — 负控制：let / const 头的 per-iteration 语义不变", () => {
  it("for (let x of …) 循环后不可见", () => {
    const src = wrap(`for (let x of [1,2]) {} return typeof x;`);
    expect(v(src)).toEqual({ ok: true, value: "undefined" });
    expect(native(`for (let x of [1,2]) {} return typeof x;`)).toBe("undefined");
  });

  it("for (const x of …) 循环后不可见", () => {
    const src = wrap(`for (const x of [1,2]) {} return typeof x;`);
    expect(v(src)).toEqual({ ok: true, value: "undefined" });
  });

  it("for (let x of …) 闭包各捕获各轮（per-iteration）", () => {
    const src = wrap(`const fs=[]; for (let x of [1,2]) fs.push(()=>x); return fs.map(f=>f()).join(",");`);
    expect(v(src)).toEqual({ ok: true, value: "1,2" });
    expect(native(`const fs=[]; for (let x of [1,2]) fs.push(()=>x); return fs.map(f=>f()).join(",");`)).toBe(
      "1,2",
    );
  });

  it("for (const x of …) 闭包各捕获各轮", () => {
    const src = wrap(`const fs=[]; for (const x of [1,2]) fs.push(()=>x); return fs.map(f=>f()).join(",");`);
    expect(v(src)).toEqual({ ok: true, value: "1,2" });
  });

  it("for (let k in …) 循环后不可见", () => {
    const src = wrap(`for (let k in {a:1}) {} return typeof k;`);
    expect(v(src)).toEqual({ ok: true, value: "undefined" });
  });

  it("普通 var（非头）提升语义不变", () => {
    const src = wrap(`var y = 5; return y + 1;`);
    expect(v(src)).toEqual({ ok: true, value: 6 });
  });
});
