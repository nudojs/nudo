/**
 * FIX-D1 回归：F-3-silent-drop-malformed-directives 11 类实例。
 * 非法/边界形态发 nudo:directive-syntax / nudo:contract-syntax 显式诊断，
 * 或合法解析——不再静默丢弃。
 *
 * 同时覆盖 I2：parseCaseArgExpr 静默 fallback 不再无声。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import {
  extractDirectives,
  extractDirectivesQuiet,
  extractInlineDirectives,
  parseCaseArgExpr,
  runWithDirectiveDiags,
  type DirectiveDiag,
} from "../directives.ts";
import type { CaseDirective, MockDirective, SkipDirective, AsDirective, ReplaceDirective } from "../directives.ts";

function extractWithDiags(source: string) {
  const ast = parse(source);
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(ast, { diags });
  return { fns, diags };
}

function extractInlineWithDiags(source: string) {
  const ast = parse(source);
  const stmt = (ast as any).program.body[0];
  const diags: DirectiveDiag[] = [];
  const dirs = extractInlineDirectives(stmt, { diags });
  return { dirs, diags };
}

describe("malformed case names", () => {
  const INVALID = [
    { name: "单引号 name", line: `@nudo:case 't' (1)`, message: "single-quoted" },
    { name: "空 name", line: `@nudo:case "" (1)` },
    { name: "name 内转义引号", line: `@nudo:case "a\\"b" (2)`, forbidName: "a\\" },
  ];

  it("非法 name：有诊断、无干净 case", () => {
    for (const { name, line, message, forbidName } of INVALID) {
      const { fns, diags } = extractWithDiags(`/**\n * ${line}\n */\nfunction f(x) { return x; }`);
      const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
      expect(diags.some((d) => d.code === "nudo:directive-syntax"), name).toBe(true);
      if (message) expect(diags.some((d) => d.message.includes(message)), name).toBe(true);
      if (forbidName) for (const c of cases) expect(c.name, name).not.toBe(forbidName);
      else expect(cases, name).toHaveLength(0);
    }
  });

  it("合法双引号 name：静默接受", () => {
    const { fns, diags } = extractWithDiags(`/**\n * @nudo:case "ok" (1)\n */\nfunction f(x) { return x; }`);
    expect(fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"))).toHaveLength(1);
    expect(diags).toHaveLength(0);
  });
});

describe("mock names", () => {
  it("Unicode 与 ASCII 标识符都是合法解析，零诊断", () => {
    const { fns, diags } = extractWithDiags(`/**\n * @nudo:mock 变量 = 1\n * @nudo:mock café = 2\n * @nudo:mock _ok = 3\n */\nfunction f(x) { return x; }`);
    const mocks = fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock")) as MockDirective[];
    expect(mocks.map((m) => m.name).sort()).toEqual(["_ok", "café", "变量"]);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });

  it("非标识符 name：诊断且不产 mock", () => {
    const { fns, diags } = extractWithDiags(`/**\n * @nudo:mock foo-bar = 1\n */\nfunction f(x) { return x; }`);
    expect(fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock"))).toHaveLength(0);
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("not a valid identifier"))).toBe(true);
  });
});

describe("skip 返回位语法", () => {
  const CASES = [
    { name: "散文", line: "@nudo:skip this function is flaky", returns: "undefined" },
    { name: "裸类型是散文", line: "@nudo:skip number()", returns: "undefined" },
    { name: "无参数", line: "@nudo:skip", returns: "undefined" },
    { name: "箭头显式类型", line: "@nudo:skip => number()", returns: "prim" },
    { name: "括号显式类型", line: "@nudo:skip (number())", returns: "prim" },
    { name: "无法识别的类型", line: "@nudo:skip => T.number", returns: "diag", diag: true },
  ];

  it("只有箭头/括号形式携带类型；无法识别时告警", () => {
    for (const { name, line, returns, diag } of CASES) {
      const { fns, diags } = extractWithDiags(`/**\n * ${line}\n */\nfunction f(x) { return x; }`);
      const skips = fns.flatMap((f) => f.directives.filter((d) => d.kind === "skip")) as SkipDirective[];
      expect(skips, name).toHaveLength(1);
      if (returns === "prim") expect(skips[0]!.returns?.shape.k, name).toBe("prim");
      else if (returns === "undefined") expect(skips[0]!.returns, name).toBeUndefined();
      if (diag) expect(diags.some((d) => d.code === "nudo:directive-syntax"), name).toBe(true);
    }
  });
});

describe("@nudo:as 形态", () => {
  const CASES = [
    { name: "尾随注释", src: `// @nudo:as number() // why\nconst x = 1;`, message: "Trailing comment", kind: "as" },
    { name: "块注释", src: `/* @nudo:as number() */\nconst x = 1;`, kind: "as", shape: "prim" },
    { name: "干净行注释", src: `// @nudo:as number()\nconst x = 1;`, kind: "as" },
  ];

  it("尾随注释保留 directive 并告警；块/行注释合法静默", () => {
    for (const { name, src, message, kind, shape } of CASES) {
      const { dirs, diags } = extractInlineWithDiags(src);
      expect(dirs.some((d) => d.kind === kind), name).toBe(true);
      if (message) expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes(message)), name).toBe(true);
      else expect(diags, name).toHaveLength(0);
      if (shape) {
        const asDir = dirs.find((d) => d.kind === "as") as AsDirective;
        expect(asDir.typeAbs.shape.k, name).toBe(shape);
      }
    }
  });
});

