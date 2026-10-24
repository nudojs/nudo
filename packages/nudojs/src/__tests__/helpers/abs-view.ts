/**
 * `check --abs` 观察面的**进程内**驱动（`runAbsView` 直接调用）。
 *
 * 为什么进程内：CLI 子进程（tsx 跑 src）很重，且共享工作树里别的分片正在
 * 改源码时，子进程可能读到写了一半的文件 ⇒ 假失败。观察面的内容断言
 * （term/pred/conf、assume 回显、用法错误）不需要子进程。
 *
 * 退出码面（`check` 的报告段不把 exitCode 复位回 0）另由 CLI 级测试钉。
 */
import { vi } from "vitest";
import { runAbsView } from "../../commands/shared.ts";

export interface AbsViewResult {
  stdout: string;
  stderr: string;
  /** runAbsView 置的 exitCode（未置 ⇒ 0） */
  exitCode: number;
}

export interface AbsViewOpts {
  fn?: string;
  assume?: string[];
  generalize?: boolean;
}

/** 跑一次 `runAbsView`，把 console.log/error 收进字符串。 */
export async function runAbsViewCaptured(
  filePath: string,
  opts: AbsViewOpts = {},
): Promise<AbsViewResult> {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map((a) => String(a)).join(" "));
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(args.map((a) => String(a)).join(" "));
  });
  const prevExit = process.exitCode;
  process.exitCode = undefined;
  try {
    await runAbsView(filePath, opts);
    return {
      stdout: out.join("\n"),
      stderr: err.join("\n"),
      exitCode: typeof process.exitCode === "number" ? process.exitCode : 0,
    };
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = prevExit;
  }
}
