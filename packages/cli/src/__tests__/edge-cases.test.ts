import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runTest(source: string): { name: string; caseName: string; result: string }[] {
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

describe("Edge Case Tests", () => {
  describe("Empty Values", () => {
    it("empty array", () => {
      const results = runTest(`
// @nudo:case "empty-arr" ([])
function process(arr) {
  return arr.length;
}
`);
      expect(results[0].result).toBe("0");
    });

    it("empty object", () => {
      const results = runTest(`
// @nudo:case "empty-obj" ({})
function process(obj) {
  return Object.keys(obj).length;
}
`);
      expect(results[0].result).toBe("0");
    });

    it("empty string", () => {
      const results = runTest(`
// @nudo:case "empty-str" ("")
function process(str) {
  return str.length;
}
`);
      expect(results[0].result).toBe("0");
    });

    it("null handling", () => {
      const results = runTest(`
// @nudo:case "null" (null)
function process(val) {
  if (val === null) return "null";
  return "not null";
}
`);
      expect(results[0].result).toBe('"null"');
    });

    it("undefined handling", () => {
      const results = runTest(`
// @nudo:case "undefined" (undefined)
function process(val) {
  if (val === undefined) return "undefined";
  return "defined";
}
`);
      expect(results[0].result).toBe('"undefined"');
    });

    it("null to undefined", () => {
      const results = runTest(`
// @nudo:case "null-undef" (null)
function process(val) {
  return val ?? "default";
}
`);
      expect(results[0].result).toBe('"default"');
    });
  });

  describe("Type Conversions", () => {
    it("number to string", () => {
      const results = runTest(`
// @nudo:case "num-to-str" (42)
function convert(n) {
  return String(n);
}
`);
      expect(results[0].result).toBe('"42"');
    });

    it("string to number", () => {
      const results = runTest(`
// @nudo:case "str-to-num" ("42")
function convert(s) {
  return Number(s);
}
`);
      expect(results[0].result).toBe("42");
    });

    it("boolean to number", () => {
      const results = runTest(`
// @nudo:case "bool-to-num" (true)
function convert(b) {
  return Number(b);
}
`);
      expect(results[0].result).toBe("1");
    });

    it("number to boolean", () => {
      const results = runTest(`
// @nudo:case "num-to-bool" (0)
function convert(n) {
  return Boolean(n);
}
`);
      expect(results[0].result).toBe("false");
    });

    it("string concatenation with number", () => {
      const results = runTest(`
// @nudo:case "concat-num" ("value: ", 42)
function concat(s, n) {
  return s + n;
}
`);
      expect(results[0].result).toBe('"value: 42"');
    });

    it("parseInt", () => {
      const results = runTest(`
// @nudo:case "parse-int" ("42")
function convert(s) {
  return parseInt(s);
}
`);
      expect(results[0].result).toBe("number");
    });

    it("parseFloat", () => {
      const results = runTest(`
// @nudo:case "parse-float" ("3.14")
function convert(s) {
  return parseFloat(s);
}
`);
      expect(results[0].result).toBe("number");
    });
  });

  describe("Boundary Values", () => {
    it("max safe integer", () => {
      const results = runTest(`
// @nudo:case "max-int" ()
function getMax() {
  return Number.MAX_SAFE_INTEGER;
}
`);
      // Design limitation: Number.MAX_SAFE_INTEGER not resolved → 已修复：
      // BUILTIN_STATIC_METHODS.Number 补常量接线，现在解析为 number
      expect(results[0].result).toBe("number");
    });

    it("min safe integer", () => {
      const results = runTest(`
// @nudo:case "min-int" ()
function getMin() {
  return Number.MIN_SAFE_INTEGER;
}
`);
      // Number.MIN_SAFE_INTEGER 常量接线修复后解析为 number
      expect(results[0].result).toBe("number");
    });

    it("infinity", () => {
      const results = runTest(`
// @nudo:case "infinity" ()
function getInf() {
  return Infinity;
}
`);
      // Unresolved built-in globals propagate unknown (not undefined) → 已修复：
      // Infinity 进入 BUILTIN_STATIC_METHODS，解析为 number（不再触发
      // nudo:unknown-global / nudo:builtin-unknown）
      expect(results[0].result).toBe("number");
    });

    it("negative infinity", () => {
      const results = runTest(`
// @nudo:case "neg-infinity" ()
function getNegInf() {
  return -Infinity;
}
`);
      // Unary - on undefined returns number → 已修复：- 现在作用于 number
      expect(results[0].result).toBe("number");
    });

    it("NaN", () => {
      const results = runTest(`
// @nudo:case "nan" ()
function getNaN() {
  return NaN;
}
`);
      // Unresolved built-in globals propagate unknown (not undefined) → 已修复：
      // NaN 进入 BUILTIN_STATIC_METHODS，解析为 number
      expect(results[0].result).toBe("number");
    });

    it("Math.PI / Math.E", () => {
      const results = runTest(`
// @nudo:case "math-pi" ()
// @nudo:case "math-e" ()
function constants() {
  return [Math.PI, Math.E];
}
`);
      // Math 常量接线修复：解析为 number（数组字面量求值为 tuple）
      expect(results[0].result).toBe("[number, number]");
    });

    it("Number.MAX_VALUE / Number.EPSILON", () => {
      const results = runTest(`
// @nudo:case "num-consts" ()
function constants() {
  return [Number.MAX_VALUE, Number.EPSILON];
}
`);
      // Number 常量接线修复：解析为 number（数组字面量求值为 tuple）
      expect(results[0].result).toBe("[number, number]");
    });

    it("empty array index", () => {
      const results = runTest(`
// @nudo:case "empty-idx" ([])
function getFirst(arr) {
  return arr[0];
}
`);
      expect(results[0].result).toBe("undefined");
    });

    it("out of bounds index", () => {
      const results = runTest(`
// @nudo:case "oob-idx" ([1, 2, 3])
function getOob(arr) {
  return arr[10];
}
`);
      expect(results[0].result).toBe("undefined");
    });
  });

  describe("Error Handling Edge Cases", () => {
    it("throw string", () => {
      const results = runTest(`
// @nudo:case "throw-str" ()
function throwError() {
  throw "error";
}
`);
      expect(results[0].result).toBe("never");
    });

    it("throw object", () => {
      const results = runTest(`
// @nudo:case "throw-obj" ()
function throwError() {
  throw { code: 500, message: "Internal error" };
}
`);
      expect(results[0].result).toBe("never");
    });

    it("try without catch", () => {
      const results = runTest(`
// @nudo:case "try-finally" ()
function tryFinally() {
  try {
    return "success";
  } finally {
    // cleanup
  }
}
`);
      expect(results[0].result).toBe('"success"');
    });

    it("catch with rethrow", () => {
      const results = runTest(`
// @nudo:case "catch-rethrow" ()
function catchRethrow() {
  try {
    throw "error";
  } catch (e) {
    throw e;
  }
}
`);
      expect(results[0].result).toBe("never");
    });

    it("nested try-catch-finally", () => {
      const results = runTest(`
// @nudo:case "nested-tcf" ()
function nested() {
  try {
    try {
      return "inner";
    } catch (e) {
      return "inner-catch";
    } finally {
      // inner finally
    }
  } catch (e) {
    return "outer-catch";
  }
}
`);
      // Nudo unions all possible paths - correct for static analysis
      expect(results[0].result).toContain('"inner"');
    });
  });

  describe("Comparison Edge Cases", () => {
    it("strict equality", () => {
      const results = runTest(`
// @nudo:case "strict-eq" (1, 1)
function compare(a, b) {
  return a === b;
}
`);
      expect(results[0].result).toBe("true");
    });

    it("loose equality", () => {
      const results = runTest(`
// @nudo:case "loose-eq" (1, "1")
function compare(a, b) {
  return a == b;
}
`);
      // Design limitation: == not implemented (returns unknown) → 已修复：
      // 字面量操作数按 JS 宽松相等语义求值，1 == "1" 得 true
      expect(results[0].result).toBe("true");
    });

    it("loose equality on literals", () => {
      const results = runTest(`
// @nudo:case "num-eq" (5, 3)
// @nudo:case "str-num-eq" ("5", 5)
// @nudo:case "bool-eq" (false, 0)
// @nudo:case "null-undef-eq" (null, undefined)
function compare(a, b) {
  return a == b;
}
`);
      // 宽松相等字面量求值：ToNumber 强转（"5"==5 → true、false==0 → true、
      // null==undefined → true）
      expect(results[0].result).toBe("false");
      expect(results[1].result).toBe("true");
      expect(results[2].result).toBe("true");
      expect(results[3].result).toBe("true");
    });

    it("loose inequality on literals", () => {
      const results = runTest(`
// @nudo:case "num-neq" (5, 3)
// @nudo:case "str-num-neq" ("5", 5)
function compare(a, b) {
  return a != b;
}
`);
      expect(results[0].result).toBe("true");
      expect(results[1].result).toBe("false");
    });

    it("loose equality on non-literals degrades to boolean", () => {
      const results = runTest(`
// @nudo:case "sym-eq" (T.string)
// @nudo:case "sym-neq" (T.number)
function compare(a, b) {
  return a == b;
}
`);
      // 非字面量操作数：静态无法定值，退化为 boolean
      expect(results[0].result).toBe("boolean");
      expect(results[1].result).toBe("boolean");
    });

    it("loose equality NaN never equals itself", () => {
      const results = runTest(`
// @nudo:case "nan-eq" ()
function compare() {
  return 0 / 0 == 0 / 0;
}
`);
      // case 参数无法表达 NaN 字面量（parseTypeValueExpr 落到 T.unknown），
      // 用 0/0（Ops.div 产出 T.literal(NaN)）触发：JS 宽松相等 NaN == NaN
      // 得 false
      expect(results[0].result).toBe("false");
    });

    it("strict inequality", () => {
      const results = runTest(`
// @nudo:case "strict-neq" (1, 2)
function compare(a, b) {
  return a !== b;
}
`);
      expect(results[0].result).toBe("true");
    });

    it("null comparison", () => {
      const results = runTest(`
// @nudo:case "null-cmp" (null)
function compare(val) {
  return val === null;
}
`);
      expect(results[0].result).toBe("true");
    });

    it("undefined comparison", () => {
      const results = runTest(`
// @nudo:case "undef-cmp" (undefined)
function compare(val) {
  return val === undefined;
}
`);
      expect(results[0].result).toBe("true");
    });

    it("typeof comparison", () => {
      const results = runTest(`
// @nudo:case "typeof-cmp" (42)
function compare(val) {
  return typeof val === "number";
}
`);
      expect(results[0].result).toBe("true");
    });
  });

  describe("String Edge Cases", () => {
    it("empty string operations", () => {
      const results = runTest(`
// @nudo:case "empty-str-ops" ("")
function process(str) {
  return {
    length: str.length,
    upper: str.toUpperCase(),
    lower: str.toLowerCase(),
    trim: str.trim()
  };
}
`);
      expect(results[0].result).toContain("length");
      expect(results[0].result).toContain("upper");
    });

    it("string with special chars", () => {
      const results = runTest(`
// @nudo:case "special-chars" ("hello\\nworld")
function process(str) {
  return str.length;
}
`);
      // Nudo correctly infers the literal length
      expect(results[0].result).toBe("12");
    });

    it("string methods on empty", () => {
      const results = runTest(`
// @nudo:case "str-methods-empty" ("")
function process(str) {
  return str.includes("");
}
`);
      expect(results[0].result).toBe("true");
    });
  });

  describe("Array Edge Cases", () => {
    it("single element array", () => {
      const results = runTest(`
// @nudo:case "single-arr" ([42])
function process(arr) {
  return arr[0];
}
`);
      expect(results[0].result).toBe("42");
    });

    it("nested empty arrays", () => {
      const results = runTest(`
// @nudo:case "nested-empty" ([[], [], []])
function process(arr) {
  return arr.length;
}
`);
      expect(results[0].result).toBe("3");
    });

    it("array with mixed types", () => {
      const results = runTest(`
// @nudo:case "mixed-arr" ([1, "two", true, null])
function process(arr) {
  return arr.length;
}
`);
      expect(results[0].result).toBe("4");
    });

    it("array spread", () => {
      const results = runTest(`
// @nudo:case "arr-spread" ([1, 2], [3, 4])
function spread(a, b) {
  return [...a, ...b];
}
`);
      expect(results[0].result).toContain("[");
      expect(results[0].result).toContain("1");
      expect(results[0].result).toContain("4");
    });

    it("array destructuring with rest", () => {
      const results = runTest(`
// @nudo:case "arr-rest" ([1, 2, 3, 4, 5])
function process(arr) {
  const [first, ...rest] = arr;
  return { first, rest };
}
`);
      expect(results[0].result).toContain("first");
      expect(results[0].result).toContain("rest");
    });
  });

  describe("Object Edge Cases", () => {
    it("nested object access", () => {
      const results = runTest(`
// @nudo:case "nested-access" ({ a: { b: { c: 42 } } })
function access(obj) {
  return obj.a.b.c;
}
`);
      expect(results[0].result).toBe("42");
    });

    it("object with computed keys", () => {
      const results = runTest(`
// @nudo:case "computed-keys" ("name", "Alice")
function create(key, value) {
  return { [key]: value, [key + "Id"]: 1 };
}
`);
      expect(results[0].result).toContain("name");
      expect(results[0].result).toContain("Alice");
    });

    it("object rest", () => {
      const results = runTest(`
// @nudo:case "obj-rest" ({ a: 1, b: 2, c: 3 })
function rest(obj) {
  const { a, ...rest } = obj;
  return rest;
}
`);
      expect(results[0].result).toContain("b");
      expect(results[0].result).toContain("c");
    });

    it("shorthand properties", () => {
      const results = runTest(`
// @nudo:case "shorthand" (1, 2, 3)
function create(a, b, c) {
  return { a, b, c };
}
`);
      expect(results[0].result).toContain("a");
      expect(results[0].result).toContain("b");
      expect(results[0].result).toContain("c");
    });

    it("valueOf chain: object receiver without a custom valueOf returns itself", () => {
      // hoek internals.valueOf pattern — the try/catch must not poison the
      // passthrough with an unknown-typed catch binding.
      const results = runTest(`
// @nudo:case "value-of-obj" ({ a: { b: 5 } })
function valueOf(obj) {
  const objValueOf = obj.valueOf;
  if (objValueOf === undefined) {
    return obj;
  }
  try {
    return objValueOf.call(obj);
  } catch (err) {
    return err;
  }
}
`);
      expect(results[0].result).toContain("a");
      expect(results[0].result).toContain("b");
    });

    it("valueOf chain: primitive receivers unbox to their own value", () => {
      const results = runTest(`
// @nudo:case "value-of-literal" (5)
function valueOfNumber(n) {
  const v = n.valueOf;
  return v.call(n);
}
`);
      expect(results[0].result).toBe("5");
    });

    it("valueOf chain: null receiver throws into the catch as TypeError", () => {
      const results = runTest(`
// @nudo:case "value-of-null" (null)
function valueOfNull(n) {
  try {
    const v = n.valueOf;
    return v.call(n);
  } catch (err) {
    return err;
  }
}
`);
      expect(results[0].result).toContain("TypeError");
    });
  });

  describe("Loop Edge Cases", () => {
    it("empty loop", () => {
      const results = runTest(`
// @nudo:case "empty-loop" ([])
function process(arr) {
  let sum = 0;
  for (const item of arr) {
    sum += item;
  }
  return sum;
}
`);
      expect(results[0].result).toBe("0");
    });

    it("single iteration", () => {
      const results = runTest(`
// @nudo:case "single-iter" ([42])
function process(arr) {
  let sum = 0;
  for (const item of arr) {
    sum += item;
  }
  return sum;
}
`);
      expect(results[0].result).toBe("42");
    });

    it("while loop", () => {
      const results = runTest(`
// @nudo:case "while-loop" (5)
function countdown(n) {
  let result = 0;
  while (n > 0) {
    result += n;
    n--;
  }
  return result;
}
`);
      expect(results[0].result).toBe("15");
    });

    it("break in loop", () => {
      const results = runTest(`
// @nudo:case "break-loop" ([1, 2, 3, 4, 5])
function findFirst(arr) {
  for (const item of arr) {
    if (item > 3) return item;
  }
  return undefined;
}
`);
      // Nudo returns a refined type with the constraint
      expect(results[0].result).toContain(">=");
    });
  });

  describe("Function Edge Cases", () => {
    it("immediately invoked function", () => {
      const results = runTest(`
// @nudo:case "iife" ()
function test() {
  return (function() { return 42; })();
}
`);
      expect(results[0].result).toBe("42");
    });

    it("arrow function", () => {
      const results = runTest(`
// @nudo:case "arrow" ()
function test() {
  const add = (a, b) => a + b;
  return add(1, 2);
}
`);
      expect(results[0].result).toBe("3");
    });

    it("default parameters", () => {
      const results = runTest(`
// @nudo:case "default-params" (1)
function test(a, b = 10) {
  return a + b;
}
`);
      expect(results[0].result).toBe("11");
    });

    it("rest parameters", () => {
      const results = runTest(`
// @nudo:case "rest-params" (1, 2, 3)
function sum(...numbers) {
  return numbers.reduce((a, b) => a + b, 0);
}
`);
      // Design limitation: rest parameters create array, reduce on array returns unknown
      expect(results[0].result).toBe("unknown");
    });
  });
});
