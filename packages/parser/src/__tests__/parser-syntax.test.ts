/**
 * 模块套件：字面量/语法面（数字/字符串/八进制/对象/结构/表达式）。
 */
import { describe, it, expect } from "vitest";
import { extractDirectives, parseCaseArgExpr, runWithDirectiveDiags, type DirectiveDiag, type CaseDirective } from "../directives.ts";
import { litValue, type Abs, formatAbs } from "@nudojs/core";
import { parse } from "../parse.ts";
import type { ClassDeclaration } from "@babel/types";
import { classInstanceMethods, classMemberKeyName, getClassMembers, methodFunctionNode } from "../ast-guards.ts";

// ---------------------------------------------------------------------------
// string concatenation is not a string literal
// ---------------------------------------------------------------------------
describe("string concatenation is not a string literal", () => {
/**
 * 回归：`@nudo:case` **期望值**面的字符串字面量**贪婪切片**。
 *
 * 旧实现的守卫只做 `startsWith(quote) && endsWith(quote)` ⇒ `"a" + "b"`
 * 的首引号在 0、末引号在末尾 ⇒ `slice(1, -1)` 把**两个独立字面量之间的
 * 运算符文本**一起吞进值里 ⇒ 折出 `a" + "b`（谁也没写过的**自信错值**）
 * ⇒ 断言假红，诊断里的 expected 是一段无意义文本。
 *
 * 修法：字符串分支先确认整段文本**就是**一个字符串字面量
 * （词法边界判定，见 `directives/string-literal.ts`），否则当「不认识」
 * （unknown + nudo:directive-syntax 诊断），不再折出错值。
 */





describe("string concatenation is not a string literal", () => {
  it("does not fold \"a\" + \"b\" into a literal value", () => {
    const abs = parseCaseArgExpr('"a" + "b"');
    expect(["unknown", "never"]).toContain(abs.shape.k);
    expect(abs.term).toBeUndefined();
    expect(litValue(abs).ok).toBe(false);
  });

  it("does not fold longer concatenations either", () => {
    expect(parseCaseArgExpr('"x" + "y" + "z"').shape.k).toBe("unknown");
    expect(parseCaseArgExpr("'a' + 'b'").shape.k).toBe("unknown");
  });

  it("expected value of a case directive is unknown, not a wrong string", () => {
    const src = `
/**
 * @nudo:case "a" () => "a" + "b"
 */
export function a() { return "ab"; }
`;
    const fns = extractDirectives(parse(src));
    const d = fns[0]?.directives.find((x) => x.kind === "case");
    expect(d).toBeDefined();
    if (!d || d.kind !== "case") return;
    const expected = d.expected as Abs | undefined;
    expect(expected).toBeDefined();
    // 「解析失败」的表示：unknown（不认识）或 never（断言面 fail-closed 表示）——
    // 两种都不是**自信的错值**（绝不等于 `a" + "b`）。
    expect(["unknown", "never"]).toContain(expected!.shape.k);
    expect(litValue(expected!).ok).toBe(false);
  });

  it("emits nudo:directive-syntax for the unrecognized expected value", () => {
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => {
      extractDirectives(
        parse(`
/**
 * @nudo:case "a" () => "a" + "b"
 */
export function a() { return "ab"; }
`),
      );
    });
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some((d) => d.code === "nudo:directive-syntax")).toBe(true);
  });

  it("a single literal is still accepted", () => {
    expect(litValue(parseCaseArgExpr('"abc"'))).toEqual({ ok: true, value: "abc" });
  });
});
});

