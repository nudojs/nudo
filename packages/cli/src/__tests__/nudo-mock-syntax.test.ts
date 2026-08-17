import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective, parseTypeValueExpr } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T, mockHelperToTypeValue } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runNudoTest(source: string): { name: string; caseName: string; result: string }[] {
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
          // Handle sinon expressions
          const body = { type: "BlockStatement", body: [] } as any;
          const fn = T.fn(["...args"], body, env);
          if (d.sinonExpr.returnValue) {
            (fn as any)._directReturn = d.sinonExpr.returnValue;
          } else if (d.sinonExpr.resolvedValue) {
            (fn as any)._directReturn = T.promise(d.sinonExpr.resolvedValue);
          } else if (d.sinonExpr.rejectedValue) {
            (fn as any)._directReturn = T.never;
          } else {
            (fn as any)._directReturn = T.unknown;
          }
          env.bind(d.name, fn);
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

describe("Nudo Mock Helper Syntax", () => {
  it("stub() should bind as a function returning unknown", () => {
    const results = runNudoTest(`
// @nudo:mock handler = stub()
// @nudo:case "test" (42)
function testFn(x) {
  return handler(x);
}
`);
    expect(results[0].result).toBe("unknown");
  });

  it("stub().returns({ status: 200 }) should return the specified value", () => {
    const results = runNudoTest(`
// @nudo:mock fetch = stub().returns({ status: 200, data: { ok: true } })
// @nudo:case "api" ("/users")
function fetchUsers(url) {
  return fetch(url);
}
`);
    expect(results[0].result).toContain("status: 200");
    expect(results[0].result).toContain("ok: true");
  });

  it("stub().resolves('hello') should return Promise<\"hello\">", () => {
    const results = runNudoTest(`
// @nudo:mock fetchData = stub().resolves("hello")
// @nudo:case "async" ()
function getData() {
  return fetchData();
}
`);
    expect(results[0].result).toBe('Promise<"hello">');
  });

  it("spy() should bind as a function returning unknown", () => {
    const results = runNudoTest(`
// @nudo:mock listener = spy()
// @nudo:case "event" ({ type: "click" })
function handleEvent(event) {
  return listener(event);
}
`);
    expect(results[0].result).toBe("unknown");
  });

  it("mock() should bind as a function returning unknown", () => {
    const results = runNudoTest(`
// @nudo:mock service = mock()
// @nudo:case "call" ()
function useService() {
  return service();
}
`);
    expect(results[0].result).toBe("unknown");
  });

  it("stub().returns with complex object", () => {
    const results = runNudoTest(`
// @nudo:mock httpClient = stub().returns({ status: 200, data: { users: [{ id: 1, name: "Alice" }] } })
// @nudo:case "users" ()
function getUsers() {
  const response = httpClient();
  return response.data.users;
}
`);
    expect(results[0].result).toContain("id: 1");
    expect(results[0].result).toContain("name: \"Alice\"");
  });

  it("mixed nudo mocks and arrow function mocks", () => {
    const results = runNudoTest(`
// @nudo:mock validate = (x) => x !== null
// @nudo:mock transform = stub().returns({ processed: true })
// @nudo:case "mix" (42)
function process(x) {
  if (!validate(x)) return null;
  return transform(x);
}
`);
    expect(results[0].result).toContain("processed: true");
  });
});

describe("Chain call syntax", () => {
  it("stub().returns(v).onFirstCall() should parse and use returns value", () => {
    const results = runNudoTest(`
// @nudo:mock handler = stub().returns(42).onFirstCall()
// @nudo:case "test" ()
function fn() {
  return handler();
}
`);
    expect(results[0].result).toBe("42");
  });

  it("stub().callsFake(expr) should parse", () => {
    const results = runNudoTest(`
// @nudo:mock transform = stub().callsFake((x) => x)
// @nudo:case "test" (21)
function fn(x) {
  return transform(x);
}
`);
    expect(results[0].result).toBeDefined();
  });

  it("spy().returns(v) should parse", () => {
    const results = runNudoTest(`
// @nudo:mock listener = spy().returns({ handled: true })
// @nudo:case "test" ()
function fn() {
  return listener();
}
`);
    expect(results[0].result).toContain("handled: true");
  });

  it("stub().withArgs(a, b).returns(v) should parse", () => {
    const results = runNudoTest(`
// @nudo:mock fetch = stub().withArgs("GET", "/api").returns({ status: 200 })
// @nudo:case "test" ()
function fn() {
  return fetch("GET", "/api");
}
`);
    expect(results[0].result).toContain("status: 200");
  });
});
