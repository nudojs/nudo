import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective, parseTypeValueExpr } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
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

describe("Built-in API Tests", () => {
  it("Date.now() should return number", () => {
    const results = runTest(`
// @nudo:case "now" ()
function getTimestamp() {
  return Date.now();
}
`);
    console.log("Date.now() result:", results[0].result);
    expect(results[0].result).toBe("number");
  });

  it("Math.floor() should return number", () => {
    const results = runTest(`
// @nudo:case "floor" (3.7)
function floorIt(x) {
  return Math.floor(x);
}
`);
    console.log("Math.floor() result:", results[0].result);
    expect(results[0].result).toBe("number");
  });

  it("Math.random() should return number", () => {
    const results = runTest(`
// @nudo:case "random" ()
function getRandom() {
  return Math.random();
}
`);
    console.log("Math.random() result:", results[0].result);
    expect(results[0].result).toBe("number");
  });

  it("JSON.stringify() should return string", () => {
    const results = runTest(`
// @nudo:case "stringify" ({a: 1})
function toJson(obj) {
  return JSON.stringify(obj);
}
`);
    console.log("JSON.stringify() result:", results[0].result);
    expect(results[0].result).toBe("string");
  });

  it("JSON.parse(literal string) decodes the literal's exact structure", () => {
    const results = runTest(`
// @nudo:case "fixture" ()
function parseFixture() {
  return JSON.parse('{"a":1,"b":[2,"x"]}');
}
// @nudo:case "scalars" ()
function parseScalars() {
  return JSON.parse('{"n":null,"t":true,"s":"x"}');
}
`);
    console.log("JSON.parse literal results:", results.map((r) => r.result));
    expect(results[0].result).toBe('{ a: 1, b: [2, "x"] }');
    expect(results[1].result).toBe('{ n: null, t: true, s: "x" }');
  });

  it("JSON.parse degrades to unknown for non-literal, invalid, or reviver calls", () => {
    const results = runTest(`
// @nudo:case "invalid" ('not json')
// @nudo:case "symbolic" (T.string)
// @nudo:case "reviver" ('{"a":1}', T.unknown)
function parseArg(text, rev) {
  return JSON.parse(text, rev);
}
`);
    console.log("JSON.parse degradation results:", results.map((r) => r.result));
    expect(results.map((r) => r.result)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("Object.keys() should return string[]", () => {
    const results = runTest(`
// @nudo:case "keys" ({a: 1, b: 2})
function getKeys(obj) {
  return Object.keys(obj);
}
`);
    console.log("Object.keys() result:", results[0].result);
    // Object.keys returns actual keys from the object
    expect(results[0].result).toBe('["a", "b"]');
  });

  it("Object.prototype.hasOwnProperty.call(obj, key) should return boolean", () => {
    const results = runTest(`
// @nudo:case "own" ({a: 1})
function checkOwn(obj) {
  return Object.prototype.hasOwnProperty.call(obj, 'a');
}
`);
    console.log("Object.prototype.hasOwnProperty.call result:", results[0].result);
    expect(results[0].result).toBe("boolean");
  });

  it("Object.prototype predicate family (isPrototypeOf, propertyIsEnumerable) should return boolean", () => {
    const results = runTest(`
// @nudo:case "proto" ({a: 1})
function checkProto(obj) {
  const a = Object.prototype.isPrototypeOf.call({}, obj);
  const b = Object.prototype.propertyIsEnumerable.call(obj, 'a');
  return a && b;
}
`);
    console.log("Object.prototype predicates result:", results[0].result);
    expect(results[0].result).toBe("boolean");
  });

  it("Object.prototype members resolve through plain objects (member access and destructuring)", () => {
    const results = runTest(`
// @nudo:case "member" ({x: 1})
function viaMember(obj) {
  return obj.hasOwnProperty('x');
}
`);
    console.log("obj.hasOwnProperty result:", results[0].result);
    expect(results[0].result).toBe("boolean");

    // Destructuring reads through the prototype chain in real JS, so
    // `const { hasOwnProperty } = obj` yields a function, not undefined —
    // and never the native JS function (plain records must be own-guarded).
    const destructured = runTest(`
// @nudo:case "destructure" ({y: 1})
function viaDestructure(obj) {
  const { hasOwnProperty } = obj;
  return hasOwnProperty.call(obj, 'y');
}
`);
    console.log("destructured hasOwnProperty result:", destructured[0].result);
    expect(destructured[0].result).toBe("boolean");
  });

  it("Object.prototype.toString.call(x) yields the receiver's brand literal", () => {
    const results = runTest(`
// @nudo:case "plain" ({a: 1})
// @nudo:case "array" ([1, 2])
// @nudo:case "fn" ((a) => a)
function brand(x) {
  return Object.prototype.toString.call(x);
}
`);
    console.log("brand results:", results.map((r) => r.result));
    expect(results[0].result).toBe('"[object Object]"');
    expect(results[1].result).toBe('"[object Array]"');
    expect(results[2].result).toBe('"[object Function]"');
  });

  it("Object.prototype.toString.call brands null/undefined and primitives", () => {
    const results = runTest(`
// @nudo:case "null" (null)
// @nudo:case "undefined" (undefined)
// @nudo:case "number" (T.number)
function brand(x) {
  return Object.prototype.toString.call(x);
}
`);
    console.log("brand results:", results.map((r) => r.result));
    expect(results[0].result).toBe('"[object Null]"');
    expect(results[1].result).toBe('"[object Undefined]"');
    expect(results[2].result).toBe('"[object Number]"');
  });

  it("Object.prototype.toString.call(new Map()) brands with the class name", () => {
    const results = runTest(`
// @nudo:case "map" ()
function brandMap() {
  return Object.prototype.toString.call(new Map());
}
`);
    console.log("brand Map result:", results[0].result);
    expect(results[0].result).toBe('"[object Map]"');
  });

  it("Object.getPrototypeOf maps receivers onto cached prototype singletons", () => {
    const results = runTest(`
// @nudo:case "plain" ({a: 1})
// @nudo:case "array" ([1])
function proto(x) {
  return Object.getPrototypeOf(x);
}
`);
    console.log("getPrototypeOf results:", results.map((r) => r.result.slice(0, 24)));
    expect(results[0].result).toContain("Object {");
    expect(results[1].result).toContain("Array {");
  });

  it("Object.getPrototypeOf identity compares equal to X.prototype", () => {
    const results = runTest(`
// @nudo:case "plain" ({a: 1})
function protoEq(x) {
  return Object.getPrototypeOf(x) === Object.prototype;
}
`);
    expect(results[0].result).toBe("true");
  });

  it("Object.getOwnPropertyDescriptor returns a value-carrying descriptor", () => {
    const results = runTest(`
// @nudo:case "hit" ({a: 1})
function desc(x) {
  const d = Object.getOwnPropertyDescriptor(x, 'a');
  return d ? d.value : 'missing';
}
`);
    console.log("descriptor value:", results[0].result);
    expect(results[0].result).toBe("1");
  });

  it("Object.getOwnPropertyDescriptor misses return undefined", () => {
    const results = runTest(`
// @nudo:case "miss" ({a: 1})
function descMiss(x) {
  return Object.getOwnPropertyDescriptor(x, 'b');
}
`);
    console.log("descriptor miss:", results[0].result);
    expect(results[0].result).toBe("undefined");
  });

  it("Buffer namespace resolves: from/prototype feed the clone-style proto chain", () => {
    const results = runTest(`
// @nudo:case "from" ({a: 1})
function buf(x) {
  const proto = Object.getPrototypeOf(x);
  if (proto === Buffer.prototype) {
    return Buffer.from(x);
  }
  return Object.create(proto);
}
`);
    console.log("buffer chain result:", results[0].result);
    expect(results[0].result).toBe("{}");
  });
});
