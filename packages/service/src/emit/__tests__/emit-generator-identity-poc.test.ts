/**
 * 生成器身份校验器 · **生产接线回归**（2026-11-05，原「决策 PoC」）。
 *
 * 产品裁决：导出的运行时校验器接受「不是生成器的普通对象」是 **bug**
 * （dts 面已声明 `Generator<T>`，zod / standard / guard 却只判「是个对象」），
 * **不判定为 breaking 变更**。故三面统一按 `Abs.facets.brand` 收紧接受集：
 * 真生成器放行，`{}` / `{next(){}}` 等普通对象拒绝。
 *
 * 本文件钉住：① 判据只认随值携带的 brand；② 三个产物面的文本与真跑裁决
 * 逐值一致；③ 无 brand 的旧 Abs 逐字不变（三面仍然同口径）；
 * ④ 2026-11-06 起嵌套字段也递归收紧（core `denoteGuardB` +
 * `syncGeneratorTags`），并对 toStringTag / 原型链判据做了跨 realm 实测；
 * ④ 产物可过 `tsc --noEmit --strict`；⑤ `z.instanceof` 路线仍不可行。
 */
import { describe, it, expect } from "vitest";
import { runInNewContext } from "node:vm";
import { z } from "zod";
import { abs, type Abs } from "@nudojs/core";
import { absToSchemaNode, absToSchemaSource } from "../schema-generator.ts";
import {
  absToStandardSchema,
  absToStandardSchemaModule,
  validateSchemaNode,
} from "../standard-schema.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";
import { generatorTagFromValue, generatorTagOf } from "../generator-identity.ts";
import { loadGeneratedModule } from "./fixtures.ts";
import { tscNoEmit } from "./dts-tsc.ts";

function* syncGen(): Generator<number> {
  yield 1;
}
async function* asyncGen(): AsyncGenerator<number> {
  yield 1;
}

/** 生成器 Abs 的最小形态：闭 obj + 随值 brand（生产由 makeGenObject 挂）。 */
const generatorAbs = (tag: "Generator" | "AsyncGenerator"): Abs => {
  const a = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
  a.facets = { ...(a.facets ?? {}), brand: tag };
  return a;
};
const plainAbs = (): Abs => abs({ k: "obj", slots: {} }, undefined, undefined, "exact");

const cases = (): ReadonlyArray<readonly [string, unknown]> =>
  [
    ["gen()", syncGen()],
    ["asyncGen()", asyncGen()],
    ["{}", {}],
    ["{next(){}}", { next() {} }],
    ["[]", []],
    ["null", null],
    ["42", 42],
  ] as const;

/** zod 产物是真模块源码 ⇒ 注入 z 后真跑。 */
function zodAccepts(source: string): (v: unknown) => boolean {
  const schema = new Function("z", `return ${source};`)(z) as {
    safeParse: (v: unknown) => { success: boolean };
  };
  return (v: unknown) => schema.safeParse(v).success;
}

/** guard 产物是 .ts ⇒ 剥掉类型标注后真跑（与 BUG-130 夹具同法）。 */
function guardOf(source: string, name: string): (v: unknown) => boolean {
  const js = source
    .replace("(value: unknown): boolean", "(value)")
    .replace(/const data(?:: any)? = value as [^;]+;/, "const data = value;")
    .replace("export function ", "function ");
  return new Function(`${js}; return ${name};`)() as (v: unknown) => boolean;
}

describe("生成器身份判据（单一真源）", () => {
  it("只认 facets.brand 的两个 tag", () => {
    expect(generatorTagOf(generatorAbs("Generator"))).toBe("Generator");
    expect(generatorTagOf(generatorAbs("AsyncGenerator"))).toBe("AsyncGenerator");
    expect(generatorTagOf(plainAbs())).toBeUndefined();
    const other = plainAbs();
    other.facets = { brand: "SomeUserBrand" };
    expect(generatorTagOf(other)).toBeUndefined();
  });

  it("运行时判据区分同步 / 异步 / 普通对象", () => {
    expect(generatorTagFromValue(syncGen())).toBe("Generator");
    expect(generatorTagFromValue(asyncGen())).toBe("AsyncGenerator");
    expect(generatorTagFromValue({})).toBeUndefined();
    expect(generatorTagFromValue({ next() {} })).toBeUndefined();
    expect(generatorTagFromValue([])).toBeUndefined();
  });
});

