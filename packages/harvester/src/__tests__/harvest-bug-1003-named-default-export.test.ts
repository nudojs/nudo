/**
 * Bug 1003 —— `nudo contract --from-dts` 把**具名 default 导出**写成本地名键
 * ⇒ 草稿键 `helper` ≠ 模块导出名 `default` ⇒ 用户照抄进侧车后**该导出永远
 * 零义务**（**假绿**），而汇总行报「**0 skipped**」让用户以为「没有需要
 * 人工处理的东西」。
 *
 * 修法（草稿面）：default 导出的**草稿键恒为 `default`**（不是本地名）⇒
 * 抄进侧车后绑定的是模块的 `default` 导出；没有丢失 ⇒ `skipped` 不虚增。
 *
 * 产品面取证（改前 vs 改后，同一份侧车 + 同一份源码）：
 * - 改后：侧车 `export { _default as default }` ⇒ `impl(x: number) => string`；
 * - 改前：侧车 `export const helper = …` ⇒ 绑不到 `default` ⇒
 *   `impl(x: any) => string` + `nudo:interface-entry-only`（零义务）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dtsToContractDraft } from "../dts-contract-draft.ts";
import { makeWorkDir, removeWorkDir, runNudoCheck, writeSidecar } from "./harvest-bug-h8b-helpers.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const NAMED_DEFAULT_DTS = `export default function helper(x: number): string;
`;

function writeDts(name: string, src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug1003-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, src, "utf-8");
  return file;
}

describe("Bug 1003 —— --from-dts 的具名 default 导出", () => {
  it("草稿键是 `default`（不是本地名 `helper`）", () => {
    const file = writeDts("def.d.ts", NAMED_DEFAULT_DTS);
    const draft = dtsToContractDraft([file], "def");
    expect(draft.exports.map((e) => e.name)).toEqual(["default"]);
    expect(draft.draftSource).toContain("as default };");
    // 改前：草稿键 = 本地名 `helper`
    expect(draft.draftSource).not.toContain("export const helper");
    expect(draft.draftSource).not.toContain("as helper };");
  });

  it("没有丢失 ⇒ 汇总行不虚增 skipped", () => {
    const file = writeDts("def.d.ts", NAMED_DEFAULT_DTS);
    const draft = dtsToContractDraft([file], "def");
    expect(draft.stats.exports).toBe(1);
    expect(draft.stats.skipped).toBe(0);
  });

  it("**抄进侧车后 `default` 导出真的带上契约**（改前：零义务）", () => {
    const file = writeDts("def.d.ts", NAMED_DEFAULT_DTS);
    const draft = dtsToContractDraft([file], "def");
    const dir = makeWorkDir("1003");
    dirs.push(dir);
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `const impl = function (x) {\n  return String(x);\n};\n\nexport default impl;\n`,
    );
    const res = runNudoCheck(target);
    expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
    // 契约落到 default 导出上 ⇒ 签名带 number / string
    expect(res.stdout).toContain("impl(x: number) => string");
    // 改前：default 导出没有契约根 ⇒ `nudo:interface-entry-only`
    expect(res.stdout).not.toContain("nudo:interface-entry-only");
  }, 120_000);
});
