/**
 * 工具链接入分册回归：Bug 56（vite-plugin 默认 include）。
 *
 * 默认 `DEFAULT_INCLUDE` 漏 `.cjs` / `.mts` / `.cts`，与 `isNudoTargetPath`
 * 的六后缀口径不一致 ⇒ 构建期诊断静默缺席（scopeDecision 早退
 * `{ skip: true, reason: "include" }`）。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  configureScope,
  scopeDecision,
} from "../scope.ts";

const OLD_INCLUDE = ["**/*.js", "**/*.mjs", "**/*.ts"];

afterEach(() => {
  // 恢复模块级默认匹配表，避免污染同文件后续用例（vitest 文件内共享实例）。
  configureScope({ include: DEFAULT_INCLUDE, exclude: DEFAULT_EXCLUDE });
});

describe("Bug 56 —— 默认 include 覆盖 isNudoTargetPath 六后缀", () => {
  it("DEFAULT_INCLUDE 恰为六后缀（与 target-path.ts 单源一致）", () => {
    expect(DEFAULT_INCLUDE).toEqual([
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "**/*.ts",
      "**/*.mts",
      "**/*.cts",
    ]);
  });

  it("[BEFORE] 旧三后缀表下 .mts 因 include 早退", () => {
    configureScope({ include: OLD_INCLUDE, exclude: DEFAULT_EXCLUDE });
    expect(scopeDecision("/proj/src/entry.mts", "export const a = 1;").reason).toBe("include");
    expect(scopeDecision("/proj/src/entry.cjs", "export const a = 1;").reason).toBe("include");
    expect(scopeDecision("/proj/src/entry.cts", "export const a = 1;").reason).toBe("include");
  });

  for (const ext of ["mjs", "cjs", "ts", "mts", "cts"]) {
    it(`[AFTER] .${ext} 默认 include 不再静默跳过`, () => {
      const d = scopeDecision(`/proj/src/entry.${ext}`, "export const a = 1;");
      expect(d.reason).not.toBe("include");
    });
  }

  it(".d.mts 声明文件仍被 guard 拒（isNudoTargetPath 口径不变）", () => {
    expect(scopeDecision("/proj/src/types.d.mts", "export type A = string;").skip).toBe(true);
  });
});