describe("case 实参/期望值的静默 fallback", () => {
  it("无法识别的表达式 / 垃圾 expected 都报诊断", () => {
    const invalid = [
      { src: `/**\n * @nudo:case "t" (T.number)\n */\nfunction f(x) { return x; }`, message: "Unrecognized" },
      { src: `/**\n * @nudo:case "t" (1) => not_a_type\n */\nfunction f(x) { return x; }` },
    ];
    for (const { src, message } of invalid) {
      const { diags } = extractWithDiags(src);
      expect(diags.some((d) => d.code === "nudo:directive-syntax" && (!message || d.message.includes(message))), src).toBe(true);
    }
  });

  it("显式 unknown/any 与合法 builder 零诊断", () => {
    for (const arg of ["unknown", "number()"]) {
      const { diags } = extractWithDiags(`/**\n * @nudo:case "t" (${arg})\n */\nfunction f(x) { return x; }`);
      expect(diags.filter((d) => d.code === "nudo:directive-syntax"), arg).toHaveLength(0);
    }
  });
});

describe("@nudo:sample count 语法", () => {
  it("缺失 / 非数字 count 报诊断且不产 sample", () => {
    for (const line of ["@nudo:sample", "@nudo:sample abc"]) {
      const { fns, diags } = extractWithDiags(`/**\n * ${line}\n */\nfunction f(x) { return x; }`);
      expect(fns.flatMap((f) => f.directives).find((d) => d.kind === "sample"), line).toBeUndefined();
      expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("@nudo:sample")), line).toBe(true);
    }
  });

  it("小数 / 负数 / 科学计数法不截断且零诊断", () => {
    for (const [raw, count] of [["3.5", 3.5], ["-2", -2], ["1e2", 100]] as const) {
      const { fns, diags } = extractWithDiags(`/**\n * @nudo:sample ${raw}\n */\nfunction f(x) { return x; }`);
      const sample = fns.flatMap((f) => f.directives).find((d) => d.kind === "sample");
      expect(sample, raw).toBeDefined();
      if (sample?.kind === "sample") expect(sample.count, raw).toBe(count);
      expect(diags.filter((d) => d.code === "nudo:directive-syntax"), raw).toHaveLength(0);
    }
  });
});

describe("diag channel semantics（显式通道：单次调用内去重 / 纯查询丢弃）", () => {
  const BAD = `/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }`;

  it("同源再 extract 重新 emit（重分析不丢报）", () => {
    const first = extractWithDiags(BAD);
    expect(first.diags).toHaveLength(1);
    const second = extractWithDiags(BAD);
    expect(second.diags).toHaveLength(1);
  });

  it("extractDirectivesQuiet 丢弃诊断（纯查询不产诊断）", () => {
    const fns = extractDirectivesQuiet(parse(BAD));
    expect(fns).toEqual([]);
    // 无可观察面可断言残留——不抛、不落任何调用方数组即为契约
  });

  it("不传 diags 的 extract 在 runWithDirectiveDiags 域内落袋", () => {
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => {
      extractDirectives(parse(BAD));
    });
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
  });

  it("runWithDirectiveDiags：域内复解析共域去重（nudo check D1 口径）", () => {
    // 同一 unsafe 表达式在域内复解析两次（extract + mock 种子复解析形态）只报一次
    const unsafe = "number(), (globalThis.__dedup = 1, 2)";
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => {
      parseCaseArgExpr(unsafe);
      parseCaseArgExpr(unsafe);
    });
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("Unsafe");
    // 新域重新报（重分析不丢报）
    const again: DirectiveDiag[] = [];
    runWithDirectiveDiags(again, () => {
      parseCaseArgExpr(unsafe);
    });
    expect(again).toHaveLength(1);
  });

  it("语句级行内抽取各自独立去重（两条 bare as 各报一次）", () => {
    const ast = parse(`// @nudo:as
const a = 1;
// @nudo:as
const b = 2;`);
    const diags: DirectiveDiag[] = [];
    for (const stmt of (ast as any).program.body) {
      extractInlineDirectives(stmt, { diags });
    }
    expect(diags.filter((d) => d.message.includes("@nudo:as requires"))).toHaveLength(2);
  });
});

