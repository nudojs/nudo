// GENERATED MERGE (scripts/tmp-merge-bugs.mjs): core-bug-399-fn-optional-params.test.ts + core-bug-399-optional-params-write-side.test.ts + core-bug-399-param-optional-flag.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { leqAbs, requiredFnArity } from "../leq.ts";
import { abs, type Abs, type Shape } from "../abs.ts";
import { formalParamDisplayNames, formalParamsFromNodes, type FormalParam } from "../format/param-surface.ts";
import { runTranspiled } from "../exec/run.ts";

describe("[merged] core-bug-399-fn-optional-params.test.ts", () => {
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
});

describe("[merged] core-bug-399-optional-params-write-side.test.ts", () => {
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
});

describe("[merged] core-bug-399-param-optional-flag.test.ts", () => {
/**
 * Bug 399（S3 只落**模型层**）—— 默认形参**可省略**，形参表必须带
 * `optional` 标记。
 *
 * 根因：`requiredFnArity` 靠**名字后缀**（`...rest` / `?`）判「可省」，
 * 而默认形参在 `formalParamDisplayNames` 里被渲染成**光秃秃的名字**
 * ⇒ 既非 `...` 也非 `?` ⇒ 默认形参被计成必选元数。
 *
 * 修法（族 08 · AGENT-CONTEXT §4 裁决）：`FormalParam` 的每个变体带
 * `optional?: boolean` 标记（true = 该位可省略），消费侧（S1 的
 * `requiredFnArity`）改读这个标记，不再靠名字后缀猜。
 *
 * 语义：`optional === true` ⇔ 该形参位**可以省略**：
 * - `kind: "default"`（`f(a, b = 1)`）⇒ true（默认形参可省）
 * - `kind: "rest"`（`f(...args)`）⇒ true（rest 恒可省）
 * - `kind: "pattern"` 且带默认值（`f({ a } = {})`）⇒ true
 * - `kind: "id"` / 无默认值的 pattern ⇒ false（必填）
 *
 * 反向钉：HEAD（未修）上 `optional` 字段不存在（undefined）⇒ 断言**必失败**。
 */



describe("Bug 399 formal param optional marker", () => {
  it("default param is marked optional", () => {
    const formals = formalParamsFromNodes([
      { type: "Identifier", name: "a" },
      { type: "AssignmentPattern", left: { type: "Identifier", name: "b" } },
      { type: "RestElement", argument: { type: "Identifier", name: "args" } },
    ] as never);
    expect(formals[0]!.optional).toBe(false);
    expect(formals[1]!.optional).toBe(true);
    expect(formals[2]!.optional).toBe(true);
  });

  it("pattern with a default value is optional, bare pattern is not", () => {
    const withDefault = formalParamsFromNodes([
      {
        type: "AssignmentPattern",
        left: {
          type: "ObjectPattern",
          properties: [
            {
              type: "ObjectProperty",
              key: { type: "Identifier", name: "a" },
              value: { type: "Identifier", name: "a" },
            },
          ],
        },
      },
    ] as never);
    const bare = formalParamsFromNodes([
      {
        type: "ObjectPattern",
        properties: [
          {
            type: "ObjectProperty",
            key: { type: "Identifier", name: "a" },
            value: { type: "Identifier", name: "a" },
          },
        ],
      },
    ] as never);
    expect(withDefault[0]!.optional).toBe(true);
    expect(bare[0]!.optional).toBe(false);
  });

  it("the marker is independent of the display name (no name-suffix guessing)", () => {
    const formals = formalParamsFromNodes([
      { type: "AssignmentPattern", left: { type: "Identifier", name: "b" } },
    ] as never);
    // 名字不带 `?` / `...` 后缀 ⇒ 消费侧必须读 optional 标记
    const p = formals[0]!;
    expect(p.kind === "default" ? p.name : undefined).toBe("b");
    expect(p.optional).toBe(true);
  });
});
});