// ---------------------------------------------------------------------------
// 表达式形态的字面量（括号 / 一元 / 模板 / bigint）必须被解析
// ---------------------------------------------------------------------------
describe("表达式形态的字面量（括号 / 一元 / 模板 / bigint）必须被解析", () => {
/**
 * 回归：case 见证 / 期望值的**表达式形态**（括号 / 一元 / 模板字面量 /
 * bigint / 进制内分隔符）落 unknown —— 而 unknown 是顶类型
 * （`leqAbs(actual, unknown)` 恒 ok）⇒ 断言**空洞通过**（期望侧）与
 * 见证满足任何契约（见证侧）= 假绿。
 *
 * 修法：按 JS 字面量语义解析这些形态（括号 / 一元 ± / 无插值模板 / bigint）。
 */






function valueOf(expr: string): unknown {
  const abs = parseCaseArgExpr(expr);
  if (abs.shape.k !== "prim") return undefined;
  const v = litValue(abs);
  return v.ok ? v.value : undefined;
}

function extractWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(source), { diags });
  return { fns, diags };
}

describe("表达式形态的字面量（括号 / 一元 / 模板 / bigint）必须被解析", () => {
  it("括号包裹与一元符号", () => {
    expect(valueOf("(7)")).toBe(7);
    expect(valueOf("( 7 )")).toBe(7);
    expect(valueOf("((7))")).toBe(7);
    expect(valueOf("(-7)")).toBe(-7);
    expect(valueOf("-(7)")).toBe(-7);
    expect(valueOf("-(7)")).toBe(-7);
    expect(valueOf("+7")).toBe(7);
  });

  it("bigint 字面量（7n）保留 bigint 类型与值", () => {
    const abs = parseCaseArgExpr("7n");
    expect(abs.shape.k).toBe("prim");
    expect((abs.shape as { type: string }).type).toBe("bigint");
    expect(valueOf("7n")).toBe(7n);
  });

  it("无插值模板字面量 ⇒ 字符串字面量", () => {
    expect(valueOf("`x`")).toBe("x");
    expect(valueOf("`hello`")).toBe("hello");
    // 有插值 ⇒ 不是字面量 ⇒ 不认识
    expect(parseCaseArgExpr("`x${1}`").shape.k).toBe("unknown");
  });

  it("进制内的数字分隔符", () => {
    expect(valueOf("0b1_0")).toBe(2);
    expect(valueOf("0o1_7")).toBe(15);
    expect(valueOf("0x1_F")).toBe(31);
  });

  it("case 见证 / 期望值不再落 unknown（空洞通过的根因）", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "paren" ((7))
 * @nudo:case "unary" (- 7)
 * @nudo:case "tpl" (\`x\`)
 * @nudo:case "exp-paren" (1) => (7)
 */
function f(x) { return x; }`);
    const cases = fns.flatMap(
      (f) => f.directives.filter((d) => d.kind === "case"),
    ) as CaseDirective[];
    expect(cases).toHaveLength(4);
    expect(litValue(cases[0]!.argsAbs[0]!)).toEqual({ ok: true, value: 7 });
    expect(litValue(cases[1]!.argsAbs[0]!)).toEqual({ ok: true, value: -7 });
    expect(litValue(cases[2]!.argsAbs[0]!)).toEqual({ ok: true, value: "x" });
    expect(litValue(cases[3]!.expected!)).toEqual({ ok: true, value: 7 });
    // 合法形态不再发「不认识这个表达式」诊断
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });

  it("非字面量的表达式仍不认识（不折错值）", () => {
    expect(parseCaseArgExpr("1 + 2").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("a ? b : c").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("(1)(2)").shape.k).toBe("unknown");
  });
});
});

// ---------------------------------------------------------------------------
// legacy octal 按八进制取值（不再按十进制读成错值）
// ---------------------------------------------------------------------------
describe("legacy octal 按八进制取值（不再按十进制读成错值）", () => {
/**
 * 回归：legacy octal（`0` 开头 + 全八进制数字）被 `Number("017")`
 * 按**十进制**读成 17（native sloppy 是 15 = 八进制）⇒ 见证 / 期望值折出
 * **自信的错值**（假红 / 假绿）。
 *
 * 修法：按 JS 字面量语义解析 —— 前导 0 ⇒ 八进制（`017` → 15）；含 8/9 ⇒
 * sloppy 十进制（`08` → 8）；分隔符跟在多位数前导 0 后面是 JS 语法错 ⇒ 不认识。
 */






function numOf(expr: string): number | undefined {
  const abs = parseCaseArgExpr(expr);
  if (abs.shape.k !== "prim") return undefined;
  const v = litValue(abs);
  return v.ok && typeof v.value === "number" ? v.value : undefined;
}

function extractWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(source), { diags });
  return { fns, diags };
}

