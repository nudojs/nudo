/**
 * Bug 467 —— `nudo.check.entryThrows` 非法值 + 合法 `profile` 时：
 * stderr 告警写死「using error」，门禁实际用 **warning**（自相矛盾）。
 *
 * 根因（config.ts checkConfig）：告警文案是常量字符串，而生效值随后被
 * profile 预设覆盖 ⇒ 文案与生效档位互相矛盾。
 *
 * 修法：先算出最终生效档位，再按**生效值**拼告警文案
 * （config.md「L2 entryThrows resolution order」：非法值不是合法显式值 →
 * 落到 config profile 预设）。
 */
import { describe, it, expect } from "vitest";
import { checkConfig } from "../evaluator/config.ts";

/** 捕获 stderr 写入（同 config-check-profile.test.ts 的手法） */
function captureStderr(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return writes.join("");
}

describe("Bug 467 — 非法 entryThrows 的告警文案必须与生效档位一致", () => {
  it("非法 entryThrows + adoption profile：文案说 warning（生效值也是 warning）", () => {
    let eff: string | undefined;
    const out = captureStderr(() => {
      eff = checkConfig({ check: { entryThrows: "bogus", profile: "adoption" } as never })
        .entryThrows;
    });
    expect(eff).toBe("warning");
    // 旧实现：文案写死 "using error"（与生效值 warning 矛盾）
    expect(out).toContain("nudo.check.entryThrows: invalid value");
    expect(out).toContain("using warning");
    expect(out).not.toContain("using error");
  });

  it("非法 entryThrows + strict profile：文案说 error（生效值也是 error）", () => {
    let eff: string | undefined;
    const out = captureStderr(() => {
      eff = checkConfig({ check: { entryThrows: "bogus", profile: "strict" } as never }).entryThrows;
    });
    expect(eff).toBe("error");
    expect(out).toContain("using error");
  });

  it("非法 entryThrows + 无 profile：回默认 error，文案说 error", () => {
    let eff: string | undefined;
    const out = captureStderr(() => {
      eff = checkConfig({ check: { entryThrows: "bogus" } as never }).entryThrows;
    });
    expect(eff).toBe("error");
    expect(out).toContain("using error");
  });

  // ── 负控制：合法值不得被本修复波及 ──────────────────────────────
  it("合法 entryThrows：不告警，且显式值压过 profile", () => {
    let eff: string | undefined;
    const out = captureStderr(() => {
      eff = checkConfig({ check: { entryThrows: "warning", profile: "strict" } }).entryThrows;
    });
    expect(eff).toBe("warning");
    expect(out).toBe("");
  });

  it("无 check 段 / 无 entryThrows：不告警，默认 error", () => {
    let out = "";
    let eff: string | undefined;
    out += captureStderr(() => {
      eff = checkConfig({}).entryThrows;
    });
    out += captureStderr(() => {
      eff = checkConfig({ check: {} }).entryThrows;
    });
    out += captureStderr(() => {
      eff = checkConfig(null).entryThrows;
    });
    expect(eff).toBe("error");
    expect(out).toBe("");
  });

  it("profile 预设本身仍生效（adoption→warning / strict→error），无告警", () => {
    let out = "";
    out += captureStderr(() => {
      expect(checkConfig({ check: { profile: "adoption" } }).entryThrows).toBe("warning");
    });
    out += captureStderr(() => {
      expect(checkConfig({ check: { profile: "strict" } }).entryThrows).toBe("error");
    });
    expect(out).toBe("");
  });
});
