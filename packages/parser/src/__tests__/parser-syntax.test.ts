/**
 * 模块套件：字面量/语法面（数字/字符串/八进制/对象/结构/表达式）。
 */
import { describe, it, expect } from "vitest";
import { extractDirectives, parseCaseArgExpr, runWithDirectiveDiags, type DirectiveDiag, type CaseDirective } from "../directives.ts";
import { litValue, type Abs, formatAbs } from "@nudojs/core";
import { parse } from "../parse.ts";
import type { ClassDeclaration } from "@babel/types";
import { classInstanceMethods, classMemberKeyName, getClassMembers, methodFunctionNode } from "../ast-guards.ts";

const valueOf = (expr: string): unknown => {
  const abs = parseCaseArgExpr(expr);
  if (abs.shape.k !== "prim") return undefined;
  const v = litValue(abs);
  return v.ok ? v.value : undefined;
};

const numOf = (expr: string): number | undefined => {
  const v = valueOf(expr);
  return typeof v === "number" ? v : undefined;
};

function parseWithDiags(expr: string): { abs: Abs; diags: DirectiveDiag[] } {
  const diags: DirectiveDiag[] = [];
  const abs = runWithDirectiveDiags(diags, () => parseCaseArgExpr(expr));
  return { abs, diags };
}

function extractWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(source), { diags });
  return { fns, diags };
}

const caseDirectives = (source: string): CaseDirective[] =>
  extractDirectives(parse(source)).flatMap((f) => f.directives.filter((d): d is CaseDirective => d.kind === "case"));

describe("字符串拼接不是字面量", () => {
  it("拼接落 unknown/never，期望值同口径并告警；单字面量仍接受", () => {
    for (const expr of ['"a" + "b"', '"x" + "y" + "z"', "'a' + 'b'"]) {
      const abs = parseCaseArgExpr(expr);
      expect(["unknown", "never"], expr).toContain(abs.shape.k);
      expect(abs.term, expr).toBeUndefined();
      expect(litValue(abs).ok, expr).toBe(false);
    }
    const src = `/**\n * @nudo:case "a" () => "a" + "b"\n */\nexport function a() { return "ab"; }`;
    const { diags } = extractWithDiags(src);
    expect(diags.some((d) => d.code === "nudo:directive-syntax")).toBe(true);
    const d = caseDirectives(src)[0]!;
    expect(d.expected).toBeDefined();
    expect(["unknown", "never"]).toContain(d.expected!.shape.k);
    expect(litValue(d.expected!).ok).toBe(false);
    expect(litValue(parseCaseArgExpr('"abc"'))).toEqual({ ok: true, value: "abc" });
  });
});

describe("表达式形态字面量", () => {
  it("括号 / 一元 / bigint / 模板 / 进制分隔符按 JS 语义取值", () => {
    const values: Array<[string, unknown]> = [
      ["(7)", 7], ["( 7 )", 7], ["((7))", 7], ["(-7)", -7], ["-(7)", -7], ["+7", 7],
      ["7n", 7n], ["`x`", "x"], ["`hello`", "hello"],
      ["0b1_0", 2], ["0o1_7", 15], ["0x1_F", 31],
    ];
    for (const [expr, value] of values) expect(valueOf(expr), expr).toBe(value);
    const bigint = parseCaseArgExpr("7n");
    expect((bigint.shape as { type: string }).type).toBe("bigint");
    expect(parseCaseArgExpr("`x${1}`").shape.k).toBe("unknown");
  });

  it("case 见证与期望值都保留取值且零诊断", () => {
    const { fns, diags } = extractWithDiags(`/**\n * @nudo:case "paren" ((7))\n * @nudo:case "unary" (- 7)\n * @nudo:case "tpl" (\`x\`)\n * @nudo:case "exp-paren" (1) => (7)\n */\nfunction f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases).toHaveLength(4);
    expect(cases.map((c) => litValue(c.argsAbs[0]!))).toEqual([
      { ok: true, value: 7 }, { ok: true, value: -7 }, { ok: true, value: "x" }, { ok: true, value: 1 },
    ]);
    expect(litValue(cases[3]!.expected!)).toEqual({ ok: true, value: 7 });
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });

  it("非字面量表达式仍不认识", () => {
    for (const expr of ["1 + 2", "a ? b : c", "(1)(2)"]) expect(parseCaseArgExpr(expr).shape.k, expr).toBe("unknown");
  });
});

describe("legacy octal", () => {
  it("前导 0 全八进制按八进制；含 8/9 按 sloppy 十进制；现代进制不变；分隔符非法", () => {
    const octal: Array<[string, number]> = [["017", 15], ["010", 8], ["077", 63], ["00", 0], ["-017", -15]];
    for (const [expr, value] of octal) expect(numOf(expr), expr).toBe(value);
    for (const [expr, value] of [["08", 8], ["09", 9], ["018", 18], ["0o17", 15], ["0b101", 5], ["0x10", 16], ["0", 0]] as const) {
      expect(numOf(expr), expr).toBe(value);
    }
    for (const expr of ["0_1", "01_0"]) expect(parseCaseArgExpr(expr).shape.k, expr).toBe("unknown");
  });

  it("case 见证与期望值按八进制取值", () => {
    const { fns, diags } = extractWithDiags(`/**\n * @nudo:case "legacy" (017)\n * @nudo:case "legacy-exp" (1) => 017\n */\nfunction f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases).toHaveLength(2);
    expect(litValue(cases[0]!.argsAbs[0]!)).toEqual({ ok: true, value: 15 });
    expect(litValue(cases[1]!.expected!)).toEqual({ ok: true, value: 15 });
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });
});

