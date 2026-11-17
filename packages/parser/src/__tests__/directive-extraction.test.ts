import { describe, it, expect } from "vitest";
import { extractDirectives } from "../directives.ts";
import { parse } from "../parse.ts";

function getDirectives(source: string) {
  const ast = parse(source);
  return extractDirectives(ast);
}

describe("@nudo:pure", () => {
  it("pure 与 case 可同时出现在一个 JSDoc 块", () => {
    const fns = getDirectives(`
      /**
       * @nudo:pure
       * @nudo:case "test" (1, 2)
       */
      function add(a, b) { return a + b; }
    `);
    expect(fns).toHaveLength(1);
    expect(fns[0].directives.map((d) => d.kind)).toEqual(expect.arrayContaining(["pure", "case"]));
  });
});

type SkipCase = { name: string; srcs: string[]; returnType: "number" | undefined };
const SKIP_CASES: SkipCase[] = [
  { name: "无返回类型", srcs: ["@nudo:skip"], returnType: undefined },
  { name: "=> number()（箭头形式）", srcs: ["@nudo:skip => number()"], returnType: "number" },
  { name: "(number())（括号形式）", srcs: ["@nudo:skip (number())"], returnType: "number" },
  { name: "散文 / 裸类型不是类型表达式", srcs: ["@nudo:skip this function is flaky", "@nudo:skip number()"], returnType: undefined },
];

describe("@nudo:skip 返回位语法", () => {
  it.each(SKIP_CASES)("$name", ({ srcs, returnType }) => {
    for (const line of srcs) {
      const fns = getDirectives(`
        /**
         * ${line}
         */
        function external() {}
      `);
      expect(fns).toHaveLength(1);
      const skip = fns[0].directives.find((d) => d.kind === "skip");
      expect(skip, `缺 skip：${line}`).toBeDefined();
      if (skip?.kind !== "skip") return;
      if (returnType === undefined) {
        expect(skip.returns).toBeUndefined();
      } else {
        expect(skip.returns?.shape.k).toBe("prim");
        if (skip.returns?.shape.k === "prim") expect(skip.returns.shape.type).toBe(returnType);
      }
    }
  });
});

const SAMPLE_CASES = [
  { name: "整数 count", count: 5 },
  { name: "小数 count 不截断", count: 3.5 },
  { name: "负数 count 不静默丢弃", count: -2 },
];

describe("@nudo:sample count", () => {
  it.each(SAMPLE_CASES)("$name", ({ count }) => {
    const fns = getDirectives(`
      /**
       * @nudo:sample ${count}
       */
      function loop(n) { return n; }
    `);
    const sample = fns[0]?.directives.find((d) => d.kind === "sample");
    expect(sample).toBeDefined();
    if (sample?.kind === "sample") expect(sample.count).toBe(count);
  });
});
