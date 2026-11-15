/**
 * Bug 712 — LSP 类方法改名**越过无关对象**的成员访问、且**漏掉对象字面量的同名 key**
 *          → 改出坏代码（运行时读到 `undefined`）。
 *
 * 改前：`collectMethodReferences` 只按**名字**匹配成员访问（`property.name === name`），
 *       完全不看接收者 ⇒ 改 `a.m` 把 `b.m` 一起改掉；定义位点又只收 ClassMethod /
 *       ObjectMethod 键 ⇒ 对象字面量里的同名 key 漏改 ⇒ 定义集与使用集口径不一致。
 * 改后：方法引用**以「归属」为界**——类方法归类、对象字面量方法归对象；
 *       成员访问只在**接收者归属与该方法定义同源**时计入；对象字面量的方法键
 *       （`{ m() {} }` / `{ m: fn }`）也算定义位点。
 *
 * 原生 oracle：真 LSP server 驱动 `textDocument/rename` ⇒ WorkspaceEdit 逐条。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@nudojs/parser";
import { collectMethodReferences, hasAmbiguousMethodReceiver, renameTargetAt } from "../symbols.ts";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

type Edit = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
};

/** 报告 r21 的夹具：类 K 的方法 m + 无关对象 other 的数据属性 m + 形参上的成员访问 */
const R21 = `export class K {
  m(p) {
    return p;
  }
}

export const other = {
  m: 1,
};

export function use(k, o) {
  k.m(1);
  o.m(2);
  return k.m(3);
}
`;

/** 对象字面量的方法：定义位（key）与使用位（成员访问）必须一起改 */
const OBJ_METHOD = `export const helper = {
  m() {
    return 2;
  },
};
export function call() {
  return helper.m();
}
`;

/** 同名但不同类：Alpha.run 与 Beta.run 不许合并 */
const TWO_CLASSES = `export class Alpha {
  run() {
    return 1;
  }
}
export class Beta {
  run() {
    return 2;
  }
}
export const a = new Alpha();
export const b = new Beta();
export function go() {
  a.run();
  b.run();
}
`;

/** 对象字面量的**函数值属性**（`{ m: fn }`）：key 也是方法定义位 */
const OBJ_PROPERTY = `export const helper = {
  m: impl,
};
export function impl() {
  return 2;
}
export function call() {
  return helper.m();
}
`;

