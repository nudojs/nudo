import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type MockDirective } from "../index.ts";

const mocksOf = (code: string): MockDirective[] =>
  extractDirectives(parse(code))[0].directives.filter((d): d is MockDirective => d.kind === "mock");

const ARROW_CASES = [
  { name: "单参数", line: "// @nudo:mock fn = (x) => x > 3", params: ["x"] },
  { name: "多参数", line: "// @nudo:mock comparator = (a, b) => a - b", params: ["a", "b"] },
  { name: "块体", line: "// @nudo:mock fn = (x) => { return x * 2; }", params: ["x"] },
];

describe("@nudo:mock：箭头函数载荷", () => {
  it("单参数 / 多参数 / 块体都保留 params", () => {
    for (const { line, params } of ARROW_CASES) {
      const mocks = mocksOf(`
${line}
function run(arr, fn) { return arr.filter(fn); }
`);
      expect(mocks, line).toHaveLength(1);
      expect(mocks[0].arrowFn, line).toBeDefined();
      expect(mocks[0].arrowFn!.params).toEqual(params);
    }
  });
});

describe("@nudo:mock：表达式 / 路径 / 多条", () => {
  it("类型表达式载荷：expression 保留，不产 arrowFn", () => {
    const [mock] = mocksOf(`
// @nudo:mock data = string()
function foo(data) { return data; }
`);
    expect(mock.name).toBe("data");
    expect(mock.expression).toBe("string()");
    expect(mock.arrowFn).toBeUndefined();
  });

  it("from 路径载荷", () => {
    const [mock] = mocksOf(`
// @nudo:mock data from "./mock-data.ts"
function foo(data) { return data; }
`);
    expect(mock.name).toBe("data");
    expect(mock.fromPath).toBe("./mock-data.ts");
  });

  it("同函数多条 mock：顺序与载荷保持", () => {
    const mocks = mocksOf(`
// @nudo:mock fn = (x) => x > 3
// @nudo:mock data = [1, 2, 3, 4, 5]
function filterAndProcess(data, fn) { return data.filter(fn); }
`);
    expect(mocks).toHaveLength(2);
    expect(mocks[0].name).toBe("fn");
    expect(mocks[0].arrowFn).toBeDefined();
    expect(mocks[1].name).toBe("data");
    expect(mocks[1].expression).toBe("[1, 2, 3, 4, 5]");
  });
});
