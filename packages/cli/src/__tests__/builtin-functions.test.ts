import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function infer(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];

  for (const fn of directives) {
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

describe("Built-in Functions", () => {
  describe("String()", () => {
    it("converts number to string", () => {
      const results = infer(`
// @nudo:case "num" (42)
function foo(x) { return String(x); }
`);
      expect(results[0].result).toBe('"42"');
    });

    it("converts string to string (identity)", () => {
      const results = infer(`
// @nudo:case "str" ("hello")
function foo(x) { return String(x); }
`);
      expect(results[0].result).toBe('"hello"');
    });

    it("converts boolean to string", () => {
      const results = infer(`
// @nudo:case "true" (true)
// @nudo:case "false" (false)
function foo(x) { return String(x); }
`);
      expect(results[0].result).toBe('"true"');
      expect(results[1].result).toBe('"false"');
    });

    it("converts null to string", () => {
      const results = infer(`
// @nudo:case "null" (null)
function foo(x) { return String(x); }
`);
      expect(results[0].result).toBe('"null"');
    });

    it("converts undefined to string", () => {
      const results = infer(`
// @nudo:case "undef" (undefined)
function foo(x) { return String(x); }
`);
      expect(results[0].result).toBe('"undefined"');
    });

    it("returns string for symbolic input", () => {
      const results = infer(`
// @nudo:case "sym" (T.number)
function foo(x) { return String(x); }
`);
      expect(results[0].result).toBe("string");
    });

    it("returns empty string for no args", () => {
      const results = infer(`
// @nudo:case "empty" ()
function foo() { return String(); }
`);
      expect(results[0].result).toBe('""');
    });
  });

  describe("Number()", () => {
    it("converts string to number", () => {
      const results = infer(`
// @nudo:case "str" ("42")
function foo(x) { return Number(x); }
`);
      expect(results[0].result).toBe("42");
    });

    it("converts number to number (identity)", () => {
      const results = infer(`
// @nudo:case "num" (42)
function foo(x) { return Number(x); }
`);
      expect(results[0].result).toBe("42");
    });

    it("converts boolean to number", () => {
      const results = infer(`
// @nudo:case "true" (true)
// @nudo:case "false" (false)
function foo(x) { return Number(x); }
`);
      expect(results[0].result).toBe("1");
      expect(results[1].result).toBe("0");
    });

    it("returns number for symbolic input", () => {
      const results = infer(`
// @nudo:case "sym" (T.string)
function foo(x) { return Number(x); }
`);
      expect(results[0].result).toBe("number");
    });
  });

  describe("Boolean()", () => {
    it("converts truthy values", () => {
      const results = infer(`
// @nudo:case "str" ("hello")
// @nudo:case "num" (42)
function foo(x) { return Boolean(x); }
`);
      expect(results[0].result).toBe("true");
      expect(results[1].result).toBe("true");
    });

    it("converts falsy values", () => {
      const results = infer(`
// @nudo:case "zero" (0)
// @nudo:case "empty" ("")
// @nudo:case "null" (null)
function foo(x) { return Boolean(x); }
`);
      expect(results[0].result).toBe("false");
      expect(results[1].result).toBe("false");
      expect(results[2].result).toBe("false");
    });
  });

  describe("parseInt()", () => {
    it("returns number", () => {
      const results = infer(`
// @nudo:case "str" ("42")
function foo(x) { return parseInt(x); }
`);
      expect(results[0].result).toBe("number");
    });
  });

  describe("parseFloat()", () => {
    it("returns number", () => {
      const results = infer(`
// @nudo:case "str" ("3.14")
function foo(x) { return parseFloat(x); }
`);
      expect(results[0].result).toBe("number");
    });
  });

  describe("isNaN()", () => {
    it("returns boolean", () => {
      const results = infer(`
// @nudo:case "num" (42)
// @nudo:case "nan" (NaN)
function foo(x) { return isNaN(x); }
`);
      expect(results[0].result).toBe("boolean");
      expect(results[1].result).toBe("boolean");
    });
  });

  describe("isFinite()", () => {
    it("returns boolean", () => {
      const results = infer(`
// @nudo:case "num" (42)
// @nudo:case "inf" (Infinity)
function foo(x) { return isFinite(x); }
`);
      expect(results[0].result).toBe("boolean");
      expect(results[1].result).toBe("boolean");
    });
  });

  describe("encodeURIComponent()", () => {
    it("returns string", () => {
      const results = infer(`
// @nudo:case "str" ("hello world")
function foo(x) { return encodeURIComponent(x); }
`);
      expect(results[0].result).toBe("string");
    });
  });

  describe("console methods", () => {
    it("console.log returns undefined", () => {
      const results = infer(`
// @nudo:case "str" ("hello")
function foo(x) { return console.log(x); }
`);
      expect(results[0].result).toBe("undefined");
    });
  });

  describe("Math methods", () => {
    it("Math.abs returns number", () => {
      const results = infer(`
// @nudo:case "num" (42)
function foo(x) { return Math.abs(x); }
`);
      expect(results[0].result).toBe("number");
    });

    it("Math.floor returns number", () => {
      const results = infer(`
// @nudo:case "num" (3.14)
function foo(x) { return Math.floor(x); }
`);
      expect(results[0].result).toBe("number");
    });
  });

  describe("Integration with narrowing", () => {
    it("String() after typeof check", () => {
      const results = infer(`
// @nudo:case "str" ("hello")
// @nudo:case "num" (42)
function foo(x) {
  if (typeof x === "string") return x.toUpperCase();
  return String(x);
}
`);
      expect(results[0].result).toBe('"HELLO"');
      expect(results[1].result).toBe('"42"');
    });

    it("String() in template literal", () => {
      const results = infer(`
// @nudo:case "num" (42)
function foo(x) { return \`value: \${String(x)}\`; }
`);
      expect(results[0].result).toBe('"value: 42"');
    });
  });
});
