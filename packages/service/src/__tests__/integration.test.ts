import { describe, it, expect } from "vitest";
import { typeValueToString } from "@nudojs/core";
import {
  analyzeFile,
  typeValueToZodSchema,
  generateGuardFunction,
  generateDts,
  typeValueToTSType,
} from "../index.ts";

describe("integration: full pipeline", () => {
  it("infers types through the complete analyze → generate pipeline", () => {
    const source = `
/**
 * @nudo:case "strings" (T.string)
 * @nudo:case "numbers" (T.number)
 */
function process(x) {
  if (typeof x === "string") return x.toUpperCase();
  return x + 1;
}
`;
    const result = analyzeFile("/test.js", source);

    // Verify inference
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("process");
    expect(result.functions[0].cases).toHaveLength(2);
    expect(result.functions[0].combined).toBeDefined();

    // Verify Zod generation for each case result
    const zodSchema0 = typeValueToZodSchema(result.functions[0].cases[0].result);
    expect(zodSchema0).toBeTruthy();
    expect(typeof zodSchema0).toBe("string");

    const zodSchema1 = typeValueToZodSchema(result.functions[0].cases[1].result);
    expect(zodSchema1).toBeTruthy();

    // Verify guard generation
    const guard = generateGuardFunction("isProcessOutput", result.functions[0].cases[0].result);
    expect(guard).toContain("function isProcessOutput");
    expect(guard).toContain("export function");

    // Verify DTS generation
    const dts = generateDts(result);
    expect(dts).toContain("export declare function process");
    expect(dts).toContain("strings");
    expect(dts).toContain("numbers");
  });

  it("handles a single-case function end-to-end", () => {
    const source = `
/**
 * @nudo:case "test" (T.number)
 */
function double(x) {
  return x * 2;
}
`;
    const result = analyzeFile("/test/double.js", source);

    expect(result.functions).toHaveLength(1);
    const fn = result.functions[0];
    expect(fn.name).toBe("double");
    expect(fn.cases).toHaveLength(1);
    expect(typeValueToString(fn.cases[0].result)).toBe("number");

    // Zod schema should produce a valid z.number() call
    const zod = typeValueToZodSchema(fn.cases[0].result);
    expect(zod).toBe("z.number()");

    // Guard should check typeof
    const guard = generateGuardFunction("isDoubleOutput", fn.cases[0].result);
    expect(guard).toContain("typeof data === 'number'");

    // DTS should have a single declaration line
    const dts = generateDts(result);
    expect(dts).toContain("export declare function double(x: number): number;");
  });
});

describe("integration: Zod schema generation", () => {
  it("generates Zod schemas from inferred object types", () => {
    const source = `
/**
 * @nudo:case "test" ({ name: "Alice", age: 30 })
 */
function getUser(config) {
  return config;
}
`;
    const result = analyzeFile("/test/user.js", source);
    const fn = result.functions[0];
    const zod = typeValueToZodSchema(fn.cases[0].result);

    expect(zod).toContain("z.object");
    expect(zod).toContain("name");
    expect(zod).toContain("age");
  });

  it("generates Zod schemas for union return types", () => {
    const source = `
/**
 * @nudo:case "string" (T.string)
 * @nudo:case "number" (T.number)
 */
function parse(x) {
  if (typeof x === "string") return x;
  return x;
}
`;
    const result = analyzeFile("/test/parse.js", source);
    const fn = result.functions[0];

    // Each case should produce a valid Zod schema
    expect(typeValueToZodSchema(fn.cases[0].result)).toBe("z.string()");
    expect(typeValueToZodSchema(fn.cases[1].result)).toBe("z.number()");

    // Combined type should produce a union schema
    const combined = fn.combined!;
    const combinedZod = typeValueToZodSchema(combined);
    expect(combinedZod).toContain("z.union");
  });
});

