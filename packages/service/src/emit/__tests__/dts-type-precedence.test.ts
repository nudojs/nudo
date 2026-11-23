/**
 * dts 类型 IR 的**优先级矩阵**：不仅比文本，还把每个产物类型送进
 * `tsc --strict`，防止 `A & B[]` 这类“能编译但语义错”的退化。
 */
import { describe, it, expect } from "vitest";
import { abs, joinAbs, num, numLit, str, strLit, type Abs } from "@nudojs/core";
import { createTemplateAbs } from "@nudojs/core/internal";
import {
  dtsTypeOfAbs,
  renderDtsType,
  type DtsType,
  type DtsTypeOpts,
} from "../dts-type.ts";
import { tscNoEmitSingle } from "./dts-tsc.ts";

const mk = (shape: Abs["shape"]): Abs => abs(shape, undefined, undefined, "exact");
const fn = (params: string[], paramTypes: Abs[], returnType: Abs): Abs =>
  mk({ k: "fn", params, paramTypes, returnType } as never);

const view = (): Abs =>
  mk({
    k: "obj",
    slots: {
      "0": { value: strLit("a") },
      length: { value: numLit(1) },
      index: { value: numLit(0) },
    },
    view: "array",
  } as never);

const render = (a: Abs, opts: DtsTypeOpts = {}): string =>
  renderDtsType(dtsTypeOfAbs(a, opts));

function expectValidType(text: string, label?: string): void {
  const check = tscNoEmitSingle(`export type T = ${text};`, "precedence.ts");
  expect(check.ok, `${label ?? text}\n${check.stderr}`).toBe(true);
}

/** tsc 语义对拍：渲染类型必须与期望类型**完全相同**（条件类型等价的严格版）。 */
function expectExactType(actual: string, expected: string, label: string): void {
  const check = tscNoEmitSingle(
    [
      "type IsExact<A, B> =",
      "  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)",
      "    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2)",
      "      ? true",
      "      : false",
      "    : false;",
      `type Actual = ${actual};`,
      `const ok: IsExact<Actual, ${expected}> = true;`,
    ].join("\n"),
    "precedence-exact.ts",
  );
  expect(check.ok, `${label}\nactual: ${actual}\nexpected: ${expected}\n${check.stderr}`).toBe(
    true,
  );
}