describe("生成器身份产物面（bug fix · 三面收紧）", () => {
  it("zod / standard 节点 / guard 产物的文本", () => {
    const a = generatorAbs("Generator");
    expect(absToSchemaSource(a)).toBe(
      'z.custom((v) => Object.prototype.toString.call(v) === "[object Generator]")',
    );
    expect(absToSchemaNode(a).node).toEqual({ k: "generator", tag: "Generator" });
    const guard = generateGuardFunctionFromAbs("isgenOutput", a);
    expect(guard).toContain('Object.prototype.toString.call(data) === "[object Generator]"');
    expect(guard).toContain('typeof data === "object"');
    // 不得引入无全局名字的构造器（Bug 233：模块求值期 ReferenceError）
    expect(guard).not.toContain("GeneratorFunction");
    expect(absToSchemaSource(a)).not.toContain("GeneratorFunction");
  });

  it("standard 产物把身份节点序列化进内联校验器", () => {
    const { source } = absToStandardSchemaModule({ xs: generatorAbs("AsyncGenerator") });
    expect(source).toContain('{"k":"generator","tag":"AsyncGenerator"}');
    expect(source).toContain('"[object " + node.tag + "]"');
  });

  for (const tag of ["Generator", "AsyncGenerator"] as const) {
    it(`${tag}：zod / standard 库 / standard 产物 / guard 四面逐值同裁决`, async () => {
      const a = generatorAbs(tag);
      const { node } = absToSchemaNode(a);
      const zod = zodAccepts(absToSchemaSource(a));
      const { source } = absToStandardSchema(a, { name: "xs" });
      const mod = await loadGeneratedModule(source);
      const lib = (v: unknown) => validateSchemaNode(node, v).issues === undefined;
      const product = (v: unknown) => mod.xs!["~standard"].validate(v).issues === undefined;
      const guard = guardOf(generateGuardFunctionFromAbs("isG", a), "isG");
      for (const [name, v] of cases()) {
        const verdicts = [zod(v), lib(v), product(v), guard(v)];
        expect(new Set(verdicts).size, `${tag} / ${name}: 四面裁决分叉`).toBe(1);
      }
      // 收紧的核心：普通对象从「接受」变「拒绝」，真生成器仍放行
      expect(guard({})).toBe(false);
      expect(guard({ next() {} })).toBe(false);
      expect(guard(tag === "Generator" ? syncGen() : asyncGen())).toBe(true);
      expect(guard(tag === "Generator" ? asyncGen() : syncGen())).toBe(false);
      expect(guard([])).toBe(false);
    });
  }

  it("已知边界：Symbol.toStringTag 可伪造（三面一致放行，不是 sound 的 instanceof）", () => {
    const fake: Record<symbol, string> = {};
    Object.defineProperty(fake, Symbol.toStringTag, { value: "Generator" });
    const a = generatorAbs("Generator");
    expect(generatorTagFromValue(fake)).toBe("Generator");
    expect(zodAccepts(absToSchemaSource(a))(fake)).toBe(true);
    expect(validateSchemaNode(absToSchemaNode(a).node, fake).issues).toBeUndefined();
    expect(guardOf(generateGuardFunctionFromAbs("isG", a), "isG")(fake)).toBe(true);
  });

  it("产物可过 tsc --noEmit --strict（guard / standard 两面）", () => {
    const a = generatorAbs("Generator");
    const guard = generateGuardFunctionFromAbs("isgenOutput", a);
    const standard = absToStandardSchema(a, { name: "xs" }).source;
    const result = tscNoEmit({
      "guard.nudo.guard.ts": guard,
      "standard.nudo.standard.ts": standard,
    });
    expect(result.ok, result.stderr).toBe(true);
  });
});

describe("负控制：不触发身份投影的 Abs 逐字不变", () => {
  it("无 facets.brand 的旧 Abs 仍走结构面（BUG-130 夹具口径）", () => {
    const a = plainAbs();
    expect(absToSchemaSource(a)).toBe("z.object({  })");
    expect(absToSchemaNode(a).node).toEqual({ k: "obj", slots: [] });
    expect(generateGuardFunctionFromAbs("isOld", a)).not.toContain("Object.prototype.toString");
    expect(guardOf(generateGuardFunctionFromAbs("isOld", a), "isOld")({})).toBe(true);
  });

});

