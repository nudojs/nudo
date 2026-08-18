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

  describe("Global numeric constants", () => {
    it("Infinity / -Infinity / NaN resolve to number", () => {
      const results = infer(`
// @nudo:case "constants" ()
function foo() {
  return [Infinity, -Infinity, NaN];
}
`);
      // 修复前：Infinity/NaN 走未知全局（unknown）且触发 nudo:unknown-global；
      // 现在通过 BUILTIN_STATIC_METHODS 接线解析为 number。
      // 常量显示 number 即可——case 序列化器对非有限数返回 null，不产
      // 字面量值。数组字面量求值为 tuple。
      expect(results[0].result).toBe("[number, number, number]");
    });

    it("Number static constants resolve to number", () => {
      const results = infer(`
// @nudo:case "num-consts" ()
function foo() {
  return [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.MAX_VALUE, Number.EPSILON];
}
`);
      // 修复前：Number.MAX_SAFE_INTEGER 报 unknown-property 且值为 undefined
      expect(results[0].result).toBe("[number, number, number, number]");
    });

    it("Math.PI / Math.E resolve to number", () => {
      const results = infer(`
// @nudo:case "math-consts" ()
function foo() { return Math.PI + Math.E; }
`);
      // 修复前：Math.PI 走 unknown-property（undefined）
      expect(results[0].result).toBe("number");
    });
  });

  describe("Loose equality", () => {
    it("literal == evaluates via JS coercion", () => {
      const results = infer(`
// @nudo:case "num" ()
// @nudo:case "str-num" ()
function foo() {
  return [5 == 3, "5" == 5];
}
`);
      // 修复前：== 未实现（unknown）；现在两字面量操作数按 JS 宽松相
      // 等求值：5 == 3 → false，"5" == 5 → true
      expect(results[0].result).toBe("[false, true]");
    });

    it("non-literal == degrades to boolean", () => {
      const results = infer(`
// @nudo:case "sym" (T.string)
function foo(x) {
  return x == "5";
}
`);
      // 任一操作数非字面量：退化为 boolean
      expect(results[0].result).toBe("boolean");
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
