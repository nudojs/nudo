/**
 * BUG-101 回归：`nudo check` 的目录目标判定必须覆盖与 `migrate verify`
 * 一致的文件集，否则 `migrate retire` 装出的门禁 `nudo check .` 在该包上
 * **恒红**（对目标目录返回空集 ⇒ `nudo:path-empty-dir` ⇒ exit 1）。
 *
 * 改前只认 `.js/.mjs/.ts` ⇒ `.mts`/`.cts`/`.cjs` 包装上就是红的。
 */
import { describe, it, expect } from "vitest";
import { isNudoTargetPath } from "../target-path.ts";

describe("BUG-101 — 目录目标扩展名集合", () => {
  it("与 migrate verify 同口径：.js/.mjs/.cjs/.ts/.mts/.cts 都是目标", () => {
    for (const p of ["a.js", "a.mjs", "a.cjs", "a.ts", "a.mts", "a.cts", "src/lib.MTS"]) {
      expect(isNudoTargetPath(p), p).toBe(true);
    }
  });

  it("仍排除：声明文件 / 侧车 / draft / JSX（能力边界）", () => {
    for (const p of [
      "a.d.ts",
      "a.d.mts",
      "a.d.cts",
      "a.nudo.js",
      "a.nudo.ts",
      "a.nudo.draft.js",
      "a.tsx",
      "a.jsx",
    ]) {
      expect(isNudoTargetPath(p), p).toBe(false);
    }
  });
});
