/**
 * Bug 827 回归（harvester 收割面）：顶层函数的**重载集塌成 union 返回**
 * （参数只取第一个 overload）⇒ union 面上调用 ⇒ **L5 假红**（`tsc --strict` exit 0）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/e2e/app-ovpkg.ts，tsc exit=0）：
 * - `export declare function convert(x: string): string;` + `export declare function convert(x: number): number;`
 *   ⇒ `convert("a").toUpperCase()` 与 `convert(1).toFixed()` **都合法**（TS 按实参选 arm）。
 *
 * 收割侧契约（本次交付的部分）：
 *   1. 重载集**不塌成单个签名**：参数位保留**每个** overload 的参数类型（逐位 union），
 *      返回位是各 overload 返回类型的 union —— 不再只取 `sigs[0]` 的参数。
 *   2. 收割产物里 overload 的信息**不丢**（两个 arm 的参数与返回都进面）。
 *
 * ⚠️ 仍未闭环（core 侧，越界发现见交付报告）：
 *   - 「按实参形态选 arm」需要 core 的 Abs fn 形状承载 overload 集合（现在没有），
 *     且 core 的 union 方法分派只认 `string` 成员（Bug 771 / 263）——
 *     假红本身要 core 改完才消；harvester 侧无法单独消掉 L5 假红。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, getFnImpl, instantiateReturn, numLit } from "@nudojs/core";
import { absToHarvestSig, harvestSigToAbs } from "../harvest-json.ts";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug827-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

type PrimShape = { k: string; type?: string; members?: { shape: PrimShape }[] };

/** 展开 sum（union）里的原语标签 */
function primLabels(a: unknown): string[] {
  const shape = (a as { shape?: PrimShape }).shape;
  if (!shape) return [];
  if (shape.k === "prim" && shape.type) return [shape.type];
  if (shape.k === "sum") {
    const out: string[] = [];
    for (const m of shape.members ?? []) out.push(...primLabels(m));
    return out;
  }
  return [];
}

/** fn 的参数位原语标签（relation 的 paramTypes —— 泛型 fn 的参数面在 relation 上） */
function primTypes(a: unknown): string[] {
  const rel = getFnImpl(a as never)?.relation;
  const pts = rel?.paramTypes ?? [];
  const out: string[] = [];
  for (const p of pts) out.push(...primLabels(p));
  return out;
}

/** fn 返回位里的原语标签（union 展开） */
function returnPrims(a: unknown): string[] {
  const rel = getFnImpl(a as never)?.relation;
  return primLabels(rel?.returnType);
}

describe("Bug 827 —— 顶层函数的重载集不被塌成单个签名", () => {
  it("参数位保留每个 overload 的参数类型（不再只取 sigs[0]）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function convert(x: string): string;
export declare function convert(x: number): number;
`,
    );
    const env = harvestDts([p]);
    const fn = env.globals["convert"]!;
    // 改前：参数位只有第一个 overload 的 `string`
    const params = primTypes(fn);
    expect(params).toContain("string");
    expect(params).toContain("number");
    // 返回位：各 overload 返回类型的 union
    const rets = returnPrims(fn);
    expect(rets).toContain("string");
    expect(rets).toContain("number");
    expect(formatShape(fn)).toBe("(string | number) => string | number");
  });

  it("单个声明的函数不受影响（参数位不被改写）", () => {
    const p = writeTemp("fx.d.ts", `export declare function only(x: string): number;\n`);
    const env = harvestDts([p]);
    expect(formatShape(env.globals["only"]!)).toBe("(string) => number");
  });

  it("参数个数不同的 overload 不改参数位（arity 不能被改）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function f(x: string): string;
export declare function f(x: string, y: number): number;
`,
    );
    const env = harvestDts([p]);
    // arity 仍是第一个 overload 的 1（改成 2 会让 `f("a")` 变成「参数不够」）
    expect(formatShape(env.globals["f"]!)).toBe("(string) => string | number");
  });

  it("带泛型 α 的 overload 不改参数位（α 是逐参数绑定的）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function g<T>(x: T): T;
export declare function g(x: string): number;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["g"]!)).toContain("T");
  });

  it("A6：overloads 随磁盘签名投影往返（缓存命中不丢派发面）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function convert(x: string): string;
export declare function convert(x: number): number;
`,
    );
    const env = harvestDts([p]);
    const fn = env.globals["convert"]!;
    const sig = absToHarvestSig(fn);
    const back = harvestSigToAbs(sig);
    const shape = (back as { shape?: { overloads?: unknown[] } }).shape;
    expect(shape?.overloads).toHaveLength(2);
    // 回放后派发仍精确：number 实参 ⇒ number arm
    expect(formatShape(instantiateReturn(back, [numLit(1)]))).toBe("number");
    expect(formatShape(instantiateReturn(back, [numLit(0)]))).toBe("number");
  });

  it("A6：重载集进入 fn shape 的 overloads 承载位（声明序逐 arm）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function convert(x: string): string;
export declare function convert(x: number): number;
`,
    );
    const env = harvestDts([p]);
    const shape = (env.globals["convert"] as { shape?: { overloads?: unknown[] } })
      .shape;
    const arms = shape?.overloads;
    expect(Array.isArray(arms)).toBe(true);
    expect(arms).toHaveLength(2);
    const armPrims = (arms as { paramTypes: unknown[]; returnType: unknown }[]).map(
      (a) => ({ p: primLabels(a.paramTypes[0]), r: primLabels(a.returnType) }),
    );
    expect(armPrims).toEqual([
      { p: ["string"], r: ["string"] },
      { p: ["number"], r: ["number"] },
    ]);
    // union 面（权威外延面）不变
    expect(formatShape(env.globals["convert"]!)).toBe(
      "(string | number) => string | number",
    );
  });
});
