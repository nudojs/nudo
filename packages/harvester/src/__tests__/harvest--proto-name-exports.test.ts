/**
 * Bug 828 回归（harvester 收割面）：导出表 / 成员表用**普通对象 + 原型链裸读裸写**
 * ⇒ 名字撞 `Object.prototype` 成员的导出**整条静默丢失**（skipped 计数还是 0）
 * ⇒ 端到端 L2 假红。
 *
 * oracle：`tsc --strict` 认为这些声明完全合法（tmp/probe/fix-r27/h6/fixture/use.ts，
 * tsc exit=0）⇒ 收割器一条都不能丢。
 *
 * 契约：撞名的导出必须是**自有键**，且值是收割到的 Abs（不是原型链上的成员）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { harvestDts, emitEnvModule } from "../harvest-dts.ts";

const dirs: string[] = [];
const generatedFiles: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  for (const f of generatedFiles) rmSync(f, { force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug828-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const fx = writeTemp(
  "fx.d.ts",
  `export declare function toString(pointer: bigint): string | null;
export declare function valueOf(): number;
export declare function hasOwnProperty(): boolean;
export declare function constructor(): void;
export declare const __proto__: { x: number };

declare module "m" {
  export declare function toString(): string;
  export declare function valueOf(): string;
  export declare function hasOwnProperty(): string;
  export declare function constructor(): string;
  export declare const __proto__: { y: number };
}
`,
);

const env = harvestDts([fx]);
const code = emitEnvModule(env, "fx");

/** 撞 Object.prototype 的导出名 */
const PROTO_NAMES = ["toString", "valueOf", "hasOwnProperty", "constructor", "__proto__"] as const;

type AbsLike = { shape?: { k: string } };

describe("Bug 828 — 撞 Object.prototype 成员的导出不得整条丢失", () => {
  it("globals 表里这些名字都是自有键，且值是收割到的 Abs", () => {
    for (const name of PROTO_NAMES) {
      expect(Object.hasOwn(env.globals, name), `globals.${name} 必须是自有键`).toBe(true);
      const value = env.globals[name] as unknown as AbsLike;
      expect(value?.shape, `globals.${name} 必须是被收割到的 Abs`).toBeTruthy();
    }
    // 反向断言：不得是原型链上的成员（修复前 rec["toString"] 命中 Object.prototype.toString）
    expect(env.globals.toString as unknown).not.toBe(Object.prototype.toString);
    expect(env.globals.valueOf as unknown).not.toBe(Object.prototype.valueOf);
    expect(env.globals.hasOwnProperty as unknown).not.toBe(Object.prototype.hasOwnProperty);
    expect(env.globals.constructor as unknown).not.toBe(Object);
    expect((env.globals.toString as unknown as AbsLike).shape?.k).toBe("fn");
    expect((env.globals["__proto__"] as unknown as AbsLike).shape?.k).toBe("obj");
  });

  it("模块记录表里这些名字同样不得丢失", () => {
    const rec = env.modules["m"]!;
    expect(rec).toBeTruthy();
    for (const name of PROTO_NAMES) {
      expect(Object.hasOwn(rec, name), `modules.m.${name} 必须是自有键`).toBe(true);
      const value = rec[name] as unknown as AbsLike;
      expect(value?.shape, `modules.m.${name} 必须是被收割到的 Abs`).toBeTruthy();
    }
    expect(rec.toString as unknown).not.toBe(Object.prototype.toString);
    expect((rec.toString as unknown as AbsLike).shape?.k).toBe("fn");
  });

  it("一条都没丢（不再出现「丢了但 skipped=0」的假象）", () => {
    expect(env.stats.files).toBe(1);
    expect(env.stats.skipped).toBe(0);
    // 5 条 global 声明 + 5 条模块声明全部进表
    expect(Object.keys(env.globals).length).toBe(5);
    expect(Object.keys(env.modules["m"]!).length).toBe(5);
  });

  it("落盘面同样保留这些导出名（求值后仍是自有键）", async () => {
    const generatedPath = fileURLToPath(
      new URL("./generated-env-bug828.tmp.ts", import.meta.url),
    );
    writeFileSync(generatedPath, code, "utf-8");
    generatedFiles.push(generatedPath);
    const mod = await import("./generated-env-bug828.tmp.ts");
    const evaluated = mod.defineEnv();
    for (const name of PROTO_NAMES) {
      expect(
        Object.hasOwn(evaluated.globals, name),
        `落盘 globals.${name} 必须是自有键`,
      ).toBe(true);
      expect(Object.hasOwn(evaluated.modules["m"]!, name), `落盘 modules.m.${name}`).toBe(true);
    }
    // `__proto__` 是自有数据键（没有改写对象的原型）
    expect((evaluated.globals as Record<string, unknown>)["__proto__"]).toBeTruthy();
    expect(Object.getPrototypeOf(evaluated.globals)).toBe(Object.prototype);
  });
});
