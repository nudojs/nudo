/**
 * Bug 233 —— `nudo export --format schema` 把**生成器的 `constructor` brand**
 * （`GeneratorFunction`）渲染成 `z.instanceof(GeneratorFunction)`：生成的 zod
 * 模块 **import 即崩**（`ReferenceError: GeneratorFunction is not defined`），
 * 整个产物作废（客户端 import 的第一行就崩，一个校验器都拿不到）。
 *
 * 根因（packages/service/src/emit/schema-generator.ts）：`case "brand"` 无条件把
 * brand **名字**当作用域内的运行时标识符插进生成源码——既不检查该名字是不是一个
 * 值，也不检查它在生成的模块里可见不可见（zod 产物只 import zod，模块里能解析的
 * 只有全局；`GeneratorFunction` 连全局都不是）。
 *
 * 修法：brand 名只有落在「运行时全局构造器」表里才允许进 `z.instanceof(...)`；
 * 其余（GeneratorFunction / AsyncGeneratorFunction / 用户类名 / `X.prototype` /
 * `Record<…>` …）降级 `z.unknown()` 并把损失记进 dropped 台账——**产物永远可 import**。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { abs, objOf, num, type Abs } from "@nudojs/core";
import { analyzeFile, resetAllAnalysisCaches } from "../index.ts";
import {
  absToSchemaSource,
  absToZodSchemaModule,
  projectAbsToSchema,
} from "../emit/schema-generator.ts";
import { absToStandardSchemaModule } from "../emit/standard-schema.ts";

// 用例级缓存隔离：整文件分析管线背后的会话级缓存
beforeEach(() => {
  resetAllAnalysisCaches();
});

const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: objOf({}) }, undefined, undefined, "exact");

/** zod 桩：链式可调用（只为验证「模块求值期不炸」） */
function zodStub(): unknown {
  const stub: unknown = new Proxy(function () {} as unknown as object, {
    get: () => stub,
    apply: () => stub,
  });
  return stub;
}

/**
 * 把 zod 产物当模块求值一次（去 import / export 后 new Function 跑）。
 * 真 zod 也会在模块顶层求值 `z.instanceof(X)` 的实参 X —— X 不存在时同样抛。
 */
function evaluateZodModule(source: string, exportNames: string[]): { ok: boolean; error?: string } {
  const body =
    source
      .replace(/^import \{ z \} from "zod";$/m, "")
      .replace(/^export const /gm, "const ") + `\nreturn { ${exportNames.join(", ")} };`;
  try {
    new Function("z", body)(zodStub());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const GENERATOR_SRC = "export function* gen() {\n  yield 1;\n}\n";

function generatorOutputAbs(): Abs {
  const result = analyzeFile("/t/bug233-gen.js", GENERATOR_SRC);
  const fn = result.functions[0]!;
  const out = fn.combinedAbs ?? fn.cases[0]?.abs;
  if (!out) throw new Error("no output abs for generator fixture");
  return out;
}

describe("Bug 233: zod brand 节点不得引用无运行时值的名字", () => {
  it("生成器的 constructor brand 不再渲染成 z.instanceof(GeneratorFunction)", () => {
    const { source, dropped } = absToZodSchemaModule({ genOutput: generatorOutputAbs() });
    expect(source).not.toMatch(/z\.instanceof\([^)]*GeneratorFunction/);
    // 族 02 / Bug 240（S21）：`constructor` 是 **internal 槽**（原生挂在原型上，
    // 不是自有属性）⇒ core 约束面（`absToConstraint`）与投影面（`format.ts`）
    // 同口径剔除 internal 槽 ⇒ 产物里**连这个字段都没有**。
    // Bug 233 的不变量（"产物永远可 import"）由此更强地满足：没有名字需要
    // 解析，也就没有 ReferenceError 可言（不是"降级成 z.unknown()"）。
    expect(source).not.toContain("constructor");
    expect(source).not.toContain("GeneratorFunction");
    // 无可降级的 brand 名字 ⇒ 台账里也不再出现 GeneratorFunction
    expect(dropped.some((d) => d.includes("GeneratorFunction"))).toBe(false);
  });

  it("生成的 zod 模块可以求值（改前：ReferenceError: GeneratorFunction is not defined）", () => {
    const { source } = absToZodSchemaModule({ genOutput: generatorOutputAbs() });
    const r = evaluateZodModule(source, ["genOutput"]);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it("负控制：求值夹具确实能抓到 ReferenceError（改前形态会红）", () => {
    const broken = 'import { z } from "zod";\nexport const genOutput = z.object({ constructor: z.instanceof(GeneratorFunction) });\n';
    const r = evaluateZodModule(broken, ["genOutput"]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("GeneratorFunction is not defined");
  });

  it("非全局 brand 降级 z.unknown() 并记 dropped", () => {
    for (const name of ["GeneratorFunction", "AsyncGeneratorFunction", "Widget", "Object.prototype"]) {
      const p = projectAbsToSchema(brandOf(name));
      expect(p.source, name).toBe("z.unknown()");
      expect(p.dropped.some((d) => d.includes(name)), name).toBe(true);
    }
  });

  it("负控制：运行时全局构造器仍走 z.instanceof（不得过度降级）", () => {
    expect(absToSchemaSource(brandOf("Date"))).toBe("z.instanceof(Date)");
    expect(absToSchemaSource(brandOf("Map"))).toBe("z.instanceof(Map)");
    expect(absToSchemaSource(brandOf("RegExp"))).toBe("z.instanceof(RegExp)");
    // 非 brand 形态不受影响（number prim 的域渲染见 Bug 1001：含 NaN / ±Infinity）
    expect(absToSchemaSource(num())).toContain("z.number()");
  });

  it("产物里的 z.instanceof 实参都是运行时全局构造器", () => {
    const mod = absToZodSchemaModule({ genOutput: generatorOutputAbs(), d: brandOf("Date") });
    const names = [...mod.source.matchAll(/z\.instanceof\(([^)]*)\)/g)].map((m) => m[1]!);
    for (const name of names) {
      const v = (globalThis as Record<string, unknown>)[name];
      expect(typeof v, name).toBe("function");
    }
  });

  it("standard 面不受影响（brand 走 JSON 节点，不引用类名）", () => {
    const mod = absToStandardSchemaModule({ out: brandOf("GeneratorFunction") });
    expect(mod.source).not.toContain("z.instanceof");
    expect(mod.source).toContain('"~standard"');
  });
});