describe("legacy octal 按八进制取值（不再按十进制读成错值）", () => {
  it("0 开头 + 全八进制数字 ⇒ 八进制", () => {
    expect(numOf("017")).toBe(15);
    expect(numOf("010")).toBe(8);
    expect(numOf("077")).toBe(63);
    expect(numOf("00")).toBe(0);
    expect(numOf("-017")).toBe(-15);
  });

  it("0 开头且含 8/9 ⇒ sloppy 十进制（与 native sloppy 一致）", () => {
    expect(numOf("08")).toBe(8);
    expect(numOf("09")).toBe(9);
    expect(numOf("018")).toBe(18);
  });

  it("现代进制字面量不受影响（0o / 0b / 0x）", () => {
    expect(numOf("0o17")).toBe(15);
    expect(numOf("0b101")).toBe(5);
    expect(numOf("0x10")).toBe(16);
    expect(numOf("0")).toBe(0);
  });

  it("分隔符跟在多位数前导 0 后面是 JS 语法错 ⇒ 不认识（不折错值）", () => {
    expect(parseCaseArgExpr("0_1").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("01_0").shape.k).toBe("unknown");
  });

  it("case 见证 / 期望值按八进制取值", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "legacy" (017)
 * @nudo:case "legacy-exp" (1) => 017
 */
function f(x) { return x; }`);
    const cases = fns.flatMap(
      (f) => f.directives.filter((d) => d.kind === "case"),
    ) as CaseDirective[];
    expect(cases).toHaveLength(2);
    expect(litValue(cases[0]!.argsAbs[0]!)).toEqual({ ok: true, value: 15 });
    expect(litValue(cases[1]!.expected!)).toEqual({ ok: true, value: 15 });
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });
});
});

// ---------------------------------------------------------------------------
// 合法 JS 数字写法必须被解析（不再落 unknown）
// ---------------------------------------------------------------------------
describe("合法 JS 数字写法必须被解析（不再落 unknown）", () => {
/**
 * 回归：case 实参 / 期望值的数字文法只认一条十进制正则
 * （/^-?\d+(\.\d+)?$/）⇒ 指数 / 进制 / 分隔符 / 前导点 / 尾点 / 一元 等
 * **合法** JS 数字写法全部落 unknown —— 而 unknown 是顶类型
 * （`leqAbs(actual, unknown)` 恒 ok）⇒ 见证满足任何契约 = 假绿。
 *
 * 修法：按 **JS 字面量语义** 解析（指数 / 进制 / 分隔符 / 前导点 / 尾点 /
 * 一元 / 括号 / bigint / Infinity / NaN 全部覆盖）。
 */






function numOf(expr: string): number | undefined {
  const abs = parseCaseArgExpr(expr);
  if (abs.shape.k !== "prim") return undefined;
  const v = litValue(abs);
  return v.ok && typeof v.value === "number" ? v.value : undefined;
}

function extractWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(source), { diags });
  return { fns, diags };
}

describe("合法 JS 数字写法必须被解析（不再落 unknown）", () => {
  it("指数 / 进制 / 分隔符 / 前导点 / 尾点 / 一元正号", () => {
    expect(numOf("1e3")).toBe(1000);
    expect(numOf("1e-3")).toBe(0.001);
    expect(numOf("1E3")).toBe(1000);
    expect(numOf("1E-3")).toBe(0.001);
    expect(numOf("1e+3")).toBe(1000);
    expect(numOf("0x10")).toBe(16);
    expect(numOf("0XFF")).toBe(255);
    expect(numOf("0b101")).toBe(5);
    expect(numOf("0o17")).toBe(15);
    expect(numOf("0O17")).toBe(15);
    expect(numOf("1_000")).toBe(1000);
    expect(numOf("1_000.5")).toBe(1000.5);
    expect(numOf(".5")).toBe(0.5);
    expect(numOf("5.")).toBe(5);
    expect(numOf("+1")).toBe(1);
    expect(numOf("- 7")).toBe(-7);
    expect(numOf("-1")).toBe(-1);
  });

  it("Infinity / NaN 是数值常量形态（不再落 unknown）", () => {
    expect(numOf("Infinity")).toBe(Infinity);
    expect(numOf("-Infinity")).toBe(-Infinity);
    const nan = parseCaseArgExpr("NaN");
    expect(nan.shape.k).toBe("prim");
    const v = litValue(nan);
    expect(v.ok && Number.isNaN(v.value as number)).toBe(true);
  });

  it("case 见证值不再是 unknown（假绿根因：见证满足任何契约）", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "exp" (1e3)
 * @nudo:case "hex" (0x10)
 * @nudo:case "sep" (1_000)
 * @nudo:case "lead" (.5)
 */
function f(x) { return x; }`);
    const cases = fns.flatMap(
      (f) => f.directives.filter((d) => d.kind === "case"),
    ) as CaseDirective[];
    expect(cases).toHaveLength(4);
    const values = cases.map((c) => litValue(c.argsAbs[0]!));
    expect(values.map((v) => (v.ok ? v.value : "<none>"))).toEqual([
      1000,
      16,
      1000,
      0.5,
    ]);
    // 合法写法不再发「不认识这个表达式」诊断
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });

  it("非法写法仍落 unknown（不折出自信的错值）", () => {
    expect(parseCaseArgExpr("0_1").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("1__0").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("0x").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("T.number").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("bogus()").shape.k).toBe("unknown");
  });
});
});

