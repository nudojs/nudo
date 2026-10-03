/**
 * watch 退出码语义（check / test 共用 startWatch 循环）：
 * 退出码 = 最近一轮的门禁状态。旧实现红轮置 `process.exitCode=1`
 * 后从不复位——后续绿轮修正后进程退出码仍粘滞 1（假红）。
 * 修复：每轮开跑前复位。runOne 以 runCheck/runTest 同语义模拟
 * （门禁红置 1，绿不置），直接驱动共享 watch 循环。
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

const RED_SRC = `export function boom() {
  throw new TypeError("x");
}
`;
const GREEN_SRC = `export function id(x) {
  return x;
}
id(1);
`;

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("watch exit code（每轮前复位）", () => {
  it("红轮置 1 后，绿轮退出码复位 0（不再粘滞）", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "nudo-watch-exit-"));
    const file = join(dir, "w.js");
    writeFileSync(file, RED_SRC, "utf-8");
    process.exitCode = undefined;

    let rounds = 0;
    const redRounds: boolean[] = [];
    const close = startWatch(
      [file],
      async (f) => {
        rounds++;
        // 与 runCheck 同 exit 语义：门禁红置 1；绿不置（留给轮首复位）
        const red = readFileSync(f, "utf-8").includes("boom");
        redRounds.push(red);
        if (red) process.exitCode = 1;
      },
      "check",
    );

    try {
      // 首轮（红）：exit 1
      await waitUntil(() => rounds >= 1);
      expect(redRounds[0]).toBe(true);
      expect(process.exitCode).toBe(1);

      // 修好文件 → 增量绿轮：退出码必须回到 0（旧实现粘滞 1）
      writeFileSync(file, GREEN_SRC, "utf-8");
      await waitUntil(() => rounds >= 2 && redRounds[redRounds.length - 1] === false);
      expect(process.exitCode).toBe(0);

      // 再改红：退出码跟随最近一轮重新变红
      writeFileSync(file, RED_SRC, "utf-8");
      await waitUntil(() => rounds >= 3 && redRounds[redRounds.length - 1] === true);
      expect(process.exitCode).toBe(1);
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });
});
