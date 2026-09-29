/**
 * 原文正则特性探测不得在字符串/注释里误判 require/import/exports。
 * 回归背景：`const doc = "require('x')"` 会让 tryEvalAbsFull 直接放弃 Abs
 * 重求值，isSelfContainedSource 也把自包含源当成模块源。
 */
import { describe, it, expect } from "vitest";
import { $lit, litValue } from "@nudojs/core";
import { isSelfContainedSource, tryEvalAbsFull } from "../analyzer-abs-eval.ts";
import { analyzeFile } from "../analyzer.ts";

describe("require/import detection is string-aware", () => {
  it("require( inside a string is not a module dependency", () => {
    const src = `export function f(s) {\n  const doc = "call require('x') to load";\n  return s + "!";\n}\n`;
    expect(isSelfContainedSource(src, [])).toBe(true);
  });

  it("import marker inside a string is not a module dependency", () => {
    const src = `export function f() {\n  const doc = "import { x } from 'y'";\n  return 1;\n}\n`;
    expect(isSelfContainedSource(src, [])).toBe(true);
  });

  it("require( inside a comment is not a module dependency", () => {
    const src = `export function f(s) {\n  // require('x') is documented here\n  return s;\n}\n`;
    expect(isSelfContainedSource(src, [])).toBe(true);
  });

  it("real require still marks non-self-contained", () => {
    const src = `const fs = require("node:fs");\nexport function f() { return fs; }\n`;
    expect(isSelfContainedSource(src, [])).toBe(false);
  });

  it("real import still marks non-self-contained", () => {
    const src = `import { x } from "./y.js";\nexport function f() { return x; }\n`;
    expect(isSelfContainedSource(src, [])).toBe(false);
  });
});

describe("tryEvalAbsFull ignores require text in strings", () => {
  it("Abs re-eval still runs when a string mentions require(", () => {
    const src = `export function f(s) {\n  const doc = "call require('x') to load";\n  return s + "!";\n}\n`;
    const abs = tryEvalAbsFull(src, "f", [$lit("hi")], "/tmp/require-in-string.js");
    expect(abs).toBeDefined();
    expect(litValue(abs!.result)).toBe("hi!");
  });

  it("analyzeFile still infers precise return despite require-in-string", () => {
    const src = `export function f(s) {\n  const doc = "require('node:fs')";\n  return s + "!";\n}\n`;
    const result = analyzeFile("/tmp/require-in-string.js", src);
    const binding = result.bindings.get("f");
    expect(binding).toBeDefined();
  });
});