// ---------------------------------------------------------------------------
// object literal properties without a top-level colon are not silently dropped
// ---------------------------------------------------------------------------
describe("object literal properties without a top-level colon are not silently dropped", () => {
/**
 * 回归：对象字面量里**无顶层冒号**的属性（getter / 方法简写 /
 * 简写属性）不得被**静默丢弃**。
 *
 * 改前 `parseObjectLiteral` 对 `findTopLevelColon(entry) === -1` 直接
 * `continue` ⇒ 该属性从 mock 值 / 期望值里**无声消失** ⇒ mock 变成
 * **自信的错值**（`cfg.port` 读出 `undefined` 而不是 8080）且**零诊断**。
 *
 * 改后：点名报 nudo:directive-syntax（属性未被识别）+ 整个字面量判
 * 「不认识」（unknown，fail-closed）——不再悄悄地少掉属性。
 */



function parseWithDiags(expr: string): { abs: ReturnType<typeof parseCaseArgExpr>; diags: DirectiveDiag[] } {
  const diags: DirectiveDiag[] = [];
  const abs = runWithDirectiveDiags(diags, () => parseCaseArgExpr(expr));
  return { abs, diags };
}

describe("object literal properties without a top-level colon are not silently dropped", () => {
  it("getter property → unknown + named diagnostic", () => {
    const { abs, diags } = parseWithDiags("{ get port() { return 8080; } }");
    expect(abs.shape.k).toBe("unknown");
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:directive-syntax" &&
          d.message.includes("Unrecognized property") &&
          d.message.includes("get port"),
      ),
    ).toBe(true);
  });

  it("method shorthand → unknown + named diagnostic", () => {
    const { abs, diags } = parseWithDiags('{ hello() { return "hi"; } }');
    expect(abs.shape.k).toBe("unknown");
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:directive-syntax" && d.message.includes("Unrecognized property"),
      ),
    ).toBe(true);
  });

  it("shorthand property → unknown + named diagnostic", () => {
    const { abs, diags } = parseWithDiags("{ ok }");
    expect(abs.shape.k).toBe("unknown");
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:directive-syntax" &&
          d.message.includes("Unrecognized property") &&
          d.message.includes("ok"),
      ),
    ).toBe(true);
  });

  it("a single unsupported property rejects the whole literal (fail-closed, no half-value)", () => {
    const { abs } = parseWithDiags("{ a: 1, ok }");
    expect(abs.shape.k).toBe("unknown");
  });

  it("properties with a top-level colon still parse and stay diagnostic-free", () => {
    const { abs, diags } = parseWithDiags("{ port: 8080 }");
    expect(abs.shape.k).toBe("obj");
    expect(diags).toHaveLength(0);
    const nested = parseWithDiags("{ a: { b: 1 } }");
    expect(nested.abs.shape.k).toBe("obj");
    expect(nested.diags).toHaveLength(0);
  });
});
});

