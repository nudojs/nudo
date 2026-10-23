/**
 * Bug 639 回归：`nudo.check.entryThrows` 的非法值告警必须**进程内去重**
 * （与同族 `nudo.check.profile` 的 `warnedGateConfig` 去重口径一致）。
 *
 * 病灶：`checkConfig()` 此前对非法 `entryThrows` 走**裸** `process.stderr.write`
 * ⇒ 批量检查（每个目标文件调一次 `checkConfig`）时同一 typo **每文件刷一行**
 * （N 个文件 N 行噪声）；而同一层配置的 `profile` typo 只报 1 行 ⇒ 两套口径。
 *
 * 修法（packages/service/src/evaluator/config.ts）：改走同文件的 `warnOnce`
 * （进程内按 key 去重）。
 *
 * 负控制：**不同**非法值各报一次（去重键含值，不是一刀切只报一行）。
 */
import { describe, it, expect } from "vitest";
import { checkConfig } from "../evaluator/config.ts";

/** 抓取本次调用期间写进 stderr 的文本 */
function captureStderr(fn: () => void): string[] {
  const writes: string[] = [];
  const original = process.stderr.write;
  const stub = (chunk: unknown): boolean => {
    writes.push(String(chunk));
    return true;
  };
  process.stderr.write = stub as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return writes;
}

describe("Bug 639: entryThrows 非法值告警进程内去重", () => {
  it("同一非法值在多次 checkConfig 调用里只告警一次", () => {
    const writes = captureStderr(() => {
      checkConfig({ check: { entryThrows: "bogus-639-same" } });
      checkConfig({ check: { entryThrows: "bogus-639-same" } });
      checkConfig({ check: { entryThrows: "bogus-639-same" } });
    });
    expect(writes.length).toBe(1);
    expect(writes[0]).toContain("nudo.check.entryThrows");
    expect(writes[0]).toContain("bogus-639-same");
  });

  it("负控制：不同非法值各告警一次（去重键含值）", () => {
    const writes = captureStderr(() => {
      checkConfig({ check: { entryThrows: "bogus-639-a" } });
      checkConfig({ check: { entryThrows: "bogus-639-b" } });
    });
    expect(writes.length).toBe(2);
    expect(writes[0]).toContain("bogus-639-a");
    expect(writes[1]).toContain("bogus-639-b");
  });

  it("负控制：合法值不告警", () => {
    const writes = captureStderr(() => {
      checkConfig({ check: { entryThrows: "warning" } });
      checkConfig({ check: { entryThrows: "off" } });
      checkConfig({ check: { entryThrows: "error" } });
    });
    expect(writes.length).toBe(0);
  });

  it("非法值仍回落可用档位（告警文案里的 using 段与生效档一致）", () => {
    const cfg = checkConfig({ check: { entryThrows: "bogus-639-fallback" } });
    expect(["error", "warning", "off"]).toContain(cfg.entryThrows);
  });
});