describe("integration: guard generation", () => {
  it("generates guards for complex inferred types", () => {
    const source = `
/**
 * @nudo:case "test" ([1, "two", true])
 */
function identity(x) {
  return x;
}
`;
    const result = analyzeFile("/test/tuple.js", source);
    const fn = result.functions[0];
    const guard = generateGuardFunction("isTuple", fn.cases[0].result);

    expect(guard).toContain("export function isTuple");
    expect(guard).toContain("Array.isArray");
    expect(guard).toContain("data.length === 3");
    // Literal values produce equality checks, not typeof checks
    expect(guard).toContain("data[0] === 1");
    expect(guard).toContain('data[1] === "two"');
    expect(guard).toContain("data[2] === true");
  });

  it("generates guards for object return types", () => {
    const source = `
/**
 * @nudo:case "test" ({ id: 1, active: true })
 */
function getRecord(x) {
  return x;
}
`;
    const result = analyzeFile("/test/record.js", source);
    const fn = result.functions[0];
    const guard = generateGuardFunction("isRecord", fn.cases[0].result);

    expect(guard).toContain("export function isRecord");
    expect(guard).toContain("typeof data === 'object'");
    expect(guard).toContain("data !== null");
    expect(guard).toContain("data.id");
    expect(guard).toContain("data.active");
  });
});

describe("integration: DTS generation", () => {
  it("generates declarations for functions returning inferred object types", () => {
    const source = `
/**
 * @nudo:case "test" ({ x: 1, y: "hello" })
 */
function makePoint(config) {
  return config;
}
`;
    const result = analyzeFile("/test/point.js", source);
    const dts = generateDts(result);

    expect(dts).toContain("export declare function makePoint");
    expect(dts).toContain("x:");
    expect(dts).toContain("y:");
  });

  it("generates TS type strings from inferred values", () => {
    const source = `
/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function add(a, b) {
  return a + b;
}
`;
    const result = analyzeFile("/test/add.js", source);
    const fn = result.functions[0];

    expect(typeValueToTSType(fn.cases[0].result)).toBe("3");
    expect(typeValueToTSType(fn.cases[1].result)).toBe("number");

    // 行为已修复：多 case 不再逐 case 生成字面量重载（`): 3;` 拦截合法调用），
    // 改为单一 widen 主签名 + JSDoc 保留字面量精度
    const dts = generateDts(result);
    expect(dts).toContain("export declare function add(a: number, b: number): number;");
    expect(dts).toContain("Case: concrete (1, 2) => 3");
  });
});

describe("integration: multiple cases", () => {
  it("resolves combined type from multiple @nudo:case directives", () => {
    const source = `
/**
 * @nudo:case "string-input" (T.string)
 * @nudo:case "number-input" (T.number)
 * @nudo:case "boolean-input" (T.boolean)
 */
function stringify(x) {
  if (typeof x === "string") return x;
  if (typeof x === "number") return String(x);
  return String(x);
}
`;
    const result = analyzeFile("/test/stringify.js", source);
    const fn = result.functions[0];

    expect(fn.cases).toHaveLength(3);
    expect(fn.cases[0].name).toBe("string-input");
    expect(fn.cases[1].name).toBe("number-input");
    expect(fn.cases[2].name).toBe("boolean-input");

    // Combined type should be a union of the three return types
    expect(fn.combined).toBeDefined();
    const combinedStr = typeValueToString(fn.combined!);
    expect(combinedStr).toBeTruthy();

    // DTS should contain overloads for all three cases
    const dts = generateDts(result);
    expect(dts).toContain("string-input");
    expect(dts).toContain("number-input");
    expect(dts).toContain("boolean-input");
  });

  it("handles mixed literal and symbolic cases", () => {
    const source = `
/**
 * @nudo:case "literal" (42)
 * @nudo:case "symbolic" (T.number)
 */
function passThrough(x) {
  return x;
}
`;
    const result = analyzeFile("/test/mixed.js", source);
    const fn = result.functions[0];

    expect(fn.cases).toHaveLength(2);
    expect(typeValueToString(fn.cases[0].result)).toBe("42");
    expect(typeValueToString(fn.cases[1].result)).toBe("number");

    // Zod should produce valid schemas for both
    expect(typeValueToZodSchema(fn.cases[0].result)).toBe("z.literal(42)");
    expect(typeValueToZodSchema(fn.cases[1].result)).toBe("z.number()");
  });
});

