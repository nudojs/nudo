/**
 * Bug 684 — `nudo check/test/health --watch` 在**多路径且首个路径是文件**时
 * watch **彻底失效**（增量轮永不触发）。
 *
 * 根因：监视根只取**第 0 个路径**（`isDir ? primary : dirname(primary)`）——
 * 「首个是文件、另有目录」时监视根是一个**文件**，`join(file, filename)` 又
 * 产出**不存在的目录形式路径** ⇒ dirty 集恒空 ⇒ 增量轮早退。
 *
 * 修法：监视根**按每个路径各自解析**（目录→该目录，文件→其所在目录），
 * 事件路径按所属监视根换算（见 cli-bug-685 / cli-bug-686 同族用例）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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

describe("Bug 684 — watch 多路径且首个是文件 ⇒ 增量轮不再永不触发", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("首个路径是文件 + 另有目录路径：改目录里的文件会触发增量轮", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const base = mkdtempSync(join(tmpdir(), "nudo-684-"));
    dirs.push(base);
    const sub = join(base, "sub");
    mkdirSync(sub, { recursive: true });
    const fileA = join(base, "a.js");
    const fileB = join(sub, "b.js");
    writeFileSync(fileA, SRC(1), "utf-8");
    writeFileSync(fileB, SRC(2), "utf-8");

    const seen: string[] = [];
    const close = startWatch([fileA, sub], async (f) => {
      seen.push(f);
    }, "check");
    try {
      // 首轮：a.js + sub/b.js
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      // 改 sub/b.js ⇒ 必须有一轮增量，且分析的是 b.js
      writeFileSync(fileB, SRC(22), "utf-8");
      await waitUntil(() => seen.length >= 1);
      expect(seen).toEqual([fileB]);
    } finally {
      close();
    }
  });

  it("首个路径是文件 + 另有目录路径：改首个文件自身也会触发增量轮", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const base = mkdtempSync(join(tmpdir(), "nudo-684b-"));
    dirs.push(base);
    const sub = join(base, "sub");
    mkdirSync(sub, { recursive: true });
    const fileA = join(base, "a.js");
    const fileB = join(sub, "b.js");
    writeFileSync(fileA, SRC(1), "utf-8");
    writeFileSync(fileB, SRC(2), "utf-8");

    const seen: string[] = [];
    const close = startWatch([fileA, sub], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      writeFileSync(fileA, SRC(11), "utf-8");
      await waitUntil(() => seen.length >= 1);
      expect(seen).toEqual([fileA]);
    } finally {
      close();
    }
  });
});
