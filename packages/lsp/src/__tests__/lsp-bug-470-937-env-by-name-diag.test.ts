/**
 * Bug 470 / 937 回归（LSP 面）
 *
 * 注：env 名的指令文法只收「词字符」或「path 形态」（core parseEnvPayload）
 * ⇒ 未知名用 `bogusenvname` 这类词字符形态（带连字符会被指令层过滤掉，
 * 根本进不了 env 名单）。：service 侧新增的**按名字**发的 env 诊断
 * （未知 env 名 `bogus` / `nodejs`…、非字符串 env 项）记录的 path 是
 * **名字本身**，不是解析后的绝对路径 ⇒ LSP 侧原先只按
 * `resolvePath(baseDir, name)` 过滤 ⇒ 这类诊断在 IDE 里被整条吃掉。
 *
 * 本文件锁：
 *  ① 未知 env 名 ⇒ IDE 里看得见 `nudo:env-unresolved`；
 *  ② 同目录**别的文件**的无 path 诊断不得误吸进来（不串台）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateText, clearValidationState } from "../validation.ts";
import { makeValidateDeps } from "./helpers.ts";

const DIAG_ENV_UNRESOLVED = "nudo:env-unresolved";

async function publish(filePath: string, source: string): Promise<any[]> {
  const sent: any[] = [];
  const deps = makeValidateDeps({
    onPublish: (params) => {
      sent.push(...params.diagnostics);
    },
  });
  await validateText(filePath, `file://${filePath}`, source, 1, deps);
  return sent;
}

describe("Bug 470/937 LSP：按名字发的 env 诊断不再被过滤掉", () => {
  it("未知 env 名 ⇒ IDE 里出现 nudo:env-unresolved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-470-"));
    try {
      const file = join(dir, "probe.js");
      const src = `// @nudo:env bogusenvname\nexport function f() { return 1; }\n`;
      writeFileSync(file, src, "utf-8");
      const diags = await publish(file, src);
      const envDiags = diags.filter((d) => d.code === DIAG_ENV_UNRESOLVED);
      expect(envDiags.length).toBeGreaterThan(0);
      expect(envDiags[0].message).toContain("bogusenvname");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearValidationState();
    }
  });

  it("同目录别的文件的无 path 诊断不误吸（本文件没有该 env 名）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-470b-"));
    try {
      // 另一个文件先用过「未知 env 名」——它的诊断记在同一个 baseDir 下
      const other = join(dir, "other.js");
      const otherSrc = `// @nudo:env otherunknownenv\nexport function g() { return 1; }\n`;
      writeFileSync(other, otherSrc, "utf-8");
      await publish(other, otherSrc);

      // 本文件用的是另一个 env 名 ⇒ 不该看到 otherunknownenv 的诊断
      const file = join(dir, "probe.js");
      const src = `// @nudo:env yetanotherenv\nexport function f() { return 1; }\n`;
      writeFileSync(file, src, "utf-8");
      const diags = await publish(file, src);
      const envDiags = diags.filter((d) => d.code === DIAG_ENV_UNRESOLVED);
      for (const d of envDiags) {
        expect(d.message).not.toContain("otherunknownenv");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearValidationState();
    }
  });
});
