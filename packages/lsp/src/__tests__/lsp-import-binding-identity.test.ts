/**
 * 模块套件：lsp-import-binding-identity（LSP 分片；1 文件 = 1 worker）。
 *
 * 同一段源码里 `import { shared }` 与函数体内的 `const shared = 9` 是**两个
 * 绑定、同一个名字**。references / definition / rename 三个面都必须按**绑定**
 * 而不是按**名字**分派 —— 否则一次「重命名局部变量」会把包的公开导出一起改掉，
 * 并改到会话从未打开的文件 ⇒ 消费方 `SyntaxError: does not provide an export
 * named …`。
 *
 * 原生 oracle：真 LSP server 驱动 `textDocument/{definition,references,rename}`，
 * 断言的是协议响应本身（不是符号层内部函数）。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { withLspServer } from "./helpers.ts";

const LIB = `export const shared = 1;\n`;

/** 遮蔽形态：函数体里的局部量与本文件的 import 同名 */
const USE = `import { shared } from "./lib.js";
export function f() {
  const shared = 9;
  return shared;
}
export function g() {
  return shared;
}
`;

/** 会话**未打开**的第三方 importer（目录扫描范围内） */
const THIRD = `import { shared } from "./lib.js";
export function h() {
  return shared;
}
`;

const FILES = { "lib.js": LIB, "use.js": USE };

/** 协议位置（0-based 行 / 列） */
const LOCAL_DECL = { line: 2, character: 8 }; // const shared
const LOCAL_USE = { line: 3, character: 9 }; // return shared（f 内，局部量）
const IMPORT_USE = { line: 6, character: 9 }; // return shared（g 内，导入）

type Edit = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
};

function relOf(uri: string, dir: string): string {
  return relative(dir, uri.replace(/^file:\/\//, ""));
}

describe("同名遮蔽：引用/定义/改名按绑定分派", () => {
  it("definition @ 遮蔽用点 ⇒ 本地 const（不跳到 lib.js）；对照：@ 导入用点 ⇒ lib.js 的导出", async () => {
    await withLspServer(FILES, async (ctx) => {
      writeFileSync(join(ctx.dir, "third.js"), THIRD, "utf-8");

      const shadowed = (await ctx.req("textDocument/definition")({
        textDocument: { uri: ctx.uri("use.js") },
        position: LOCAL_USE,
      })) as Array<{ uri: string; range: { start: { line: number; character: number } } }>;
      const shadowedAt = shadowed.map(
        (l) => `${relOf(l.uri, ctx.dir)}:${l.range.start.line}:${l.range.start.character}`,
      );
      // 首跳必须是本地声明（改前：lib.js 的导出排第一）
      expect(shadowedAt[0]).toBe("use.js:2:8");

      const imported = (await ctx.req("textDocument/definition")({
        textDocument: { uri: ctx.uri("use.js") },
        position: IMPORT_USE,
      })) as Array<{ uri: string; range: { start: { line: number; character: number } } }>;
      const importedAt = imported.map(
        (l) => `${relOf(l.uri, ctx.dir)}:${l.range.start.line}:${l.range.start.character}`,
      );
      // 对照：真导入用点仍跨文件（行为不变）
      expect(importedAt[0]).toBe("lib.js:0:13");
    });
  });

  it("references @ 遮蔽用点 ⇒ 只有本文件的局部绑定（不含 lib.js / 未打开的 third.js）", async () => {
    await withLspServer(FILES, async (ctx) => {
      writeFileSync(join(ctx.dir, "third.js"), THIRD, "utf-8");

      const res = (await ctx.req("textDocument/references")({
        textDocument: { uri: ctx.uri("use.js") },
        position: LOCAL_USE,
        context: { includeDeclaration: true },
      })) as Array<{ uri: string; range: { start: { line: number; character: number } } }>;
      const where = res
        .map((l) => `${relOf(l.uri, ctx.dir)}:${l.range.start.line}:${l.range.start.character}`)
        .sort();
      expect(where).toEqual(["use.js:2:8", "use.js:3:9"]);
    });
  });

  it("rename @ 局部声明 ⇒ 只改本文件两处（不连坐包的公开导出，也不碰未打开的文件）", async () => {
    await withLspServer(FILES, async (ctx) => {
      writeFileSync(join(ctx.dir, "third.js"), THIRD, "utf-8");

      const res = (await ctx.req("textDocument/rename")({
        textDocument: { uri: ctx.uri("use.js") },
        position: LOCAL_DECL,
        newName: "localOnly",
      })) as { changes?: Record<string, Edit[]> } | null;
      const changes = res?.changes ?? {};
      const touched = Object.keys(changes).map((uri) => relOf(uri, ctx.dir)).sort();
      expect(touched).toEqual(["use.js"]);
      const edits = changes[Object.keys(changes)[0]!] ?? [];
      const at = edits
        .map((e) => `${e.range.start.line}:${e.range.start.character}`)
        .sort();
      expect(at).toEqual(["2:8", "3:9"]);
      // 只钉位置集合的话，空替换（newText: ""）也能通过 ⇒ 逐条钉替换文本。
      expect(edits.map((e) => e.newText)).toEqual(["localOnly", "localOnly"]);
    });
  });

  it("对照：rename @ 导入本地名 ⇒ 仍跨文件（lib.js 的导出 + 两个 importer）", async () => {
    await withLspServer(FILES, async (ctx) => {
      writeFileSync(join(ctx.dir, "third.js"), THIRD, "utf-8");

      const res = (await ctx.req("textDocument/rename")({
        textDocument: { uri: ctx.uri("use.js") },
        position: IMPORT_USE,
        newName: "shared2",
      })) as { changes?: Record<string, Edit[]> } | null;
      const changes = res?.changes ?? {};
      const touched = Object.keys(changes).map((uri) => relOf(uri, ctx.dir)).sort();
      // 行为不变：导入名身份仍是「目标模块的导出」
      expect(touched).toEqual(["lib.js", "third.js", "use.js"]);
      // use.js 里只改导入说明符与 g 的用点 —— **不**碰 f 体内的局部量
      const useEdits = changes[Object.keys(changes).find((u) => u.endsWith("use.js"))!] ?? [];
      const useAt = useEdits
        .map((e) => `${e.range.start.line}:${e.range.start.character}`)
        .sort();
      expect(useAt).toEqual(["0:9", "6:9"]);
      // 只钉位置集合的话，空替换（newText: ""）也能通过 ⇒ 逐条钉替换文本。
      expect(useEdits.map((e) => e.newText)).toEqual(["shared2", "shared2"]);
    });
  });
});
