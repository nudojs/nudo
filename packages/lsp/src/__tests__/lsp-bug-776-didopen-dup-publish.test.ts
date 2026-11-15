// GENERATED MERGE (scripts/tmp-merge-bugs.mjs): lsp-bug-776-didopen-dup-publish.test.ts + lsp-bug-776-validation-self-exclusion.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createMockConnection, makeValidateDeps } from "./helpers.ts";
import { createNudoServer } from "../server.ts";
import { clearValidationState, handleNudoDepFileChanged, registerNudoImportDeps, validateText } from "../validation.ts";

describe("[merged] lsp-bug-776-didopen-dup-publish.test.ts", () => {
/**
 * Bug 776 —— `didOpen` 重复发布 `publishDiagnostics`。
 *
 * 症状：打开一个文件后，同一版本、同一内容的诊断被**发布两次**。
 * 根因：`vscode-languageserver` 的 `TextDocuments.listen()` 在 `didOpen` 时
 * **同时** fire `onDidOpen` 与 `onDidChangeContent`
 * （`vscode-languageserver/lib/common/textDocuments.js`）⇒ server 的
 * 「打开即验证」路径与「编辑防抖」路径对**同一内容**各跑一遍完整校验，
 * 各 publish 一次。
 *
 * 修法（片 D · `server.ts`）：
 * - `documents.onDidOpen` 记录文档指纹（version + 内容）；
 * - `documents.onDidChangeContent` 发现指纹相同 ⇒ 认定是 didOpen 回声 ⇒
 *   不再排一次防抖校验；
 * - publish 面加**内容去重**（同 uri + 同 version + 同诊断内容 ⇒ 只发一次），
 *   同版本但诊断内容变了（侧车/依赖变更后的 force 重检）仍照发。
 *
 * 钉：打开一个会出诊断的文件 ⇒ 只发布 1 次；打开一个不出诊断的文件 ⇒
 * 也只发布 1 次（空数组），不得出现「同一版本同内容发两次」。
 */







const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Bug 776 — didOpen 不得重复发布同一版本的诊断", () => {
  it("会出诊断的文件：didOpen 只发布一次（同 version 同内容）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776-"));
    try {
      const src = "export function boom() {\n  throw new Error('x');\n}\n";
      const file = join(dir, "boom.js");
      writeFileSync(file, src, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await sleep(900);
      const published = mock.sentDiagnostics.filter((d) => d.uri === uri);
      expect(published).toHaveLength(1);
      expect(published[0]?.version).toBe(1);
      expect((published[0]?.diagnostics ?? []).map((d: { code?: string }) => d.code)).toContain(
        "nudo:entry-may-throw",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("不出诊断的文件：didOpen 也只发布一次（空数组）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776-"));
    try {
      const src = "export const a = 1;\n";
      const file = join(dir, "plain.js");
      writeFileSync(file, src, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await sleep(900);
      const published = mock.sentDiagnostics.filter((d) => d.uri === uri);
      expect(published).toHaveLength(1);
      expect(published[0]?.diagnostics).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("编辑后仍会发布新版本的诊断（去重不得把后续诊断吞掉）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776-"));
    try {
      const src = "export function boom() {\n  throw new Error('x');\n}\n";
      const file = join(dir, "boom.js");
      writeFileSync(file, src, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await sleep(900);
      mock.notifications.get("textDocument/didChange")!({
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: src + "\nexport const b = 2;\n" }],
      });
      await sleep(900);
      const versions = mock.sentDiagnostics
        .filter((d) => d.uri === uri)
        .map((d) => d.version);
      expect(versions).toContain(1);
      expect(versions).toContain(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
});

describe("[merged] lsp-bug-776-validation-self-exclusion.test.ts", () => {
/**
 * Bug 776（validation.ts 半）—— 依赖文件变更的 **self-排除**。
 *
 * `handleNudoDepFileChanged` 把 `computeDirtySet(...)` 的返回值（含**种子**
 * 本身）整个塞进 `parentSet` ⇒ 变更文件被当成**自己的** parent ⇒ 触发对
 * 自己的 force 重检 ⇒ 自激重检（改一个文件把自己又重检一遍）。
 *
 * 修法（片 E 落，片 D 消费）：`parentSet` 排除变更文件自身
 * （`nudoDepParents` 边与 module graph 脏集两处都排除）。
 *
 * 钉：变更文件自己 ⇒ **不**重检自己（publish 次数不增加）；
 * 而**真正的** parent（@nudo:import 依赖方）仍被重检（不得误伤）。
 */







const norm = (p: string) => resolve(p).replace(/\\/g, "/");

describe("Bug 776（validation 半）—— 依赖文件变更的 self-排除", () => {
  beforeEach(() => {
    clearValidationState();
  });

  it("变更文件自己 ⇒ 不重检自己（无自激重检）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776e-"));
    try {
      const file = join(dir, "self.js");
      const src = `export function s(x) { return x; }\n`;
      writeFileSync(file, src, "utf-8");
      let published = 0;
      const deps = makeValidateDeps({
        docs: [[norm(file), { uri: `file://${file}`, version: 2, getText: () => src }]],
        lookupKey: norm,
        onPublish: () => {
          published++;
        },
      });
      // 初验：登记 knownFiles（module graph 需要）
      await validateText(file, `file://${file}`, src, 2, deps, false);
      const afterInitial = published;
      expect(afterInitial).toBeGreaterThan(0);

      // 变更文件自己 ⇒ 不得再触发一次对自己的重检
      await handleNudoDepFileChanged(file, deps);
      expect(published).toBe(afterInitial);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("真正的 parent（@nudo:import 依赖方）仍被重检（self-排除不得误伤）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776f-"));
    try {
      const parent = join(dir, "a.js");
      const dep = join(dir, "shapes.nudo.js");
      writeFileSync(dep, "export const positive = number().gt(0);\n");
      const parentSrc = `/// @nudo:import { positive } from "./shapes.nudo.js"
export function needsPositive(x) {
  return x;
}
`;
      writeFileSync(parent, parentSrc);
      registerNudoImportDeps(parent, parentSrc);

      let published = 0;
      const deps = makeValidateDeps({
        docs: [[norm(parent), { uri: `file://${parent}`, version: 2, getText: () => parentSrc }]],
        lookupKey: norm,
        onPublish: () => {
          published++;
        },
      });
      await handleNudoDepFileChanged(dep, deps);
      expect(published).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
});
