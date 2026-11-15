/**
 * 工具链接入分册回归：Bug 59 / Bug 95（harvester 面）。
 *
 * - Bug 59：`emitEnvModule` 落盘源码面丢 fn `overloads` 与 tuple `rest`
 *   ⇒ 内存 / 磁盘 / 落盘三面不同型（convert(1) 退成并集、[number, ...string[]]
 *   退成 [number]）。
 * - Bug 95：收割面丢 `declare class` 的 static 成员 ⇒ Api.create / Api.version
 *   读成 unknown。
 *
 * 落盘面按「真实求值」验证：把生成代码剥掉 ESM import / TS 类型注解后注入
 * core 导出求值，不写仓库内临时文件。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Abs,
  num,
  str,
  bool,
  never as absNever,
  unknown as absUnknown,
  numLit,
  strLit,
  boolLit,
  objOf,
  relationFn,
  abs as makeAbs,
  v as termVar,
  formatShape,
  formatAbs,
  instantiateReturn,
} from "@nudojs/core";
import { harvestDts, emitEnvModule } from "../harvest-dts.ts";
import { absToHarvestSig, harvestSigToAbs } from "../harvest-json.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeDts(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bugtooling-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 求值 emitEnvModule 产物：注入 core 具名导出，返回 defineEnv() 结果。 */
function evalEmitted(code: string): { globals: Record<string, Abs> } {
  const stripped = code
    .replace(/^import .* from "@nudojs\/core";$/m, "")
    .replace(/: Record<string, unknown>/g, "")
    .replace("export function defineEnv()", "function defineEnv()");
  const factory = new Function(
    "num",
    "str",
    "bool",
    "absNever",
    "absUnknown",
    "numLit",
    "strLit",
    "boolLit",
    "objOf",
    "relationFn",
    "makeAbs",
    "termVar",
    `${stripped}\nreturn defineEnv();`,
  );
  return factory(
    num,
    str,
    bool,
    absNever,
    absUnknown,
    numLit,
    strLit,
    boolLit,
    objOf,
    relationFn,
    makeAbs,
    termVar,
  ) as { globals: Record<string, Abs> };
}

function fnShape(a: Abs): { overloads?: unknown[]; slots?: Record<string, { value: Abs }> } {
  return a.shape as unknown as { overloads?: unknown[]; slots?: Record<string, { value: Abs }> };
}

// ---------------------------------------------------------------------------
// Bug 59
// ---------------------------------------------------------------------------

const b59 = writeDts(
  "fn.d.ts",
  [
    "export declare function convert(x: string): string;",
    "export declare function convert(x: number): number;",
    "export declare const tup: [number, ...string[]];",
    "",
  ].join("\n"),
);
const env59 = harvestDts([b59]);
const code59 = emitEnvModule(env59, "fx59");

describe("Bug 59 —— emitEnvModule 落盘面保留 fn overloads 与 tuple rest", () => {
  it("内存 / 磁盘两面基线（overloads=2、convert(1)=number、tup 带 rest）", () => {
    const conv = env59.globals.convert!;
    expect(fnShape(conv).overloads?.length).toBe(2);
    expect(formatShape(instantiateReturn(conv, [numLit(1)]))).toBe("number");
    expect(formatAbs(env59.globals.tup!)).toContain("...string[]");
    expect(formatAbs(harvestSigToAbs(absToHarvestSig(env59.globals.tup!)))).toContain(
      "...string[]",
    );
  });

  it("落盘源码文本发射 rest / overloads", () => {
    expect(code59).toContain("rest:");
    expect(code59).toContain("f.shape.overloads");
  });

  it("落盘产物真实求值后与内存 / 磁盘面同型（三面对账）", () => {
    const globals = evalEmitted(code59).globals;
    const conv = globals.convert!;
    expect(fnShape(conv).overloads?.length).toBe(2);
    expect(formatShape(instantiateReturn(conv, [numLit(1)]))).toBe("number");
    expect(formatAbs(globals.tup!)).toContain("...string[]");
  });
});

// ---------------------------------------------------------------------------
// Bug 95
// ---------------------------------------------------------------------------

const b95 = writeDts(
  "clspkg.d.ts",
  [
    "export declare class Api {",
    "  static version: string;",
    "  static create(name: string): Api;",
    "  name: string;",
    "}",
    "",
  ].join("\n"),
);
const env95 = harvestDts([b95]);

describe("Bug 95 —— declare class 的 static 成员进类值 slots", () => {
  it("Api 是 fn 类值且带 static slots（version / create）", () => {
    const api = env95.globals.Api!;
    expect(api.shape.k).toBe("fn");
    const slots = fnShape(api).slots ?? {};
    expect(Object.keys(slots).sort()).toEqual(["create", "version"]);
    expect(formatShape(slots.version!.value)).toBe("string");
  });

  it("Api.create('x') 返回实例面，name 读成 string", () => {
    const api = env95.globals.Api!;
    const create = fnShape(api).slots!.create!.value;
    const inst = instantiateReturn(create, [strLit("x")]);
    // 实例面是 brand：解包后再读 slot
    const inner = inst.shape.k === "brand" ? inst.shape.shape : inst;
    const innerSlots = inner.shape.k === "obj" ? inner.shape.slots : {};
    expect(formatShape(innerSlots.name!.value)).toBe("string");
  });

  it("落盘源码面也带 static slots（emitEnvModule 不丢）", () => {
    const code = emitEnvModule(env95, "clspkg");
    expect(code).toContain("version");
    expect(code).toContain("create");
    const globals = evalEmitted(code).globals;
    expect(Object.keys(fnShape(globals.Api!).slots ?? {}).sort()).toEqual([
      "create",
      "version",
    ]);
  });
});
