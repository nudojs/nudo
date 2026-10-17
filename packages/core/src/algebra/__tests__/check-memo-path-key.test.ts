import { describe, it, expect } from "vitest";
import { checkMemoKey } from "../check-memo.ts";
import type { CheckOptions } from "../check-types.ts";
import type { LoadDepsFingerprint } from "../load-deps-fp.ts";

/**
 * checkMemoKey 的 filePath 必须过 stablePathKey 归一（与依赖索引/定向逐出
 * 同口径）：同一文件的裸路径与 file:// URL 两种形态此前各占一条 memo 条目，
 * 不陈旧但损耗命中率。
 */
const deps: LoadDepsFingerprint = {
  fp: "-",
  paths: [],
  contents: [],
  truncated: false,
  readError: false,
};
const opts: CheckOptions = {};

describe("checkMemoKey 路径归一（stablePathKey 口径）", () => {
  it("裸路径与 file:// URL 两种形态同键", () => {
    const a = checkMemoKey("/abs/proj/main.js", "let x = 1;", opts, deps);
    const b = checkMemoKey("file:///abs/proj/main.js", "let x = 1;", opts, deps);
    expect(a).toBe(b);
  });

  it("不同文件仍不同键（归一不得坍缩不同路径）", () => {
    const a = checkMemoKey("/abs/proj/main.js", "let x = 1;", opts, deps);
    const c = checkMemoKey("/abs/proj/other.js", "let x = 1;", opts, deps);
    expect(a).not.toBe(c);
  });

  it("同一路径同参数键稳定（幂等）", () => {
    const a = checkMemoKey("/abs/proj/main.js", "let x = 1;", opts, deps);
    const b = checkMemoKey("/abs/proj/main.js", "let x = 1;", opts, deps);
    expect(a).toBe(b);
  });
});
