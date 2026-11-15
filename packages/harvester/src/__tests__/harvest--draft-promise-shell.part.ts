/**
 * Bug 916 回归（harvester **草稿面**）：`Promise<T>` 特判**剥掉**了 Promise
 * 外壳 ⇒ 契约要求的是 **resolve 之后**的值 ⇒ 契约**先天不可满足**
 * ⇒ **假红**（tsc 绿，`nudo check` 红）；且与**收割面相反**（收割面保留
 * `eff/promise` 外壳）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h8a/e2e/b916.ts ⇒ 无错）：
 *   `function fetchUser(id: number): Promise<{id: number; name: string}> {
 *      return Promise.resolve({ id, name: "n" });
 *    }`
 *
 * 改前（git HEAD 的草稿面）：`Promise<T>` → `fn({…}, shape({ id: number(), name: string() }))`
 *   ⇒ 返回义务落在 resolve 后的值上 ⇒ 实现返回 Promise ⇒ 必然违约。
 * 改后（tmp/probe/fix-r27/h8a/probe.ts）：
 *   `export const fetchUser = fn({ id: number() }, any());`
 *   ＋ note 明说「Promise 外壳保留（与收割面同口径），该位无约束」。
 *
 * **两个产物面同口径**：收割面保留外壳（`(number) => promise<{…}>`），
 * 草稿面也**不剥**（该位无约束 + 标注丢失）⇒ 两侧都不对 resolve 后的值
 * 设义务 ⇒ 同一答案（不假红）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { dtsToContractDraft } from "../dts-contract-draft.ts";
import { harvestDts } from "../harvest-dts.ts";
import {
  makeWorkDir,
  removeWorkDir,
  runNudoCheck,
  writeSidecar,
} from "./harvest-bug-h8a-helpers.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeDts(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug916-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const DTS = `export declare function fetchUser(id: number): Promise<{ id: number; name: string }>;
`;

describe("Bug 916 —— 草稿面：Promise 外壳**不剥**（与收割面同口径，不假红）", () => {
  it("草稿的返回位**不是** resolve 后的类型（外壳不被剥掉）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("export const fetchUser");
    // 剥壳的旧形态：返回位 = resolve 后的对象
    expect(draft.draftSource).not.toMatch(/fn\(\{ id: number\(\) \}, shape\(/);
    expect(draft.draftSource).not.toContain("name: string()");
  });

  it("该位的丢失**如实标注**（note + skipped 计数），不静默放宽", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("Promise shell is kept");
    expect(draft.stats.skipped).toBeGreaterThanOrEqual(1);
  });

  it("产品面：草稿抄进侧车后 `nudo check` **绿**（与 tsc 同向，不再假红）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    const dir = makeWorkDir("b916");
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function fetchUser(id) { return Promise.resolve({ id, name: "n" }); }\n`,
    );
    const res = runNudoCheck(target);
    removeWorkDir(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain("constraint-violated");
  });

  it("收割面同口径：Promise 外壳**保留**（promise<…>）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const env = harvestDts([p]);
    expect(formatShape(env.globals.fetchUser!)).toBe(
      "(number) => promise<{ id: number, name: string }>",
    );
  });
});
