import { describe, it, expect } from "vitest";
import { formatShape } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";

describe("fnSig impl: concrete args produce precise values", () => {
  it("ES 内建：Math/JSON/encode/Number/parseInt/Promise 折叠表", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "concrete" (3.7)
 * @nudo:case "symbolic" (number())
 */
function floorIt(x) { return Math.floor(x); }

/** @nudo:case "test" (3, 7) */
function maxOf(a, b) { return Math.max(a, b); }

/** @nudo:case "test" (42) */
function toJson(x) { return JSON.stringify(x); }

/** @nudo:case "test" ("hello world") */
function encode(s) { return encodeURIComponent(s); }

/**
 * @nudo:case "int" (5)
 * @nudo:case "float" (5.5)
 */
function checkInt(x) { return Number.isInteger(x); }

/** @nudo:case "test" ("42") */
function parseIt(s) { return parseInt(s); }

/** @nudo:case "hex" ("0x10") */
function parseHex(s) { return parseInt(s); }

/** @nudo:case "hexr" ("ff", 16) */
function parseHexR(s, r) { return parseInt(s, r); }

/** @nudo:case "test" (42) */
async function wrap(x) { return await Promise.resolve(x); }
`;
    const result = analyzeFile("/test/builtins.js", source);
    const byName = Object.fromEntries(result.functions.map((f) => [f.name, f]));
    expect(formatShape(byName.floorIt!.cases[0]!.abs)).toBe("3");
    expect(formatShape(byName.floorIt!.cases[1]!.abs)).toBe("NaN | number");
    expect(formatShape(byName.maxOf!.cases[0]!.abs)).toBe("7");
    expect(formatShape(byName.toJson!.cases[0]!.abs)).toBe('"42"');
    expect(formatShape(byName.encode!.cases[0]!.abs)).toBe('"hello%20world"');
    expect(formatShape(byName.checkInt!.cases[0]!.abs)).toBe("true");
    expect(formatShape(byName.checkInt!.cases[1]!.abs)).toBe("false");
    expect(formatShape(byName.parseIt!.cases[0]!.abs)).toBe("42");
    expect(formatShape(byName.parseHex!.cases[0]!.abs)).toBe("16");
    expect(formatShape(byName.parseHexR!.cases[0]!.abs)).toBe("255");
    expect(formatShape(byName.wrap!.cases[0]!.abs)).toBe("promise<42>");
  });
});

describe("fnSig impl: URL constructor with concrete args", () => {
  it("字面量 URL 精确属性；符号字符串回落 string", () => {
    const source = `
/// @nudo:env web

/** @nudo:case "test" ("https://example.com/path?q=hello#hash") */
function parseUrlLiteral(raw) {
  const url = new URL(raw);
  return { host: url.hostname, path: url.pathname, query: url.search, hash: url.hash };
}

/** @nudo:case "test" (string()) */
function parseUrlSymbolic(raw) {
  const url = new URL(raw);
  return url.hostname;
}
`;
    const result = analyzeFile("/test/url.js", source);
    const byName = Object.fromEntries(result.functions.map((f) => [f.name, f]));
    const res = formatShape(byName.parseUrlLiteral!.cases[0]!.abs);
    for (const part of ['"example.com"', '"/path"', '"?q=hello"', '"#hash"']) expect(res).toContain(part);
    expect(formatShape(byName.parseUrlSymbolic!.cases[0]!.abs)).toBe("string");
  });
});

describe("fnSig impl: Node.js path with concrete args", () => {
  it("path.join/extname/basename/dirname 折叠；符号实参回落 string", () => {
    const source = `
/// @nudo:env node
import { join, extname, basename, dirname } from "node:path";

/** @nudo:case "test" ("src", "utils", "index.js") */
function buildPath(a, b, c) { return join(a, b, c); }

/** @nudo:case "test" ("file.ts") */
function getExt(f) { return extname(f); }

/** @nudo:case "test" ("/home/user/file.txt") */
function getName(p) { return basename(p); }

/** @nudo:case "withExt" ("/home/user/file.txt", ".txt") */
function getNameExt(p, ext) { return basename(p, ext); }

/** @nudo:case "test" ("/home/user/file.txt") */
function getDir(p) { return dirname(p); }

/** @nudo:case "test" (string(), string()) */
function buildPathSymbolic(a, b) { return join(a, b); }
`;
    const result = analyzeFile("/test/path.js", source);
    const byName = Object.fromEntries(result.functions.map((f) => [f.name, f]));
    expect(formatShape(byName.buildPath!.cases[0]!.abs)).toBe('"src/utils/index.js"');
    expect(formatShape(byName.getExt!.cases[0]!.abs)).toBe('".ts"');
    expect(formatShape(byName.getName!.cases[0]!.abs)).toBe('"file.txt"');
    expect(formatShape(byName.getNameExt!.cases[0]!.abs)).toBe('"file"');
    expect(formatShape(byName.getDir!.cases[0]!.abs)).toBe('"/home/user"');
    expect(formatShape(byName.buildPathSymbolic!.cases[0]!.abs)).toBe("string");
  });
});
