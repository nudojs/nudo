/**
 * Bug 240 回归钉：生成器对象是**内部槽对象**——原生**没有任何自有可枚举
 * 属性**（`Object.keys` / `Object.getOwnPropertyNames` / `for-in` 恒空；
 * `hasOwnProperty("next")` 恒 false）。引擎此前把协议方法与 yield 元素
 * 塞进**自有可枚举槽** ⇒ 枚举面印出
 * `"0,next,return,throw,constructor,@@iterator"`（原生 `""`）。
 *
 * 修法（`exec/runtime/async.ts` 的 `makeGenObject`）：协议方法与 yield
 * 元素槽标 **internal**（枚举面 / 自有面不可见；`$get` / `$in` 照常直读
 * 直查——`"next" in g` 恒 true，与原生一致）。
 *
 * ── 已知残留（与族 01 结论冲突，本分片不改）────────────────────────────
 * 原生 `g[0]` 恒 `undefined`、`"0" in g` 恒 `false`；族 01 提交
 * `d6fa0679` 的「数字下标读（历史口径）继续可读 yield 值」
 * （`exec-generator-protocol.test.ts`）把 `g[0]` 固化为 yield 值（且
 * 数字下标槽承载元素域面 → 签名面 `"0": any`）。移除数字下标槽会同时
 * 改掉族 01 的该结论与元素域签名面 ⇒ 需另案（族 01 结论解除）处理，
 * 本分片按「不改族 01 已提交语义」约束保留 ⇒ 下列两条以 todo 记缺口。
 * ───────────────────────────────────────────────────────────────────────
 *
 * ── S18（投影面分片）：签名面不发布 internal 槽 ────────────────────────
 * 协议方法槽虽对**属性 introspection**不可见（枚举面 / 自有面已过滤
 * `Slot.internal`），但**投影面**（`algebra/format.ts`）此前不过滤 ⇒
 * 签名面把 `next` / `return` / `throw` / `constructor` / `@@iterator`
 * 五个内部槽当用户可见属性发布（Bug 240 报告的产品面证据）。S18 让
 * 投影面剔除 internal 槽，但**保留数字下标槽**（承载元素域——族 01
 * `eval-spread-iter-elems` 钉住的 `"0": string`）。
 */
import { describe, it, expect } from "vitest";
import { val, call } from "./eval-helpers.ts";
import { formatAbs } from "../format.ts";
import { abs } from "../abs.ts";

const GEN = `
  function* g() { yield 1; yield 2; }
  const gi = g();
`;

describe("Bug 240：生成器对象的自有可枚举面为空", () => {
  it("Object.keys(g) → \"\"（改前：\"0,next,return,throw,constructor,@@iterator\"）", () => {
    expect(val(`export function f() { ${GEN} return Object.keys(gi).join(","); }`)).toEqual({
      ok: true,
      value: "",
    });
  });

  it("Object.getOwnPropertyNames(g) → \"\"", () => {
    expect(
      val(`export function f() { ${GEN} return Object.getOwnPropertyNames(gi).join(","); }`),
    ).toEqual({ ok: true, value: "" });
  });

  it("for-in 累积 → \"\"", () => {
    expect(
      val(`export function f() { ${GEN} let s = ""; for (const k in gi) s += k; return s; }`),
    ).toEqual({ ok: true, value: "" });
  });

  it("hasOwnProperty(\"next\") → false（协议方法在原型上，不在自有面）", () => {
    expect(
      val(`export function f() { ${GEN} return Object.prototype.hasOwnProperty.call(gi, "next"); }`),
    ).toEqual({ ok: true, value: false });
  });

  it("负控制：协议面仍可用（typeof gi.next → \"function\"，gi.next().value → 1）", () => {
    expect(
      val(`export function f() { ${GEN} return typeof gi.next + ":" + gi.next().value; }`),
    ).toEqual({ ok: true, value: "function:1" });
  });

  it("负控制：\"next\" in gi → true（原型链命中，与原生一致）", () => {
    expect(val(`export function f() { ${GEN} return "next" in gi; }`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：解构 lowering 仍按序取到元素（const [a] = gi → 1）", () => {
    expect(val(`export function f() { ${GEN} const [a] = gi; return a; }`)).toEqual({
      ok: true,
      value: 1,
    });
  });

  it.todo("原生 g[0] 恒 undefined —— 需解除族 01「数字下标读（历史口径）」结论");
  it.todo("原生 \"0\" in g 恒 false —— 同上（数字下标槽仍在自有面）");
});

describe("Bug 240（S18）：投影面不发布 internal 槽", () => {
  it("签名面不发布协议方法槽（无 next/return/throw/constructor/@@iterator）", () => {
    const sig = formatAbs(
      call(`export function* g() { yield 1; yield "s"; }`, "g").result as never,
    );
    // 协议方法槽是 internal 槽（原生挂在原型上，不是自有属性）⇒ 不进投影面
    expect(sig).not.toContain("next");
    expect(sig).not.toContain("return");
    expect(sig).not.toContain("throw");
    expect(sig).not.toContain("constructor");
    expect(sig).not.toContain("@@iterator");
    // 负控制：元素域（数字下标槽）仍发布
    expect(sig).toContain('"0": 1');
    expect(sig).toContain('"1": "s"');
  });

  it("签名面保留数字下标元素域（yield* s → \"0\": string）——族 01 口径不被破", () => {
    const strAbs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    const sig = formatAbs(
      call(`export function* g(s) { yield* s; }`, "g", [strAbs]).result as never,
    );
    expect(sig).toContain('"0": string');
    expect(sig).not.toContain("unknown");
  });

  it("@@iterator 槽按符号键投影建模（\"@@iterator\" 槽带 symbolKey 标记）", () => {
    const shape = call(`export function* g() { yield 1; }`, "g").result.shape as unknown as {
      k: string;
      slots: Record<string, { internal?: boolean; symbolKey?: boolean }>;
    };
    expect(shape.k).toBe("obj");
    // 与用户写的 `[Symbol.X]` 静态字段同机制（族 01 Bug 149 / 203）
    expect(shape.slots["@@iterator"]?.symbolKey).toBe(true);
    expect(shape.slots["@@iterator"]?.internal).toBe(true);
  });

  it("负控制：协议面在运行面仍可用（typeof gi.next → \"function\"）", () => {
    expect(
      val(
        `export function f() { const gi = (function* () { yield 1; })(); return typeof gi.next; }`,
      ),
    ).toEqual({ ok: true, value: "function" });
  });
});
