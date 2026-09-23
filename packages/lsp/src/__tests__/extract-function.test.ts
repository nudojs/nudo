/**
 * Extract Function 金标：自由变量、返回值、表达式/语句选区。
 */
import { describe, it, expect } from "vitest";
import { extractFunction, extractToWorkspaceEdit, applyEdits, fullDocumentRange } from "../extract-function.ts";

describe("extractFunction — statements", () => {
  const src = `function outer(a, b) {
  const t = a + b;
  const u = t * 2;
  return u;
}
`;

  it("extracts two statements with free vars a,b and returns t via captured? no — t used outside", () => {
    // 选中 L2–L3（const t; const u）
    // t 在 L3 用、u 在 L4 用 → capturedWrites
    const r = extractFunction(
      src,
      { start: { line: 1, character: 2 }, end: { line: 3, character: 0 } },
      { name: "combine" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.functionName).toBe("combine");
    expect(r.params).toContain("a");
    expect(r.params).toContain("b");
    expect(r.functionText).toContain("function combine(a, b)");
    expect(r.functionText).toContain("return u");
    expect(r.callText).toContain("const u = combine");
    expect(r.newText).toContain("function combine");
    expect(r.newText).toContain("const u = combine");
  });

  it("void extract when nothing escapes", () => {
    const s = `function f(x) {
  console.log(x);
  console.log(x + 1);
}
`;
    const r = extractFunction(
      s,
      { start: { line: 1, character: 2 }, end: { line: 3, character: 0 } },
      { name: "logAll" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.returns).toBeNull();
    expect(r.callText).toBe("logAll(x);");
    expect(r.functionText).toContain("function logAll(x)");
  });
});

describe("extractFunction — expression", () => {
  it("extracts expression into returning function", () => {
    const s = `function f(a, b) {
  return a + b * 2;
}
`;
    // 选中 `a + b * 2`（line 1, after "return "）
    const r = extractFunction(
      s,
      { start: { line: 1, character: 9 }, end: { line: 1, character: 18 } },
      { name: "sum" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.functionText).toContain("function sum(a, b)");
    expect(r.functionText).toContain("return a + b * 2");
    expect(r.callText).toBe("sum(a, b)");
    expect(r.newText).toContain("return sum(a, b)");
    // 原表达式只应出现在新函数体内，调用方变成 sum(a, b)
    const caller = r.newText.slice(r.newText.indexOf("function f"));
    expect(caller).not.toContain("a + b * 2");
    expect(r.functionText).toContain("a + b * 2");
  });
});

describe("extractFunction — guards", () => {
  it("rejects empty selection", () => {
    const r = extractFunction("function f(){}\n", {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/empty/);
  });

  it("rejects invalid name fallback to extracted", () => {
    const s = `function f(x) {\n  return x;\n}\n`;
    const r = extractFunction(
      s,
      { start: { line: 1, character: 2 }, end: { line: 1, character: 11 } },
      { name: "1bad" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.functionName).toBe("extracted");
  });
});

describe("applyEdits / extractToWorkspaceEdit", () => {
  it("applyEdits multi replace from the end", () => {
    const out = applyEdits("abcdef", [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "X" },
      { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 4 } }, newText: "Y" },
    ]);
    expect(out).toBe("XbcYef");
  });

  it("workspace edit wraps full-file rewrite", () => {
    const s = `function f(x) {\n  return x;\n}\n`;
    const w = extractToWorkspaceEdit(
      s,
      { start: { line: 1, character: 2 }, end: { line: 1, character: 11 } },
      { name: "id2" },
    );
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.title).toContain("id2");
    expect(w.newText).toContain("function id2");
  });

  it("fullDocumentRange spans the file", () => {
    const r = fullDocumentRange("a\nbb\n");
    expect(r.start).toEqual({ line: 0, character: 0 });
    expect(r.end.line).toBe(2);
  });
});
