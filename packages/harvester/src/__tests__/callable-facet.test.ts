/**
 * A2 残余 · `declare class` 类值的「不可裸调用」承载位在收割链上不丢失。
 *
 * 三个**重建点**都必须整包搬运 `facets.callable`（A7 同型教训）：
 * 1. `harvest-dts.ts::classValueAbs` 生产；
 * 2. `harvest-to-abs.ts::harvestedValueToAbs` 用 `absFunction` 造 mock；
 * 3. `harvest-json.ts` 的 `HarvestSig` 磁盘往返（ABI v15）。
 *
 * 任一处丢失 ⇒ 热缓存命中的类值退回无槽位 ⇒ 产品面
 * `JSON.stringify(obj, DeclaredClass)` 变「声称不抛」的假绿（冷/热不一致）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";
import { harvestedValueToAbs } from "../harvest-to-abs.ts";
import {
  absToHarvestSig,
  harvestSigToAbs,
  materializeHarvestJson,
  serializeHarvestJson,
  HARVEST_DISK_ABI,
} from "../harvest-json.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-a2-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const CLS = `export declare class A2HarvestClassQ {\n  label: string;\n}\n`;

function classValue(): Abs {
  const env = harvestDts([writeTemp("a.d.ts", CLS)]);
  return env.globals["A2HarvestClassQ"]!;
}

describe("A2 残余 · declare class 类值挂 callable:false", () => {
  it("生产点：harvestDts 类值带槽位，且仍保留 ctor facet", () => {
    const a = classValue();
    expect(a.facets?.callable).toBe(false);
    expect((a.shape as { ctor?: boolean }).ctor).toBe(true);
  });

  it("重建点 1：harvestedValueToAbs 用 absFunction 造 mock 不抹掉槽位", () => {
    const mock = harvestedValueToAbs(classValue());
    expect(mock.facets?.callable).toBe(false);
    expect((mock.shape as { ctor?: boolean }).ctor).toBe(true);
  });

  it("重建点 2：HarvestSig / harvestSigToAbs 往返保留槽位", () => {
    const sig = absToHarvestSig(classValue());
    expect((sig as { callable?: boolean }).callable).toBe(false);
    expect(harvestSigToAbs(sig).facets?.callable).toBe(false);
  });

  it("重建点 3：完整 serialize / materialize 往返保留槽位（ABI v15）", () => {
    expect(HARVEST_DISK_ABI).toBe("nudo-harvest-disk-v15");
    const a = classValue();
    const env = { globals: { C: a }, modules: {}, stats: { files: 1, symbols: 1, skipped: 0 } };
    const json = serializeHarvestJson("pkg", env, { dtsHash: "h", maxFiles: 12 });
    const back = materializeHarvestJson(json);
    expect(back, "materialize must not miss").toBeTruthy();
    expect(back!.globals["C"]!.facets?.callable).toBe(false);
  });

  it("负控：普通函数声明不挂 callable（构造签名也不误挂）", () => {
    const env = harvestDts([
      writeTemp("b.d.ts", `export declare function plainA2(x: number): string;\n`),
    ]);
    expect(env.globals["plainA2"]?.facets?.callable).toBeUndefined();
  });
});
