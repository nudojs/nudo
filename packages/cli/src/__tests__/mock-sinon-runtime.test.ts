import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective, type MockDirective, parseTypeValueExpr } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T, mockHelperToTypeValue } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function createSinonMock(sinonExpr: any, env: any): any {
  const body = { type: "BlockStatement", body: [] };
  const fn = T.fn(["...args"], body, env);

  if (sinonExpr.returnValue) {
    (fn as any)._directReturn = sinonExpr.returnValue;
  } else if (sinonExpr.resolvedValue) {
    (fn as any)._directReturn = T.promise(sinonExpr.resolvedValue);
  } else if (sinonExpr.rejectedValue) {
    (fn as any)._directReturn = T.never;
  } else {
    (fn as any)._directReturn = T.unknown;
  }
  return fn;
}

function inferWithSinonMocks(source: string): { name: string; caseName: string; result: string }[] {
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
        } else if (d.nudoMock) {
          const typeVal = mockHelperToTypeValue(d.nudoMock, env);
          env.bind(d.name, typeVal);
        } else if (d.sinonExpr) {
          const mockFn = createSinonMock(d.sinonExpr, env);
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

describe("Sinon Mock Runtime Tests", () => {
  it("sinon.stub() - basic stub", () => {
    const results = inferWithSinonMocks(`
// @nudo:mock fetch = sinon.stub()
// @nudo:case "call" ("/api/data")
function getData(url) {
  return fetch(url);
}
`);
    console.log("sinon.stub() result:", results[0].result);
    // Stub returns unknown by default
    expect(results[0].result).toBeDefined();
  });

  it("sinon.stub().returns() - with return value", () => {
    const results = inferWithSinonMocks(`
// @nudo:mock fetch = sinon.stub().returns({ data: "test" })
// @nudo:case "call" ("/api/data")
function getData(url) {
  return fetch(url);
}
`);
    console.log("sinon.stub().returns() result:", results[0].result);
    expect(results[0].result).toBeDefined();
  });

  it("sinon.spy() - spy function", () => {
    const results = inferWithSinonMocks(`
// @nudo:mock handler = sinon.spy()
// @nudo:case "event" ("click")
function processEvent(eventName) {
  handler(eventName);
  return eventName;
}
`);
    console.log("sinon.spy() result:", results[0].result);
    expect(results[0].result).toBe('"click"');
  });

  it("sinon.mock() - mock function", () => {
    const results = inferWithSinonMocks(`
// @nudo:mock service = sinon.mock()
// @nudo:case "call" ("getData")
function useService(method) {
  return service[method]();
}
`);
    console.log("sinon.mock() result:", results[0].result);
    expect(results[0].result).toBeDefined();
  });

  it("sinon.stub().resolves() - promise resolution", () => {
    const results = inferWithSinonMocks(`
// @nudo:mock fetch = sinon.stub().resolves({ data: "test" })
// @nudo:case "call" ("/api/data")
async function getData(url) {
  return await fetch(url);
}
`);
    console.log("sinon.stub().resolves() result:", results[0].result);
    expect(results[0].result).toBeDefined();
  });

  it("sinon.stub().callsFake() - executes the fake with actual args", () => {
    const results = inferWithSinonMocks(`
// @nudo:mock transform = sinon.stub().callsFake((x) => ({ v: x }))
// @nudo:case "direct" (21)
function applyTransform(x) {
  return transform(x);
}
`);
    expect(results[0].result).toBe("{ v: 21 }");
  });

  it("stub().callsFake() (bare form) - same execution semantics as sinon prefix", () => {
    const results = inferWithSinonMocks(`
// @nudo:mock transform = stub().callsFake((x) => ({ v: x }))
// @nudo:case "direct" (21)
function applyTransform(x) {
  return transform(x);
}
`);
    expect(results[0].result).toBe("{ v: 21 }");
  });

  it("sinon.stub().callsFake() value propagates precisely through arr.map HOF", () => {
    const results = inferWithSinonMocks(`
// @nudo:mock transform = sinon.stub().callsFake((x) => ({ v: x }))
// @nudo:case "hof" ([1, 2, 3])
function mapAll(arr) {
  return arr.map(transform);
}
`);
    expect(results[0].result).toBe("[{ v: 1 }, { v: 2 }, { v: 3 }]");
  });

  it("sinon.stub().withArgs().returns() - matched args use the chain return, unmatched fall back", () => {
    const results = inferWithSinonMocks(`
// @nudo:mock handler = sinon.stub().withArgs(21).returns("hit")
// @nudo:case "match" (21)
// @nudo:case "miss" (22)
function call(x) {
  return handler(x);
}
`);
    expect(results[0].result).toBe('"hit"');
    expect(results[1].result).toBe("unknown");
  });
});
