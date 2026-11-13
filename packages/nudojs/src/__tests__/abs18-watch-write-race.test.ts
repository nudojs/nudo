/**
 * ABS-18 · 「轮末/分析中写入被吞」竞态的**确定性 e2e 夹具**。
 *
 * 旧行为：`recordVersions()` 在增量轮 resolve 之后才跑 ⇒ 分析期间的二次保存被记成
 * 新基线 ⇒ 下一次事件比对「未变」⇒ 改动被静默吞掉（用户得再保存一次）。
 *
 * 复现方式（确定而非概率）：让 `runOne`（fake 分析器）在**增量轮一开始**就阻塞在
 * 一个手动 gate 上——此时基线已按新契约记录 → 在阻塞期间写入新内容 → 释放。
 * 旧实现会把这次写入记成基线（不再有任何后续轮次）；新实现必须再触发一轮，
 * 且第二轮读到的磁盘内容包含第二次写入。
 *
 * 反向验证（开发时手工做过）：把 `recordVersions(changedFiles)` 挪回
 * `runIncremental(...).finally(...)`，本夹具在 15s 内等不到第二轮 ⇒ 红。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWatch } from "../commands/shared.ts";

const waitUntil = async (pred: () => boolean, ms = 15000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
};

const SRC = (n: number) => `export function f() {\n  return ${n};\n}\n`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-abs18-race-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("ABS-18 · watch 分析中的写入不被吞", () => {
  it("增量轮阻塞期间的第二次写入必须触发下一轮，并读到新内容", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const file = join(dir, "a.js");
    writeFileSync(file, SRC(1), "utf-8");

    /** 增量轮次数（首轮全量不算）。 */
    let incrementalRounds = 0;
    /** 每轮分析时从磁盘读到的内容（fake 分析器模拟「分析读盘」）。 */
    const analyzed: string[] = [];
    /** 第一轮增量在「分析中」阻塞，由测试放行。 */
    let releaseFirstRound!: () => void;
    const firstRoundGate = new Promise<void>((resolve) => {
      releaseFirstRound = resolve;
    });
    let firstRoundEntered!: () => void;
    const firstRoundEnteredP = new Promise<void>((resolve) => {
      firstRoundEntered = resolve;
    });

    let sawFullRound = false;
    const close = startWatch([dir], async (f) => {
      analyzed.push(readFileSync(f, "utf-8"));
      if (!sawFullRound) {
        sawFullRound = true; // 首轮全量：正常返回
        return;
      }
      incrementalRounds++;
      if (incrementalRounds === 1) {
        // 第一轮增量：基线已记录（新契约），现在阻塞模拟慢分析
        firstRoundEntered();
        await firstRoundGate;
      }
    }, "check");

    try {
      // 1) 首轮全量完成
      await waitUntil(() => sawFullRound && analyzed.length >= 1);

      // 2) 第一次写入 → 触发增量轮 1，并等它进入「分析中」
      writeFileSync(file, `${SRC(11)}// first\n`, "utf-8");
      await firstRoundEnteredP;
      expect(incrementalRounds).toBe(1);

      // 3) 分析进行中的第二次写入（旧实现会把它记成基线而吞掉）
      writeFileSync(file, `${SRC(111)}// second\n`, "utf-8");
      // 立刻放行本轮：把窗口钉成「写入在轮内、事件在轮后到达」——
      // 旧实现会在轮末把 V2 记成基线，随后 debounce 的事件被判「未变」而丢弃；
      // 新实现的基线是轮前的 V1，V2 ≠ V1 ⇒ 必然再触发一轮。
      releaseFirstRound();

      // 4) 必须再触发一轮（分析集包含 a.js），且这轮读到第二次写入的内容
      await waitUntil(() => incrementalRounds >= 2);
      const last = analyzed[analyzed.length - 1]!;
      expect(last).toContain("return 111");
      expect(last).toContain("// second");
    } finally {
      releaseFirstRound();
      close();
    }
  });
});