describe("嵌套字段身份投影（2026-11-06 补齐递归）", () => {
  const nested = () =>
    abs(
      { k: "obj", slots: { g: { value: generatorAbs("Generator") } } },
      undefined,
      undefined,
      "exact",
    );

  it("zod / standard 节点 / guard 三面都在槽位上验身份", () => {
    const a = nested();
    expect(absToSchemaSource(a)).toContain("z.custom(");
    expect(absToSchemaSource(a)).toContain("z.object({");
    expect(absToSchemaNode(a).node).toEqual({
      k: "obj",
      slots: [{ key: "g", node: { k: "generator", tag: "Generator" } }],
    });
    const guard = generateGuardFunctionFromAbs("isNested", a);
    expect(guard).toContain('Object.prototype.toString.call(data.g) === "[object Generator]"');
    // 不重复注入：core denoteGuardB 是唯一来源
    expect(guard.match(/Object\.prototype\.toString/g)?.length).toBe(1);
  });

  it("四面逐值同裁决：{ g: gen() } 放行、{ g: {} } 拒绝", async () => {
    const a = nested();
    const zod = zodAccepts(absToSchemaSource(a));
    const { node } = absToSchemaNode(a);
    const { source } = absToStandardSchema(a, { name: "xs" });
    const mod = await loadGeneratedModule(source);
    const lib = (v: unknown) => validateSchemaNode(node, v).issues === undefined;
    const product = (v: unknown) => mod.xs!["~standard"].validate(v).issues === undefined;
    const guard = guardOf(generateGuardFunctionFromAbs("isNested", a), "isNested");
    for (const [name, v] of [
      ["{g: gen()}", { g: syncGen() }],
      ["{g: {}}", { g: {} }],
      ["{g: null}", { g: null }],
      ["{}", {}],
    ] as const) {
      const verdicts = [zod(v), lib(v), product(v), guard(v)];
      expect(new Set(verdicts).size, `${name}: 四面裁决分叉`).toBe(1);
    }
    expect(guard({ g: syncGen() })).toBe(true);
    expect(guard({ g: {} })).toBe(false);
  });

  it("异步生成器作为字段时 tag 不串味", () => {
    const a = abs(
      { k: "obj", slots: { g: { value: generatorAbs("AsyncGenerator") } } },
      undefined,
      undefined,
      "exact",
    );
    expect(absToSchemaSource(a)).toContain('"[object AsyncGenerator]"');
    const guard = guardOf(generateGuardFunctionFromAbs("isAsyncNested", a), "isAsyncNested");
    expect(guard({ g: asyncGen() })).toBe(true);
    expect(guard({ g: syncGen() })).toBe(false);
  });
});

describe("判别谓词取舍实测（2026-11-06，结论：保留 toStringTag 口径）", () => {
  /** %GeneratorPrototype%（本地 realm）：gen → fn.prototype → 这一层。 */
  const generatorPrototype = () => Object.getPrototypeOf(Object.getPrototypeOf(syncGen()));

  it("原型链判据不可伪造，但对跨 realm 生成器误拒", () => {
    const GP = generatorPrototype();
    const fake: Record<symbol, string> = {};
    Object.defineProperty(fake, Symbol.toStringTag, { value: "Generator" });
    expect(GP.isPrototypeOf(syncGen())).toBe(true);
    expect(GP.isPrototypeOf(fake)).toBe(false); // 原型链判据赢在不可伪造
    const crossRealm = runInNewContext("(function*(){ yield 1; })()") as unknown;
    expect(Object.prototype.toString.call(crossRealm)).toBe("[object Generator]");
    expect(GP.isPrototypeOf(crossRealm)).toBe(false); // 但赢不了跨 realm
  });

  it("toStringTag 判据对本地 / 跨 realm 真生成器都放行", () => {
    const crossRealm = runInNewContext("(function*(){ yield 1; })()") as unknown;
    expect(generatorTagFromValue(syncGen())).toBe("Generator");
    expect(generatorTagFromValue(asyncGen())).toBe("AsyncGenerator");
    expect(generatorTagFromValue(crossRealm)).toBe("Generator");
    // 代价：伪造 toStringTag 的普通对象仍被接受（已在上方「已知边界」钉住）
  });
});

describe("方案 (b) 不可行实证（z.instanceof 路线）", () => {
  it("没有全局 GeneratorFunction 构造器", () => {
    expect("GeneratorFunction" in globalThis).toBe(false);
  });

  it("生成器对象的原型构造器无名，且不 instanceof 生成器「函数」构造器", () => {
    const g = syncGen();
    expect(Object.getPrototypeOf(g).constructor.name).toBe("");
    const GF = Object.getPrototypeOf(syncGen).constructor as Function;
    expect(GF.name).toBe("GeneratorFunction");
    expect(g instanceof (GF as never)).toBe(false);
  });
});
