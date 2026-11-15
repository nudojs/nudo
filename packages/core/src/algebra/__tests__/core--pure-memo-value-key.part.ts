/**
 * Bug 281：@nudo:pure 的记忆化键必须是**值基**，不能是**变量身份**（term）。
 *
 * 旧实现：pureMemoKey = callBudgetKey("pure", "", args) ⇒ 键 = shape 种类 +
 * termToString(term) ⇒ term 是**变量 id**（不是值内容）⇒ 同一变量重绑定为
 * 不同值后仍命中旧缓存 ⇒ **陈旧结果**（宿主路径 use() 得 "2,2"，native 期望
 * "2,4"）。
 *
 * 本钉锁住：
 * - Abs 层（$call + markPureFn）：同一变量重绑定 ⇒ 缓存失效（重算）；
 * - Abs 层：不同变量同值 ⇒ 缓存命中（记忆化按**值**承诺）；
 * - 宿主函数路径（_memoize = "p"，同 service/eval-pure.ts 的落法）：同一变量
 *   重绑定 ⇒ use() 得 "2,4"；不同变量同值 ⇒ 命中；不同变量不同值 ⇒ 不得命中；
 * - 不可比较的实参（函数值）⇒ **不缓存**（宁可不算命中，也不能算出错误的
 *   命中——错误的命中 = 陈旧值 = 本条 bug 的根因）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { abs, litValue, type Abs } from "../abs.ts";
import { absFunction, markPureFn } from "../abs-fn.ts";
import { $call, clearPureMemo } from "../exec/call.ts";
import { clearPureCallMemo } from "../exec/calls.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";

beforeEach(() => {
  clearPureMemo();
  clearPureCallMemo();
});

/** 对象实参：shape = obj{v: <字面量>}，term = 变量 id（身份与内容解耦） */
function objArg(varId: string, v: number): Abs {
  return abs(
    {
      k: "obj",
      slots: {
        v: { value: abs({ k: "prim", type: "number" }, { op: "lit", value: v }, undefined, "exact") },
      },
    },
    { op: "var", id: varId },
    undefined,
    "exact",
  );
}

/** 纯函数 p(o) = o.v * 2（apply 钩子；调用次数即「是否重算」） */
function pureDouble(counter: { n: number }): Abs {
  const fn = absFunction(["o"], {
    apply: (args) => {
      counter.n += 1;
      const s = args[0]!.shape;
      if (s.k !== "obj") throw new Error("expect obj arg");
      const inner = litValue(s.slots["v"]!.value);
      if (!inner.ok) throw new Error("expect lit slot");
      return abs(
        { k: "prim", type: "number" },
        { op: "lit", value: Number(inner.value) * 2 },
        undefined,
        "exact",
      );
    },
  });
  markPureFn(fn as unknown as object, "p");
  return fn;
}

/** 宿主 JS 函数路径：_memoize = "p"（同 service/eval-pure.ts 的落法） */
function hostUse(src: string, entry = "use"): string {
  const exports = runTranspiled(src, { mode: "exec", maxLoopIters: 2000 });
  (exports["p"] as { _memoize?: string })._memoize = "p";
  const full = callTranspiledExportFull(exports, entry, []);
  const v = litValue(full.result);
  return v.ok ? String(v.value) : "<no-lit>";
}

describe("Bug 281 — pure memo 键值基（同一变量重绑定不得命中旧缓存）", () => {
  it("Abs 层：同一变量重绑定为不同值 ⇒ 缓存失效（重算）", () => {
    const c = { n: 0 };
    const fn = pureDouble(c);
    const r1 = $call(fn, [objArg("o", 1)]);
    const r2 = $call(fn, [objArg("o", 2)]);
    expect(litValue(r1)).toEqual({ ok: true, value: 2 });
    // 陈旧命中会得 2（= 旧缓存）；正确行为 = 重算得 4
    expect(litValue(r2)).toEqual({ ok: true, value: 4 });
    expect(c.n).toBe(2);
  });

  it("Abs 层：不同变量同值 ⇒ 缓存命中（记忆化按值承诺）", () => {
    const c = { n: 0 };
    const fn = pureDouble(c);
    const a = $call(fn, [objArg("a", 1)]);
    const b = $call(fn, [objArg("b", 1)]);
    expect(litValue(a)).toEqual({ ok: true, value: 2 });
    expect(litValue(b)).toEqual({ ok: true, value: 2 });
    // 值相同 ⇒ 命中 ⇒ 函数体只跑一次
    expect(c.n).toBe(1);
  });

  it("Abs 层：不可比较的实参（函数值）⇒ 不缓存（不算命中）", () => {
    const c = { n: 0 };
    const fn = absFunction(["f"], {
      apply: () => {
        c.n += 1;
        return abs({ k: "prim", type: "number" }, { op: "lit", value: 1 }, undefined, "exact");
      },
    });
    markPureFn(fn as unknown as object, "pFnArg");
    const arg = absFunction([], { apply: () => abs({ k: "never" }, undefined, undefined, "exact") });
    $call(fn, [arg]);
    $call(fn, [arg]);
    // 函数值不可比 ⇒ 不缓存 ⇒ 两次都真跑（保守：宁可不算命中）
    expect(c.n).toBe(2);
  });

  it("宿主函数路径：同一变量重绑定 ⇒ use() 得 \"2,4\"（native 口径）", () => {
    const out = hostUse(`export function p(o) { return o.v * 2; }
export function use() {
  let o = { v: 1 };
  const a = p(o);
  o = { v: 2 };
  const b = p(o);
  return String(a) + "," + String(b);
}`);
    expect(out).toBe("2,4");
  });

  it("宿主函数路径：不同变量同值 ⇒ 命中（函数体只跑一次）", () => {
    const out = hostUse(`let calls = 0;
export function p(o) { calls = calls + 1; return o.v * 2; }
export function use() {
  const a = { v: 1 };
  const b = { v: 1 };
  const x = p(a);
  const y = p(b);
  return String(x) + "," + String(y) + ",calls=" + calls;
}`);
    expect(out).toBe("2,2,calls=1");
  });

  it("宿主函数路径：不同变量不同值 ⇒ 不得命中（\"2,4,calls=2\"）", () => {
    const out = hostUse(`let calls = 0;
export function p(o) { calls = calls + 1; return o.v * 2; }
export function use() {
  const a = { v: 1 };
  const b = { v: 2 };
  const x = p(a);
  const y = p(b);
  return String(x) + "," + String(y) + ",calls=" + calls;
}`);
    expect(out).toBe("2,4,calls=2");
  });
});
