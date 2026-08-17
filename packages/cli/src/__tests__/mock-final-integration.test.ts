import { describe, it, expect, beforeAll } from "vitest";
import { parse, extractDirectives, type CaseDirective, parseTypeValueExpr } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runTest(source: string): { name: string; caseName: string; result: string }[] {
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
        } else if (d.sinonExpr) {
          const body = { type: "BlockStatement", body: [] };
          const mockFn = T.fn(["...args"], body, env);
          if (d.sinonExpr.returnValue) {
            (mockFn as any)._directReturn = d.sinonExpr.returnValue;
          } else if (d.sinonExpr.resolvedValue) {
            (mockFn as any)._directReturn = T.promise(d.sinonExpr.resolvedValue);
          } else {
            (mockFn as any)._directReturn = T.unknown;
          }
          env.bind(d.name, mockFn);
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

describe("Final Integration Test - All Mock Features", () => {
  const source = `
// 1. 基础箭头函数 Mock - filter
// @nudo:mock predicate = (x) => x > 3
// @nudo:case "filter" ([1, 2, 3, 4, 5])
function filterGreater(arr) {
  const result = [];
  for (const item of arr) {
    if (predicate(item)) result.push(item);
  }
  return result;
}

// 2. 基础箭头函数 Mock - map
// @nudo:mock transform = (x) => x * 2
// @nudo:case "map" ([1, 2, 3])
function doubleAll(arr) {
  return arr.map(transform);
}

// 3. 基础箭头函数 Mock - reduce
// @nudo:mock reducer = (a, b) => a + b
// @nudo:case "reduce" ([1, 2, 3, 4])
function sumAll(arr) {
  return arr.reduce(reducer, 0);
}

// 4. 多参数 Mock
// @nudo:mock combine = (a, b) => a + b * 10
// @nudo:case "combine" (3, 4)
function combineNums(a, b) {
  return combine(a, b);
}

// 5. 函数组合
// @nudo:mock f = (x) => x + 1
// @nudo:mock g = (x) => x * 2
// @nudo:case "compose" (5)
function compose(x) {
  return f(g(x));
}

// 6. 回调模式
// @nudo:mock callback = (result) => result * 2
// @nudo:case "callback" (21)
function processWithCallback(x) {
  return callback(x);
}

// 7. 类型收窄 - string
// @nudo:mock processor = (x) => typeof x === "string" ? x.toUpperCase() : x
// @nudo:case "string" ("hello")
// @nudo:case "number" (42)
function process(x) {
  return processor(x);
}

// 8. 对象返回
// @nudo:mock makeUser = (name, age) => ({ name, age, isAdult: age >= 18 })
// @nudo:case "user" ("Alice", 25)
function createUser(name, age) {
  return makeUser(name, age);
}

// 9. 数组解构
// @nudo:mock swap = ([a, b]) => [b, a]
// @nudo:case "swap" ([1, 2])
function swapPair(pair) {
  return swap(pair);
}

// 10. 对象解构
// @nudo:mock getFullName = ({first, last}) => first + " " + last
// @nudo:case "name" ({first: "John", last: "Doe"})
function fullName(obj) {
  return getFullName(obj);
}

// 11. Rest 参数
// @nudo:mock sum = (...args) => args.length
// @nudo:case "rest" (1, 2, 3)
function countArgs() {
  return sum(1, 2, 3);
}

// 12. 条件逻辑
// @nudo:mock validator = (x) => x > 0 && x < 100
// @nudo:case "valid" (50)
// @nudo:case "invalid" (150)
function validate(x) {
  return validator(x);
}

// 13. 嵌套函数调用
// @nudo:mock double = (x) => x * 2
// @nudo:mock addTen = (x) => x + 10
// @nudo:case "nested" (5)
function nestedCalls(x) {
  return addTen(double(x));
}

// 14. 无参数 Mock
// @nudo:mock getRandom = () => 42
// @nudo:case "noargs" ()
function getValue() {
  return getRandom();
}

// 15. Sinon Mock
// @nudo:mock fetch = sinon.stub()
// @nudo:case "sinon" ("/api/data")
function getData(url) {
  return fetch(url);
}
`;

  let results: { name: string; caseName: string; result: string }[];

  beforeAll(() => {
    results = runTest(source);
  });

  it("1. filter with predicate", () => {
    const r = results.find(r => r.caseName === "filter")!;
    expect(r.result).toBe("[4, 5]");
  });

  it("2. map with transform", () => {
    const r = results.find(r => r.caseName === "map")!;
    expect(r.result).toBe("[2, 4, 6]");
  });

  it("3. reduce with reducer", () => {
    const r = results.find(r => r.caseName === "reduce")!;
    expect(r.result).toBe("10");
  });

  it("4. multi-parameter mock", () => {
    const r = results.find(r => r.caseName === "combine")!;
    expect(r.result).toBe("43");
  });

  it("5. function composition", () => {
    const r = results.find(r => r.caseName === "compose")!;
    expect(r.result).toBe("11");
  });

  it("6. callback pattern", () => {
    const r = results.find(r => r.caseName === "callback")!;
    expect(r.result).toBe("42");
  });

  it("7a. type narrowing - string", () => {
    const r = results.find(r => r.caseName === "string")!;
    expect(r.result).toBe('"HELLO"');
  });

  it("7b. type narrowing - number", () => {
    const r = results.find(r => r.caseName === "number")!;
    expect(r.result).toBe("42");
  });

  it("8. object return", () => {
    const r = results.find(r => r.caseName === "user")!;
    expect(r.result).toBe('{ name: "Alice", age: 25, isAdult: true }');
  });

  it("9. array destructuring", () => {
    const r = results.find(r => r.caseName === "swap")!;
    expect(r.result).toBe("[2, 1]");
  });

  it("10. object destructuring", () => {
    const r = results.find(r => r.caseName === "name")!;
    expect(r.result).toBe('"John Doe"');
  });

  it("11. rest parameters", () => {
    const r = results.find(r => r.caseName === "rest")!;
    expect(r.result).toBe("3");
  });

  it("12a. conditional - valid", () => {
    const r = results.find(r => r.caseName === "valid")!;
    expect(r.result).toBe("true");
  });

  it("12b. conditional - invalid", () => {
    const r = results.find(r => r.caseName === "invalid")!;
    expect(r.result).toBe("false");
  });

  it("13. nested function calls", () => {
    const r = results.find(r => r.caseName === "nested")!;
    expect(r.result).toBe("20");
  });

  it("14. no-args mock", () => {
    const r = results.find(r => r.caseName === "noargs")!;
    expect(r.result).toBe("42");
  });

  it("15. sinon stub (returns unknown)", () => {
    const r = results.find(r => r.caseName === "sinon")!;
    expect(r.result).toBe("unknown");
  });

  it("all tests passed", () => {
    console.log("\n=== 最终测试结果 ===");
    for (const r of results) {
      console.log(`${r.name} - ${r.caseName}: ${r.result}`);
    }
    console.log(`\n总计: ${results.length} 个测试用例`);
  });
});
