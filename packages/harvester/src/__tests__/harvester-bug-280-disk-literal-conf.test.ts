/**
 * BUG-280 回归：磁盘投影丢 `conf` ⇒ 回读把**每个** Abs 标成 `mock` ⇒ 声明的
 * 字面量被 `widenUncertainLiteral` 放宽成基类型 ⇒ 同一份 `.d.ts`，缓存冷 / 热
 * 两次运行发布**不同**的 zod / standard 产物（热产物接受集更宽 ⇒ 消费端假绿）。
 *
 * 契约：磁盘投影里的 `lit` **只**来自声明 ⇒ 回读必须恢复 `exact` 精度。
 */
import { describe, it, expect } from "vitest";
import { abs as makeAbs, strLit, type Abs, type LiteralValue } from "@nudojs/core";
import { absToHarvestSig, harvestSigToAbs, materializeHarvestJson, serializeHarvestJson } from "../harvest-json.ts";

/** `"\\" | "/"`（与夹具同形：两个字面量的 sum） */
function sum2(): Abs {
  return makeAbs({ k: "sum", members: [strLit("\\"), strLit("/")] }, undefined, undefined, "exact");
}

/** Abs 的字面量值（非 `lit` 项 ⇒ undefined）。 */
function litValue(a: Abs): LiteralValue | undefined {
  const t = a.term;
  return t?.op === "lit" ? t.value : undefined;
}

describe("BUG-280 —— 磁盘回读保留声明字面量的精度", () => {
  it("单个声明字面量往返后 conf = exact（不是 mock）", () => {
    const back = harvestSigToAbs(absToHarvestSig(strLit("/")));
    expect(back.conf).toBe("exact");
    expect(back.term?.op).toBe("lit");
  });

  it("字面量并集（\"\\\\\" | \"/\"）往返后每个成员仍是字面量", () => {
    const src = sum2();
    const back = harvestSigToAbs(absToHarvestSig(src));
    expect(back.shape.k).toBe("sum");
    const members = (back.shape as { members: Abs[] }).members;
    expect(members.map(litValue)).toEqual(["\\", "/"]);
    for (const m of members) expect(m.conf).toBe("exact");
  });

  it("整包序列化 → 回读：字面量不退化（冷 / 热两面同产物）", () => {
    const env = {
      globals: { sep: sum2() },
      modules: {},
      stats: { files: 1, symbols: 1, skipped: 0 },
    };
    const json = JSON.parse(
      JSON.stringify(serializeHarvestJson("fakepkg", env, { dtsHash: "h", maxFiles: 1 })),
    );
    const back = materializeHarvestJson(json)!;
    const sep = back.globals.sep!;
    expect(sep.shape.k).toBe("sum");
    const members = (sep.shape as { members: Abs[] }).members;
    expect(members.map(litValue)).toEqual(["\\", "/"]);
  });
});
