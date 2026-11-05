/**
 * BUG-144 回归：收割面的 `case "enum"` 把 enum 整体抹成 `unknown`（成员 / 字面值
 * 全丢）却报 `skipped: 0`，而同一 harvester 的契约草稿面完整建模成
 * `shape({ Red: 1, Green: 2 })` ⇒ **两面矛盾**。
 *
 * 契约：收割面与草稿面同款建模（成员名 → 字面量；数字 enum 复现自增序号）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";
import { dtsToContractDraft } from "../dts-contract-draft.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// module 形态（`export`）：契约草稿面只登记导出，两面可比
const DTS = `export declare enum Color { Red = 1, Green = 2 }
export declare enum Name { A = "a", B = "b" }
export declare const enum CE { X = 1, Y = 2 }
export declare enum Auto { First, Second }
`;

function writeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug144-"));
  dirs.push(dir);
  const p = join(dir, "enum.d.ts");
  writeFileSync(p, DTS, "utf-8");
  return p;
}

function slotLits(a: Abs | undefined): Record<string, unknown> {
  const s = a!.shape;
  if (s.k !== "obj") return {};
  const out: Record<string, unknown> = {};
  for (const [k, sl] of Object.entries(s.slots)) {
    out[k] = sl.value.term?.op === "lit" ? sl.value.term.value : undefined;
  }
  return out;
}

const file = writeTemp();
const env = harvestDts([file]);

describe("BUG-144 —— 收割面保留 enum 成员与字面值", () => {
  it("数字 / 字符串 / const enum 都有成员面（不再是 unknown）", () => {
    for (const name of ["Color", "Name", "CE"]) {
      expect(env.globals[name]!.shape.k).toBe("obj");
    }
    expect(slotLits(env.globals.Color)).toEqual({ Red: 1, Green: 2 });
    expect(slotLits(env.globals.Name)).toEqual({ A: "a", B: "b" });
    expect(slotLits(env.globals.CE)).toEqual({ X: 1, Y: 2 });
  });

  it("无初始化器的成员按 TS 语义从 0 自增", () => {
    expect(slotLits(env.globals.Auto)).toEqual({ First: 0, Second: 1 });
  });

  it("与契约草稿面同口径（两面不再矛盾）", () => {
    const draft = dtsToContractDraft([file]);
    const draftColor = draft.exports.find((e) => e.name === "Color");
    expect(draftColor).toBeDefined();
    // 草稿面把成员写成 shape({ Red: 1, Green: 2 })；收割面现在给同一个成员集
    expect(draftColor!.dsl).toContain("Red: 1");
    expect(draftColor!.dsl).toContain("Green: 2");
  });
});
