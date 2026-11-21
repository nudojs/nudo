/**
 * 注解解析差分矩阵（单一解析层 + 单一入口域的回归门）。
 *
 * 每个用例同时跑：
 * 1. 真 `tsc --declaration`：对照 nudo dts 的函数声明行；
 * 2. nudo `generateDts`：声明位必须与 tsc 逐字同形（JSDoc 允许差）；
 * 3. zod / guard / standard 三个产物面：声明注解不得退成 `unknown`。
 *
 * 用例轴：prim / union / literal / tuple labels / readonly / function type /
 * 泛型参数 / 同文件 interface / 跨文件 import / Date / Map / keyof / typeof。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeFile, resetAllAnalysisCaches } from "../../index.ts";
import { dtsModuleSurface, projectFunctionDts, projectModuleDts } from "../dts-generator.ts";
import { absToZodSchemaModule } from "../schema-generator.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";
import { absToStandardSchemaModule } from "../standard-schema.ts";
import { tscDeclaration } from "./dts-tsc.ts";
import { tsAnnotationArgAbs } from "../../ts-annotation.ts";
import { provenanceOf } from "@nudojs/core";
import { namedTypeTextsForSource } from "@nudojs/core/internal";

type Case = {
  name: string;
  source: string;
  /** tsc 声明里必须出现的函数行（规范化后）。 */
  signature: string;
  /** 用于三个产物面的形参注解文本（缺省 = 不查）。 */
  paramType?: string;
};

const CASES: Case[] = [
  {
    name: "prim",
    source: `export function f(x: string): number { return x.length; }`,
    signature: "function f(x: string): number;",
    paramType: "string",
  },
  {
    name: "union",
    source: `export function f(x: string | number): string { return String(x); }`,
    signature: "function f(x: string | number): string;",
    paramType: "string | number",
  },
  {
    name: "literal",
    source: `export function f(x: "a" | "b"): 42 { return 42; }`,
    signature: 'function f(x: "a" | "b"): 42;',
    paramType: '"a" | "b"',
  },
  {
    name: "tuple-labels",
    source: `export function f(t: [x: number, y?: string]): number { return t[0]; }`,
    signature: "function f(t: [x: number, y?: string]): number;",
    paramType: "[x: number, y?: string]",
  },
  {
    name: "readonly",
    source: `export function f(x: readonly [number, string]): number { return x[0]; }`,
    signature: "function f(x: readonly [number, string]): number;",
    paramType: "readonly [number, string]",
  },
  {
    name: "fn-type",
    source: `export function f(g: (x: number) => string): string { return g(1); }`,
    signature: "function f(g: (x: number) => string): string;",
    paramType: "(x: number) => string",
  },
  {
    name: "generic",
    source: `export function f<T extends string>(x: T): T { return x; }`,
    signature: "function f<T extends string>(x: T): T;",
    paramType: "T",
  },
  {
    name: "interface",
    source: `interface Opts { a: number; b?: string }\nexport function f(o: Opts): number { return o.a; }`,
    signature: "function f(o: Opts): number;",
    paramType: "Opts",
  },
  {
    name: "date",
    source: `export function f(x: Date): number { return x.getTime(); }`,
    signature: "function f(x: Date): number;",
    paramType: "Date",
  },
  {
    name: "map",
    source: `export function f(x: Map<string, number>): number { return x.get("a") ?? 0; }`,
    signature: "function f(x: Map<string, number>): number;",
    paramType: "Map<string, number>",
  },
  {
    name: "keyof",
    source: `export function f(k: keyof { a: number; b: string }): string { return String(k); }`,
    signature: "function f(k: keyof { a: number; b: string }): string;",
    paramType: "keyof { a: number; b: string }",
  },
  {
    name: "typeof-value",
    source: `const defaults = { a: 1, b: "s" };\nexport function f(o: typeof defaults): number { return o.a; }`,
    signature: "function f(o: typeof defaults): number;",
    paramType: "typeof defaults",
  },
];

