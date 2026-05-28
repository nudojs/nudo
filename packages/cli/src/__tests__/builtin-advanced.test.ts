import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
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
      results.push({ name: fn.name, caseName: dir.name, result: typeValueToString(result.value) });
    }
  }
  return results;
}

describe("Built-in Symbol API", () => {
  it("Symbol.for(key) should return symbol", () => {
    const results = runTest(`
// @nudo:case "for" ()
function fn() {
  return Symbol.for("key");
}
`);
    expect(results[0].result).toBe("symbol");
  });

  it("Symbol.iterator should return symbol", () => {
    const results = runTest(`
// @nudo:case "iterator" ()
function fn() {
  return Symbol.iterator;
}
`);
    expect(results[0].result).toBe("symbol");
  });

  it("Symbol.asyncIterator should return symbol", () => {
    const results = runTest(`
// @nudo:case "asyncIterator" ()
function fn() {
  return Symbol.asyncIterator;
}
`);
    expect(results[0].result).toBe("symbol");
  });

  it("Symbol.toStringTag should return symbol", () => {
    const results = runTest(`
// @nudo:case "toStringTag" ()
function fn() {
  return Symbol.toStringTag;
}
`);
    expect(results[0].result).toBe("symbol");
  });

  it("Symbol.hasInstance should return symbol", () => {
    const results = runTest(`
// @nudo:case "hasInstance" ()
function fn() {
  return Symbol.hasInstance;
}
`);
    expect(results[0].result).toBe("symbol");
  });
});

describe("Built-in Reflect API", () => {
  it("Reflect.has(obj, key) should return boolean", () => {
    const results = runTest(`
// @nudo:case "has" ()
function fn() {
  return Reflect.has({ a: 1 }, "a");
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("Reflect.get(obj, key) should return unknown", () => {
    const results = runTest(`
// @nudo:case "get" ()
function fn() {
  return Reflect.get({ a: 1 }, "a");
}
`);
    expect(results[0].result).toBe("unknown");
  });

  it("Reflect.set(obj, key, value) should return boolean", () => {
    const results = runTest(`
// @nudo:case "set" ()
function fn() {
  return Reflect.set({}, "a", 1);
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("Reflect.deleteProperty(obj, key) should return boolean", () => {
    const results = runTest(`
// @nudo:case "deleteProperty" ()
function fn() {
  return Reflect.deleteProperty({ a: 1 }, "a");
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("Reflect.ownKeys(obj) should return string[]", () => {
    const results = runTest(`
// @nudo:case "ownKeys" ()
function fn() {
  return Reflect.ownKeys({ a: 1, b: 2 });
}
`);
    expect(results[0].result).toBe("string[]");
  });

  it("Reflect.getPrototypeOf(obj) should return {} | null", () => {
    const results = runTest(`
// @nudo:case "getPrototypeOf" ()
function fn() {
  return Reflect.getPrototypeOf({});
}
`);
    expect(results[0].result).toContain("{}");
    expect(results[0].result).toContain("null");
  });
});

describe("Built-in Intl API", () => {
  it("new Intl.DateTimeFormat() instance", () => {
    const results = runTest(`
// @nudo:case "new-datetimeformat" ()
function fn() {
  const fmt = new Intl.DateTimeFormat();
  return fmt;
}
`);
    expect(results[0].result).toContain("DateTimeFormat");
  });

  it("new Intl.DateTimeFormat().format() should return string", () => {
    const results = runTest(`
// @nudo:case "format" ()
function fn() {
  const fmt = new Intl.DateTimeFormat();
  return fmt.format();
}
`);
    expect(results[0].result).toBe("string");
  });

  it("new Intl.NumberFormat() instance", () => {
    const results = runTest(`
// @nudo:case "new-numberformat" ()
function fn() {
  const fmt = new Intl.NumberFormat();
  return fmt;
}
`);
    expect(results[0].result).toContain("NumberFormat");
  });

  it("new Intl.NumberFormat().format() should return string", () => {
    const results = runTest(`
// @nudo:case "format" ()
function fn() {
  const fmt = new Intl.NumberFormat();
  return fmt.format();
}
`);
    expect(results[0].result).toBe("string");
  });
});

describe("Built-in WeakMap API", () => {
  it("new WeakMap() should return WeakMap instance", () => {
    const results = runTest(`
// @nudo:case "new-weakmap" ()
function fn() {
  const wm = new WeakMap();
  return wm;
}
`);
    expect(results[0].result).toContain("WeakMap");
  });

  it("weakMap.get() should return unknown", () => {
    const results = runTest(`
// @nudo:case "get" ()
function fn() {
  const wm = new WeakMap();
  return wm.get({});
}
`);
    expect(results[0].result).toBe("unknown");
  });

  it("weakMap.set() should return WeakMap instance", () => {
    const results = runTest(`
// @nudo:case "set" ()
function fn() {
  const wm = new WeakMap();
  return wm.set({}, "value");
}
`);
    expect(results[0].result).toContain("WeakMap");
  });

  it("weakMap.has() should return boolean", () => {
    const results = runTest(`
// @nudo:case "has" ()
function fn() {
  const wm = new WeakMap();
  return wm.has({});
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("weakMap.delete() should return boolean", () => {
    const results = runTest(`
// @nudo:case "delete" ()
function fn() {
  const wm = new WeakMap();
  return wm.delete({});
}
`);
    expect(results[0].result).toBe("boolean");
  });
});

describe("Built-in WeakSet API", () => {
  it("new WeakSet() should return WeakSet instance", () => {
    const results = runTest(`
// @nudo:case "new-weakset" ()
function fn() {
  const ws = new WeakSet();
  return ws;
}
`);
    expect(results[0].result).toContain("WeakSet");
  });

  it("weakSet.add() should return WeakSet instance", () => {
    const results = runTest(`
// @nudo:case "add" ()
function fn() {
  const ws = new WeakSet();
  return ws.add({});
}
`);
    expect(results[0].result).toContain("WeakSet");
  });

  it("weakSet.has() should return boolean", () => {
    const results = runTest(`
// @nudo:case "has" ()
function fn() {
  const ws = new WeakSet();
  return ws.has({});
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("weakSet.delete() should return boolean", () => {
    const results = runTest(`
// @nudo:case "delete" ()
function fn() {
  const ws = new WeakSet();
  return ws.delete({});
}
`);
    expect(results[0].result).toBe("boolean");
  });
});
