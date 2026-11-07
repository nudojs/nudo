/**
 * Bug 1013 回归（harvester **草稿面**）：`Record<K,V>` 特判把**值域整个丢掉**
 * （只写进注释）⇒ 契约**比 TS 更松** ⇒ **放绿** TS2322。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h8a/e2e/b1013.ts ⇒ TS2322）：
 *   `function getRecord(): Record<string, number> { return { x: "str" }; }`
 *   ⇒ TS2322（红）。
 *
 * 改前（git HEAD 的草稿面）：`Record<string, number>` ⇒ `shape({})` ＋
 *   一条注释「open Record → number()」—— **注释宣称有值域、实现里却没有**
 *   ⇒ 调用点传 `{x: "str"}` 也不违约 ⇒ 放绿。
 * 改后（tmp/probe/fix-r27/h8a/probe.ts）：
 * - 键是**字面量集合**（`Record<"a" | "b", number>`）⇒ **值域落到实现**：
 *   `shape({ a: number(), b: number() })` ⇒ 该位不再放绿；
 * - 键不是字面量（`Record<string, number>`）⇒ 契约 DSL **没有索引签名**
 *   ⇒ **如实降级**：`shape({})` ＋ note 明说「值域**未**建模（比 TS 松）」
 *   ＋ 计入 `skipped` ⇒ 丢失**可见**，不静默。
 *
 * **两个产物面同口径**：收割面把 `Record<string, number>` 建成**开放对象**
 * 且**带索引值域**（`index.value = number`，见 Bug 803）⇒ 值域在收割面没丢；
 * 草稿面如实说「DSL 表达不了」⇒ 两侧对**值域是什么**答案一致
 * （都是 number），草稿面不冒充已建模。
 *
 * ⚠️ 已知限制（**越界**，见交付报告）：契约 DSL 无索引签名 ⇒
 * `Record<string, V>` 的值域在草稿面**无法**落到实现；要彻底对齐需要 core
 * 的 DSL 支持开放 shape + 索引值域（core 冻结，本分片不改 core）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug1013-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** fn Abs 的第 0 个形参（对象面） */
function paramObjShape(abs: unknown): {
  open?: boolean;
  index?: { key: unknown; value: unknown };
} | undefined {
  const s = (abs as { shape: { k: string; paramTypes?: { shape?: unknown }[] } }).shape;
  const p = s.paramTypes?.[0]?.shape as
    | { k: string; open?: boolean; index?: { key: unknown; value: unknown } }
    | undefined;
  return p?.k === "obj" ? p : undefined;
}

describe("Bug 1013 —— 草稿面：Record 的值域**落到实现**（或如实降级，不放绿）", () => {
  it("键是字面量集合时，**值域落到实现**（shape 的字段就是值域）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function takeRecordLit(r: Record<"a" | "b", number>): void;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("shape({ a: number(), b: number() })");
  });

  it("键不是字面量时**如实降级**：不宣称值域 + note 明说未建模 + 计入 skipped", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function takeRecord(r: Record<string, number>): void;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    // 改前的假声明：注释宣称有值域，实现里没有
    expect(draft.draftSource).not.toContain("open Record");
    expect(draft.draftSource).not.toMatch(/r: shape\(\{[^}]*number\(\)/);
    expect(draft.draftSource).toContain("Record value domain is NOT modeled");
    expect(draft.stats.skipped).toBeGreaterThanOrEqual(1);
  });

  it("产品面：值域落地的 Record **红**（与 tsc 的 TS2322 同向，不再放绿）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function takeRecordLit(r: Record<"a" | "b", number>): void;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    const dir = makeWorkDir("b1013");
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function takeRecordLit(r) { return; }
export function use() { return takeRecordLit({ a: "str", b: 1 }); }
`,
    );
    const res = runNudoCheck(target);
    removeWorkDir(dir);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("constraint-violated");
  });

  it("收割面同口径：Record 是**开放对象且带索引值域**（值域没丢）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function takeRecord(r: Record<string, number>): void;
`,
    );
    const env = harvestDts([p]);
    const obj = paramObjShape(env.globals.takeRecord)!;
    expect(obj.open).toBe(true);
    expect(obj.index).toBeDefined();
    expect(formatShape(obj.index!.value as never)).toBe("number");
  });
});
