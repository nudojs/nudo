/**
 * Bug 1010 — LSP `definition` 对**类方法形参** / **对象方法形参** / **`catch` 形参**
 * 返回 `null`，而**同一位置**的 `references` 却**返回声明位点**
 * ⇒ 同一个 LSP、同一个坐标，两个面自相矛盾。
 *
 * 根因：`buildSymbolTable` 的访问器清单只覆盖 `FunctionDeclaration` /
 * `FunctionExpression` / `ArrowFunctionExpression` 三种函数的 `params`
 * ⇒ 类方法 / 对象方法 / `catch` 的形参**不进 `definitions`** ⇒
 * `findDefinition` 落空 ⇒ definition 返回 `null`；
 * 而 `references` 走 babel binding 面（`collectBindingReferences`）
 * ⇒ 不受符号表影响 ⇒ 照常返回声明位 ⇒ **两个面自相矛盾**。
 *
 * 改后：补 `ClassMethod` / `ObjectMethod` / `ClassPrivateMethod` /
 * `ClassPrivateProperty` / `CatchClause` 五个访问器，各自
 * `registerParam(..., scopeRangeOf(path.scope))`
 * ⇒ 形参进 `definitions` ⇒ definition 命中声明位。
 * ⚠ `catch` 形参的作用域是 **CatchClause 自身作用域**（不是外层）。
 *
 * 原生 oracle：真 LSP server 的 `textDocument/definition` / `textDocument/references`。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

type Loc = {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

const SRC = `export class K {
  method(cp) {
    return cp + 1;
  }
}

const obj = {
  om(op) {
    return op + 1;
  },
};

try {
  throw new Error("x");
} catch (ep) {
  console.log(ep);
}

export function plain(fp) {
  return fp + 1;
}
`;

/** 0-based 行列（needle 的第 occurrence 次出现） */
function posOf(src: string, needle: string, occurrence = 0): { line: number; character: number } {  const lines = src.split("\n");
  let seen = 0;
  for (let line = 0; line < lines.length; line++) {
    let from = 0;
    for (;;) {
      const idx = lines[line]!.indexOf(needle, from);
      if (idx < 0) break;
      if (seen === occurrence) return { line, character: idx };
      seen++;
      from = idx + 1;
    }
  }
  throw new Error(`needle not found: ${needle}`);
}

/** 形参位（声明位） */
const CLASS_PARAM = posOf(SRC, "cp)");
const OBJECT_PARAM = posOf(SRC, "op)");
const CATCH_PARAM = { line: posOf(SRC, "(ep)").line, character: posOf(SRC, "(ep)").character + 1 };
/** 普通函数形参（对照组：改前就是好的） */
const PLAIN_PARAM = posOf(SRC, "fp)");

async function definitionAt(pos: { line: number; character: number }): Promise<Loc[]> {
  let out: Loc[] = [];
  await withLspServer({ "src.js": SRC }, async (ctx) => {
    const handler = ctx.req("textDocument/definition");
    const res = await handler({
      textDocument: { uri: ctx.uri("src.js") },
      position: pos,
    });
    out = (res ?? []) as Loc[];
  });
  return out;
}

async function referencesAt(pos: { line: number; character: number }): Promise<Loc[]> {
  let out: Loc[] = [];
  await withLspServer({ "src.js": SRC }, async (ctx) => {
    const handler = ctx.req("textDocument/references");
    const res = await handler({
      textDocument: { uri: ctx.uri("src.js") },
      position: pos,
      context: { includeDeclaration: true },
    });
    out = (res ?? []) as Loc[];
  });
  return out;
}

describe("Bug 1010 — definition 对方法形参 / catch 形参不再返回 null", () => {
  it("类方法形参：definition ⇒ 形参声明位（改前是 null）", async () => {
    const defs = await definitionAt(CLASS_PARAM);
    expect(defs.length).toBeGreaterThanOrEqual(1);
    const def = defs[0]!;
    expect(def.range.start.line).toBe(CLASS_PARAM.line);
    expect(def.range.start.character).toBe(CLASS_PARAM.character);
    expect(def.range.end.character).toBe(CLASS_PARAM.character + "cp".length);
  });

  it("对象方法形参：definition ⇒ 形参声明位（改前是 null）", async () => {
    const defs = await definitionAt(OBJECT_PARAM);
    expect(defs.length).toBeGreaterThanOrEqual(1);
    const def = defs[0]!;
    expect(def.range.start.line).toBe(OBJECT_PARAM.line);
    expect(def.range.start.character).toBe(OBJECT_PARAM.character);
    expect(def.range.end.character).toBe(OBJECT_PARAM.character + "op".length);
  });

  it("catch 形参：definition ⇒ 形参声明位（改前是 null）", async () => {
    const defs = await definitionAt(CATCH_PARAM);
    expect(defs.length).toBeGreaterThanOrEqual(1);
    const def = defs[0]!;
    expect(def.range.start.line).toBe(CATCH_PARAM.line);
    expect(def.range.start.character).toBe(CATCH_PARAM.character);
    expect(def.range.end.character).toBe(CATCH_PARAM.character + "ep".length);
  });

  it("同一坐标：definition 与 references 的声明位**一致**（不再自相矛盾）", async () => {
    for (const pos of [CLASS_PARAM, OBJECT_PARAM, CATCH_PARAM, PLAIN_PARAM]) {
      const defs = await definitionAt(pos);
      const refs = await referencesAt(pos);
      expect(defs.length, `definition @${pos.line}:${pos.character}`).toBeGreaterThanOrEqual(1);
      const decl = refs.find((r) => r.range.start.line === pos.line)!;
      expect(decl, `references @${pos.line}:${pos.character} 缺声明位`).toBeTruthy();
      expect(defs[0]!.range).toEqual(decl.range);
    }
  });

  it("负控制：普通函数形参的 definition 不受影响", async () => {
    const defs = await definitionAt(PLAIN_PARAM);
    expect(defs.length).toBeGreaterThanOrEqual(1);
    expect(defs[0]!.range.start.line).toBe(PLAIN_PARAM.line);
    expect(defs[0]!.range.start.character).toBe(PLAIN_PARAM.character);
  });
});
