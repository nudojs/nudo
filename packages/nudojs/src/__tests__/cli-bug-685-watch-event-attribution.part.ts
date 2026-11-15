/**
 * Bug 685 — `nudo check/test --watch` 在**同目录多文件**时把变更文件
 * **误记成首个路径** ⇒ 被改的文件**永不被重新分析**。
 *
 * 根因：非目录分支 `const fullPath = isDir ? join(watchTarget, filename) : primary;`
 * ⇒ `fullPath` **恒等于第 0 个路径**，与「哪个文件真的变了」无关。
 *
 * 修法：事件路径按**该事件所属的监视根**换算（`join(root, filename)`）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWatch } from "../commands/shared.ts";

const waitUntil = async (pred: () => boolean, ms = 15000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const SRC = (n: number) => `export function f${n}() {\n  return ${n};\n}\n`;

describe("Bug 685 — watch 事件路径归属真实变更文件", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("同目录多文件：改第二个文件 ⇒ 增量轮重跑的是它（改前：重跑首个文件）", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "nudo-685-"));
    dirs.push(dir);
    const p1 = join(dir, "p1.js");
    const p2 = join(dir, "p2.js");
    writeFileSync(p1, SRC(1), "utf-8");
    writeFileSync(p2, SRC(2), "utf-8");

    const seen: string[] = [];
    const close = startWatch([p1, p2], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      writeFileSync(p2, SRC(22), "utf-8");
      await waitUntil(() => seen.length >= 1);
      expect(seen).toEqual([p2]);
      expect(seen).not.toContain(p1);
    } finally {
      close();
    }
  });

  it("同目录多文件：改第一个文件 ⇒ 增量轮重跑的是它（回归护栏）", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "nudo-685b-"));
    dirs.push(dir);
    const p1 = join(dir, "p1.js");
    const p2 = join(dir, "p2.js");
    writeFileSync(p1, SRC(1), "utf-8");
    writeFileSync(p2, SRC(2), "utf-8");

    const seen: string[] = [];
    const close = startWatch([p1, p2], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      writeFileSync(p1, SRC(11), "utf-8");
      await waitUntil(() => seen.length >= 1);
      expect(seen).toEqual([p1]);
    } finally {
      close();
    }
  });
});
