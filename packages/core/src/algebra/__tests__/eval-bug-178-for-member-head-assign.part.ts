/**
 * Bug 178 回归：`for (o.x of …)` / `for (o.x in …)` 的**成员表达式头**。
 *
 * ES 语义（ForIn/OfHeadEvaluation 的 AssignmentElement 形态）：头目标是
 * **赋值目标**——每轮把迭代项**写回**该成员槽（`o.x` = 末轮项）。
 *
 * 修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头
 * **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的
 * 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值
 * `3` / `"b"`）⇒ L2 假绿 + `nudo test` 假红。
 *
 * 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层
 * 绑定）；未被头赋值的成员保持旧值。
 */
import { describe, it, expect } from "vitest";
import { litValue, checkSource, pTrue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { l2Count, sigOf, sidecarOpts } from "./nudo-constraints.ts";

/** 引擎求值结果字面量值 */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 原生 oracle（new Function） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 178 — for (o.x of …) 成员头每轮写回成员槽", () => {
  it("for (o.x of [1,2,3]) 后 o.x === 3", () => {
    const src = wrap(`const o={x:0}; for (o.x of [1,2,3]) {} return o.x;`);
    expect(v(src)).toEqual({ ok: true, value: 3 });
    expect(native(`const o={x:0}; for (o.x of [1,2,3]) {} return o.x;`)).toBe(3);
  });

  it("for (o.x in {a:1,b:2}) 后 o.x === 'b'", () => {
    const src = wrap(`const o={x:0}; for (o.x in {a:1,b:2}) {} return o.x;`);
    expect(v(src)).toEqual({ ok: true, value: "b" });
    expect(native(`const o={x:0}; for (o.x in {a:1,b:2}) {} return o.x;`)).toBe("b");
  });

  it("头写回后体内可读到当轮值", () => {
    const src = wrap(`const o={x:0,y:0}; for (o.x of [1,2]) { o.y = o.x * 2; } return o.y;`);
    expect(v(src)).toEqual({ ok: true, value: 4 });
    expect(native(`const o={x:0,y:0}; for (o.x of [1,2]) { o.y = o.x * 2; } return o.y;`)).toBe(4);
  });

  it("计算键成员头：o[key] 写回生效", () => {
    const src = wrap(`const o={x:0}; const key="x"; for (o[key] of [1,2,3]) {} return o.x;`);
    expect(v(src)).toEqual({ ok: true, value: 3 });
    expect(native(`const o={x:0}; const key="x"; for (o[key] of [1,2,3]) {} return o.x;`)).toBe(3);
  });

  it("多层成员头：o.a.x 写回生效", () => {
    const src = wrap(`const o={a:{x:0}}; for (o.a.x of [1,2,3]) {} return o.a.x;`);
    expect(v(src)).toEqual({ ok: true, value: 3 });
    expect(native(`const o={a:{x:0}}; for (o.a.x of [1,2,3]) {} return o.a.x;`)).toBe(3);
  });

  it("标识符头：for (x of …) 写回既有绑定", () => {
    const src = wrap(`let x=0; for (x of [1,2,3]) {} return x;`);
    expect(v(src)).toEqual({ ok: true, value: 3 });
    expect(native(`let x=0; for (x of [1,2,3]) {} return x;`)).toBe(3);
  });

  it("标识符头（for-in）：for (k in …) 写回既有绑定", () => {
    const src = wrap(`let k=""; for (k in {a:1,b:2}) {} return k;`);
    expect(v(src)).toEqual({ ok: true, value: "b" });
    expect(native(`let k=""; for (k in {a:1,b:2}) {} return k;`)).toBe("b");
  });

  it("标识符头写 const 绑定 = 原生 TypeError（写回通道的 const 守卫）", () => {
    const src = wrap(`const c = 1; try { for (c of [1,2]) {} return c; } catch (e) { return "TypeError"; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
    expect(
      native(`const c = 1; try { for (c of [1,2]) {} return c; } catch (e) { return "TypeError"; }`),
    ).toBe("TypeError");
  });
});

describe("Bug 178 — 产品面：nudo check 签名不再折出旧值", () => {
  const NUDO_SRC = `
export const num = number();
`;
  const opts = sidecarOpts("std178c", NUDO_SRC, "/t/b178.js");
  const IMP = `/// @nudo:import { num } from "./std178c.nudo.js"\n`;

  it("for (o.x of [1,2,3]) 后 o.x 折出 3（不再是旧值 0）", () => {
    const r = checkSource(
      "/t/b178.js",
      IMP +
        `
export function f() {
  const o = { x: 0 };
  for (o.x of [1, 2, 3]) {}
  return o.x;
}
`,
      pTrue,
      opts,
    );
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "f")).toMatch(/3/);
    expect(sigOf(r, "f")).not.toMatch(/=> 0$/);
  });
});

describe("Bug 178 — 负控制：无头赋值的目标保持旧值", () => {
  it("const 头不写回外层绑定（仍是块级每轮新绑定）", () => {
    const src = wrap(`let x=0; for (const y of [1,2]) {} return x;`);
    expect(v(src)).toEqual({ ok: true, value: 0 });
    expect(native(`let x=0; for (const y of [1,2]) {} return x;`)).toBe(0);
  });

  it("let 头不写回外层绑定", () => {
    const src = wrap(`let x=0; for (let y of [1,2]) {} return x;`);
    expect(v(src)).toEqual({ ok: true, value: 0 });
  });

  it("未被头赋值的成员保持旧值", () => {
    const src = wrap(`const o={x:0,y:7}; for (const y of [1,2]) {} return o.x+"/"+o.y;`);
    expect(v(src)).toEqual({ ok: true, value: "0/7" });
  });

  it("成员头不影响其它成员", () => {
    const src = wrap(`const o={x:0,y:7}; for (o.x of [1,2]) {} return o.y;`);
    expect(v(src)).toEqual({ ok: true, value: 7 });
  });
});
