/**
 * Bug 858 —— `@nudo:mock g = ({ a, b }) => a + b` 的**形参根本没被绑定** ⇒
 * mock 体读到未声明全局 ⇒ `ReferenceError` ⇒ **error 级**假红 + dts 产物写出
 * `caller(): never`（**错误类型声明**）。
 *
 * 根因（expr-scan.ts `parseArrowFunctionExpr` 的形参循环）：形参被降级成
 * 「名字 / 占位名」而**无绑定语义**——解构形参退化成占位名 `__destructured_0`、
 * `AssignmentPattern`（默认值）**整条丢弃**（连同 `params` / `paramPatterns` 的
 * 下标对齐）、rest 形参保留字面 `...`。
 *
 * 修法（parser 侧）：形参表现在带**绑定语义**——
 * - `params`：**JS 源码形态**（消费面拼函数签名用）：标识符是名字、默认形参保留
 *   默认值（`a = 1`）、rest 保留 `...`、解构保留源码形态（`{ a, b }`）；
 * - `paramPatterns`：形参 AST（原样，1:1 对齐）——消费面可自行解构绑定；
 * - `boundNames`：**绑定的名字**（解构列出顶层绑定名；rest 是裸名；默认是绑定名）
 *   ——自由标识符分析（作用域）按此判定「已被形参绑定」。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, type MockDirective } from "../directives.ts";
import { parseArrowFunctionExpr } from "../directives/expr-scan.ts";

function mockOf(source: string): MockDirective {
  const fns = extractDirectives(parse(source));
  const mocks = fns.flatMap((f) =>
    f.directives.filter((d): d is MockDirective => d.kind === "mock"),
  );
  expect(mocks).toHaveLength(1);
  return mocks[0]!;
}

describe("Bug 858: mock payload params carry binding semantics", () => {
  it("object destructuring keeps the pattern and exposes the bound names", () => {
    const r = parseArrowFunctionExpr("({ a, b }) => a + b");
    expect(r).not.toBeNull();
    expect(r!.params).toEqual(["{ a, b }"]);
    expect(r!.paramPatterns[0]!.type).toBe("ObjectPattern");
    expect(r!.boundNames).toEqual([["a", "b"]]);
  });

  it("array destructuring keeps the pattern and exposes the bound names", () => {
    const r = parseArrowFunctionExpr("([a, b]) => a + b");
    expect(r).not.toBeNull();
    expect(r!.params).toEqual(["[a, b]"]);
    expect(r!.paramPatterns[0]!.type).toBe("ArrayPattern");
    expect(r!.boundNames).toEqual([["a", "b"]]);
  });

  it("default value params are kept (not dropped) and expose the bound name", () => {
    const r = parseArrowFunctionExpr("(a = 1) => a");
    expect(r).not.toBeNull();
    expect(r!.params).toEqual(["a = 1"]);
    expect(r!.paramPatterns[0]!.type).toBe("AssignmentPattern");
    expect(r!.boundNames).toEqual([["a"]]);
  });

  it("rest params keep the `...` in the signature and expose the bare bound name", () => {
    const r = parseArrowFunctionExpr("(...args) => args.length");
    expect(r).not.toBeNull();
    expect(r!.params).toEqual(["...args"]);
    expect(r!.paramPatterns[0]!.type).toBe("RestElement");
    expect(r!.boundNames).toEqual([["args"]]);
  });

  it("plain identifiers are unchanged", () => {
    const r = parseArrowFunctionExpr("(a, b) => a + b");
    expect(r).not.toBeNull();
    expect(r!.params).toEqual(["a", "b"]);
    expect(r!.boundNames).toEqual([["a"], ["b"]]);
  });

  it("params / paramPatterns / boundNames stay 1:1 aligned (no dropped slots)", () => {
    const r = parseArrowFunctionExpr("(a = 1, { b }, ...rest) => a");
    expect(r).not.toBeNull();
    expect(r!.params).toHaveLength(3);
    expect(r!.paramPatterns).toHaveLength(3);
    expect(r!.boundNames).toHaveLength(3);
    expect(r!.boundNames).toEqual([["a"], ["b"], ["rest"]]);
  });

  it("the `@nudo:mock` directive carries the binding semantics", () => {
    const mock = mockOf(
      `/**
 * @nudo:mock g = ({ a, b }) => a + b
 */
export function caller() { return g({ a: 1, b: 2 }); }`,
    );
    expect(mock.arrowFn).toBeDefined();
    expect(mock.arrowFn!.params).toEqual(["{ a, b }"]);
    expect(mock.arrowFn!.paramPatterns[0]!.type).toBe("ObjectPattern");
    expect(mock.arrowFn!.boundNames).toEqual([["a", "b"]]);
  });
});