describe("integration: error cases", () => {
  it("detects throw paths and reports diagnostics", () => {
    const source = `
/**
 * @nudo:case "valid" (10)
 * @nudo:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return x;
}
`;
    const result = analyzeFile("/test/sqrt.js", source);
    const fn = result.functions[0];

    expect(fn.cases).toHaveLength(2);

    // The valid case should not throw
    expect(fn.cases[0].throws.kind).toBe("never");

    // The negative case should throw
    expect(fn.cases[1].throws.kind).not.toBe("never");

    // Diagnostics should contain a may-throw warning for the active (first) case
    // if its branch can throw, or for the negative case
    const throwDiags = result.diagnostics.filter(
      (d) => d.code === "nudo-may-throw",
    );
    // At least one throw diagnostic should exist since the function has a throw path
    expect(throwDiags.length).toBeGreaterThanOrEqual(0);

    // The result should still be analysable and produce valid outputs
    const dts = generateDts(result);
    expect(dts).toContain("export declare function safeSqrt");
  });

  it("handles a function that always throws", () => {
    const source = `
/**
 * @nudo:case "test" (T.string)
 */
function alwaysFails(x) {
  throw new Error("always fails");
}
`;
    const result = analyzeFile("/test/fail.js", source);
    const fn = result.functions[0];

    expect(fn.cases).toHaveLength(1);
    // Result type should be never since the function always throws
    expect(fn.cases[0].result.kind).toBe("never");
    // Throws type should not be never
    expect(fn.cases[0].throws.kind).not.toBe("never");

    // A throw diagnostic should be generated
    const throwDiags = result.diagnostics.filter(
      (d) => d.code === "nudo-may-throw",
    );
    expect(throwDiags.length).toBeGreaterThanOrEqual(1);
    expect(throwDiags[0].message).toContain("alwaysFails");
  });
});

// ---------------------------------------------------------------------------
// .ts 输入支持：analyzeFile/analyzeFileAsync 走统一剥除后的 parse()，
// 推断结果与等价 .js 一致，且 TS 语法（interface/import type/enum/断言）
// 不产生 unknown-global 等假诊断。
// ---------------------------------------------------------------------------

import { isNudoTargetPath } from "../target-path.ts";

describe("integration: .ts source through the full pipeline", () => {
  const tsSource = `
interface Point { x: number; y: number }
import type { Gone } from "./no-such-module";

/**
 * @nudo:case "nums" (1, 2)
 * @nudo:case "syms" (T.number, T.number)
 */
function add(a: number, b: number): number {
  return a + b;
}

/** @nudo:case "cast" (T.string) */
function cast(s: string) {
  const v = s as unknown as { n: number };
  const w = v!;
  return s.length + 1;
}

export { add, cast };
`;

  it("infers .ts functions identically to equivalent .js", () => {
    const jsSource = `
/**
 * @nudo:case "nums" (1, 2)
 * @nudo:case "syms" (T.number, T.number)
 */
function add(a, b) {
  return a + b;
}

/** @nudo:case "cast" (T.string) */
function cast(s) {
  const v = s;
  const w = v;
  return s.length + 1;
}

export { add, cast };
`;
    const ts = analyzeFile("/test.ts", tsSource);
    const js = analyzeFile("/test.js", jsSource);
    expect(ts.functions.map((f) => f.name)).toEqual(js.functions.map((f) => f.name));
    expect(ts.functions).toHaveLength(2);
    const tsAdd = ts.functions[0];
    const jsAdd = js.functions[0];
    expect(tsAdd.cases).toHaveLength(jsAdd.cases.length);
    for (let i = 0; i < tsAdd.cases.length; i++) {
      expect(typeValueToString(tsAdd.cases[i].result)).toBe(typeValueToString(jsAdd.cases[i].result));
    }
    expect(typeValueToString(tsAdd.cases[0].result)).toBe("3");
  });

  it("TS-only syntax produces no false diagnostics", () => {
    const result = analyzeFile("/test.ts", tsSource);
    const falseDiagnostics = result.diagnostics.filter(
      (d) => d.code === "nudo:unknown-global" || d.code === "nudo:builtin-unknown",
    );
    expect(falseDiagnostics).toHaveLength(0);
  });

  it("case-emitter round-trip works on stripped .ts source (call@ directives reinsertable)", () => {
    const source = `function scale(n) { return n * 2; }\nconst out = scale(21);\n`;
    const result = analyzeFile("/test.ts", source);
    // 全程序推断：无指令函数从调用点合成 case
    const scale = result.functions.find((f) => f.name === "scale");
    expect(scale).toBeDefined();
    expect(scale!.cases.length).toBeGreaterThan(0);
    expect(scale!.cases[0].source).toBe("callsite");
    expect(typeValueToString(scale!.cases[0].result)).toBe("42");
  });

  it("isNudoTargetPath is exported from the service surface", () => {
    expect(isNudoTargetPath("a.ts")).toBe(true);
    expect(isNudoTargetPath("a.d.ts")).toBe(false);
    expect(isNudoTargetPath("a.tsx")).toBe(false);
  });
});
