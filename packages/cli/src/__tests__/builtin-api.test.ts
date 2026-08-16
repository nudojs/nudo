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
});
