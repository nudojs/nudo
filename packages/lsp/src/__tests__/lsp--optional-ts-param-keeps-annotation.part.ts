/**
 * Bug 1024 —— 「Change signature: make `'x'` optional」打在 **TypeScript 形参**上
 * ⇒ 编辑范围覆盖 `x: number` **整段** ⇒ **静默删掉用户的类型标注**。
 *
 * 根因（`packages/lsp/src/refactor-b2.ts` 的 `makeParamOptionalAt`）：
 * `strip-types` 剥 TS 时**只删 `TSTypeAnnotation` 节点、不改写 `Identifier` 的
 * `loc`** ⇒ 剥完后区间仍是 `x: number`；而 `makeParamOptionalAt` 把它**当「标识符
 * 区间」**直接用，再用 `${h.name} = undefined` **整段覆盖** ⇒ 类型标注被当作标识符
 * 的一部分一起抹掉。
 *
 * 修法：把类型标注**拼回**新文本 —— 节点上的旁路 `nudoTypeText`（core
 * `strip-types.ts` 挂载，**零新增 core 导出**）给出标注文本 ⇒ 新文本是
 * `x: number = undefined`。
 *
 * ⚠ 勘误（族 23 共享上下文 §4 勘误表第 4 行）：「静默」只指 **LSP 侧**（无提示、
 * 无 diff 预览）；`nudo check` 会从 0 error 翻成 1 error（`scaled(x: any, label:
 * string) => number throws TypeError`）⇒ 本钉**断言门禁不再变红**（改后仍 0 error），
 * 并把「改前会变红」钉成对照。
 *
 * oracle（动作面 / 门禁面）：
 *   改前 edit[0] = [0:23 → 0:32] "x = undefined"（覆盖 "x: number" ⇒ 标注被删）
 *        ⇒ `nudo check` → 1 error（`nudo:entry-may-throw`）
 *   改后 edit[0] = [0:23 → 0:32] "x: number = undefined"（标注保留）
 *        ⇒ `nudo check` → 0 error
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeParamOptionalAt } from "../refactor-b2.ts";
import { withLspServer, withTempDir } from "./helpers.ts";
import { applyEdits, runNudoCheck } from "./lsp-bug-r90b-harness.ts";

const SRC = `export function scaled(x: number, label: string): number {
  return x * 2;
}
`;

/** 光标：第 1 行（1 基）的 `x`（0 基列 23） */
const LINE = 1;
const COLUMN = 23;

describe("Bug 1024 · make optional 保留 TS 类型标注", () => {
  it("新文本把类型标注拼回去", () => {
    const r = makeParamOptionalAt(SRC, LINE, COLUMN);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.title).toBe("Change signature: make 'x' optional");
    expect(r.edits[0]!.newText).toBe("x: number = undefined");
    // 区间仍是「标识符（含标注）」的区间 —— 但**不再**用纯标识符文本覆盖它
    expect(r.edits[0]!.range).toEqual({
      start: { line: 0, character: 23 },
      end: { line: 0, character: 32 },
    });
  });

  it("应用后：类型标注仍在（`x: number = undefined`）", () => {
    const r = makeParamOptionalAt(SRC, LINE, COLUMN);
    if (!r || !("edits" in r)) return;
    const patched = applyEdits(SRC, r.edits);
    expect(patched).toContain("scaled(x: number = undefined, label: string): number");
    expect(patched).not.toContain("scaled(x = undefined");
  });

  it("门禁面：应用后 `nudo check` 仍是 0 error（改前会翻成 1 error）", () => {
    const r = makeParamOptionalAt(SRC, LINE, COLUMN);
    if (!r || !("edits" in r)) return;
    const patched = applyEdits(SRC, r.edits);
    withTempDir("nudo-b2-1024-", (dir) => {
      const after = join(dir, "after.ts");
      const before = join(dir, "before.ts");
      writeFileSync(after, patched, "utf-8");
      // 「改前」形态：类型标注被抹掉（`x = undefined`）
      writeFileSync(
        before,
        patched.replace("x: number = undefined", "x = undefined"),
        "utf-8",
      );
      const afterRes = runNudoCheck(after);
      const beforeRes = runNudoCheck(before);
      expect(afterRes.code).toBe(0);
      expect(afterRes.stdout).toContain("0 error");
      // 改前的症状（勘误）：门禁从 0 error 翻成 1 error（`nudo:entry-may-throw`）
      expect(beforeRes.code).toBe(1);
      expect(beforeRes.stdout).toContain("nudo:entry-may-throw");
    });
  });

  it("协议面：codeAction 给出的 rewrite 文本保留标注", async () => {
    await withLspServer({ "a.ts": SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("a.ts") },
        range: {
          start: { line: LINE - 1, character: COLUMN },
          end: { line: LINE - 1, character: COLUMN },
        },
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const rewrite = actions.find((a) => a.kind === "refactor.rewrite");
      expect(rewrite).toBeDefined();
      expect(rewrite!.edit!.changes[uri("a.ts")]![0]!.newText).toBe(
        "x: number = undefined",
      );
    });
  });

  it("对照：纯 JS 形参的行为不变（`x = undefined`）", () => {
    const js = `export function scaled(x, label) {
  return x * 2;
}
`;
    const r = makeParamOptionalAt(js, 1, 23);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.edits[0]!.newText).toBe("x = undefined");
  });
});
