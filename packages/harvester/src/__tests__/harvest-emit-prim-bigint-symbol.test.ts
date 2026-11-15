/**
 * Bug 795 回归（harvester 落盘面）：`emitEnvModule` 把 `bigint` / `symbol`
 * 降级为 `unknown` ⇒ **内存收割与落盘产物对同一份 .d.ts 给出不同答案**。
 *
 * oracle：`tsc --strict` 认为 `bigint` / `symbol` 声明完全合法（见
 * tmp/probe/fix-r27/h6/fixture/use.ts，tsc exit=0）⇒ 收割器不得降级。
 *
 * 契约：
 *   1. 内存面（harvestDts）保留 bigint / symbol 原语；
 *   2. 落盘面（emitEnvModule 产物的**实际求值结果**）与内存面同口径；
 *   3. 磁盘投影面（harvest-json 的签名投影）同样保留这两个原语。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatShape, type Abs } from "@nudojs/core";
import { harvestDts, emitEnvModule } from "../harvest-dts.ts";
import { absToHarvestSig, harvestSigToAbs } from "../harvest-json.ts";

const dirs: string[] = [];
const generatedFiles: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  for (const f of generatedFiles) rmSync(f, { force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug795-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const fx = writeTemp(
  "fx.d.ts",
  `export declare function big(x: bigint): bigint;
export declare function sym(x: symbol): symbol;
export declare function ok(x: number): string;
`,
);

const env = harvestDts([fx]);
const code = emitEnvModule(env, "fx");

type ShapeLike = { k: string; type?: string };

function primOf(a: unknown): string | undefined {
  const shape = (a as { shape?: ShapeLike }).shape;
  return shape?.k === "prim" ? shape.type : undefined;
}

/** fn Abs 的第 0 个形参 / 返回位的原语标签（paramTypes / returnType 里装的是 Abs） */
function fnPrims(a: unknown): { param: string | undefined; ret: string | undefined } {
  const shape = (a as { shape?: { paramTypes?: unknown[]; returnType?: unknown } }).shape;
  return {
    param: primOf(shape?.paramTypes?.[0]),
    ret: primOf(shape?.returnType),
  };
}

describe("Bug 795 — 落盘面不得把 bigint / symbol 降级成 unknown", () => {
  it("内存面保留 bigint / symbol 原语", () => {
    expect(fnPrims(env.globals.big)).toEqual({ param: "bigint", ret: "bigint" });
    expect(fnPrims(env.globals.sym)).toEqual({ param: "symbol", ret: "symbol" });
    // 对照组：普通原语不受影响
    expect(fnPrims(env.globals.ok)).toEqual({ param: "number", ret: "string" });
    expect(formatShape(env.globals.big)).toBe("(bigint) => bigint");
    expect(formatShape(env.globals.sym)).toBe("(symbol) => symbol");
  });

  it("emitEnvModule 源码保留 bigint / symbol 原语（不再退化成 absUnknown）", () => {
    expect(code).toContain('type: "bigint"');
    expect(code).toContain('type: "symbol"');
    // 反向断言：bigint / symbol 两条不得被降级
    const bigLine = code.split("\n").find((l) => l.trim().startsWith("big:")) ?? "";
    const symLine = code.split("\n").find((l) => l.trim().startsWith("sym:")) ?? "";
    expect(bigLine).not.toContain("absUnknown");
    expect(symLine).not.toContain("absUnknown");
  });

  it("落盘产物求值后与内存收割同口径（bigint / symbol 不丢）", async () => {
    const generatedPath = fileURLToPath(
      new URL("./generated-env-bug795.tmp.ts", import.meta.url),
    );
    writeFileSync(generatedPath, code, "utf-8");
    generatedFiles.push(generatedPath);
    const mod = await import("./generated-env-bug795.tmp.ts");
    const evaluated = mod.defineEnv();
    expect(fnPrims(evaluated.globals.big)).toEqual({ param: "bigint", ret: "bigint" });
    expect(fnPrims(evaluated.globals.sym)).toEqual({ param: "symbol", ret: "symbol" });
    expect(formatShape(evaluated.globals.big as Abs)).toBe(formatShape(env.globals.big));
    expect(formatShape(evaluated.globals.sym as Abs)).toBe(formatShape(env.globals.sym));
    // 对照组：普通原语两侧一致
    expect(formatShape(evaluated.globals.ok as Abs)).toBe(formatShape(env.globals.ok));
  });

  it("磁盘投影面（签名投影）同样保留 bigint / symbol", () => {
    const bigSig = absToHarvestSig(env.globals.big);
    const symSig = absToHarvestSig(env.globals.sym);
    expect(bigSig.k).toBe("fn");
    expect((bigSig as { paramTypes: { type: string }[] }).paramTypes[0]!.type).toBe("bigint");
    expect((bigSig as { returns: { type: string } }).returns.type).toBe("bigint");
    expect((symSig as { paramTypes: { type: string }[] }).paramTypes[0]!.type).toBe("symbol");
    expect((symSig as { returns: { type: string } }).returns.type).toBe("symbol");
    // 回放：mock Abs 仍保留原语标签
    const bigBack = harvestSigToAbs(bigSig);
    const symBack = harvestSigToAbs(symSig);
    expect(fnPrims(bigBack)).toEqual({ param: "bigint", ret: "bigint" });
    expect(fnPrims(symBack)).toEqual({ param: "symbol", ret: "symbol" });
  });

  it("未知的原语标签诚实降级成 unknown（不静默造出假 prim）", () => {
    const bogus = harvestSigToAbs({ k: "prim", type: "notAPrim" } as never);
    expect(bogus.shape.k).toBe("unknown");
  });
});
