/**
 * `DtsType` 的独立文本 oracle。
 *
 * 与 `dts-type.test.ts` 的 snapshot 不同：这里期望文本是**手写常量**，不随
 * IR 实现自动更新；新增 IR 节点或改渲染规则时，必须显式更新此表。
 * 每个产物同时过 `tsc --strict`，保证手写期望本身是合法类型。
 */
import { describe, it, expect } from "vitest";
import { renderDtsType, type DtsType } from "../dts-type.ts";
import { tscNoEmitSingle } from "./dts-tsc.ts";

const cases: Array<[string, DtsType, string]> = [
  ["prim", { kind: "prim", name: "number" }, "number"],
  ["literal", { kind: "literal", text: '"a"' }, '"a"'],
  ["never", { kind: "never" }, "never"],
  ["unknown", { kind: "unknown" }, "unknown"],
  ["array", { kind: "array", element: { kind: "prim", name: "string" } }, "string[]"],
  [
    "array-union",
    {
      kind: "array",
      element: {
        kind: "union",
        members: [
          { kind: "prim", name: "number" },
          { kind: "prim", name: "string" },
        ],
      },
    },
    "(number | string)[]",
  ],
  [
    "tuple",
    {
      kind: "tuple",
      elements: [
        { kind: "prim", name: "number" },
        { kind: "prim", name: "string" },
      ],
    },
    "[number, string]",
  ],
  [
    "tuple-rest",
    {
      kind: "tuple",
      elements: [{ kind: "prim", name: "number" }],
      rest: {
        kind: "union",
        members: [
          { kind: "prim", name: "number" },
          { kind: "prim", name: "string" },
        ],
      },
    },
    "[number, ...(number | string)[]]",
  ],
  [
    "object",
    {
      kind: "object",
      slots: [
        { key: "a", type: { kind: "prim", name: "number" } },
        { key: "b", type: { kind: "prim", name: "string" }, optional: true },
      ],
    },
    "{ a: number; b?: string }",
  ],
  [
    "object-union",
    {
      kind: "object",
      slots: [
        {
          key: "v",
          optional: true,
          type: {
            kind: "union",
            members: [
              { kind: "prim", name: "number" },
              { kind: "prim", name: "string" },
            ],
          },
        },
      ],
    },
    "{ v?: (number | string) }",
  ],
  [
    "intersection",
    {
      kind: "intersection",
      members: [
        {
          kind: "object",
          slots: [{ key: "a", type: { kind: "prim", name: "number" } }],
        },
        {
          kind: "object",
          slots: [{ key: "b", type: { kind: "prim", name: "string" } }],
        },
      ],
    },
    "{ a: number } & { b: string }",
  ],
  [
    "generic",
    {
      kind: "generic",
      name: "Map",
      args: [{ kind: "prim", name: "string" }, { kind: "prim", name: "number" }],
    },
    "Map<string, number>",
  ],
  ["named", { kind: "named", text: "Date" }, "Date"],
  ["annotated", { kind: "annotated", text: "string | null" }, "string | null"],
  ["truncated", { kind: "truncated", reason: "cycle" }, "/* nudo:truncated:cycle */ unknown"],
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
    "(number | string)",
  ],
  [
    "template",
    { kind: "template", parts: [{ fixed: "id-" }, { type: { kind: "prim", name: "number" } }] },
    "`id-${number}`",
  ],
  [
    "fn",
    {
      kind: "fn",
      params: [{ name: "x", type: { kind: "prim", name: "number" } }],
      returnType: { kind: "prim", name: "string" },
    },
    "(x: number) => string",
  ],
  [
    "union-fn",
    {
      kind: "union",
      members: [
        {
          kind: "fn",
          params: [{ name: "x", type: { kind: "prim", name: "number" } }],
          returnType: { kind: "prim", name: "string" },
        },
        { kind: "prim", name: "number" },
      ],
    },
    "((x: number) => string) | number",
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
    "{ (a0: number): string }",
  ],
];

describe("DtsType 独立文本 oracle", () => {
  for (const [name, node, expected] of cases) {
    it(name, () => {
      const text = renderDtsType(node);
      expect(text).toBe(expected);
      const check = tscNoEmitSingle(`export type T = ${text};`, "oracle.ts");
      expect(check.ok, check.stderr).toBe(true);
    });
  }
});
