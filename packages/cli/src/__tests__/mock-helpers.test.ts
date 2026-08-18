import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective, parseTypeValueExpr } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T, stub, spy, mock, mockHelperToTypeValue } from "@nudojs/core";
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

describe("Mock Helper Functions", () => {
  describe("mockHelperToTypeValue", () => {
    it("stub() should create a function returning unknown", () => {
      const env = createEnvironment();
      const helper = stub();
      const typeVal = mockHelperToTypeValue(helper, env);
      expect(typeVal.kind).toBe("function");
      expect((typeVal as any)._directReturn.kind).toBe("unknown");
    });

    it("stub().returns(T.number) should create a function returning number", () => {
      const env = createEnvironment();
      const helper = stub.returns(T.number);
      const typeVal = mockHelperToTypeValue(helper, env);
      expect(typeVal.kind).toBe("function");
      expect((typeVal as any)._directReturn.kind).toBe("primitive");
    });

    it("stub().resolves(T.string) should create a function returning promise<string>", () => {
      const env = createEnvironment();
      const helper = stub.resolves(T.string);
      const typeVal = mockHelperToTypeValue(helper, env);
      expect(typeVal.kind).toBe("function");
      expect((typeVal as any)._directReturn.kind).toBe("promise");
    });

    it("spy() should create a function returning unknown", () => {
      const env = createEnvironment();
      const helper = spy();
      const typeVal = mockHelperToTypeValue(helper, env);
      expect(typeVal.kind).toBe("function");
    });

    it("mock() should create a function returning unknown", () => {
      const env = createEnvironment();
      const helper = mock();
      const typeVal = mockHelperToTypeValue(helper, env);
      expect(typeVal.kind).toBe("function");
    });
  });

  describe("Mock helpers through evaluator", () => {
    it("stub().returns with arrow function mock should work", () => {
      // The existing arrow function syntax already works - this is the baseline
      const results = runNudoTest(`
// @nudo:mock handler = (x) => x * 2
// @nudo:case "double" (21)
function double(x) {
  return handler(x);
}
`);
      expect(results[0].result).toBe("42");
    });

    it("stub with _directReturn should work in evaluator", () => {
      // Simulate what happens when a mock helper is bound to an env var
      const env = createEnvironment();
      const helper = stub.returns(T.number);
      const typeVal = mockHelperToTypeValue(helper, env);
      env.bind("myStub", typeVal);

      // The evaluator should see _directReturn and return number
      const ast = parse(`
// @nudo:case "test" ()
function testFn() {
  return myStub();
}
`);
      const directives = extractDirectives(ast);
      const fn = directives[0];
      const caseDir = fn.directives.find((d): d is CaseDirective => d.kind === "case")!;
      const result = evaluateFunctionFull(fn.node, caseDir.args, env);
      expect(typeValueToString(result.value)).toBe("number");
    });
  });

  describe("stub().callsFake executes the fake with actual args (sinon semantics)", () => {
    it("mockHelperToTypeValue binds the fake function itself, not a direct return of it", () => {
      const env = createEnvironment();
      const fake = parseTypeValueExpr("(x) => ({ v: x })");
      expect(fake.kind).toBe("function");
      const typeVal = mockHelperToTypeValue(stub.callsFake(fake), env);
      // 调用语义 = 以实参执行 fake：直接绑定 fake 本身（同 @nudo:mock 箭头机制），
      // 而非把 fake 函数值当 _directReturn 传播
      expect(typeVal).toBe(fake);
    });

    it("stub().callsFake((x) => ({ v: x })) called with 21 yields { v: 21 }", () => {
      const results = runNudoTest(`
// @nudo:mock transform = stub().callsFake((x) => ({ v: x }))
// @nudo:case "direct" (21)
function applyTransform(x) {
  return transform(x);
}
`);
      expect(results[0].result).toBe("{ v: 21 }");
    });

    it("sinon.stub().callsFake((x) => ({ v: x })) called with 21 yields { v: 21 }", () => {
      const results = runNudoTest(`
// @nudo:mock transform = sinon.stub().callsFake((x) => ({ v: x }))
// @nudo:case "direct" (21)
function applyTransform(x) {
  return transform(x);
}
`);
      expect(results[0].result).toBe("{ v: 21 }");
    });

    it("callsFake propagates precisely through arr.map(transform) HOF", () => {
      const results = runNudoTest(`
// @nudo:mock transform = stub().callsFake((x) => ({ v: x }))
// @nudo:case "hof" ([1, 2, 3])
function mapAll(arr) {
  return arr.map(transform);
}
`);
      expect(results[0].result).toBe("[{ v: 1 }, { v: 2 }, { v: 3 }]");
    });

    it("withArgs(...).returns(...) matched args take priority; unmatched fall back to stub default", () => {
      const results = runNudoTest(`
// @nudo:mock handler = stub().withArgs(21).returns("hit")
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
});
