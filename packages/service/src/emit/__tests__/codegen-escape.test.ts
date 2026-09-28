/**
 * 生成代码转义回归（BUG-003）。
 * 用户可控字符串进代码/类型/注释/守卫时必须转义，否则语法错误或注入：
 * 1. guard 属性访问：`data.${key}` 裸拼 → 恒真 / SyntaxError
 * 2. dts 模板固定段：反引号 / `${` / 反斜杠 未转义 → 类型注入
 * 3. dts JSDoc：case 名 / 类型串含块注释终止序列 → 提前闭合
 * 4. dropped 注记：键换行逃逸 `//`
 * 5. 数字键：`01` 裸写非法 TS/JS
 */
import { describe, it, expect } from "vitest";
import { abs, num, str, numLit, strLit, objOf, type Abs } from "@nudojs/core";
import { createTemplateAbs, denoteGuard } from "@nudojs/core/internal";
import { absToTSType, generateFunctionDtsLines } from "../dts-generator.ts";
import {
  absToZodSchemaModule,
  formatJsObjectKey,
  projectAbsToSchema,
} from "../schema-generator.ts";
import { absToStandardSchemaModule } from "../standard-schema.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";
import type { CaseResult, FunctionAnalysis } from "../../analyzer-types.ts";

function objAbs(slots: Record<string, Abs>, optionalKeys: string[] = []): Abs {
  const built: Record<string, { value: Abs; optional?: boolean }> = {};
  for (const [k, v] of Object.entries(slots)) {
    built[k] = { value: v, ...(optionalKeys.includes(k) ? { optional: true } : {}) };
  }
  return abs({ k: "obj", slots: built as never }, undefined, undefined, "exact");
}

/** 数字收窄（带不可投影 pred，用于制造 dropped） */
function numWithUnprojectable(): Abs {
  return abs(
    { k: "prim", type: "number" },
    { op: "var", id: "x" },
    { op: "gt", a: { op: "var", id: "x" }, b: { op: "var", id: "y" } },
    "exact",
  );
}

function fnAnalysis(overrides: Partial<FunctionAnalysis> & { cases: CaseResult[] }): FunctionAnalysis {
  return {
    name: "f",
    loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
    paramNames: ["x"],
    ...overrides,
  };
}

describe("guard property access is injection-safe", () => {
  it("does not emit always-true guard for operator-like keys", () => {
    // key=`foo||true||bar` → 旧代码 `typeof data.foo||true||bar === "number"` 恒真
    const a = objAbs({ "foo||true||bar": num() });
    const g = generateGuardFunctionFromAbs("isX", a);
    const check = new Function("data", `return ${denoteGuard(a, "data")};`);
    expect(check({})).toBe(false);
    expect(check({ "foo||true||bar": 1 })).toBe(true);
    expect(check({ "foo||true||bar": "s" })).toBe(false);
  });

  it("uses bracket access for non-identifier keys", () => {
    const a = objAbs({ "a-b": num(), "foo bar": str() });
    const g = generateGuardFunctionFromAbs("isY", a);
    expect(g).toContain('data["a-b"]');
    expect(g).toContain('data["foo bar"]');
    expect(g).not.toContain("data.a-b");
    const check = new Function("data", `return ${denoteGuard(a, "data")};`);
    expect(check({ "a-b": 1, "foo bar": "s" })).toBe(true);
    expect(check({})).toBe(false);
  });

  it("keeps bracket access for keys with quotes, newlines, and digits", () => {
    const keys = ['foo"bar', "a\nb", "123", "x*/y"];
    for (const key of keys) {
      const a = objAbs({ [key]: num() });
      const body = denoteGuard(a, "data");
      expect(() => new Function("data", `return ${body};`)).not.toThrow();
      const check = new Function("data", `return ${body};`) as (d: unknown) => boolean;
      expect(check({ [key]: 1 })).toBe(true);
      expect(check({})).toBe(false);
    }
  });

  it("optional slots use safe access too", () => {
    const a = objAbs({ "foo||true||bar": num() }, ["foo||true||bar"]);
    const body = denoteGuard(a, "data");
    const check = new Function("data", `return ${body};`) as (d: unknown) => boolean;
    expect(check({})).toBe(true); // optional missing is ok
    expect(check({ "foo||true||bar": 1 })).toBe(true);
    expect(check({ "foo||true||bar": "s" })).toBe(false);
  });
});

