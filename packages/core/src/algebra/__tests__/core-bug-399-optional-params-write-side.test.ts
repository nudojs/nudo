/**
 * Bug 399 回归（**写侧**）：形参表面（`FormalParam.optional`）→ fn shape 的
 * `optionalParams` 标记 → `leq` 的必选元数判定。
 *
 * 读侧钉在 `core-bug-399-fn-optional-params.test.ts`（模型层：形参表面 →
 * shape → `leq`）；本钉走**真实管线**（源码 → 转译 → fn shape），
 * 因为写侧的每一跳都在真实路径上才生效：
 *
 * - 转译面：函数表达式 / 箭头 → `transpile/expr/function.ts` 的 `$fnVal(...)`
 *   发射 `optionalParams: [...]`（`transpile/helpers.ts` 的
 *   `paramOptionalFlags`，与 `paramDisplayNames` 同源同长度 ⇒ 下标对齐）；
 * - 声明面：`generalize.ts` 的 6 个 `env.fns.set` 写 `optionalParams`，
 *   `abs-modules.ts` 的 `fnToAbs` 读出；
 * - 载体：`AbsFnImpl.optionalParams` → `absFunction` 落进 `Shape.k==="fn"`；
 * - 消费：`leq.ts` 的 `fnRequiredArity`（先读标记，缺省回退名字后缀）。
 *
 * 产品症状：`let f = () => 2; f = (x = 1) => x;` ⇒ 新值被计成「需要 1 个
 * 参数」而旧值是 0 ⇒ `nudo:assign-mismatch` **假红**（JS 语义下
 * `(x = 1) => x` 的 `length` 是 0 ⇒ 可零参调用）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled } from "../exec/run.ts";
import { leqAbs } from "../leq.ts";
import { abs, type Abs } from "../abs.ts";

/** 转译产物里取某个导出绑定的 fn shape */
function fnShapeOf(src: string, name: string): { params: string[]; optionalParams?: boolean[] } | undefined {
  const exports = runTranspiled(src, { mode: "analyze" }) as Record<string, Abs>;
  const v = exports[name];
  const sh = v?.shape;
  if (!sh || sh.k !== "fn") return undefined;
  return { params: sh.params, optionalParams: sh.optionalParams };
}

/** fn shape（无标记）——目标侧 */
function fnAbs(params: string[]): Abs {
  return abs({ k: "fn", params }, undefined, undefined, "exact");
}

describe("Bug 399（写侧）：默认形参的「可省略」标记真的落到了 fn shape 上", () => {
  it("箭头函数：默认形参位标为可省略", () => {
    const sh = fnShapeOf("export const f = (x = 1) => x;", "f");
    expect(sh).toBeDefined();
    expect(sh!.params).toEqual(["x"]);
    expect(sh!.optionalParams).toEqual([true]);
  });

  it("箭头函数：普通形参位不标为可省略", () => {
    const sh = fnShapeOf("export const f = (x, y = 1) => x + y;", "f");
    expect(sh).toBeDefined();
    expect(sh!.optionalParams).toEqual([false, true]);
  });

  it("必选元数按标记算：`(x = 1) => x` 赋给「0 个必选元」的 fn ⇒ 可赋值", () => {
    const sh = fnShapeOf("export const f = (x = 1) => x;", "f");
    const src = abs(
      { k: "fn", params: sh!.params, optionalParams: sh!.optionalParams },
      undefined,
      undefined,
      "exact",
    );
    expect(leqAbs(src, fnAbs([])).ok).toBe(true);
  });

  it("反向控制：无默认值的 `(x, y)` 赋给「0 个必选元」的 fn ⇒ 不可赋值", () => {
    const sh = fnShapeOf("export const f = (x, y) => x + y;", "f");
    const src = abs(
      { k: "fn", params: sh!.params, optionalParams: sh!.optionalParams },
      undefined,
      undefined,
      "exact",
    );
    const r = leqAbs(src, fnAbs([]));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("fn arity required 2");
  });

  it("反向控制：默认形参**不**抹掉前面形参的必选性（`(x, y = 1)` 仍需 1 个）", () => {
    const sh = fnShapeOf("export const f = (x, y = 1) => x + y;", "f");
    const src = abs(
      { k: "fn", params: sh!.params, optionalParams: sh!.optionalParams },
      undefined,
      undefined,
      "exact",
    );
    const r = leqAbs(src, fnAbs([]));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("fn arity required 1");
  });
});
