/**
 * Bug 634 回归（LSP 编辑器面）：check 通道必须施加 **inject 通道**
 * （`@nudo:mock` / `@nudo:as` / `@nudo:replace` / env 全局），与 CLI
 * `nudo check` 同源同口径。
 *
 * 病灶：本面此前只传 `modules`（不传 `inject`）⇒ 被 mock 掉的依赖退化成
 * 未知全局 ⇒ 报 `nudo:entry-may-throw`（**假红**：同一份文件 CLI 判绿、
 * IDE 判红）。
 *
 * 修法（packages/lsp/src/validation.ts）：复用本包唯一的注入装配器
 * `buildLspInjection`（packages/lsp/src/agent-tools.ts，与 agent 工具面
 * 同源），并按 CLI 的口径同时喂 `modules`（并入 env / mock-module 覆盖
 * 后的表）与 `inject`。
 *
 * 负控制：真的没有 mock 的文件，入口 may-throw 诊断**仍应**出现（不得把
 * 门禁整体关掉）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { checkToLspDiagnostics } from "../validation.ts";
import { withTempDir } from "./helpers.ts";

const MOCKED_SRC = `/**
 * @nudo:mock dep = (x) => x
 */
export function f() {
  return dep(1);
}
`;

/** 无 mock 的对照：入口读一个不存在的全局 ⇒ 真的可能抛 */
const UNMOCKED_SRC = `export function g() {
  return notDefinedAnywhere(1);
}
`;

function codes(diags: { code?: string | number }[]): string[] {
  return diags.map((d) => String(d.code ?? ""));
}

describe("Bug 634: LSP check 面施加 inject 通道（@nudo:mock 生效）", () => {
  it("@nudo:mock 覆盖的依赖不得再报 nudo:entry-may-throw（与 CLI 同口径：绿）", () => {
    withTempDir("nudo-lsp-bug-634-", (dir) => {
      const file = join(dir, "lib.js");
      writeFileSync(file, MOCKED_SRC, "utf-8");
      const diags = checkToLspDiagnostics(file, MOCKED_SRC);
      expect(codes(diags)).not.toContain("nudo:entry-may-throw");
    });
  });

  it("负控制：没有 mock 的入口仍报 nudo:entry-may-throw（门禁未被关掉）", () => {
    withTempDir("nudo-lsp-bug-634b-", (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, UNMOCKED_SRC, "utf-8");
      const diags = checkToLspDiagnostics(file, UNMOCKED_SRC);
      expect(codes(diags)).toContain("nudo:entry-may-throw");
    });
  });
});