describe("未闭合参数/括号不静默丢弃", () => {
  const CASES = [
    `/* @nudo:case "a" (1 */\nfunction f(x) { return x; }`,
    `/**\n * @nudo:case "a" ((1)\n */\nfunction f(x) { return x; }`,
    `/**\n * @nudo:case "a" (\n *   1\n */\nfunction f(x) { return x; }`,
  ];

  it("未闭合 case 参数：零 case + unclosed argument list 诊断", () => {
    for (const src of CASES) {
      const { fns, diags } = extractWithDiags(src);
      expect(fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")), src).toHaveLength(0);
      expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("unclosed argument list")), src).toBe(true);
    }
  });

  it("未闭合 skip 括号：returns undefined + 诊断；平衡形态零诊断", () => {
    const broken = extractWithDiags(`/**\n * @nudo:skip (number()\n */\nfunction f(x) { return x; }`);
    const brokenSkips = broken.fns.flatMap((f) => f.directives.filter((d) => d.kind === "skip")) as SkipDirective[];
    expect(brokenSkips[0]!.returns).toBeUndefined();
    expect(broken.diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("unclosed parenthesis"))).toBe(true);

    const ok = extractWithDiags(`/**\n * @nudo:skip (number())\n */\nfunction f(x) { return x; }`);
    const okSkips = ok.fns.flatMap((f) => f.directives.filter((d) => d.kind === "skip")) as SkipDirective[];
    expect(okSkips[0]!.returns?.shape.k).toBe("prim");
    expect(ok.diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });

  it("平衡的同行 case 保持静默", () => {
    const { fns, diags } = extractWithDiags(`/**\n * @nudo:case "ok" (1)\n */\nfunction f(x) { return x; }`);
    expect(fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"))).toHaveLength(1);
    expect(diags).toHaveLength(0);
  });
});

describe("标签与载荷不跨行粘连", () => {
  it("空 case / mock 标签不把下一行吞成载荷", () => {
    const cases = [
      { kind: "case", src: `/*\n@nudo:case\n"evil" (1)\n*/\nfunction f(x) { return x; }`, forbidName: "evil", message: "missing quoted name" },
      { kind: "case", src: `/**\n * @nudo:case\n * @nudo:case "real" (1)\n */\nfunction f(x) { return x; }`, allowName: "real", message: "missing quoted name" },
      { kind: "case", src: `/**\n * @nudo:case\n * see docs for "x" (1)\n */\nfunction f(x) { return x; }`, forbidText: "see docs", message: "missing quoted name" },
      { kind: "mock", src: `/*\n@nudo:mock\nfoo = 1\n*/\nfunction f(x) { return x; }`, forbidName: "foo", message: "@nudo:mock" },
    ];
    for (const { kind, src, forbidName, allowName, forbidText, message } of cases) {
      const { fns, diags } = extractWithDiags(src);
      const dirs = fns.flatMap((f) => f.directives.filter((d) => d.kind === kind)) as Array<{ name: string }>;
      if (forbidName) expect(dirs.map((d) => d.name), src).not.toContain(forbidName);
      if (allowName) expect(dirs.map((d) => d.name), src).toEqual([allowName]);
      if (forbidText) expect(diags.some((d) => d.message.includes(forbidText)), src).toBe(false);
      expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes(message)), src).toBe(true);
    }
  });

  it("多行 case 参数（稍后行闭合）仍完整解析", () => {
    const { fns, diags } = extractWithDiags(`/**\n * @nudo:case "a" (\n *   1,\n *   2\n * )\n */\nfunction f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases.map((c) => c.name)).toEqual(["a"]);
    expect(diags).toHaveLength(0);
  });

  it("mock from 路径引号未闭合（双/单引号）：诊断且不产 mock", () => {
    for (const quote of ['"src', "'src"]) {
      const { fns, diags } = extractWithDiags(`/**\n * @nudo:mock x from ${quote}\n */\nfunction f(x) { return x; }`);
      expect(fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock")), quote).toHaveLength(0);
      expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("unclosed quote in path")), quote).toBe(true);
    }
  });

  it("/// 行注释形式识别 case 与 mock", () => {
    const { fns, diags } = extractWithDiags(`/// @nudo:case "d" (1)\n/// @nudo:mock m = 2\nfunction f(x) { return x; }`);
    expect(fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")).map((d) => d.kind === "case" && d.name)).toEqual(["d"]);
    expect(fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock")).map((d) => d.kind === "mock" && d.name)).toEqual(["m"]);
    expect(diags).toHaveLength(0);
  });
});

describe("行内指令接受 JSDoc 续行", () => {
  it("as / replace / 多条 / /// 都合法提取且零诊断", () => {
    const cases = [
      { src: `/**\n * @nudo:as number()\n */\nconst a = 1;`, kind: "as", count: 1, shape: "prim" },
      { src: `/**\n * @nudo:replace a number()\n */\nconst a = 1;`, kind: "replace", count: 1, target: "a" },
      { src: `/**\n * @nudo:replace a number()\n * @nudo:replace b string()\n */\nconst a = (b) => b;`, kind: "replace", count: 2 },
      { src: `/// @nudo:as number()\nconst a = 1;`, kind: "as", count: 1 },
    ];
    for (const { src, kind, count, shape, target } of cases) {
      const { dirs, diags } = extractInlineWithDiags(src);
      const matched = dirs.filter((d) => d.kind === kind);
      expect(matched, src).toHaveLength(count);
      if (shape) expect((matched[0] as AsDirective).typeAbs.shape.k, src).toBe(shape);
      if (target) expect((matched[0] as ReplaceDirective).targetSource, src).toBe(target);
      expect(diags, src).toHaveLength(0);
    }
  });

  it("裸 as / replace 标签：显式诊断且不产指令", () => {
    const { dirs, diags } = extractInlineWithDiags(`/**\n * @nudo:as\n * @nudo:replace\n */\nconst a = 1;`);
    expect(dirs).toHaveLength(0);
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("@nudo:as requires"))).toBe(true);
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("@nudo:replace requires"))).toBe(true);
  });

  it("字符串里的注释符不算尾随注释；真实尾随注释仍告警", () => {
    for (const expr of [`lit("http://x")`, `lit("see // docs")`, `shape({ note: lit("a /* b") })`]) {
      const { dirs, diags } = extractInlineWithDiags(`// @nudo:as ${expr}\nconst a = 1;`);
      expect(dirs.filter((d) => d.kind === "as"), expr).toHaveLength(1);
      expect(diags.some((d) => d.message.includes("Trailing comment")), expr).toBe(false);
    }
    const trailing = extractInlineWithDiags(`/**\n * @nudo:as number() // why\n */\nconst x = 1;`);
    expect(trailing.dirs.filter((d) => d.kind === "as")).toHaveLength(1);
    expect(trailing.diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("Trailing comment"))).toBe(true);
  });
});