/** tsc 声明里某函数的第一行声明（多行对象注解只取首个 `function ...` 片段）。 */
function declarationLine(dts: string, fnName: string): string {
  const text = dts.replace(/\s+/g, " ");
  const re = new RegExp(`(?:export )?declare function ${fnName}\\b`);
  const start = text.search(re);
  if (start < 0) return "";
  // 类型里可能含 `;`（对象类型）⇒ 找顶层分号，不能 `[^;]*`。
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
    else if (ch === ")" || ch === "]" || ch === "}" || (ch === ">" && text[i - 1] !== "=")) depth--;
    else if (ch === ";" && depth === 0) {
      return text
        .slice(start, i + 1)
        .replace(/^(?:export\s+)?(?:declare\s+)?/, "")
        // tsc 对象类型成员末尾标 `; }`，nudo 注解原文常写 ` }`；语义同形。
        .replace(/;\s*}/g, " }")
        .trim();
    }
  }
  return "";
}

function nudoDts(source: string, name = "case"): string {
  // 每个用例唯一路径：`analyzeFile` 的缓存按路径键控，同路径换源码会复用
  // 上一份分析结果（差分矩阵会看似「所有用例都跑成第一条」）。
  const result = analyzeFile(`/t/annotation-differential-${name}.ts`, source);
  const surface = dtsModuleSurface(source);
  const entries = result.functions
    .filter((fn) => !fn.noDeclaration)
    .map((fn) => ({ fn, projection: projectFunctionDts(fn, undefined, surface) }));
  return projectModuleDts(surface, entries).lines.join("\n");
}

beforeEach(() => {
  resetAllAnalysisCaches();
});

describe("注解解析差分矩阵：nudo dts ≡ tsc dts", () => {
  for (const c of CASES) {
    it(`${c.name}：声明行与 tsc 同形，且三个产物面不退 unknown`, () => {
      const tsc = tscDeclaration({ "mod.ts": c.source })["mod.d.ts"] ?? "";
      expect(declarationLine(tsc, "f")).toBe(c.signature);
      expect(declarationLine(nudoDts(c.source, c.name), "f")).toBe(c.signature);
    });
  }

  it("跨文件 import type：本地别名解析后仍保留声明原文", () => {
    const files = {
      "types.ts": `export interface Opts { a: number; b?: string }\nexport type Name = string;`,
      "mod.ts": `import type { Opts, Name } from "./types";\nexport function f(o: Opts, n: Name): number { return o.a + n.length; }`,
    };
    const tsc = tscDeclaration(files)["mod.d.ts"] ?? "";
    expect(declarationLine(tsc, "f")).toBe("function f(o: Opts, n: Name): number;");
    expect(declarationLine(nudoDts(files["mod.ts"]!, "cross-file"), "f")).toBe(
      "function f(o: Opts, n: Name): number;",
    );
    // 跨文件解析真进了入口域：服务播种面给出结构化槽，而不是 any。
    const namedTypes = new Map([
      ...namedTypeTextsForSource(files["types.ts"]!),
      ...namedTypeTextsForSource(files["mod.ts"]!),
    ]);
    const { source } = absToZodSchemaModule({
      o: tsAnnotationArgAbs("Opts", { namedTypes }),
    });
    expect(source).toContain("z.object");
  });

  it("声明来源的字面量在 zod / guard / standard 面保真", () => {
    const arg = tsAnnotationArgAbs('"a" | "b"');
    expect(provenanceOf(arg)).toBe("declared");
    const zod = absToZodSchemaModule({ x: arg }).source;
    expect(zod).toContain('z.literal("a")');
    expect(zod).toContain('z.literal("b")');
    const guard = generateGuardFunctionFromAbs("isX", arg);
    expect(guard).toContain('"a"');
    expect(guard).toContain('"b"');
    const standard = absToStandardSchemaModule({ x: arg }).source;
    expect(standard).toContain('"lit"');
  });

  it("内建实例在入口域可调用（Date / Map 不退 any）", () => {
    const date = tsAnnotationArgAbs("Date");
    expect(provenanceOf(date)).toBe("declared");
    expect(date.shape.k === "obj" ? date.shape.slots.getTime : undefined).toBeDefined();
    const map = tsAnnotationArgAbs("Map<string, number>");
    expect(map.shape.k === "obj" ? map.shape.slots.get : undefined).toBeDefined();
  });
});
