/**
 * BUG-072：模块顶层「建模内抛」/ 原生必抛被吸收 ⇒ `nudo check` 绿灯。
 * 修复：`definiteModuleThrowOf` 对确定性装载期抛（IIFE throw / 顶层调用必抛
 * 函数 / nullish 成员访问 / 非法 JSON.parse / 类静态块 throw）出证据。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

function moduleThrows(src: string, file: string) {
  const r = checkSource(file, src, pTrue);
  return r.issues.filter((i) => i.code === "nudo:module-throw");
}

describe("BUG-072 module initializer definitely throws ⇒ nudo:module-throw", () => {
  it("IIFE with unconditional throw", () => {
    const issues = moduleThrows(
      `export const a = 1;\n(function () { throw new Error("x"); })();\n`,
      "/t/bug-072-t2.js",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toContain("Error");
  });

  it("top-level call to a function that always throws", () => {
    const issues = moduleThrows(
      `export function boom() { throw new Error("x"); }\nboom();\n`,
      "/t/bug-072-t3.js",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("Error");
  });

  it("top-level member access on a nullish const", () => {
    const issues = moduleThrows(
      `export const a = 1;\nconst x = null;\nx.foo();\n`,
      "/t/bug-072-t4.js",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("TypeError");
  });

  it("top-level JSON.parse of an invalid literal", () => {
    const issues = moduleThrows(
      `export const a = 1;\nJSON.parse("{");\n`,
      "/t/bug-072-t5.js",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("SyntaxError");
  });

  it("class static block with unconditional throw", () => {
    const issues = moduleThrows(
      `export function m() { return 1; }\nclass K { static { throw new Error("x"); } }\n`,
      "/t/bug-072-t7.js",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("Error");
  });

  it("typeof missing identifier is safe (not a ReferenceError)", () => {
    const issues = moduleThrows(
      `export const v = typeof __nudoMissingNative;\nexport function f(){ return 1; }\n`,
      "/t/bug-072-neg-typeof.js",
    );
    expect(issues).toHaveLength(0);
  });

  it("conditional / optional access is not definite", () => {
    const issues = moduleThrows(
      `export function m() { return 1; }\nif (globalThis.cond) throw new Error("x");\nconst x = null;\nconst y = x?.foo;\n`,
      "/t/bug-072-neg.js",
    );
    expect(issues).toHaveLength(0);
  });
});
