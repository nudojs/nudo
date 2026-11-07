/**
 * Bug 686 — `nudo check/test/health --watch` 在路径**跨多个目录**时，只监视
 * **第一个目录** ⇒ 其余目录下的文件**永不被重跑**。
 *
 * 根因：监视根只由**第 0 个路径**决定（`isDir ? primary : dirname(primary)`），
 * 路径集里其余目录**从未被 `fs.watch` 注册** ⇒ 那些目录里的文件是永久盲区
 * （而 `getFiles()` 却把**所有**路径下的文件都收进文件集 ⇒ 文件集跨目录、
 * 监视范围只有一个目录）。
 *
 * 修法：监视根**按每个路径各自解析**（目录→该目录，文件→其所在目录），
 * 每个根一个 watcher，关闭句柄一次关掉全部。
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

describe("Bug 686 — watch 监视根覆盖全部路径目录", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("跨目录路径：改第二个目录里的文件会触发增量轮（改前：0 轮）", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const base = mkdtempSync(join(tmpdir(), "nudo-686-"));
    dirs.push(base);
    const dirA = join(base, "a");
    const dirB = join(base, "b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const fileA = join(dirA, "x.js");
    const fileB = join(dirB, "o.js");
    writeFileSync(fileA, SRC(1), "utf-8");
    writeFileSync(fileB, SRC(2), "utf-8");

    const seen: string[] = [];
    const close = startWatch([dirA, fileB], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      // 改**第二个目录**里的文件 ⇒ 必须触发增量轮
      // 断言用 toContain 而非 toEqual([fileB])：fs.watch 在 macOS 上会合并
      // / 重复投递**初始扫描**事件，高并发全量运行时残留事件可能落在
      // `seen.length = 0` 之后（实测 Received = [b/o.js, a/x.js]）。Bug 686
      // 的核心语义是「该目录的变更被监视到」，不是「恰好只投递一个事件」；
      // 严格相等把宿主事件投递行为当成产品契约，会造成与产品无关的假红。
      writeFileSync(fileB, SRC(22), "utf-8");
      await waitUntil(() => seen.includes(fileB));
      expect(seen).toContain(fileB);
    } finally {
      close();
    }
  });

  it("跨目录路径：改第一个目录里的文件也照常触发（回归护栏）", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const base = mkdtempSync(join(tmpdir(), "nudo-686b-"));
    dirs.push(base);
    const dirA = join(base, "a");
    const dirB = join(base, "b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const fileA = join(dirA, "x.js");
    const fileB = join(dirB, "o.js");
    writeFileSync(fileA, SRC(1), "utf-8");
    writeFileSync(fileB, SRC(2), "utf-8");

    const seen: string[] = [];
    const close = startWatch([dirA, fileB], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      // 同上的回归护栏：只要求「改第一个目录的文件仍被监视到」，不假定
      // fs.watch 恰好投递一个事件（初始扫描的延迟事件会跨清空点落地）。
      writeFileSync(fileA, SRC(11), "utf-8");
      await waitUntil(() => seen.includes(fileA));
      expect(seen).toContain(fileA);
    } finally {
      close();
    }
  });
});