function posOf(src: string, needle: string, occurrence = 0): { line: number; character: number } {
  const lines = src.split("\n");
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

/** 打开若干文件后驱动一次 rename，返回每个文件的编辑清单 */
async function renameEdits(
  files: Record<string, string>,
  target: { file: string; position: { line: number; character: number } },
  newName: string,
): Promise<Record<string, Array<{ at: string; newText: string }>>> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b712-"));
  try {
    const paths: Record<string, string> = {};
    for (const [name, src] of Object.entries(files)) {
      const p = join(dir, name);
      writeFileSync(p, src, "utf-8");
      paths[name] = p;
    }
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    for (const [name, src] of Object.entries(files)) {
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: {
          uri: `file://${paths[name]}`,
          languageId: "javascript",
          version: 1,
          text: src,
        },
      });
    }
    await new Promise((r) => setTimeout(r, 300));
    const handler = mock.requests.get("textDocument/rename");
    expect(handler, "rename handler not registered").toBeTruthy();
    const res = handler!({
      textDocument: { uri: `file://${paths[target.file]}` },
      position: target.position,
      newName,
    }) as { changes?: Record<string, Edit[]> } | null;
    const out: Record<string, Array<{ at: string; newText: string }>> = {};
    for (const [uri, edits] of Object.entries(res?.changes ?? {})) {
      const name = Object.keys(paths).find((k) => uri.endsWith(paths[k]!)) ?? uri;
      out[name] = edits.map((e) => ({
        at: `${e.range.start.line}:${e.range.start.character}-${e.range.end.line}:${e.range.end.character}`,
        newText: e.newText,
      }));
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bug 712 — 方法改名以「归属」为界", () => {
  it("纯函数面：无关对象的同名成员访问不进改名集合", () => {
    const ast = parse(R21);
    const hits = collectMethodReferences(ast, "m", { owner: { kind: "class", name: "K" } });
    const at = (h: (typeof hits)[number]): string =>
      `${h.loc.start.line}:${h.loc.start.column}`;
    // 定义位：类 K 的方法键（1-based 行 2 / 列 2）
    expect(hits.some((h) => h.kind === "key" && at(h) === "2:2")).toBe(true);
    // 使用位：k.m(1) / k.m(3) 的接收者是**形参**（解析不出归属）⇒ 不计入
    // 无关对象 other 的数据属性 m 与 o.m(2) 同样不进集合
    expect(hits.some((h) => at(h) === "8:2")).toBe(false); // other 的 key
    expect(hits.some((h) => at(h) === "13:4")).toBe(false); // o.m(2)
  });

  it("纯函数面：对象字面量的方法键是定义位，且同源成员访问进集合", () => {
    const hits = collectMethodReferences(parse(OBJ_METHOD), "m", {
      owner: { kind: "object", name: "helper" },
    });
    const at = (h: (typeof hits)[number]): string => `${h.loc.start.line}:${h.loc.start.column}`;
    expect(hits.some((h) => h.kind === "key" && at(h) === "2:2")).toBe(true);
    expect(hits.some((h) => h.kind === "member")).toBe(true);
  });

  it("纯函数面：同名但不同类不合并（显式归属时）", () => {
    const hits = collectMethodReferences(parse(TWO_CLASSES), "run", {
      owner: { kind: "class", name: "Alpha" },
    });
    const at = (h: (typeof hits)[number]): string => `${h.loc.start.line}:${h.loc.start.column}`;
    expect(hits.some((h) => at(h) === "2:2")).toBe(true); // Alpha.run 键
    expect(hits.some((h) => at(h) === "6:2")).toBe(false); // Beta.run 键
  });

  it("协议面（真 server）：归属歧义 ⇒ **拒绝改名**（不产出任何编辑，代码不被改坏）", async () => {
    const edits = await renameEdits(
      { "ren-meth.js": R21 },
      { file: "ren-meth.js", position: posOf(R21, "m(p)") },
      "renamed",
    );
    const list = edits["ren-meth.js"] ?? [];
    // 改前：4 条编辑（类方法键 + k.m(1) + o.m(2) + k.m(3)）
    //   ⇒ `o.m(2)` 被改成 `o.renamed(2)`，运行时读到 undefined（静默坏代码）
    // 改后：R21 夹具里 `k` / `o` 都是**无类型形参** ⇒ 接收者归属解析不出来，
    //   而文件内 `other` 有同名成员 `m` ⇒ **归属歧义**。
    //   歧义下只有两种自洽结果：全改（改到无关对象）或全不改（定义改了、
    //   调用点没改 ⇒ 同样坏）——两者都坏 ⇒ 拒绝改名，**一条编辑都不产出**。
    expect(list).toEqual([]);
  });

  it("纯函数面：归属歧义可被检出（歧义 ⇒ 拒绝；无歧义 ⇒ 可改）", () => {
    // R21：形参接收者 + 同名不同归属成员 ⇒ 歧义
    expect(hasAmbiguousMethodReceiver(parse(R21), "m", { owner: { kind: "class", name: "K" } })).toBe(true);
    // OBJ_METHOD：接收者归属可解析（helper ⇒ 对象字面量）⇒ 无歧义
    expect(hasAmbiguousMethodReceiver(parse(OBJ_METHOD), "m", { owner: { kind: "object", name: "helper" } })).toBe(false);
    // TWO_CLASSES：a / b 都能解析出归属 ⇒ 无歧义
    expect(hasAmbiguousMethodReceiver(parse(TWO_CLASSES), "run", { owner: { kind: "class", name: "Alpha" } })).toBe(false);
  });

  it("协议面（真 server）：改对象字面量的方法 ⇒ key 与同源成员访问一起改", async () => {
    const edits = await renameEdits(
      { "obj-meth.js": OBJ_METHOD },
      { file: "obj-meth.js", position: posOf(OBJ_METHOD, "m()") },
      "renamed",
    );
    const list = edits["obj-meth.js"] ?? [];
    // 定义位：对象字面量的 key
    const key = posOf(OBJ_METHOD, "m()");
    expect(list.some((e) => e.at === `${key.line}:${key.character}-${key.line}:${key.character + 1}`)).toBe(true);
    // 使用位：helper.m()
    const use = posOf(OBJ_METHOD, "helper.m");
    const useCol = use.character + "helper.".length;
    expect(list.some((e) => e.at === `${use.line}:${useCol}-${use.line}:${useCol + 1}`)).toBe(true);
    expect(list.every((e) => e.newText === "renamed")).toBe(true);
  });

  it("协议面（真 server）：对象字面量的函数值属性 `{ m: fn }` 的 key 也是定义位", async () => {
    const edits = await renameEdits(
      { "obj-prop.js": OBJ_PROPERTY },
      { file: "obj-prop.js", position: posOf(OBJ_PROPERTY, "m: impl") },
      "renamed",
    );
    const list = edits["obj-prop.js"] ?? [];
    const key = posOf(OBJ_PROPERTY, "m: impl");
    // 改前：ObjectProperty 的 key 不在收集范围 ⇒ 只改调用点，key 留着 m（改出坏代码）
    expect(list.some((e) => e.at === `${key.line}:${key.character}-${key.line}:${key.character + 1}`)).toBe(true);
    const use = posOf(OBJ_PROPERTY, "helper.m");
    const useCol = use.character + "helper.".length;
    expect(list.some((e) => e.at === `${use.line}:${useCol}-${use.line}:${useCol + 1}`)).toBe(true);
  });

  it("协议面（真 server）：同名但不同类不合并（Alpha.run 不碰 Beta.run）", async () => {
    const edits = await renameEdits(
      { "two.js": TWO_CLASSES },
      { file: "two.js", position: posOf(TWO_CLASSES, "run()") },
      "renamed",
    );
    const list = edits["two.js"] ?? [];
    const alphaKey = posOf(TWO_CLASSES, "run()");
    const betaKey = posOf(TWO_CLASSES, "run()", 1);
    const aUse = posOf(TWO_CLASSES, "a.run()");
    const bUse = posOf(TWO_CLASSES, "b.run()");
    expect(list.some((e) => e.at === `${alphaKey.line}:${alphaKey.character}-${alphaKey.line}:${alphaKey.character + 3}`)).toBe(true); // Alpha.run 键
    expect(list.some((e) => e.at.startsWith(`${betaKey.line}:`))).toBe(false); // Beta.run 键
    expect(list.some((e) => e.at.startsWith(`${bUse.line}:`))).toBe(false); // b.run()
    expect(list.some((e) => e.at.startsWith(`${aUse.line}:`))).toBe(true); // a.run()
  });

  it("协议面（真 server）：跨文件的无关类不被改（Alpha.run ≠ Beta.run）", async () => {
    const a = `export class Alpha {
  run() {
    return 1;
  }
}
`;
    const b = `export class Beta {
  run() {
    return 2;
  }
}
`;
    const edits = await renameEdits(
      { "a.js": a, "b.js": b },
      { file: "a.js", position: posOf(a, "run()") },
      "renamed",
    );
    // 改前：b.js 的 Beta.run 也被改（跨文件 name-based 扫描）
    expect(edits["b.js"] ?? []).toEqual([]);
    expect((edits["a.js"] ?? []).some((e) => e.at === "1:2-1:5")).toBe(true);
  });

  it("prepareRename 面：类方法键 / 同源成员访问可改名，无关数据属性不可改名", () => {
    expect(renameTargetAt(R21, 2, 2)).toMatchObject({ kind: "method", name: "m" });
    // other 的数据属性 m：不可改名
    expect(renameTargetAt(R21, 8, 2)).toMatchObject({ error: expect.any(String) });
  });
});