describe("dts 类型 IR 优先级矩阵", () => {
  it("array：union / fn / intersection 元素都加括号", () => {
    const union = mk({ k: "arr", element: joinAbs(num(), str()) });
    const fnArr = mk({ k: "arr", element: fn(["x"], [num()], str()) });
    const viewArr = mk({ k: "arr", element: view() });

    expect(render(union)).toBe("(number | string)[]");
    expect(render(fnArr)).toBe("((x: number) => string)[]");
    expect(render(viewArr)).toBe('(["a"] & { index: 0 })[]');
    for (const a of [union, fnArr, viewArr]) expectValidType(render(a));
  });

  it("tuple rest：union / fn / intersection 都加括号", () => {
    const restUnion = mk({
      k: "tuple",
      elements: [str()],
      rest: joinAbs(num(), str()),
    });
    const restFn = mk({
      k: "tuple",
      elements: [str()],
      rest: fn(["x"], [num()], str()),
    });
    const restView = mk({ k: "tuple", elements: [str()], rest: view() });

    expect(render(restUnion)).toBe("[string, ...(number | string)[]]");
    expect(render(restFn)).toBe("[string, ...((x: number) => string)[]]");
    expect(render(restView)).toBe('[string, ...(["a"] & { index: 0 })[]]');
    for (const a of [restUnion, restFn, restView]) expectValidType(render(a));
  });

  it("tsc 语义等价：括号只影响解析，不改变类型", () => {
    const arrUnion = render(mk({ k: "arr", element: joinAbs(num(), str()) }));
    const arrFn = render(mk({ k: "arr", element: fn(["x"], [num()], str()) }));
    const restUnion = render(
      mk({ k: "tuple", elements: [str()], rest: joinAbs(num(), str()) }),
    );
    const optUnion = render(
      mk({
        k: "obj",
        slots: { f: { value: joinAbs(num(), str()), optional: true } },
      } as never),
    );
    const roArr = render(mk({ k: "arr", element: num() }), { readonlyValues: true });
    const unionFn = render(
      mk({ k: "sum", members: [fn(["x"], [num()], str()), num()] }),
    );

    expectExactType(arrUnion, "(number | string)[]", "array union");
    expectExactType(arrFn, "Array<(x: number) => string>", "array fn");
    expectExactType(restUnion, "[string, ...(number | string)[]]", "tuple rest union");
    expectExactType(optUnion, "{ f?: number | string }", "optional union");
    expectExactType(roArr, "ReadonlyArray<number>", "readonly array");
    expectExactType(unionFn, "number | ((x: number) => string)", "union fn");
  });

  it("union：fn 加括号；intersection 依赖 & 高于 | 的优先级", () => {
    const uFn = mk({ k: "sum", members: [fn(["x"], [num()], str()), num()] });
    const uView = mk({ k: "sum", members: [view(), num()] });

    expect(render(uFn)).toBe("((x: number) => string) | number");
    expect(render(uView)).toBe('["a"] & { index: 0 } | number');
    expectValidType(render(uFn));
    expectValidType(render(uView));
  });

  it("object optional：union / fn 值加括号", () => {
    const optUnion = mk({
      k: "obj",
      slots: { f: { value: joinAbs(num(), str()), optional: true } },
    } as never);
    const optFn = mk({
      k: "obj",
      slots: { f: { value: fn(["x"], [num()], str()), optional: true } },
    } as never);

    expect(render(optUnion)).toBe("{ f?: (number | string) }");
    expect(render(optFn)).toBe("{ f?: ((x: number) => string) }");
    expectValidType(render(optUnion));
    expectValidType(render(optFn));
  });

  it("readonly 数组 / 元组 / Readonly 对象", () => {
    const arr = mk({ k: "arr", element: num() });
    const tuple = mk({ k: "tuple", elements: [numLit(1)] });
    const obj = mk({ k: "obj", slots: { a: { value: num() } } });
    const roObj = { ...obj, facets: { frozen: true } } as Abs;

    expect(render(arr, { readonlyValues: true })).toBe("readonly number[]");
    expect(render(tuple, { readonlyValues: true })).toBe("readonly [1]");
    expect(render(roObj)).toBe("Readonly<{ a: number }>");
    for (const text of [
      render(arr, { readonlyValues: true }),
      render(tuple, { readonlyValues: true }),
      render(roObj),
    ]) {
      expectValidType(text);
    }
  });

  it("显式节点类别：typeVar / truncated / group / annotated", () => {
    const typeVar = abs({ k: "any" }, { op: "var", id: "T" }, undefined, "path");
    expect(render(typeVar, { typeVars: new Map([["T", "T"]]) })).toBe("T");

    expect(
      renderDtsType({
        kind: "array",
        element: { kind: "truncated", reason: "cycle" },
      }),
    ).toBe("/* nudo:truncated:cycle */ unknown[]");
    expect(
      renderDtsType({
        kind: "template",
        parts: [{ fixed: "id-" }, { type: { kind: "truncated", reason: "depth" } }],
      }),
    ).toBe("`id-${/* nudo:truncated:depth */ string}`");
    expect(
      renderDtsType({
        kind: "tuple",
        elements: [
          {
            kind: "group",
            inner: {
              kind: "union",
              members: [
                { kind: "prim", name: "number" },
                { kind: "prim", name: "string" },
              ],
            },
          },
        ],
      }),
    ).toBe("[(number | string)]");
    expect(
      renderDtsType({
        kind: "fn",
        params: [{ name: "x", type: { kind: "prim", name: "number" } }],
        returnType: { kind: "annotated", text: "string | null" },
      }),
    ).toBe("(x: number) => string | null");
  });

  it("所有节点类别在嵌套位置都能被 tsc 解析", () => {
    const atoms: Array<[string, DtsType]> = [
      ["prim", { kind: "prim", name: "number" }],
      ["literal", { kind: "literal", text: '"a"' }],
      ["never", { kind: "never" }],
      ["unknown", { kind: "unknown" }],
      ["array", { kind: "array", element: { kind: "prim", name: "number" } }],
      [
        "tuple",
        { kind: "tuple", elements: [{ kind: "prim", name: "number" }] },
      ],
      [
        "union",
        {
          kind: "union",
          members: [
            { kind: "prim", name: "number" },
            { kind: "prim", name: "string" },
          ],
        },
      ],
      [
        "intersection",
        {
          kind: "intersection",
          members: [
            { kind: "prim", name: "number" },
            { kind: "object", slots: [] },
          ],
        },
      ],
      [
        "object",
        {
          kind: "object",
          slots: [{ key: "v", type: { kind: "prim", name: "number" } }],
        },
      ],
      [
        "generic",
        { kind: "generic", name: "Array", args: [{ kind: "prim", name: "number" }] },
      ],
      ["named", { kind: "named", text: "Date" }],
      ["annotated", { kind: "annotated", text: "string" }],
      ["truncated", { kind: "truncated", reason: "cycle" }],
      [
        "group",
        {
          kind: "group",
          inner: {
            kind: "union",
            members: [
              { kind: "prim", name: "number" },
              { kind: "prim", name: "string" },
            ],
          },
        },
      ],
      [
        "template",
        {
          kind: "template",
          parts: [{ fixed: "id-" }, { type: { kind: "prim", name: "number" } }],
        },
      ],
      [
        "fn",
        {
          kind: "fn",
          params: [{ name: "x", type: { kind: "prim", name: "number" } }],
          returnType: { kind: "prim", name: "string" },
        },
      ],
      [
        "overloads",
        {
          kind: "overloads",
          arms: [
            {
              paramTypes: [{ kind: "prim", name: "number" }],
              returnType: { kind: "prim", name: "string" },
            },
          ],
        },
      ],
    ];
    const contexts: Array<[string, (t: DtsType) => DtsType]> = [
      ["direct", (t) => t],
      ["array", (t) => ({ kind: "array", element: t })],
      ["tuple", (t) => ({ kind: "tuple", elements: [t] })],
      [
        "rest",
        (t) => ({ kind: "tuple", elements: [{ kind: "prim", name: "number" }], rest: t }),
      ],
      ["union", (t) => ({ kind: "union", members: [t, { kind: "never" }] })],
      [
        "intersection",
        (t) => ({ kind: "intersection", members: [t, { kind: "object", slots: [] }] }),
      ],
      [
        "optional",
        (t) => ({
          kind: "object",
          slots: [{ key: "v", type: t, optional: true }],
        }),
      ],
      [
        "generic",
        (t) => ({ kind: "generic", name: "Array", args: [t] }),
      ],
      [
        "fn-param",
        (t) => ({
          kind: "fn",
          params: [{ name: "x", type: t }],
          returnType: { kind: "prim", name: "string" },
        }),
      ],
      [
        "fn-return",
        (t) => ({
          kind: "fn",
          params: [],
          returnType: t,
        }),
      ],
    ];
    for (const [name, atom] of atoms) {
      for (const [ctx, wrap] of contexts) {
        const text = renderDtsType(wrap(atom));
        expectValidType(text, `${name} in ${ctx}`);
      }
    }
  });

  it("generic / template / 截断标记仍是合法类型", () => {
    const map = mk({
      k: "brand",
      name: "Map",
      shape: mk({ k: "obj", slots: {} }),
    } as never);
    const tpl = createTemplateAbs([strLit("id-"), num()]);
    expect(render(map)).toBe("Map<unknown, unknown>");
    expectValidType(render(map));
    expect(render(tpl)).toBe("`id-${number}`");
    expectValidType(render(tpl));

    // 截断标记直接作为类型文本必须可编译。
    expectValidType("/* nudo:truncated:cycle */ unknown");
    expectValidType("/* nudo:truncated:depth */ unknown[]");
  });
});
