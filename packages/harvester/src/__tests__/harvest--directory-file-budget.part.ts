/**
 * Bug 1015 —— `nudo contract --from-dts <目录>` **静默只投影前 16 个 `.d.ts`**
 * ⇒ 第 17+ 个文件的导出**整条不存在**于草稿，而汇总行报「**16 d.ts ·
 * 0 skipped**」⇒ 丢失**零信号** ⇒ 照抄进侧车后这些导出**零义务**（假绿）。
 *
 * 修法（草稿面）：目录模式**投影全部** `.d.ts`（不再有条数上限）⇒ 第 17+
 * 个文件的导出出现在草稿里；遍历不到的地方（读失败 / 深度上限）**如实计数**
 * ⇒ 汇总行说真话。
 *
 * 反向闸：改前（只投影前 16 个）⇒ 本文件的「第 17+ 个导出」断言失败。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dtsPathToContractDraft } from "../dts-contract-draft.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 造 N 个 `.d.ts`（每个一个独有导出） */
function makePkg(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug1015-"));
  dirs.push(dir);
  const pkg = join(dir, "pkg");
  mkdirSync(pkg, { recursive: true });
  for (let i = 1; i <= count; i++) {
    const name = `m${String(i).padStart(2, "0")}`;
    writeFileSync(
      join(pkg, `${name}.d.ts`),
      `export declare function ${name}Fn(x: number): string;\n`,
      "utf-8",
    );
  }
  return pkg;
}

describe("Bug 1015 —— --from-dts 目录模式的文件预算", () => {
  it("目录里的 `.d.ts` **全部**被投影（改前：只投影前 16 个）", () => {
    const pkg = makePkg(20);
    const draft = dtsPathToContractDraft(pkg, "pkg");
    expect(draft.files.length).toBe(20);
    expect(draft.stats.files).toBe(20);
    expect(draft.stats.exports).toBe(20);
  });

  it("第 17+ 个文件的导出**出现在草稿里**", () => {
    const pkg = makePkg(20);
    const draft = dtsPathToContractDraft(pkg, "pkg");
    for (const n of ["m17Fn", "m18Fn", "m19Fn", "m20Fn"]) {
      expect(draft.draftSource, `缺少 ${n}`).toContain(`export const ${n} =`);
    }
    // 前 16 个也还在（不是「换了一批」）
    expect(draft.draftSource).toContain("export const m01Fn =");
    expect(draft.draftSource).toContain("export const m16Fn =");
  });

  it("没有截断 ⇒ 汇总行不虚增 skipped", () => {
    const pkg = makePkg(20);
    const draft = dtsPathToContractDraft(pkg, "pkg");
    expect(draft.stats.skipped).toBe(0);
    expect(draft.stats.droppedFiles ?? 0).toBe(0);
  });

  it("单文件入口不受影响", () => {
    const pkg = makePkg(3);
    const draft = dtsPathToContractDraft(join(pkg, "m01.d.ts"), "m01");
    expect(draft.files.length).toBe(1);
    expect(draft.stats.exports).toBe(1);
    expect(draft.draftSource).toContain("export const m01Fn =");
  });
});