describe("explicit diag channel（extractDirectives opts.diags：调用方自备数组）", () => {
  const BAD = `/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }`;

  it("diags 落调用方数组", () => {
    const sink: DirectiveDiag[] = [];
    const fns = extractDirectives(parse(BAD), { diags: sink });
    expect(fns).toEqual([]); // 非法 case 名 → 无指令产出（诊断已发）
    expect(sink.length).toBeGreaterThan(0);
    expect(sink[0]!.code).toBe("nudo:directive-syntax");
  });

  it("单次调用内同文案去重（同一处同一问题）", () => {
    const sink: DirectiveDiag[] = [];
    // 同一去重域内、同一位置（同一份源码）被扫描两次 → 只报一次
    runWithDirectiveDiags(sink, () => {
      extractDirectives(parse(BAD));
      extractDirectives(parse(BAD));
    });
    expect(sink.length).toBe(1);
  });

  it("同文案但不同位置 → 各报一条（Bug 848：去重身份含位置）", () => {
    const sink: DirectiveDiag[] = [];
    // 两个函数各带一条**逐字相同**的非法 case 名 ⇒ 两处**不同的出错点**
    // ⇒ 不能塌缩成一条（用户修好第一处后以为已经修完，第二处完全不可见）
    extractDirectives(
      parse(`/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }
/**
 * @nudo:case 't' (1)
 */
function g(x) { return x; }`),
      { diags: sink },
    );
    expect(sink.length).toBe(2);
    expect(sink[0]!.at).toBeDefined();
    expect(sink[1]!.at).toBeDefined();
    expect(sink[0]!.at!.line).not.toBe(sink[1]!.at!.line);
  });

  it("sink extract 覆盖外层 runWithDirectiveDiags 域（自成新去重域）", () => {
    const outer: DirectiveDiag[] = [];
    const inner: DirectiveDiag[] = [];
    runWithDirectiveDiags(outer, () => {
      extractDirectives(parse(BAD), { diags: inner });
    });
    expect(inner).toHaveLength(1);
    expect(outer).toHaveLength(0);
  });

  it("不传 diags 且无外层域 → 诊断丢弃（纯查询形态）", () => {
    const fns = extractDirectives(parse(BAD));
    expect(fns).toEqual([]); // 非法 case 名 → 无指令产出（诊断已丢弃）
  });
});
