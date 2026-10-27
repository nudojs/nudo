/**
 * BUG-167：同一函数体写成**对象方法简写**与写成**函数字面量**，在「有无副作用 /
 * 是否闭合」上必须给出同一结论。此前 `exec/transpile/expr/object.ts` 的
 * ObjectMethod / 方法型 FunctionExpression 两条 `$fnVal` 构造点**不发**
 * `effectFree` / `closed` facet（`expr/function.ts` 的函数表达式路径发），
 * 于是 sort 比较器闸门、promise then 回调、访问器纯度判定对同一段代码
 * 在两种写法下结论相反。
 *
 * 第二面（读域不可判）：`Object.defineProperty(o, "b", { get })` 装的访问器
 * 占位槽是 `unknown`（无 term）——投影面（`formatShape` / `denoteGuard` /
 * dts）此前仍去**执行** getter 取读域，把分析期的某次读值冻结成「确定值」⇒
 * 签名面自信错值 + guard 写成 `data.b === <literal>` 恒假。现在占位槽无 term
 * 时按 presence 判定，不执行用户 getter（不制造分析期副作用）。
 *
 * 负控制（Bug 191 / Bug 152）：对象字面量访问器的占位槽仍是 `$lit(void 0)`，
 * 读域照旧投影、调用点求值序不变。
 */
import { describe, it, expect } from "vitest";
import { formatShape, formatAbs } from "../format.ts";
import { denoteGuard } from "../denote.ts";
import { getFnImpl } from "../abs-fn.ts";
import type { Abs } from "../abs.ts";
import { call } from "./eval-helpers.ts";

/** 取对象槽上的函数 Abs（对象方法简写 / 方法型函数表达式） */
function fnSlotAbs(src: string, key: string): Abs {
  const r = call(src, "f").result;
  if (r.shape.k !== "obj") throw new Error(`期望 obj 形状，实际 ${r.shape.k}`);
  const slot = r.shape.slots[key];
  if (!slot) throw new Error(`槽 ${key} 缺席`);
  return slot.value;
}

/** `Object.defineProperty` 装的有副作用 getter（占位槽为 unknown） */
const DEFINE_PROP_SRC = `
let calls = 0;
export function f() {
  const o = { a: 1 };
  Object.defineProperty(o, "b", { get() { calls++; return calls; }, enumerable: true });
  return o;
}`;

describe("BUG-167: 对象方法 / 方法型函数表达式补齐 effectFree·closed facet", () => {
  it("纯方法：两个 facet 都在场（此前完全缺席）", () => {
    const impl = getFnImpl(fnSlotAbs(`export function f() { return { m(a) { return a; } }; }`, "m"));
    expect(impl).toBeDefined();
    expect(impl?.effectFree).toBe(true);
    expect(impl?.closed).toBe(true);
  });

  it("有副作用的方法：effectFree 不为 true（与函数字面量同结论）", () => {
    const methodImpl = getFnImpl(
      fnSlotAbs(`export function f() { let n = 0; return { m() { n++; } }; }`, "m"),
    );
    const fnImpl = getFnImpl(
      fnSlotAbs(`export function f() { let n = 0; return { m: function () { n++; } }; }`, "m"),
    );
    expect(methodImpl?.effectFree ?? false).toBe(false);
    expect(fnImpl?.effectFree ?? false).toBe(false);
  });

  it("读外层可变态的方法：closed 不为 true（与函数字面量同结论）", () => {
    const src = (body: string) => `export function f(x) { return { ${body} }; }`;
    const methodImpl = getFnImpl(fnSlotAbs(src(`m() { return x; }`), "m"));
    const fnImpl = getFnImpl(fnSlotAbs(src(`m: function () { return x; }`), "m"));
    expect(methodImpl?.closed ?? false).toBe(false);
    expect(fnImpl?.closed ?? false).toBe(false);
  });

  it("方法体只读 this：effectFree 仍为 true（读不是副作用）", () => {
    const impl = getFnImpl(fnSlotAbs(`export function f() { return { n: 1, m() { return this.n; } }; }`, "m"));
    expect(impl?.effectFree).toBe(true);
  });
});

describe("BUG-167: 读域不可判的访问器不得被投影执行 / 冻结", () => {
  it("签名面打印 unknown（不是冻结的末次读值）", () => {
    expect(formatShape(call(DEFINE_PROP_SRC, "f").result)).toBe("{ a: 1, b: unknown }");
  });

  it("formatAbs（无损面）同口径", () => {
    expect(formatAbs(call(DEFINE_PROP_SRC, "f").result)).toContain("{ a: 1, b: unknown }");
  });

  it("guard 只判 presence（不写必等式 ⇒ 不再恒假）", () => {
    const guard = denoteGuard(call(DEFINE_PROP_SRC, "f").result, "data");
    expect(guard).not.toMatch(/data\.b\s*===/);
    expect(guard).toContain('Object.hasOwn(data, "b")');
  });

  it("guard 放行自己的真实返回值（每次读都不同）", () => {
    const guard = denoteGuard(call(DEFINE_PROP_SRC, "f").result, "data");
    // denotation 是**表达式**（与 export --format guard 的产物同源）
    const check = new Function("data", `return (${guard});`) as (d: unknown) => boolean;

    let calls = 0;
    const real: Record<string, unknown> = { a: 1 };
    Object.defineProperty(real, "b", {
      enumerable: true,
      get() {
        calls += 1;
        return calls;
      },
    });
    expect(check(real)).toBe(true);
    expect(check(real)).toBe(true);
  });

  it("负控制：字面量访问器的读域照旧投影（Bug 191 口径不变）", () => {
    expect(
      formatShape(call(`export function f() { return { a: 1, get b() { return 2; } }; }`, "f").result),
    ).toBe("{ a: 1, b: 2 }");
    // 以 this 为接收者的读同样可证纯
    expect(
      formatShape(call(`export function f() { return { n: 41, get q() { return this.n; } }; }`, "f").result),
    ).toBe("{ n: 41, q: 41 }");
    // 仅 setter：读值恒 undefined（占位槽）
    expect(formatShape(call(`export function f() { return { set ab(v) {} }; }`, "f").result)).toBe(
      "{ ab: undefined }",
    );
  });
});