describe("合法 JS 数字写法", () => {
  it("指数 / 进制 / 分隔符 / 前导点 / 尾点 / 一元 / Infinity / NaN", () => {
    const nums: Array<[string, number]> = [
      ["1e3", 1000], ["1e-3", 0.001], ["1E3", 1000], ["1E-3", 0.001], ["1e+3", 1000],
      ["0x10", 16], ["0XFF", 255], ["0b101", 5], ["0o17", 15], ["0O17", 15],
      ["1_000", 1000], ["1_000.5", 1000.5], [".5", 0.5], ["5.", 5], ["+1", 1], ["- 7", -7], ["-1", -1],
      ["Infinity", Infinity], ["-Infinity", -Infinity],
    ];
    for (const [expr, value] of nums) expect(numOf(expr), expr).toBe(value);
    const nan = parseCaseArgExpr("NaN");
    expect(nan.shape.k).toBe("prim");
    const v = litValue(nan);
    expect(v.ok && Number.isNaN(v.value as number)).toBe(true);
  });

  it("case 见证保留数值且零诊断；非法写法仍 unknown", () => {
    const { fns, diags } = extractWithDiags(`/**\n * @nudo:case "exp" (1e3)\n * @nudo:case "hex" (0x10)\n * @nudo:case "sep" (1_000)\n * @nudo:case "lead" (.5)\n */\nfunction f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases.map((c) => litValue(c.argsAbs[0]!))).toEqual([
      { ok: true, value: 1000 }, { ok: true, value: 16 }, { ok: true, value: 1000 }, { ok: true, value: 0.5 },
    ]);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
    for (const expr of ["0_1", "1__0", "0x", "T.number", "bogus()"]) expect(parseCaseArgExpr(expr).shape.k, expr).toBe("unknown");
  });
});

describe("对象字面量属性", () => {
  it("getter / 方法简写 / 简写属性：unknown + 点名诊断；整字面量 fail-closed", () => {
    const cases = [
      { expr: "{ get port() { return 8080; } }", name: "get port" },
      { expr: '{ hello() { return "hi"; } }' },
      { expr: "{ ok }", name: "ok" },
    ];
    for (const { expr, name } of cases) {
      const { abs, diags } = parseWithDiags(expr);
      expect(abs.shape.k, expr).toBe("unknown");
      const hit = diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("Unrecognized property") && (!name || d.message.includes(name)));
      expect(hit, expr).toBe(true);
    }
    expect(parseWithDiags("{ a: 1, ok }").abs.shape.k).toBe("unknown");
  });

  it("含顶层冒号的属性正常解析且零诊断", () => {
    for (const expr of ["{ port: 8080 }", "{ a: { b: 1 } }"]) {
      const { abs, diags } = parseWithDiags(expr);
      expect(abs.shape.k, expr).toBe("obj");
      expect(diags, expr).toHaveLength(0);
    }
  });
});

describe("shape optional 标记投影", () => {
  it("optional / partial 为可选；必选与混合字段保持各自标记", () => {
    const slotsOf = (expr: string) => {
      const abs = parseCaseArgExpr(expr);
      expect(abs.shape.k, expr).toBe("obj");
      return (abs as unknown as { shape: { k: "obj"; slots: Record<string, { optional?: boolean }> } }).shape.slots;
    };
    expect(slotsOf("shape({ a: number().optional() })").a!.optional).toBe(true);
    expect(formatAbs(parseCaseArgExpr("shape({ a: number().optional() })"))).toContain("?");
    expect(slotsOf("partial(shape({ a: number() }))").a!.optional).toBe(true);
    const required = slotsOf("shape({ a: number() })");
    expect(required.a!.optional).toBeUndefined();
    expect(formatAbs(parseCaseArgExpr("shape({ a: number() })"))).not.toContain("?");
    const mixed = slotsOf("shape({ a: number().optional(), b: string() })");
    expect(mixed.a!.optional).toBe(true);
    expect(mixed.b!.optional).toBeUndefined();
  });
});

const STATIC_SRC = `export class Util {\n  static helper(x) { return x; }\n  instanceMethod(y) { return y; }\n}\n`;

describe("静态方法普查", () => {
  it("classInstanceMethods 只收实例方法；getClassMembers 能看见 static 并可取 key/函数体", () => {
    const stmt = parse(STATIC_SRC).program.body[0]!;
    if (stmt.type !== "ExportNamedDeclaration") throw new Error("expected export");
    const decl = stmt.declaration as ClassDeclaration;
    const instances = classInstanceMethods(decl);
    expect(instances.map((m) => m.name)).toEqual(["instanceMethod"]);
    expect(instances[0]!.node.type).toBe("ClassMethod");

    const statics = getClassMembers(decl).filter((m) => (m as { static?: boolean }).static === true);
    expect(statics).toHaveLength(1);
    expect(classMemberKeyName(statics[0]!)).toBe("helper");
    expect(methodFunctionNode(statics[0]!)).toBeDefined();
  });
});

function firstCase(source: string): { name: string; argsAbs: Abs[] } {
  const fns = extractDirectives(parse(source));
  const d = fns[0]?.directives.find((x) => x.kind === "case");
  if (!d || d.kind !== "case") throw new Error("expected case directive");
  return d as { name: string; argsAbs: Abs[] };
}

describe("字符串字面量转义", () => {
  const ESCAPES: Array<[string, string]> = [
    ['"a\\tb"', "a\tb"], ['"a\\nb"', "a\nb"], ['"a\\\\b"', "a\\b"],
    ['"a\\"b"', 'a"b'], ['"\\u0041"', "A"], ['"ab"', "ab"], ["'ab'", "ab"],
  ];

  it("转义按 JS 语义解释，普通单/双引号字符串不变", () => {
    for (const [expr, value] of ESCAPES) expect(litValue(parseCaseArgExpr(expr)), expr).toEqual({ ok: true, value });
  });

  it("case 见证携带 cooked 值，且值里不残留字面反斜杠", () => {
    const d = firstCase(`/**\n * @nudo:case "esc" ("a\\tb")\n */\nexport function f(x) { return x; }`);
    expect(d.argsAbs).toHaveLength(1);
    expect(litValue(d.argsAbs[0]!)).toEqual({ ok: true, value: "a\tb" });
    const lv = litValue(parseCaseArgExpr('"a\\tb"'));
    expect(lv.ok).toBe(true);
    if (!lv.ok) return;
    expect(String(lv.value)).not.toContain("\\");
    expect(String(lv.value).length).toBe(3);
  });
});

describe("结构字面量整段校验", () => {
  it("尾随成员访问 / 加法 / 尾部文本都不折进结构（落 unknown）", () => {
    for (const expr of ["[1][0]", "{ a: 1 } + { b: 2 }", "{ a: 1 }.b", "[1, 2].length", "{ a: 1 } tail"]) {
      expect(parseCaseArgExpr(expr).shape.k, expr).toBe("unknown");
    }
  });

  it("case 期望值尾随文本不折成 tuple/obj，并报 nudo:directive-syntax", () => {
    const diags: DirectiveDiag[] = [];
    const fns = extractDirectives(parse(`/**\n * @nudo:case "d" (1) => [1][0]\n */\nfunction d(x) { return x; }`), { diags });
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases).toHaveLength(1);
    expect(cases[0]!.expected!.shape.k).not.toBe("tuple");
    expect(cases[0]!.expected!.shape.k).not.toBe("obj");
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("[1][0]"))).toBe(true);
  });

  it("纯结构字面量与嵌套结构仍正常解析", () => {
    for (const [expr, kind] of [["{ a: 1 }", "obj"], ["[1, 2]", "tuple"], ["[]", "tuple"], ["{}", "obj"], ["{ a: { b: [1, 2] } }", "obj"]] as const) {
      expect(parseCaseArgExpr(expr).shape.k, expr).toBe(kind);
    }
  });
});
