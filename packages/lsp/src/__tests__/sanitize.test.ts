/**
 * sanitizeErrorMessage（BUG-023 / S5-005）：
 * LSP 诊断 / agent 工具结果会进 IDE 与远端 LLM
 * 会话——原始 err.message 的绝对路径等于回传
 * 工作区布局。
 */
import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { sanitizeErrorMessage } from "../sanitize.ts";

describe("sanitizeErrorMessage (BUG-023)", () => {
  it("replaces home-directory prefix with ~", () => {
    const home = homedir();
    const msg = `ENOENT: no such file or directory, open '${home}/proj/a.js'`;
    expect(sanitizeErrorMessage(msg, [])).toBe(
      `ENOENT: no such file or directory, open '~/proj/a.js'`,
    );
  });

  it("replaces tracked root prefixes with .", () => {
    const msg =
      "Cannot find module '/workspace/nudo/x.js' imported from '/workspace/nudo/a.js'";
    expect(sanitizeErrorMessage(msg, ["/workspace/nudo"])).toBe(
      "Cannot find module './x.js' imported from './a.js'",
    );
  });

  it("home wins first, roots second (both applied)", () => {
    const home = homedir();
    const msg = `at f (${home}/repo/nudo/src/a.ts:1:1)`;
    expect(sanitizeErrorMessage(msg, [`${home}/repo/nudo`])).toBe(
      "at f (./src/a.ts:1:1)",
    );
  });

  it("passes through messages without tracked prefixes", () => {
    expect(sanitizeErrorMessage("boom", ["/nonexistent-root-xyz"])).toBe("boom");
  });

  it("ignores degenerate roots (/, ., ~)", () => {
    expect(sanitizeErrorMessage("/a/boom", ["/", ".", "~"])).toBe("/a/boom");
  });
});
