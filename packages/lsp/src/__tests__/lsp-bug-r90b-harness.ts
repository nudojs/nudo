/**
 * 族 23 片 B（lsp-refactor：733 / 738 / 739 / 741 / 744 / 970 / 1024）共享 harness：
 * 把 `inlineVariableAt` / `makeParamOptionalAt` 产出的 TextEdit **落到源码上**，
 * 再取**语义面**证据（`node --check` 的 stderr / 落盘后源码的运行结果）。
 *
 * 只服务本片的 `lsp-bug-733|738|739|741|744|970|1024-*.test.ts`；
 * 不改动共享的 `helpers.ts`（族 24 片 C 的地盘）——协议面复用它的 `withLspServer`。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Edit = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
};

/** （0 基）行号 + 列号 → 源码绝对偏移 */
export function offsetAt(src: string, line: number, character: number): number {
  const lines = src.split("\n");
  let off = 0;
  for (let i = 0; i < line; i++) off += (lines[i] ?? "").length + 1;
  return off + character;
}

/**
 * 把 TextEdit 落到源码上（**正确客户端口径**：所有 range 相对**原文**，
 * 按起点倒序一次性拼接 ⇒ 结果与编辑顺序无关）。
 */
export function applyEdits(src: string, edits: Edit[]): string {
  const marked = edits
    .map((e) => ({
      s: offsetAt(src, e.range.start.line, e.range.start.character),
      t: offsetAt(src, e.range.end.line, e.range.end.character),
      newText: e.newText,
    }))
    .sort((a, b) => b.s - a.s || b.t - a.t);
  let cur = src;
  for (const e of marked) cur = cur.slice(0, e.s) + e.newText + cur.slice(e.t);
  return cur;
}

/** 两条 edit 的区间是否相交（LSP：同一 change 数组内的 TextEdit 不得重叠） */
export function editsOverlap(a: Edit, b: Edit): boolean {
  const s1 = a.range.start;
  const e1 = a.range.end;
  const s2 = b.range.start;
  const e2 = b.range.end;
  const before = (
    p: { line: number; character: number },
    q: { line: number; character: number },
  ): boolean => p.line < q.line || (p.line === q.line && p.character < q.character);
  return before(s1, e2) && before(s2, e1);
}

/** 整个 edit 集合内部是否有重叠 */
export function anyOverlap(edits: Edit[]): boolean {
  for (let i = 0; i < edits.length; i++) {
    for (let j = i + 1; j < edits.length; j++) {
      if (editsOverlap(edits[i]!, edits[j]!)) return true;
    }
  }
  return false;
}

/** `node --check` 的判定（"OK" 或失败原因首行） */
export function nodeCheck(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b2-check-"));
  const file = join(dir, "m.mjs");
  writeFileSync(file, src, "utf-8");
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: ["ignore", "pipe", "pipe"] });
    return "OK";
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    return stderr[0] ?? "FAILED";
  }
}

/**
 * 落盘后跑一遍源码：返回求值结果的 JSON 文本（出错时返回 `Error: <message>`）。
 * 例：`runModule(src, "M.f()")` ⇒ `"3"` / `"Error: b is not defined"`。
 */
export function runModule(src: string, expr: string): string {  const dir = mkdtempSync(join(tmpdir(), "nudo-b2-rt-"));
  const file = join(dir, "m.mjs");
  writeFileSync(file, src, "utf-8");
  try {
    const out = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import * as M from ${JSON.stringify(file)}; console.log(JSON.stringify(${expr}));`,
      ],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" },
    );
    return out.trim();
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? "")
      .split("\n")
      .filter((l) => /Error/.test(l) && !/Node\.js v/.test(l));
    const first = stderr[0]?.trim() ?? "(no stderr)";
    return first.replace(/^.*?(Error: .*)$/, "$1");
  }
}

/**
 * 跑 `nudo check`（**从源码入口**，与 `tmp/probe/cli/nudo.sh` 同一条命令）：
 * 返回 exit code + stdout。L2 门禁（`nudo:entry-may-throw`）住在 CLI 里，
 * 分析面（`analyzeFile`）不发射它 ⇒ 门禁面只能走 CLI。
 */
export function runNudoCheck(file: string): { code: number; stdout: string; stderr?: string } {
  const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
  const cli = join(repoRoot, "packages", "nudojs", "src", "index.ts");
  const tsx = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--import", tsx, cli, "check", file],
      { encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" } },
    );
    return { code: 0, stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}
