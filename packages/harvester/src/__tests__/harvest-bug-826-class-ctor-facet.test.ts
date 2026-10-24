/**
 * Bug 826 回归（harvester 收割面）：收割的 **`declare class` 类值没有 `ctor` facet**
 * ⇒ `new X()` 被判「**可能抛 TypeError**（可构造性未知）」⇒ **L2 假红**
 * （`tsc --strict` 对同一份代码 exit 0）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h5/e2e/cls/app.ts，tsc exit=0）：
 * - `export declare class Gadget { label: string; compute(input: number): number }`
 *   ⇒ `new Gadget()` 是**构造调用**（合法），`g.label` 是 string。
 *
 * 收割侧契约：
 *   1. 类值（构造函数）带 **`ctor: true` facet** —— core 的 `new` 路径按 callee 的
 *      `ctor` facet 判可构造性（`Shape k:"fn".ctor`）：缺省 = 「可构造性未知」
 *      ⇒ 记 may TypeError；
 *   2. mock 化（`harvestedValueToAbs`）时**透传**该 facet（否则又变回未知）；
 *   3. `new X()` 走构造分支 ⇒ 产出**实例面**（不是 may-throw）。
 *
 * 产品面（闸②）：改前 `buildGadget() => number | string throws TypeError`
 * （`new on function value of unknown constructibility`）；改后 0 error。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $new, formatShape, type Abs } from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "@nudojs/core/internal";
import { harvestDts } from "../harvest-dts.ts";
import { harvestedValueToAbs } from "../harvest-to-abs.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug826-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const CLS = `export declare class Gadget {
  label: string;
  compute(input: number): number;
}
`;

/** fn 形状的 ctor facet */
function ctorFacet(a: Abs | undefined): boolean | undefined {
  return (a?.shape as { ctor?: boolean } | undefined)?.ctor;
}

/** `new X()` 的效果面（may-throw 收集） */
function newEffects(callee: Abs): { kinds: string[]; value: string } {
  const effects: MayThrowEffect[] = [];
  let value = "";
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    const built = $new(callee, []);
    value = formatShape(built);
    setMayThrowCollector(null);
  });
  return { kinds: effects.map((e) => e.kind), value };
}

describe("Bug 826 —— 收割的 declare class 类值带 ctor facet（new 不再 may-throw）", () => {
  it("类值带 `ctor: true` facet（改前缺省 = 可构造性未知）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    expect(ctorFacet(env.globals["Gadget"])).toBe(true);
  });

  it("mock 化时透传 ctor facet（否则又变回「可构造性未知」）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    const mock = harvestedValueToAbs(env.globals["Gadget"]!);
    expect(ctorFacet(mock)).toBe(true);
  });

  it("`new Gadget()` 不记 may TypeError（改前记「可构造性未知」）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    const mock = harvestedValueToAbs(env.globals["Gadget"]!);
    const r = newEffects(mock);
    expect(r.kinds).not.toContain("TypeError");
  });

  it("`new Gadget()` 产出实例面（Point/Gadget 品牌，不是 unknown）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    const mock = harvestedValueToAbs(env.globals["Gadget"]!);
    const r = newEffects(mock);
    expect(r.value).toBe("Gadget");
  });

  it("反向：去掉 ctor facet ⇒ 同一个 new 记 may TypeError（证明判据就是这个 facet）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    const mock = harvestedValueToAbs(env.globals["Gadget"]!);
    const noCtor: Abs = { ...mock, shape: { ...mock.shape } };
    delete (noCtor.shape as { ctor?: boolean }).ctor;
    const r = newEffects(noCtor);
    expect(r.kinds).toContain("TypeError");
  });

  it("普通函数（不是类）不带 ctor facet（可构造性保持未知，不误报可构造）", () => {
    const p = writeTemp("fx.d.ts", `export declare function plain(x: number): string;\n`);
    const env = harvestDts([p]);
    expect(ctorFacet(env.globals["plain"])).toBeUndefined();
  });
});
