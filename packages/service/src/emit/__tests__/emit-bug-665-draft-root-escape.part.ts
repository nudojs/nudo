/**
 * Bug 665 —— `nudo contract --draft --write` 的**项目根边界**用
 * `rel.startsWith("..")` 判逃逸 ⇒ 项目根下的**合法目录** `..data/` 被判
 * 「在项目根之外」⇒ 草稿**拒写**。
 *
 * 根因：`relative()` 返回的是**相对路径字符串**——「向上逃逸」的判据是
 * 「整段等于 `..`」或「以 `..` + 路径分隔符开头」，**不是**裸
 * `startsWith("..")`：后者把 `..data/` / `...cfg/` 这类**合法**相对路径
 * （目录名以 `..` 开头）误判成父目录逃逸。
 *
 * 修法（族 20 · 片 B · **service 半**）：判据改成
 * `rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)`
 * —— 与 CLI 半（`packages/nudojs/src/commands/contract-draft.ts` 的
 * `runContractDraft`）**逐字同款**（同一个 bug 的两半 ⇒ 同一片修；
 * 不许抽成 core 的共享助手 —— core 冻结面不得新增导出）。
 *
 * ⚠ 本钉**只**钉 service 半（`writeInterfaceDraft` 的项目根判据）；
 *   CLI 半的钉在 `packages/nudojs/src/__tests__/cli-bug-665-dotdir-escape.test.ts`。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sidecarDraftPath, writeInterfaceDraft } from "../interface-draft.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nudo-draft-665-"));
  writeFileSync(join(root, "package.json"), '{ "name": "dotdir-probe", "private": true }\n', "utf-8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const DRAFT_SOURCE = `// @nudo:draft\nimport { fn } from "@nudojs/core";\n\nexport const f = fn({});\n`;

describe("Bug 665（service 半）—— 项目根判据按**路径分量**，不按字符串前缀", () => {
  it("项目根下的合法目录 `..data/` 不再被误判为越出项目根 ⇒ 草稿写盘成功", () => {
    const dir = join(root, "..data");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "f.js");
    writeFileSync(file, "export function f(x) { return x + 1; }\n", "utf-8");

    // 改前：这里抛 `draft write refused: outside project root …`
    const w = writeInterfaceDraft(file, DRAFT_SOURCE, { projectDir: root });

    expect(w.written).toBe(true);
    expect(existsSync(sidecarDraftPath(file))).toBe(true);
  });

  it("真正越出项目根的路径**仍被拒**（判据不许放宽成「一律放行」）", () => {
    const outside = mkdtempSync(join(tmpdir(), "nudo-draft-665-out-"));
    try {
      const file = join(outside, "f.js");
      writeFileSync(file, "export function f(x) { return x + 1; }\n", "utf-8");

      expect(() => writeInterfaceDraft(file, DRAFT_SOURCE, { projectDir: root })).toThrow(
        /outside project root/,
      );
      expect(existsSync(sidecarDraftPath(file))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("项目根下**文件名**以 `..` 开头（`..data.js`）同样不再被误判为逃逸", () => {
    const file = join(root, "..data.js");
    writeFileSync(file, "export function f(x) { return x + 1; }\n", "utf-8");

    // 改前：`rel === "..data.js"` ⇒ `startsWith("..")` ⇒ 抛「outside project root」
    const w = writeInterfaceDraft(file, DRAFT_SOURCE, { projectDir: root });

    expect(w.written).toBe(true);
    expect(existsSync(sidecarDraftPath(file))).toBe(true);
  });
});
