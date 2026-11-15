/**
 * Bug 709 回归钉：符号表按**名字**索引 ⇒ **遮蔽**的同名局部变量上 F12 /
 * Find-references 会落到**另一个作用域**的声明。
 *
 * 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）：
 *   源：
 *     export function a() {
 *       const v = 1;
 *       return v;
 *     }
 *     export function b() {
 *       const v = 2;
 *       return v;
 *     }
 *   definition on `v`（a 内）⇒ 跳到 **b 里的 v** ❌（应跳 a 里的 v）
 *   references on `v`（a 内）⇒ [b 的 v 声明, a 的 v 声明, a 的 v 用点] ❌
 *     （混进 b 的声明）
 *
 * 根因：`buildSymbolTable` 的 `definitions` 是 `Map<string, SymbolInfo>` ——
 * 无作用域维度，`VariableDeclarator` 无条件 `definitions.set(name, …)`
 * **覆盖**先声明 ⇒ 后声明的 `v`（b 里的）成为唯一入口。
 *
 * 修法：定义按**作用域路径**存（`name@行:列`），同名绑定在不同作用域各存
 * 一条；查定义时按**光标所在作用域**取最内层的那条。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { buildSymbolTable, findDefinition, findReferences } from "../symbols.ts";
import { withLspServer } from "./helpers.ts";

const SHADOW_SRC = `export function a() {
  const v = 1;
  return v;
}

export function b() {
  const v = 2;
  return v;
}
`;

describe("Bug 709 — 遮蔽的同名绑定按作用域解析", () => {
  it("buildSymbolTable：同名绑定各存一条（不被覆盖）", () => {
    const ast = parse(SHADOW_SRC);
    const table = buildSymbolTable(ast, "file:///t/s.js");
    // 作用域路径键：`v@<作用域起点>` —— a 内与 b 内各一条
    const scoped = [...table.definitions.keys()].filter((k) => k.startsWith("v@"));
    expect(scoped.length).toBe(2);
    // 两条指向不同作用域里的不同声明
    const lines = scoped.map((k) => table.definitions.get(k)!.loc.start.line);
    expect(lines.sort()).toEqual([2, 7]);
  });

  it("findDefinition：按光标所在作用域取最内层的定义", () => {
    const ast = parse(SHADOW_SRC);
    const table = buildSymbolTable(ast, "file:///t/s.js");
    // a 内的 v（声明在第 2 行）
    const inA = findDefinition(table, "v", { line: 2, column: 8 });
    expect(inA?.loc.start.line).toBe(2);
    // b 内的 v（声明在第 7 行）
    const inB = findDefinition(table, "v", { line: 7, column: 8 });
    expect(inB?.loc.start.line).toBe(7);
  });

  it("findReferences：只返回光标所在作用域的引用", () => {
    const ast = parse(SHADOW_SRC);
    const table = buildSymbolTable(ast, "file:///t/s.js");
    const refsA = findReferences(table, "v", { line: 2, column: 8 });
    expect(refsA.length).toBeGreaterThanOrEqual(1);
    for (const r of refsA) expect(r.loc.start.line).toBeLessThanOrEqual(3);
  });

  it("协议面：definition on 遮蔽的 `v` 跳到本作用域的声明", async () => {
    await withLspServer({ "shadow.js": SHADOW_SRC }, async ({ req, uri }) => {
      const atA = req("textDocument/definition")({
        textDocument: { uri: uri("shadow.js") },
        position: { line: 2, character: 9 },
      }) as any[];
      expect(Array.isArray(atA)).toBe(true);
      expect(atA.length).toBeGreaterThanOrEqual(1);
      expect(atA[0]!.uri).toBe(uri("shadow.js"));
      // a 里的 v 声明在第 2 行（0 基 = 1）
      expect(atA[0]!.range.start.line).toBe(1);
      expect(atA[0]!.range.start.character).toBe(8);

      const atB = req("textDocument/definition")({
        textDocument: { uri: uri("shadow.js") },
        position: { line: 7, character: 9 },
      }) as any[];
      expect(atB.length).toBeGreaterThanOrEqual(1);
      // b 里的 v 声明在第 7 行（0 基 = 6）
      expect(atB[0]!.range.start.line).toBe(6);
      expect(atB[0]!.range.start.character).toBe(8);
    });
  });

  it("协议面：references on 遮蔽的 `v` 不混进另一个作用域的声明", async () => {
    await withLspServer({ "shadow.js": SHADOW_SRC }, async ({ req, uri }) => {
      const refs = req("textDocument/references")({
        textDocument: { uri: uri("shadow.js") },
        position: { line: 2, character: 9 },
        context: { includeDeclaration: true },
      }) as any[];
      const lines = refs.map((r) => r.range.start.line);
      // b 里的声明（第 7 行 / 0 基 6）不得出现
      expect(lines).not.toContain(6);
      // a 里的声明（0 基 1）与用点（0 基 2）都在
      expect(lines).toContain(1);
      expect(lines).toContain(2);
    });
  });
});