describe("dts template literal types are escaped", () => {
  it("escapes backticks in fixed segments", () => {
    // "a" + x + "`" → 旧代码 `` `a${number}`` `` 在反引号处截断
    const t = createTemplateAbs([strLit("a"), num(), strLit("`")]);
    const ts = absToTSType(t);
    expect(ts).toBe("`a${number}\\``");
    expect(() => new Function(`return 0;`)).not.toThrow();
    // 反引号必须转义：输出里不允许出现裸固定段反引号提前闭合
    expect(ts.startsWith("`")).toBe(true);
    expect(ts.endsWith("`")).toBe(true);
    expect(ts.slice(1, -1)).not.toMatch(/(^|[^\\])`/);
  });

  it("escapes ${ in fixed segments so it cannot open interpolation", () => {
    // "${" + x + "}" → 旧代码 `` `${${number}}` `` 内层被当二次插值
    const t = createTemplateAbs([strLit("${"), num(), strLit("}")]);
    const ts = absToTSType(t);
    expect(ts).toBe("`\\${${number}}`");
    // 转义后的 `\${` 不是插值起点
    expect(ts).not.toMatch(/[^\\]\$\{\$\{/);
  });

  it("escapes backslashes in fixed segments", () => {
    const t = createTemplateAbs([strLit("a\\b"), num()]);
    const ts = absToTSType(t);
    expect(ts).toBe("`a\\\\b${number}`");
  });
});

describe("dts JSDoc comment bodies cannot break out", () => {
  it("neutralizes */ in case names", () => {
    const c: CaseResult = {
      name: "x*/ process.exit(1); /*",
      argAbs: [numLit(1)],
      abs: numLit(1),
      throwsAbs: abs({ k: "never" }, undefined, undefined, "exact"),
    };
    const lines = generateFunctionDtsLines(fnAnalysis({ cases: [c] }));
    const jsdoc = lines[0]!;
    expect(jsdoc).toContain("/**");
    expect(jsdoc.trimEnd().endsWith("*/")).toBe(true);
    // 注释体内的 `*/` 必须转义成 `*\/`
    expect(jsdoc).toContain("*\\/");
    // 只允许最后的 `*/` 闭合：中间不得出现裸 `*/`
    const withoutClose = jsdoc.slice(0, jsdoc.lastIndexOf("*/"));
    expect(withoutClose).not.toContain("*/");
  });

  it("neutralizes */ in types embedded in JSDoc (@param / Case args)", () => {
    const c: CaseResult = {
      name: "n",
      argAbs: [strLit("a*/b")],
      abs: strLit("a*/b"),
      throwsAbs: abs({ k: "never" }, undefined, undefined, "exact"),
    };
    const lines = generateFunctionDtsLines(fnAnalysis({ cases: [c] }));
    const jsdoc = lines[0]!;
    const withoutClose = jsdoc.slice(0, jsdoc.lastIndexOf("*/"));
    expect(withoutClose).not.toContain("*/");
  });

  it("flattens newlines in case names", () => {
    const c: CaseResult = {
      name: "a\nb",
      argAbs: [numLit(1)],
      abs: numLit(1),
      throwsAbs: abs({ k: "never" }, undefined, undefined, "exact"),
    };
    const lines = generateFunctionDtsLines(fnAnalysis({ cases: [c] }));
    const jsdoc = lines[0]!;
    // 单个 JSDoc 块不得被 case 名撕成多行（除标准 ` * ` 行）
    const inner = jsdoc.split("\n").filter((l) => !l.startsWith(" *") && l !== "/**" && l !== " */");
    expect(inner).toEqual([]);
  });
});

describe("dropped notes cannot escape line comments", () => {
  it("flattens newlines in object keys used as dropped prefixes (zod)", () => {
    const a = objAbs({ "a\nb": numWithUnprojectable() });
    const { source, dropped } = absToZodSchemaModule({ out: a });
    expect(dropped.length).toBeGreaterThan(0);
    // 每个 `//` 注记行不得被键里的换行顶出
    const noteLines = source.split("\n").filter((l) => l.startsWith("//   "));
    expect(noteLines.length).toBeGreaterThan(0);
    for (const l of noteLines) {
      expect(l).not.toMatch(/^[^/]/); // 不得有非注释顶出
    }
    // 逃逸行（`b: pred…`）不得作为顶层 token 出现
    expect(source).not.toMatch(/^b: pred/m);
  });

  it("flattens newlines in dropped notes (standard-schema)", () => {
    const a = objAbs({ "a\nb": numWithUnprojectable() });
    const { source } = absToStandardSchemaModule({ out: a });
    expect(source).not.toMatch(/^b: pred/m);
    const noteLines = source.split("\n").filter((l) => l.includes("pred not projected"));
    for (const l of noteLines) {
      expect(l.startsWith("//") || l.includes("//   ")).toBe(true);
    }
  });

  it("neutralizes */ in dropped notes (line comment is safe but keep single-line)", () => {
    const a = objAbs({ "a\nb*/c": numWithUnprojectable() });
    const { source } = absToZodSchemaModule({ out: a });
    expect(source).not.toMatch(/^c: pred/m);
  });
});

describe("numeric object keys keep quotes when not canonical", () => {
  it("quotes leading-zero digit keys", () => {
    expect(formatJsObjectKey("01")).toBe('"01"');
    expect(formatJsObjectKey("00")).toBe('"00"');
    expect(formatJsObjectKey("0123")).toBe('"0123"');
  });

  it("allows bare canonical integers and identifiers", () => {
    expect(formatJsObjectKey("0")).toBe("0");
    expect(formatJsObjectKey("123")).toBe("123");
    expect(formatJsObjectKey("ok")).toBe("ok");
    expect(formatJsObjectKey("$x")).toBe("$x");
    expect(formatJsObjectKey("1.5")).toBe('"1.5"');
    expect(formatJsObjectKey("-1")).toBe('"-1"');
    expect(formatJsObjectKey("1e3")).toBe('"1e3"');
  });

  it("emits valid object literals for leading-zero keys in zod and dts", () => {
    const a = objAbs({ "01": num(), "00": str(), "0": num(), "123": num() });
    const src = absToSchemaSourceForTest(a);
    expect(src).toContain('"01": z.number()');
    expect(src).toContain('"00": z.string()');
    expect(src).toContain("0: z.number()");
    expect(src).toContain("123: z.number()");
    const ts = absToTSType(a);
    expect(ts).toContain('"01": number');
    expect(ts).toContain('"00": string');
    expect(ts).toContain("0: number");
  });
});

function absToSchemaSourceForTest(a: Abs): string {
  return projectAbsToSchema(a).source;
}
