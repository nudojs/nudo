/**
 * Bug 487 回归（LSP 面）：项目配置指纹用了**未归一**的 `autoBind`
 * （`cfg.contract?.autoBind ?? true`），而分析面读的是 **service 侧归一后**
 * 的值（`interfaceConfig`）⇒ 两者口径分裂。
 *
 * 后果：把 `autoBind` 写成非布尔（非法形状，如 `"false"`）时，归一回落
 * `true` ⇒ 有效行为与「不写」**完全相同**，但原始指纹不同 ⇒ 用户只改了这
 * 处无效写法也会 miss analysisCache ⇒ 全量重算（性能）＋ 行为漂移风险。
 *
 * 本文件锁：
 *  ① 非法非布尔 autoBind ⇒ 指纹与「不写 autoBind」**相同**（归一后行为相同
 *     ⇒ 指纹必须相同）；
 *  ② 合法 `autoBind: false` ⇒ 指纹**不同**（有效行为确实变了 ⇒ 必须 miss）。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectConfigFingerprint, clearValidationState } from "../validation.ts";

function project(nudo: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-487-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "p", version: "1.0.0", type: "module", ...(nudo === undefined ? {} : { nudo }) }),
    "utf-8",
  );
  return dir;
}

function fingerprintOf(dir: string): string {
  const file = join(dir, "a.js");
  writeFileSync(file, `export function f() { return 1; }\n`, "utf-8");
  return projectConfigFingerprint(file);
}

describe("Bug 487 LSP：配置指纹用归一后的 autoBind", () => {
  it("非法非布尔 autoBind ⇒ 指纹与「不写」相同（行为相同 ⇒ 不得 miss 缓存）", () => {
    const noAutoBind = project({ contract: { autoBind: true } });
    const bogusAutoBind = project({ contract: { autoBind: "false" } });
    try {
      expect(fingerprintOf(bogusAutoBind)).toBe(fingerprintOf(noAutoBind));
    } finally {
      rmSync(noAutoBind, { recursive: true, force: true });
      rmSync(bogusAutoBind, { recursive: true, force: true });
      clearValidationState();
    }
  });

  it("非法非布尔 autoBind ⇒ 指纹与「省略整个 contract」相同", () => {
    const bare = project({});
    const bogus = project({ contract: { autoBind: 0 } });
    try {
      expect(fingerprintOf(bogus)).toBe(fingerprintOf(bare));
    } finally {
      rmSync(bare, { recursive: true, force: true });
      rmSync(bogus, { recursive: true, force: true });
      clearValidationState();
    }
  });

  it("合法 autoBind:false ⇒ 指纹与 true 不同（行为确实变了 ⇒ 必须 miss）", () => {
    const on = project({ contract: { autoBind: true } });
    const off = project({ contract: { autoBind: false } });
    try {
      expect(fingerprintOf(off)).not.toBe(fingerprintOf(on));
    } finally {
      rmSync(on, { recursive: true, force: true });
      rmSync(off, { recursive: true, force: true });
      clearValidationState();
    }
  });
});
