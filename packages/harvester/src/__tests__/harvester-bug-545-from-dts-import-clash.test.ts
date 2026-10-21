/**
 * Bug 545 —— `nudo contract --from-dts` 写出的草稿模块里，**builder 的 import
 * 绑定**与生成的 `export const <name>` **撞名** ⇒ 写出的文件是**非法
 * JavaScript**（`node --check` 直接 SyntaxError）。
 *
 * 症状（旧口径）：
 * ```js
 * import { fn, any, lit, union } from "@nudojs/core";
 * export const lit = fn({ l: union(lit("a"), lit("b")) }, any());
 * ```
 * ⇒ `SyntaxError: Identifier 'lit' has already been declared`。
 *
 * 修法：侧车键取**导出身份**，绑定名与 builder import 撞名时走别名形态
 * `const _nudo_N = …; export { _nudo_N as <identity> };`。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { formatDtsContractDraft } from "../dts-contract-draft.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function nodeCheck(file: string): { ok: boolean; stderr: string } {
  try {
    execFileSync(process.execPath, ["--check", file], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

describe("Bug 545 —— --from-dts 草稿的 import ↔ export 撞名", () => {
  it("导出名撞 builder import ⇒ 走别名形态（改前：export const lit）", () => {
    const src = formatDtsContractDraft("types", ["types.d.ts"], [
      { name: "lit", dsl: `fn({ l: union(lit("a"), lit("b")) }, any())`, kind: "function" },
    ]);
    expect(src).not.toMatch(/^export const lit = /m);
    expect(src).toContain("export { _nudo_1 as lit };");
  });

  it("草稿产物真能过 node --check（改前：Identifier 'lit' has already been declared）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-from-dts-545-"));
    dirs.push(dir);
    const src = formatDtsContractDraft("types", ["types.d.ts"], [
      { name: "lit", dsl: `fn({ l: union(lit("a"), lit("b")) }, any())`, kind: "function" },
    ]);
    const file = join(dir, "types.nuco.draft.js");
    writeFileSync(file, src, "utf-8");
    const check = nodeCheck(file);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("负控制：普通导出名仍是 export const <name>（不误改别名形态）", () => {
    const src = formatDtsContractDraft("types", ["types.d.ts"], [
      { name: "lineTotal", dsl: "fn({ price: number() }, number())", kind: "function" },
    ]);
    expect(src).toContain("export const lineTotal = fn({ price: number() }, number());");
    expect(src).not.toContain("_nudo_1");
  });
});
