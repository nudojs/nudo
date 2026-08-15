import { describe, it, expect } from "vitest";
import { typeValueToString } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";

describe("fnSig impl: concrete args produce precise values", () => {
  it("Math.floor with literal returns exact result", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "concrete" (3.7)
 * @nudo:case "symbolic" (T.number)
 */
function floorIt(x) {
  return Math.floor(x);
}
`;
    const result = analyzeFile("/test/math.js", source);
    const fn = result.functions[0];
    expect(fn.cases[0].name).toBe("concrete");
    expect(typeValueToString(fn.cases[0].result)).toBe("3");
    expect(fn.cases[1].name).toBe("symbolic");
    expect(typeValueToString(fn.cases[1].result)).toBe("number");
  });

  it("Math.max with literals returns exact result", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" (3, 7)
 */
function maxOf(a, b) {
  return Math.max(a, b);
}
`;
    const result = analyzeFile("/test/math.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("7");
  });

  it("JSON.stringify with literal returns exact string", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" (42)
 */
function toJson(x) {
  return JSON.stringify(x);
}
`;
    const result = analyzeFile("/test/json.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe('"42"');
  });

  it("encodeURIComponent with literal returns exact string", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" ("hello world")
 */
function encode(s) {
  return encodeURIComponent(s);
}
`;
    const result = analyzeFile("/test/encode.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe('"hello%20world"');
  });

  it("Number.isInteger with literal returns exact boolean", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "int" (5)
 * @nudo:case "float" (5.5)
 */
function checkInt(x) {
  return Number.isInteger(x);
}
`;
    const result = analyzeFile("/test/num.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("true");
    expect(typeValueToString(result.functions[0].cases[1].result)).toBe("false");
  });

  it("parseInt with literal returns exact number", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" ("42")
 */
function parseIt(s) {
  return parseInt(s);
}
`;
    const result = analyzeFile("/test/parse.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("42");
  });

  it("Promise.resolve preserves argument type", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" (42)
 */
async function wrap(x) {
  return await Promise.resolve(x);
}
`;
    const result = analyzeFile("/test/promise.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("Promise<42>");
  });
});

describe("fnSig impl: URL constructor with concrete args", () => {
  it("URL with literal string returns precise properties", () => {
    const source = `
/// @nudo:env web

/**
 * @nudo:case "test" ("https://example.com/path?q=hello#hash")
 */
function parseUrl(raw) {
  const url = new URL(raw);
  return {
    host: url.hostname,
    path: url.pathname,
    query: url.search,
    hash: url.hash,
  };
}
`;
    const result = analyzeFile("/test/url.js", source);
    const res = typeValueToString(result.functions[0].cases[0].result);
    expect(res).toContain('"example.com"');
    expect(res).toContain('"/path"');
    expect(res).toContain('"?q=hello"');
    expect(res).toContain('"#hash"');
  });

  it("URL with symbolic string falls back to generic type", () => {
    const source = `
/// @nudo:env web

/**
 * @nudo:case "test" (T.string)
 */
function parseUrl(raw) {
  const url = new URL(raw);
  return url.hostname;
}
`;
    const result = analyzeFile("/test/url.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("string");
  });
});

describe("fnSig impl: Node.js path with concrete args", () => {
  it("path.join with literals returns exact path", () => {
    const source = `
/// @nudo:env node

import { join } from "node:path";

/**
 * @nudo:case "test" ("src", "utils", "index.js")
 */
function buildPath(a, b, c) {
  return join(a, b, c);
}
`;
    const result = analyzeFile("/test/path.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe('"src/utils/index.js"');
  });

  it("path.extname with literal returns exact extension", () => {
    const source = `
/// @nudo:env node

import { extname } from "node:path";

/**
 * @nudo:case "test" ("file.ts")
 */
function getExt(f) {
  return extname(f);
}
`;
    const result = analyzeFile("/test/path.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe('".ts"');
  });

  it("path.basename with literal returns exact name", () => {
    const source = `
/// @nudo:env node

import { basename } from "node:path";

/**
 * @nudo:case "test" ("/home/user/file.txt")
 */
function getName(p) {
  return basename(p);
}
`;
    const result = analyzeFile("/test/path.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe('"file.txt"');
  });

  it("path.dirname with literal returns exact dir", () => {
    const source = `
/// @nudo:env node

import { dirname } from "node:path";

/**
 * @nudo:case "test" ("/home/user/file.txt")
 */
function getDir(p) {
  return dirname(p);
}
`;
    const result = analyzeFile("/test/path.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe('"/home/user"');
  });

  it("path.join with symbolic args falls back to string", () => {
    const source = `
/// @nudo:env node

import { join } from "node:path";

/**
 * @nudo:case "test" (T.string, T.string)
 */
function buildPath(a, b) {
  return join(a, b);
}
`;
    const result = analyzeFile("/test/path.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("string");
  });
});
