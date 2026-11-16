import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type MockDirective } from "../index.ts";

function mockOf(expr: string): MockDirective {
  const fns = extractDirectives(parse(`
// @nudo:mock fetch = ${expr}
function getData() { return fetch("/api/data"); }
`));
  expect(fns).toHaveLength(1);
  const mocks = fns[0].directives.filter((d): d is MockDirective => d.kind === "mock");
  expect(mocks).toHaveLength(1);
  return mocks[0];
}

const CONSTRUCTORS = [
  { expr: "sinon.stub()", type: "stub" },
  { expr: "sinon.spy()", type: "spy" },
  { expr: "sinon.mock()", type: "mock" },
];

const TERMINALS = [
  { expr: 'sinon.stub().returns({ data: "test" })', field: "returnValue" },
  { expr: 'sinon.stub().resolves({ data: "test" })', field: "resolvedValue" },
  { expr: 'sinon.stub().rejects(new Error("fail"))', field: "rejectedValue" },
];

const CHAINS = [
  'sinon.stub().onFirstCall().returns({ data: "first" })',
  'sinon.stub().onSecondCall().returns({ data: "second" })',
  'sinon.stub().onCall(5).returns({ data: "fifth" })',
  'sinon.stub().withArgs("/api/data").returns({ data: "test" })',
  "sinon.stub().callsFake((url) => ({ data: url }))",
];

describe("sinon 表达式载荷", () => {
  it("stub / spy / mock 构造函数识别 type", () => {
    for (const { expr, type } of CONSTRUCTORS) expect(mockOf(expr).sinonExpr!.type, expr).toBe(type);
  });

  it("returns / resolves / rejects 保留对应终值", () => {
    for (const { expr, field } of TERMINALS) {
      const sinonExpr = mockOf(expr).sinonExpr as unknown as Record<string, unknown>;
      expect(sinonExpr.type, expr).toBe("stub");
      expect(sinonExpr[field], expr).toBeDefined();
    }
  });

  it("调用调度链（onFirst/onSecond/onCall/withArgs/callsFake）保留 returnValue", () => {
    for (const expr of CHAINS) {
      const sinonExpr = mockOf(expr).sinonExpr!;
      expect(sinonExpr.type, expr).toBe("stub");
      expect(sinonExpr.returnValue, expr).toBeDefined();
    }
  });
});
