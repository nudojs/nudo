/**
 * getTypeAtPosition / getCompletionsAtPosition（自 analyzer.test.ts 拆出）。
 */
import { describe, it, expect } from "vitest";
import { getTypeAtPosition, getCompletionsAtPosition } from "../lsp-surface.ts";

describe("getTypeAtPosition", () => {
  it("returns type for identifier at position", () => {
    const source = `const x = 42;\nconst y = x;\n`;
    const tv = getTypeAtPosition("/test/pos.js", source, 1, 6);
    expect(tv).not.toBeNull();
  });

  it("returns null for empty position", () => {
    const source = `\n\n\n`;
    const tv = getTypeAtPosition("/test/empty.js", source, 2, 0);
    expect(tv).toBeNull();
  });
});

describe("getCompletionsAtPosition", () => {
  it("returns variable completions without dot trigger", () => {
    const source = `const x = 42;\nfunction add(a, b) { return a + b; }\n`;
    const completions = getCompletionsAtPosition("/test/comp.js", source, 2, 0);
    expect(completions.length).toBeGreaterThan(0);
    const names = completions.map((c) => c.label);
    expect(names).toContain("x");
    expect(names).toContain("add");
  });

  it("returns property completions for object after dot", () => {
    const source = `const obj = { x: 1, y: "hello" };\nobj.x;\n`;
    const completions = getCompletionsAtPosition("/test/dot.js", source, 2, 4);
    expect(completions.length).toBeGreaterThan(0);
    const names = completions.map((c) => c.label);
    expect(names).toContain("x");
    expect(names).toContain("y");
  });

  it("returns array method completions after dot", () => {
    const source = `const arr = [1, 2, 3];\narr.map;\n`;
    const completions = getCompletionsAtPosition("/test/arr.js", source, 2, 4);
    const names = completions.map((c) => c.label);
    expect(names).toContain("map");
    expect(names).toContain("filter");
    expect(names).toContain("reduce");
    expect(names).toContain("length");
  });

  // 来源：IDE 深度批次——union 接收者的 dot 补全不再返回空
  // Abs：同 key 集对象 join 会字段合并；异 key 集保持 sum（与 TypeValue union 同形）
  it("completes only members common to every union member, with per-member type detail", () => {
    const source = [
      `const a = { x: 1, y: 9 };`,
      `const b = { x: 2 };`,
      `const u = Math.random() > 0.5 ? a : b;`,
      `u.x;`,
    ].join("\n");
    const completions = getCompletionsAtPosition("/test/union.js", source, 4, 2);
    const names = completions.map((c) => c.label);
    expect(names).toContain("x");
    // y 只存在于 a：非公共成员不得出现在补全里
    expect(names).not.toContain("y");
    // detail 是各成员上该成员类型的并集渲染
    const x = completions.find((c) => c.label === "x");
    expect(x?.kind).toBe("property");
    expect(x?.detail).toBe("1 | 2");
  });

  it("returns empty completions for a union with no common members", () => {
    const source = [
      `const c1 = { p: 1 };`,
      `const c2 = { q: 2 };`,
      `const u = Math.random() > 0.5 ? c1 : c2;`,
      `u.a;`,
    ].join("\n");
    const completions = getCompletionsAtPosition("/test/union-empty.js", source, 4, 2);
    expect(completions).toEqual([]);
  });

  // 来源：IDE 深度批次——内置方法 detail 不再硬编码，取 evaluator 真实 fnSig
  it("derives array method detail from the evaluator instead of hardcoding", () => {
    const source = `const arr = [1, 2, 3];\narr.map;\n`;
    const completions = getCompletionsAtPosition("/test/arr-sig.js", source, 2, 4);
    // Array.prototype.map 的近似签名：(_arg0: unknown) => unknown[]
    expect(completions.find((c) => c.label === "map")?.detail).toBe("(_arg0: unknown) => unknown[]");
    expect(completions.find((c) => c.label === "join")?.detail).toBe("(_arg0: string) => string");
    // 字面量 [1,2,3] 求值为 tuple：length 是精确字面量
    expect(completions.find((c) => c.label === "length")?.detail).toBe("3");
    // 抽象 array（filter 结果）的 length 回到 number
    const widened = getCompletionsAtPosition(
      "/test/arr-wide.js",
      `const arr = [1, "a"].filter(() => Math.random() > 0.5);\narr.m;\n`,
      2,
      4,
    );
    expect(widened.find((c) => c.label === "length")?.detail).toBe("number");
  });

  it("derives tuple length and string/promise method detail from the evaluator", () => {
    const tuple = getCompletionsAtPosition("/test/tuple.js", `const pair = [1, "a"];\npair.x;\n`, 2, 5);
    expect(tuple.find((c) => c.label === "length")?.detail).toBe("2");

    // [1,2].join("-") 推断出 primitive string（字面量接收者不走 string 分支）
    const str = getCompletionsAtPosition("/test/str.js", `const s = [1, 2].join("-");\ns.to;\n`, 2, 2);
    expect(str.find((c) => c.label === "toUpperCase")?.detail).toBe("() => string");
    expect(str.find((c) => c.label === "slice")?.detail).toBe("(_arg0: number, _arg1: number) => string");

    const promise = getCompletionsAtPosition("/test/promise.js", `const p = Promise.resolve(1);\np.then;\n`, 2, 2);
    expect(promise.find((c) => c.label === "then")?.detail).toBe("(_arg0: unknown) => promise<unknown>");
    // 派生自求值器原型近似表：含建模过的 Object.prototype 继承方法 toString
    expect(promise.map((c) => c.label).sort()).toEqual(["catch", "finally", "then", "toString"]);
  });
});

