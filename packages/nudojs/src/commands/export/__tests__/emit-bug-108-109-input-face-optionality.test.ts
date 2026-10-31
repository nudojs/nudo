/**
 * BUG-108 / BUG-109 —— 入参面的**可选性**在四个产物面之间必须一致。
 *
 * BUG-108：形参**声明级带默认值**（`f(a = 1)`）却有参数契约时，zod 面与 dts 面
 * 只取契约级可选性（契约没写 `optional` ⇒ 必填）⇒ 发布出去的入参面**拒绝
 * 实现允许的零参调用**（`f()`：dts TS2554 / zod 校验失败），而同一份源码的
 * `nudo check` 签名面与 standard 面都说该位可省。
 *   判据：契约级 ∪ 声明级默认值（与 standard 面同口径）。
 *
 * BUG-109：剩余参数位在**对象槽面**（zod 的 `{ rest: … }`）上是**必填**槽 ⇒
 * `g()`（rest 为空，合法调用）被入参 schema 拒绝。
 *   判据：rest 槽恒可选（缺省 = 空 rest 数组），且槽值是**一层**数组
 *   （元素类型 = 契约/观测的元素 Abs，不是 `unknown[][]`）。
 *
 * 本文件放在产物面实现旁边（`packages/nudojs/src/commands/export/`）：修复点
 * 是 `unifiedParamFace`（zod / standard 共用的唯一参数面），dts 面走
 * `dtsFaceEntry` 的独立投影路径——两条路径都要钉。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveInterface, obj } from "@nudojs/core";
import { analyzeFileAsync, type FunctionAnalysis } from "@nudojs/service";
import { projectModuleDts } from "@nudojs/service/emit";
import { buildEffectiveInterfaceOptions } from "../selection.ts";
import { unifiedParamFace, type ParamFace } from "../contract-face.ts";
import { renderZodModule, zodInputSlots } from "../zod-face.ts";
import { dtsFaceEntry } from "../dts-face.ts";

/** 临时工程（侧车 `.nudo.js` 要真在磁盘上才解析得到） */
function project(files: Record<string, string>, entry: string): { filePath: string; source: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-108-109-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content.endsWith("\n") ? content : content + "\n", "utf-8");
  }
  return { filePath: join(dir, entry), source: files[entry]! };
}

type Face = {
  fn: FunctionAnalysis;
  params: ParamFace[];
  zod: ReturnType<typeof zodInputSlots>;
  dts: string;
};

/** 按 `nudo export` 的产品面路径取三条入参面（zod / standard / dts） */
async function faceOf(
  files: Record<string, string>,
  entry: string,
  fnName: string,
): Promise<Face> {
  const { filePath, source } = project(files, entry);
  const result = await analyzeFileAsync(
    filePath,
    source,
    undefined,
    undefined,
    undefined,
    "none",
  );
  const fn = result.functions.find((f) => f.name === fnName);
  if (!fn) throw new Error(`function ${fnName} not analysed`);
  const eff = effectiveInterface(source, fnName, buildEffectiveInterfaceOptions(filePath));
  const params = unifiedParamFace(fn, eff, fn.cases);
  const dtsEntry = dtsFaceEntry(fn, fnName, eff, source, filePath, undefined, undefined);
  const dts = projectModuleDts(undefined, [
    { fn, projection: dtsEntry.projection },
  ]).lines.join("\n");
  return { fn, params, zod: zodInputSlots(params), dts };
}

const NUM_CONTRACT = {
  "contracts.nudo.js": `import { number } from "@nudojs/core";
export const num = number();
`,
};

describe("BUG-108 —— 契约级 ∪ 声明级默认值（zod / standard / dts 同口径）", () => {
  const ENTRY = {
    ...NUM_CONTRACT,
    "a.js": `/// @nudo:import { num } from "./contracts.nudo.js"
/**
 * @nudo:contract a num
 * @nudo:contract return num
 */
export function f(a = 1) {
  return a;
}
`,
  };

  it("有默认值的形参在参数面上可选（契约没写 optional 也不否决默认值）", async () => {
    const { params } = await faceOf(ENTRY, "a.js", "f");
    expect(params.map((p) => p.name)).toEqual(["a"]);
    expect(params[0]!.optional).toBe(true);
  });

  it("zod 入参面：该位渲染成 `.optional()`（零参调用不被 schema 拒绝）", async () => {
    const { zod, params } = await faceOf(ENTRY, "a.js", "f");
    expect(zod.a?.optional).toBe(true);
    const mod = renderZodModule({ fInput: obj(zod) });
    expect(mod?.source).toBeDefined();
    expect(mod!.source).toContain("z.object({ a: ");
    expect(mod!.source).toMatch(/a: [^;\n]*\.optional\(\)/);
    // 槽值仍是契约域（num），不是被降级成 any
    expect(params[0]!.abs.shape.k).not.toBe("any");
  });

  it("dts 入参面：该位带 `?`（消费方 `f()` 不再 TS2554）", async () => {
    const { dts } = await faceOf(ENTRY, "a.js", "f");
    expect(dts).toMatch(/export declare function f\(a\?: number\): number;/);
  });

  // ── 负控制：契约申报了 optional 与未带默认值的必填位不受影响 ──────
  it("负控制：无默认值的契约形参仍是必填（不因本条修复放宽）", async () => {
    const files = {
      ...NUM_CONTRACT,
      "c.js": `/// @nudo:import { num } from "./contracts.nudo.js"
/**
 * @nudo:contract a num
 */
export function need(a) {
  return a;
}
`,
    };
    const { params, zod } = await faceOf(files, "c.js", "need");
    expect(params[0]!.optional).not.toBe(true);
    expect(zod.a?.optional).not.toBe(true);
  });
});

describe("BUG-109 —— rest 槽在对象槽面上可选且只有一层数组", () => {
  const ENTRY = {
    "b.js": `export function g(...rest) {
  return rest.length;
}
`,
  };

  it("rest 参数面：槽值是一层数组 + 可选（缺省 = 空 rest 数组）", async () => {
    const { params } = await faceOf(ENTRY, "b.js", "g");
    expect(params.map((p) => p.name)).toEqual(["rest"]);
    const slot = params[0]!;
    expect(slot.isRest).toBe(true);
    expect(slot.optional).toBe(true);
    // 一层数组：元素不是「数组的数组」
    expect(slot.abs.shape.k).toBe("arr");
    if (slot.abs.shape.k === "arr") {
      expect(slot.abs.shape.element.shape.k).not.toBe("arr");
    }
  });

  it("zod 入参面：`rest` 槽 `.optional()`（`g()` 不被 schema 拒绝）", async () => {
    const { zod } = await faceOf(ENTRY, "b.js", "g");
    expect(zod.rest?.optional).toBe(true);
    const mod = renderZodModule({ gInput: obj(zod) });
    expect(mod!.source).toMatch(/rest: z\.array\(.+\)\.optional\(\)/);
    expect(mod!.source).not.toContain("z.array(z.array(");
  });

  it("dts 面：rest 位是 `...rest: T[]`（TS 的剩余参数不能带 `?`）", async () => {
    const { dts } = await faceOf(ENTRY, "b.js", "g");
    expect(dts).toMatch(/export declare function g\(\.\.\.rest: (any|unknown)\[\]\)/);
    expect(dts).not.toContain("...rest?:");
  });
});
