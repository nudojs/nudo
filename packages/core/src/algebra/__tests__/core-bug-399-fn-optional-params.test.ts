/**
 * Bug 399 回归：默认形参**可省略** ⇒ 必选元数不能靠名字后缀猜。
 *
 * 根因（实测）：`packages/core/src/algebra/leq.ts` 的 `requiredFnArity` 按
 * 形参**名字**判必选（跳过 `...rest` / `x?`），而默认形参（`f(a, b = 1)`）
 * 在形参表面上只是**光秃秃的名字**（`b`）⇒ 被计成必选元数 ⇒
 * `f = (x = 1) => x` 被判「需要 1 个参数」⇒ `nudo:assign-mismatch` **假红**
 * （JS 语义下 `(x = 1) => x` 的 `length` 是 0）。
 *
 * 修法（读侧，本片）：fn shape 增**可选**字段 `optionalParams?: boolean[]`
 * （与 `params` 同下标，true = 该位可省），`leq` 读它算必选元数；缺省回退
 * `requiredFnArity`（**公开签名与既有行为一字不改**）。
 *
 * 写侧（模型 → shape）由族内另一片负责：形参表面（`FormalParam.optional`，
 * 族 03 已落）→ fn shape 的 `optionalParams`。本钉把**写侧口径**一并钉住
 * （形参表面 → shape → `leq` 判定），使写侧落地后不必再改钉。
 */
import { describe, it, expect } from "vitest";
import { leqAbs, requiredFnArity } from "../leq.ts";
import { abs, type Abs, type Shape } from "../abs.ts";
import {
  formalParamDisplayNames,
  formalParamsFromNodes,
  type FormalParam,
} from "../param-surface.ts";

/** fn shape（可选带 `optionalParams` 标记——写侧口径） */
function fnAbs(params: string[], optionalParams?: boolean[]): Abs {
  const shape = {
    k: "fn" as const,
    params,
    ...(optionalParams ? { optionalParams } : {}),
  };
  return abs(shape as Shape, undefined, undefined, "exact");
}

/** 形参表面 → fn shape（写侧口径：形参 optional 标记 → shape optionalParams） */
function fnAbsFromFormals(formals: FormalParam[]): Abs {
  return fnAbs(
    formalParamDisplayNames(formals),
    formals.map((f) => f.optional === true),
  );
}

/** AST 形参节点（结构化字面量——不必引 parser） */
function paramsOf(...nodes: Array<Record<string, unknown>>) {
  return formalParamsFromNodes(nodes as never);
}

describe("Bug 399：默认形参可省略 ⇒ 必选元数读 optionalParams 标记", () => {
  it("模型层：默认形参带 optional 标记、普通形参不带", () => {
    const formals = paramsOf(
      { type: "Identifier", name: "a" },
      {
        type: "AssignmentPattern",
        left: { type: "Identifier", name: "b" },
        right: { type: "NumericLiteral", value: 1 },
      },
    );
    expect(formals.map((f) => f.optional)).toEqual([false, true]);
    expect(formalParamDisplayNames(formals)).toEqual(["a", "b"]);
  });

  it("端到端（读侧）：f(a, b = 1) 赋给「只需 1 个必选元」的 fn ⇒ 可赋值", () => {
    const src = fnAbsFromFormals(
      paramsOf(
        { type: "Identifier", name: "a" },
        {
          type: "AssignmentPattern",
          left: { type: "Identifier", name: "b" },
          right: { type: "NumericLiteral", value: 1 },
        },
      ),
    );
    expect(src.shape.k).toBe("fn");
    expect(leqAbs(src, fnAbs(["a"])).ok).toBe(true);
  });

  it("反向控制：f(a, b)（无默认）⇒ 不可赋值（必选 2 > 目标必选 1）", () => {
    const src = fnAbsFromFormals(
      paramsOf({ type: "Identifier", name: "a" }, { type: "Identifier", name: "b" }),
    );
    const r = leqAbs(src, fnAbs(["a"]));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("fn arity required 2");
  });

  it("反向控制：f(a, b = 1) 赋给「0 个必选元」的 fn ⇒ 仍不可赋值（a 是必选）", () => {
    const src = fnAbsFromFormals(
      paramsOf(
        { type: "Identifier", name: "a" },
        {
          type: "AssignmentPattern",
          left: { type: "Identifier", name: "b" },
          right: { type: "NumericLiteral", value: 1 },
        },
      ),
    );
    const r = leqAbs(src, fnAbs([]));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("fn arity required 1");
  });

  it("缺省标记时回退名字后缀判据（既有行为不变）", () => {
    expect(leqAbs(fnAbs(["a", "b"]), fnAbs(["a"])).ok).toBe(false);
    expect(leqAbs(fnAbs(["a", "...rest"]), fnAbs(["a"])).ok).toBe(true);
    expect(leqAbs(fnAbs(["a", "b?"]), fnAbs(["a"])).ok).toBe(true);
  });

  it("公开口径 requiredFnArity 一字不改", () => {
    expect(requiredFnArity(["x0", "...paths"])).toBe(1);
    expect(requiredFnArity(["options?"])).toBe(0);
    expect(requiredFnArity(["path", "ext?"])).toBe(1);
    expect(requiredFnArity(["a", "b"])).toBe(2);
    expect(requiredFnArity(undefined)).toBe(0);
  });
});
