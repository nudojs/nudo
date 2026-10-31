/**
 * BUG-126 回归：可选 / rest 形参的「可省略」语义丢失 ⇒ 收割出的 fn 最少实参数
 * 偏大（`g(a: string, b?: number)` 被数成 2 个必填，而 TS `minArgumentCount` = 1）
 * ⇒ 收割结果**不满足它自己声明的类型**。
 *
 * 契约：`optionalParams` 逐位标记可选性，必选元数与 TS 的 `minArgumentCount` 一致。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";
import { absToHarvestSig, harvestSigToAbs } from "../harvest-json.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug126-"));
  dirs.push(dir);
  const p = join(dir, "d.d.ts");
  writeFileSync(p, content, "utf-8");
  return p;
}

type FnShape = {
  k: string;
  params: string[];
  paramTypes?: Abs[];
  optionalParams?: boolean[];
};

function fnShape(a: Abs | undefined): FnShape {
  return a!.shape as FnShape;
}

/** core `fnMinArity` 的口径：最后一个必选位 + 1 */
function minArity(s: FnShape): number {
  let last = -1;
  for (let i = 0; i < s.params.length; i++) {
    if (s.params[i]!.startsWith("...")) continue;
    if (s.optionalParams ? s.optionalParams[i] === true : s.params[i]!.endsWith("?")) continue;
    last = i;
  }
  return last + 1;
}

const env = harvestDts([
  writeTemp(
    `export declare function g(a: string, b?: number): boolean;
export declare function rest(...xs: number[]): void;
export declare function req(a: string, b: number): void;
`,
  ),
]);

describe("BUG-126 —— 可选 / rest 形参的可省略性", () => {
  it("可选形参记进 optionalParams，必选元数 = TS minArgumentCount（1）", () => {
    const s = fnShape(env.globals.g);
    expect(s.params).toHaveLength(2);
    expect(s.optionalParams).toEqual([false, true]);
    expect(minArity(s)).toBe(1);
    // 类型面仍是 `number | undefined`（可省略 ≠ 去掉 undefined）
    expect(s.paramTypes![1]!.shape.k).toBe("sum");
  });

  it("rest 形参不是必选位（元数 0）", () => {
    const s = fnShape(env.globals.rest);
    expect(s.optionalParams).toEqual([true]);
    expect(minArity(s)).toBe(0);
  });

  it("对照：全必选签名不受影响（元数 2）", () => {
    const s = fnShape(env.globals.req);
    expect(s.optionalParams).toBeUndefined();
    expect(minArity(s)).toBe(2);
  });

  it("磁盘投影往返保留 optionalParams（冷 / 热同元数）", () => {
    const back = harvestSigToAbs(absToHarvestSig(env.globals.g!));
    expect(fnShape(back).optionalParams).toEqual([false, true]);
    expect(minArity(fnShape(back))).toBe(1);
  });
});