// ---------------------------------------------------------------------------
// shape optional flag is projected into the case-arg slot
// ---------------------------------------------------------------------------
describe("shape optional flag is projected into the case-arg slot", () => {
/**
 * 回归：`@nudo:case` **期望值**里的 shape 槽必须保留 **optional** 标记。
 *
 * 改前 `constraintToCaseArgAbs` 只投影 `field.constraint`、丢掉
 * `field.optional` ⇒ 期望 Abs 里可选槽变**必填** ⇒ 缺该字段的**合法**
 * 实际值被判 `[FAIL]`（该绿却红），且报出的 `expected` 文案不带 `?`
 * ——而契约（侧车）面同一文法正确 ⇒ 两面自相矛盾。
 *
 * 改后：与 core 的 `constraintToEntryAbs` 同口径，把 optional 写进槽位。
 */




function slotsOf(expr: string): Record<string, { value: unknown; optional?: boolean }> {
  const abs = parseCaseArgExpr(expr);
  expect(abs.shape.k).toBe("obj");
  if (abs.shape.k !== "obj") throw new Error(`not an object: ${expr}`);
  return abs.shape.slots;
}

describe("shape optional flag is projected into the case-arg slot", () => {
  it("shape({ a: number().optional() }) → optional slot", () => {
    const slots = slotsOf("shape({ a: number().optional() })");
    expect(slots.a!.optional).toBe(true);
    // 展示面同步带出 `?`
    expect(formatAbs(parseCaseArgExpr("shape({ a: number().optional() })"))).toContain("?");
  });

  it("partial(shape({ a: number() })) → optional slot", () => {
    const slots = slotsOf("partial(shape({ a: number() }))");
    expect(slots.a!.optional).toBe(true);
  });

  it("required field stays required (no over-widening)", () => {
    const slots = slotsOf("shape({ a: number() })");
    expect(slots.a!.optional).toBeUndefined();
    expect(formatAbs(parseCaseArgExpr("shape({ a: number() })"))).not.toContain("?");
  });

  it("mixed shape keeps per-field optional flags", () => {
    const slots = slotsOf("shape({ a: number().optional(), b: string() })");
    expect(slots.a!.optional).toBe(true);
    expect(slots.b!.optional).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// static method census — parser contract + service-side precondition
// ---------------------------------------------------------------------------
describe("static method census — parser contract + service-side precondition", () => {
/**
 * 判定钉：静态类方法在**两套**类成员收集器上口径相反。
 *
 * - core 的 `scan-top-functions`（`nudo check` 签名面）**收**静态方法
 * （注释明写「static 与实例方法同为入口可见」）；
 * - parser 的 `classInstanceMethods`（`ast-guards.ts`）**跳过** static
 * ⇒ service 的 `collectClassMethods`（`analyzer-ast.ts`）构造出的
 * `analysis.functions` 里静态方法**不存在** ⇒ `nudo test` / `nudo health`
 * / `nudo contract` 的函数普查与 `nudo check` 不一致。
 *
 * **裁决（主 agent）**：走 service 侧，用**已导出**的 `getClassMembers`
 * 自行收集 static ⇒ **不改** parser 已发布符号 `classInstanceMethods` 的
 * 契约（其 doc 明写「Skips … static members」），parser 导出面零变化。
 *
 * 本钉因此钉住两件事：
 * ① parser 侧契约**不变**：`classInstanceMethods` 只收实例方法
 * （防止有人顺手改语义，把 service 侧收口的前提改掉）；
 * ② service 侧收口所需的**能力**已在 parser 导出面就位：
 * `getClassMembers` **能看见** static 成员，且
 * `classMemberKeyName` / `methodFunctionNode` 能读出它的 key 与函数体
 * ——否则 service 侧无从收口（这正是本条的真落点）。
 */





const src = `
export class Util {
  static helper(x) { return x; }
  instanceMethod(y) { return y; }
}
`;

function utilClass(): ClassDeclaration {
  const ast = parse(src);
  const stmt = ast.program.body[0]!;
  if (stmt.type !== "ExportNamedDeclaration") throw new Error("expected export");
  const decl = stmt.declaration;
  if (!decl || decl.type !== "ClassDeclaration") throw new Error("expected class");
  return decl;
}

describe("static method census — parser contract + service-side precondition", () => {
  it("parser contract unchanged: classInstanceMethods skips static members", () => {
    const members = classInstanceMethods(utilClass());
    expect(members.map((m) => m.name)).toEqual(["instanceMethod"]);
  });

  it("service-side precondition: getClassMembers sees the static member", () => {
    const members = getClassMembers(utilClass());
    const statics = members.filter(
      (m) => (m as { static?: boolean }).static === true,
    );
    expect(statics).toHaveLength(1);
    expect(classMemberKeyName(statics[0]!)).toBe("helper");
    // 函数体可取（service 侧据此建 analysis.functions 条目）
    expect(methodFunctionNode(statics[0]!)).toBeDefined();
  });

  it("service-side precondition: instance member is visible too", () => {
    const members = classInstanceMethods(utilClass());
    expect(members.map((m) => m.name)).toEqual(["instanceMethod"]);
    expect(members[0]!.node.type).toBe("ClassMethod");
  });
});
});

// ---------------------------------------------------------------------------
// 字符串字面量转义与结构字面量整段校验
// ---------------------------------------------------------------------------
function firstCase(source: string): { name: string; argsAbs: Abs[] } {
  const fns = extractDirectives(parse(source));
  const d = fns[0]?.directives.find((x) => x.kind === "case");
  if (!d || d.kind !== "case") throw new Error("expected case directive");
  return d as { name: string; argsAbs: Abs[] };
}

describe("字符串字面量转义", () => {
  const ESCAPES = [
    { expr: '"a\\tb"', value: "a\tb" },
    { expr: '"a\\nb"', value: "a\nb" },
    { expr: '"a\\\\b"', value: "a\\b" },
    { expr: '"a\\"b"', value: 'a"b' },
    { expr: '"\\u0041"', value: "A" },
    { expr: '"ab"', value: "ab" },
    { expr: "'ab'", value: "ab" },
  ];

  it("转义按 JS 语义解释，普通单/双引号字符串不变", () => {
    for (const { expr, value } of ESCAPES) {
      expect(litValue(parseCaseArgExpr(expr)), expr).toEqual({ ok: true, value });
    }
  });

  it("case 见证携带 cooked 值，且值里不残留字面反斜杠", () => {
    const d = firstCase(`
/**
 * @nudo:case "esc" ("a\\tb")
 */
export function f(x) { return x; }
`);
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
    const fns = extractDirectives(
      parse(`/**
 * @nudo:case "d" (1) => [1][0]
 */
function d(x) { return x; }`),
      { diags },
    );
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases).toHaveLength(1);
    expect(cases[0]!.expected!.shape.k).not.toBe("tuple");
    expect(cases[0]!.expected!.shape.k).not.toBe("obj");
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("[1][0]"))).toBe(true);
  });

  it("纯结构字面量与嵌套结构仍正常解析", () => {
    expect(parseCaseArgExpr("{ a: 1 }").shape.k).toBe("obj");
    expect(parseCaseArgExpr("[1, 2]").shape.k).toBe("tuple");
    expect(parseCaseArgExpr("[]").shape.k).toBe("tuple");
    expect(parseCaseArgExpr("{}").shape.k).toBe("obj");
    expect(parseCaseArgExpr("{ a: { b: [1, 2] } }").shape.k).toBe("obj");
  });
});
