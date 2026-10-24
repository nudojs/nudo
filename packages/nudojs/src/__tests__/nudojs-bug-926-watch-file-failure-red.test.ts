/**
 * Bug 926：`nudo test --watch` 把**单文件分析失败整个吞掉** ⇒ 门禁**保持绿（exit 0）**；
 * 而**同一目录**的 `nudo check --watch` / `nudo health --watch` / 非 watch 的
 * `nudo test` **全部 exit 1** ⇒ **watch 面上唯一的假绿**（共享 watch 循环吞掉
 * `runOne` 抛出的异常，从不置红）。
 *
 * 修法（CLI 面，`packages/nudojs/src/commands/shared.ts` 的**共享** watch 循环
 * `startWatch`）：每文件的 catch **必须置红**（`process.exitCode = 1`）——
 * **全量轮与增量轮两处**都改；与同文件自陈的「退出码语义 = 最近一轮的门禁状态」
 * 一致。
 *
 * ⚠ **不中断整轮**：一个坏文件不该中止整轮（这是现在的行为，也是对的；
 *   错的只是「不置红」）——本文件同时锁住「坏文件不中止整轮」与
 *   「下一轮绿则退出码复位 0（不得引入粘滞红）」。
 *
 * 本钉直接驱动**共享** watch 循环（check / test / health 三个面走同一个
 * `startWatch`）——`runOne` 以 runCheck/runTest 同语义模拟：门禁红置 1、绿不置；
 * 分析失败（解析/装配失败）⇒ **抛异常**（旧实现只打一行 stderr 就吞掉）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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

/** 坏文件：分析失败（模拟解析失败抛错） */
const BAD_SRC = `export function boom() {
  throw new TypeError("x");
}
`;
/** 好文件：分析通过 */
const GOOD_SRC = `export function id(x) {
  return x;
}
`;

/** 轮末横幅（startWatch 的 watchBanner ⇒ console.error） */
const ROUND_END = "Watching for changes...";

/** 装 console：抓横幅（轮末屏障）+ 静音 clear/log */
function installConsole(): { lines: string[]; rounds: () => number } {
  const lines: string[] = [];
  vi.spyOn(console, "clear").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  });
  return { lines, rounds: () => lines.filter((l) => l.includes(ROUND_END)).length };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("Bug 926: watch 面单文件分析失败必须置红（不得吞掉异常保持绿）", () => {
  it("全量轮：坏文件分析失败 ⇒ exit 1（改前：吞掉异常 ⇒ exit 0 假绿）", async () => {
    const { rounds } = installConsole();
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-926-"));
    const bad = join(dir, "bad.js");
    writeFileSync(bad, BAD_SRC, "utf-8");
    writeFileSync(join(dir, "good.js"), GOOD_SRC, "utf-8");
    process.exitCode = undefined;

    const attempted: string[] = [];
    const close = startWatch(
      [dir],
      async (f) => {
        attempted.push(f);
        // 分析失败 ⇒ 抛（改前：watch 循环 catch 后只打 stderr ⇒ 保持绿）
        if (f.endsWith("bad.js")) throw new Error("parse failed: Unexpected token");
      },
      "test",
    );

    try {
      await waitUntil(() => rounds() >= 1);
      expect(attempted.some((f) => f.endsWith("bad.js"))).toBe(true);
      // 门禁必须红
      expect(process.exitCode).toBe(1);
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });

  it("全量轮：坏文件**不中止整轮**（后续文件仍被分析）", async () => {
    const { rounds } = installConsole();
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-926-"));
    writeFileSync(join(dir, "bad.js"), BAD_SRC, "utf-8");
    writeFileSync(join(dir, "good.js"), GOOD_SRC, "utf-8");
    process.exitCode = undefined;

    const attempted: string[] = [];
    const close = startWatch(
      [dir],
      async (f) => {
        attempted.push(f);
        if (f.endsWith("bad.js")) throw new Error("parse failed: Unexpected token");
      },
      "test",
    );

    try {
      await waitUntil(() => rounds() >= 1);
      expect(attempted.some((f) => f.endsWith("good.js"))).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });

  it("增量轮：坏文件分析失败 ⇒ exit 1；改好后下一轮绿 ⇒ 复位 0（不粘滞红）", async () => {
    const { rounds } = installConsole();
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-926-"));
    const file = join(dir, "w.js");
    writeFileSync(file, GOOD_SRC, "utf-8");
    process.exitCode = undefined;

    let attempts = 0;
    const close = startWatch(
      [file],
      async (f) => {
        attempts++;
        if (readFileSync(f, "utf-8").includes("boom")) throw new Error("parse failed: Unexpected token");
      },
      "test",
    );

    try {
      // 首轮（绿）：退出码 0
      await waitUntil(() => rounds() >= 1);
      expect(attempts).toBeGreaterThanOrEqual(1);
      expect(process.exitCode).toBe(0);

      // 改坏 ⇒ 增量轮必须置红
      writeFileSync(file, BAD_SRC, "utf-8");
      await waitUntil(() => rounds() >= 2);
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(process.exitCode).toBe(1);

      // 改好 ⇒ 下一轮绿 ⇒ 复位 0（本次修复不得引入「粘滞红」）
      writeFileSync(file, GOOD_SRC, "utf-8");
      await waitUntil(() => rounds() >= 3);
      expect(process.exitCode).toBe(0);
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });
});
