import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective, parseTypeValueExpr } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";
import { analyzeFile } from "@nudojs/service";

function inferWithMocks(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];

  for (const fn of directives) {
    // Apply mocks first
    for (const d of fn.directives) {
      if (d.kind === "mock") {
        if (d.arrowFn) {
          const fnType = T.fn(d.arrowFn.params, d.arrowFn.body, env);
          (fnType as any)._paramPatterns = d.arrowFn.paramPatterns;
          env.bind(d.name, fnType);
        } else if (d.expression) {
          env.bind(d.name, parseTypeValueExpr(d.expression));
        }
      }
    }

    const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
    for (const dir of caseDirectives) {
      const result = evaluateFunctionFull(fn.node, dir.args, env);
      results.push({
        name: fn.name,
        caseName: dir.name,
        result: typeValueToString(result.value),
      });
    }
  }
  return results;
}

describe("Mock Arrow Functions", () => {
  it("supports arrow function mock with direct call", () => {
    const results = inferWithMocks(`
// @nudo:mock fn = (x) => x > 3
// @nudo:case "num" (5)
function test(x) {
  return fn(x);
}
`);
    // fn(5) should return true since 5 > 3
    expect(results[0].result).toBe("true");
  });

  it("supports arrow function mock for filter", () => {
    const results = inferWithMocks(`
// @nudo:mock fn = (x) => x > 3
// @nudo:case "nums" ([1, 2, 3, 4, 5])
function filter(arr) {
  const result = [];
  for (const item of arr) {
    if (fn(item)) result.push(item);
  }
  return result;
}
`);
    // Should filter to [4, 5]
    expect(results[0].result).toBe("[4, 5]");
  });

  it("supports arrow function mock with multiple params", () => {
    const results = inferWithMocks(`
// @nudo:mock fn = (a, b) => a + b
// @nudo:case "nums" ([1, 2, 3])
function sum(arr) {
  return arr.reduce(fn, 0);
}
`);
    // reduce with (a, b) => a + b and [1, 2, 3] should give 6
    expect(results[0].result).toBe("6");
  });

  it("supports arrow function mock with string operations", () => {
    const results = inferWithMocks(`
// @nudo:mock fn = (x) => x.toUpperCase()
// @nudo:case "str" ("hello")
function transform(x) {
  return fn(x);
}
`);
    // fn("hello") should return "HELLO"
    expect(results[0].result).toBe('"HELLO"');
  });
});

describe("Mock Arrow Functions: builtin HOF propagation", () => {
  it("mock arrow propagates through items.map(fn) with object results", () => {
    const results = inferWithMocks(`
// @nudo:mock fn = (x) => ({ ok: true })
// @nudo:case "items" ([1, 2, 3])
function applyAll(items) {
  return items.map(fn);
}
`);
    // mock 函数值透传给 builtin HOF：与内联箭头 items.map(x => ({ ok: true })) 同机制
    expect(results[0].result).toBe("[{ ok: true }, { ok: true }, { ok: true }]");
  });

  it("mock arrow keeps propagating when the receiver is a union of arrays", () => {
    const results = inferWithMocks(`
// @nudo:mock fn = (x) => ({ ok: true })
// @nudo:case "go" ()
function applyUnion() {
  const items = Math.random() > 0.5 ? [1, 2] : [3, 4, 5];
  return items.map(fn);
}
`);
    // union 接收者按成员分布求值，不再保守降级 unknown
    expect(results[0].result).toBe("[{ ok: true }, { ok: true }] | [{ ok: true }, { ok: true }, { ok: true }]");
  });

  it("mock arrow reduce(fn, 0) over a union receiver still accumulates", () => {
    const results = inferWithMocks(`
// @nudo:mock add = (a, b) => a + b
// @nudo:case "go" ()
function sumUnion() {
  const xs = Math.random() > 0.5 ? [1, 2] : [3, 4, 5];
  return xs.reduce(add, 0);
}
`);
    expect(results[0].result).toBe("3 | 12");
  });
});

describe("Mock Arrow Functions: callback arg through call sites", () => {
  // 直接走 analyzer 主路径：mock 绑定必须先于全程序求值，顶层调用点
  // （mockHof([1,2,3])）在 evaluateProgram 中求值并记录 call@ case——
  // mock 晚于该点绑定会让「mock 函数值作为回调实参」整体降级 unknown。
  it("top-level call site: items.map(fn) with a mock arrow yields precise elements", () => {
    const result = analyzeFile("mock-hof-callsite.js", `
// @nudo:mock fn = (x) => ({ ok: true, v: x })
function mockHof(items) { return items.map(fn); }
mockHof([1, 2, 3]);
`);
    const fn = result.functions.find((f) => f.name === "mockHof");
    expect(fn).toBeDefined();
    expect(fn!.cases[0].source).toBe("callsite");
    expect(typeValueToString(fn!.cases[0].result)).toBe("[{ ok: true, v: 1 }, { ok: true, v: 2 }, { ok: true, v: 3 }]");
  });

  it("in-function call site: mock arrow through map/filter/reduce stays precise", () => {
    const result = analyzeFile("mock-hof-inner.js", `
// @nudo:mock fn = (x) => ({ ok: true, v: x })
// @nudo:mock pred = (x) => x > 1
// @nudo:mock add = (a, b) => a + b
function innerMap(items) { return items.map(fn); }
function innerFilter(xs) { return xs.filter(pred); }
function innerReduce(xs) { return xs.reduce(add, 0); }
const a = innerMap([1, 2]);
const b = innerFilter([1, 2, 3]);
const c = innerReduce([1, 2, 3]);
`);
    const map = result.functions.find((f) => f.name === "innerMap");
    const filter = result.functions.find((f) => f.name === "innerFilter");
    const reduce = result.functions.find((f) => f.name === "innerReduce");
    expect(typeValueToString(map!.cases[0].result)).toBe("[{ ok: true, v: 1 }, { ok: true, v: 2 }]");
    // filter 不丢元素类型
    expect(typeValueToString(filter!.cases[0].result)).toBe("2 | 3[]");
    expect(typeValueToString(reduce!.cases[0].result)).toBe("6");
  });
});
