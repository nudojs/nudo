import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective, type MockDirective, parseTypeValueExpr } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function inferWithMocks(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];

  for (const fn of directives) {
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

describe("Real-world Mock Tests", () => {
  // 测试1: 基础 filter
  it("filter with predicate", () => {
    const results = inferWithMocks(`
// @nudo:mock predicate = (x) => x > 3
// @nudo:case "nums" ([1, 2, 3, 4, 5])
function filterGreater(arr) {
  const result = [];
  for (const item of arr) {
    if (predicate(item)) result.push(item);
  }
  return result;
}
`);
    expect(results[0].result).toBe("[4, 5]");
  });

  // 测试2: map
  it("map with transform", () => {
    const results = inferWithMocks(`
// @nudo:mock transform = (x) => x * 2
// @nudo:case "nums" ([1, 2, 3])
function doubleAll(arr) {
  return arr.map(transform);
}
`);
    expect(results[0].result).toBe("[2, 4, 6]");
  });

  // 测试3: reduce
  it("reduce with reducer", () => {
    const results = inferWithMocks(`
// @nudo:mock reducer = (a, b) => a + b
// @nudo:case "nums" ([1, 2, 3, 4])
function sumAll(arr) {
  return arr.reduce(reducer, 0);
}
`);
    expect(results[0].result).toBe("10");
  });

  // 测试4: 多参数
  it("multi-parameter mock", () => {
    const results = inferWithMocks(`
// @nudo:mock combine = (a, b) => a + b * 10
// @nudo:case "nums" (3, 4)
function combineNums(a, b) {
  return combine(a, b);
}
`);
    expect(results[0].result).toBe("43");
  });

  // 测试5: 函数组合
  it("function composition", () => {
    const results = inferWithMocks(`
// @nudo:mock f = (x) => x + 1
// @nudo:mock g = (x) => x * 2
// @nudo:case "num" (5)
function compose(x) {
  return f(g(x));
}
`);
    expect(results[0].result).toBe("11");
  });

  // 测试6: 回调模式
  it("callback pattern", () => {
    const results = inferWithMocks(`
// @nudo:mock callback = (result) => result * 2
// @nudo:case "num" (21)
function processWithCallback(x) {
  return callback(x);
}
`);
    expect(results[0].result).toBe("42");
  });

  // 测试7: 字符串操作
  it("string operations", () => {
    const results = inferWithMocks(`
// @nudo:mock transform = (s) => s.toUpperCase()
// @nudo:case "str" ("hello")
function transformStr(s) {
  return transform(s);
}
`);
    expect(results[0].result).toBe('"HELLO"');
  });

  // 测试8: 条件逻辑
  it("conditional logic", () => {
    const results = inferWithMocks(`
// @nudo:mock validator = (x) => x > 0 && x < 100
// @nudo:case "valid" (50)
// @nudo:case "invalid" (150)
function validate(x) {
  return validator(x);
}
`);
    expect(results[0].result).toBe("true");
    expect(results[1].result).toBe("false");
  });

  // 测试9: 返回数组
  it("return array", () => {
    const results = inferWithMocks(`
// @nudo:mock generator = (n) => [n, n * 2, n * 3]
// @nudo:case "num" (5)
function generateTriples(n) {
  return generator(n);
}
`);
    expect(results[0].result).toBe("[5, 10, 15]");
  });

  // 测试10: 类型收窄
  it("type narrowing", () => {
    const results = inferWithMocks(`
// @nudo:mock processor = (x) => typeof x === "string" ? x.toUpperCase() : x
// @nudo:case "str" ("hello")
// @nudo:case "num" (42)
function process(x) {
  return processor(x);
}
`);
    expect(results[0].result).toBe('"HELLO"');
    expect(results[1].result).toBe("42");
  });

  // 测试11: 无参数 mock
  it("no-parameter mock", () => {
    const results = inferWithMocks(`
// @nudo:mock getter = () => 42
// @nudo:case "empty" ()
function getValue() {
  return getter();
}
`);
    expect(results[0].result).toBe("42");
  });

  // 测试12: 复杂表达式
  it("complex expressions", () => {
    const results = inferWithMocks(`
// @nudo:mock calc = (a, b) => (a + b) * (a - b)
// @nudo:case "nums" (5, 3)
function calculate(a, b) {
  return calc(a, b);
}
`);
    expect(results[0].result).toBe("16");
  });
});
