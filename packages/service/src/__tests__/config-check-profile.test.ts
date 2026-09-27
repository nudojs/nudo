/**
 * A8：`package.json#nudo.check.profile` 是 L2 预设，CLI 与 LSP 必须同口径。
 * 此前 service `checkConfig` 只读 `entryThrows` —— IDE 把 CLI 已降级的
 * `nudo:entry-may-throw` 仍显示为 error。
 */
import { describe, it, expect } from "vitest";
import { checkConfig } from "../evaluator/config.ts";

describe("checkConfig gate profile", () => {
  it("defaults to entryThrows=error", () => {
    for (const c of [undefined, null, {}, { check: {} }]) {
      expect(checkConfig(c).entryThrows).toBe("error");
    }
  });

  it("profile adoption → L2 warning; strict → L2 error", () => {
    expect(checkConfig({ check: { profile: "adoption" } }).entryThrows).toBe("warning");
    expect(checkConfig({ check: { profile: "strict" } }).entryThrows).toBe("error");
  });

  it("explicit entryThrows wins over profile", () => {
    expect(checkConfig({ check: { profile: "adoption", entryThrows: "error" } }).entryThrows).toBe(
      "error",
    );
    expect(checkConfig({ check: { profile: "strict", entryThrows: "off" } }).entryThrows).toBe("off");
  });

  it("invalid profile falls back to error (no preset applied)", () => {
    expect(
      checkConfig({ check: { profile: "lenient" } as never }).entryThrows,
    ).toBe("error");
  });

  it("invalid entryThrows still warns even when profile is valid", () => {
    const writes: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      // 非法 entryThrows + 合法 profile：应用 profile，但告警不得被吞
      expect(
        checkConfig({ check: { entryThrows: "warn", profile: "adoption" } as never }).entryThrows,
      ).toBe("warning");
      expect(writes.join("")).toContain("nudo.check.entryThrows: invalid value");
    } finally {
      process.stderr.write = orig;
    }
  });

  it("ignoreThrows list still parsed", () => {
    expect(checkConfig({ check: { ignoreThrows: ["TypeError"] } }).ignoreThrows).toEqual([
      "TypeError",
    ]);
  });
});
