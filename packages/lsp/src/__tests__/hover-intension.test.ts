import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getHoverAtPosition, getAbsAtPosition } from "../lsp-surface.ts";
import { makeBufferAwareLoadModule } from "../validation.ts";
import { attachHover } from "../server-ide.ts";
import { formatAbs } from "@nudojs/core";

describe("getHoverAtPosition lossless Abs", () => {
  it("hover on function name shows Abs + intension", () => {
    const source = `function scale(x) { return x + 1; }\nscale(2);\n`;
    const hover = getHoverAtPosition("/t/hover.js", source, 1, 9);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toContain("scale");
    expect(hover!.intension ?? "").toContain("+");
    // 无损 Abs：含 conf 标记
    expect(hover!.abs).toBeDefined();
    expect(hover!.abs).toContain("#");
    expect(hover!.absMultiline).toBeDefined();
  });

  it("hover on binding shows Abs from evalAbsModuleGraph bindings", () => {
    const source = `const x = 1 + 2;\n`;
    const hover = getHoverAtPosition("/t/h3.js", source, 1, 7);
    if (hover?.abs) {
      expect(hover.abs).toContain("3");
    }
  });

  it("hover on identifier resolves through the binding table (node table removed)", () => {
    const source = `const n = 1 + 2;\n`;
    // fail-closed：节点级 Abs 表已删——标识符 n（column 6）经绑定表解析
    const hover = getHoverAtPosition("/t/h4.js", source, 1, 6);
    expect(hover).not.toBeNull();
    expect(hover!.abs).toBeDefined();
    expect(hover!.abs).toContain("3");
  });

  it("hover on non-function still returns type", () => {
    const source = `const n = 1;\n`;
    const hover = getHoverAtPosition("/t/h2.js", source, 1, 7);
    if (hover) expect(typeof hover.typeText).toBe("string");
  });

  it("hover on HOF function name reads intension (formatPoly), not arity-only", () => {
    const source = `function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}
`;
    // 列：function 名 processItems 起始附近
    const hover = getHoverAtPosition("/t/hof-hover.js", source, 1, 10);
    expect(hover).not.toBeNull();
    expect(hover!.intension).toBeDefined();
    expect(hover!.intension).toContain("items: arr(A1)");
    expect(hover!.intension).toContain("B:transform");
    expect(hover!.intension).not.toContain("arr(A1) = A1");
  });

  it("hover on call callee shows generalized signature, not arity-only Abs", () => {
    const source = `function scale(x) { return x * 2; }
const r = scale(3);
`;
    // scale( 的 callee 列
    const hover = getHoverAtPosition("/t/hof-call-hover.js", source, 2, 11);
    expect(hover).not.toBeNull();
    // intension 来自 generalize，不是 arity-only
    expect(hover!.intension).toBeDefined();
    expect(hover!.intension).toContain("scale");
    // arity-only fn Abs（returnType 空槽）不再抢占展示面：callee hover
    // 落 generalize 签名（含关系 / 返回类型），不显示 `(x) => ?`
    expect(hover!.typeText).toContain("scale");
    expect(hover!.typeText).not.toContain("=> ?");
  });

  it("recursive fn on self-referential contract: local hover not poisoned by cycle truncation", () => {
    // 自引用契约（lazy astNode）→ 递归调用在引擎内触发 cycle 预算截断
    // （opaque unknown）。位置/调用/赋值记录按帧过滤后，顶层帧的绑定值
    // （调用结果联合）不被内层截断帧污染
    const sidecar = `import { fn, nullable, union, shape, lit, string, lazy } from "@nudojs/core";

export const astNode = union(
  shape({ type: lit("Identifier"), name: string() }),
  shape({ type: lit("MemberExpression"), object: lazy(() => astNode) }),
  shape({ type: string() }),
);

export const staticName = fn({ node: nullable(astNode) }, union(string(), lit(null), lit(undefined)));
`;
    const loadModule = (spec: string) => (spec.endsWith("rec.nudo.js") ? sidecar : undefined);
    const source = `export function staticName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    if (node.computed) return null;
    const obj = staticName(node.object);
    if (obj === null) return null;
    const prop = node.type === "Identifier" ? node.name : null;
    return "x." + obj;
  }
  return null;
}
`;
    // 声明位 obj（L6 C10）：调用初始化 → 顶层帧调用记录 result 联合
    const decl = getHoverAtPosition("/t/rec.js", source, 6, 10, undefined, { loadModule });
    expect(decl?.typeText).toContain("obj:");
    expect(decl?.typeText).toContain("null");
    expect(decl?.typeText).toContain("string");
    expect(decl?.typeText).not.toContain("unknown");
    // 读位 obj（L7 C8）：A0 位置记录（最外层帧）
    const read = getHoverAtPosition("/t/rec.js", source, 7, 8, undefined, { loadModule });
    expect(read?.typeText).toContain("obj:");
    expect(read?.typeText).not.toContain("unknown");
    // 非调用初始化局部（三元）声明位（L8 C10）：declarator-id 位置记录
    const ternary = getHoverAtPosition("/t/rec.js", source, 8, 10, undefined, { loadModule });
    expect(ternary?.typeText).toContain("prop:");
    expect(ternary?.typeText).not.toContain("unknown");
    // 函数名（L1 C16）：generalize 签名面（非 arity-only `(arg0) => ?`）
    const fnHover = getHoverAtPosition("/t/rec.js", source, 1, 16, undefined, { loadModule });
    expect(fnHover?.typeText).not.toContain("=> ?");
    expect(fnHover?.signature).toContain("staticName(node: nullable(astNode))");
  });

  it("discriminant arm with array slot: index read + chained member reads derive", () => {
    // TemplateLiteral 臂（expressions 数组 + quasis 元素模板）补进判别联合后，
    // `x.arr.length`（数组 length）→ `quasis?.[0]`（index 读）→ `q.value.cooked`
    // （链式成员读）整链可推导——判别窄化进臂 + nullish 守卫消中间 undefined
    const sidecar = `import { fn, nullable, union, shape, lit, string, array } from "@nudojs/core";

export const elem = shape({ value: shape({ cooked: nullable(string()), raw: string() }) });

export const astNode = union(
  shape({ type: lit("StringLiteral"), value: string() }),
  shape({ type: lit("TemplateLiteral"), expressions: array(string()), quasis: array(elem) }),
  shape({ type: string() }),
);

export const literalString = fn({ node: nullable(astNode) }, nullable(string()));
`;
    const loadModule = (spec: string) => (spec.endsWith("tmpl.nudo.js") ? sidecar : undefined);
    const source = `export function literalString(node) {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions != null && node.expressions.length === 0) {
    const q = node.quasis?.[0];
    return q ? q.value.cooked : null;
  }
  return null;
}
`;
    // 判别等值守卫后的成员读：expressions 为数组 → length: number
    const len = getHoverAtPosition("/t/tmpl.js", source, 4, 86, undefined, { loadModule });
    expect(len?.typeText).toContain("length:");
    expect(len?.typeText).toContain("number");
    expect(len?.typeText).not.toContain("unknown");
    // index 读局部（可选链）：元素模板形状
    const q = getHoverAtPosition("/t/tmpl.js", source, 5, 10, undefined, { loadModule });
    expect(q?.typeText).toContain("q:");
    expect(q?.typeText).toContain("cooked");
    expect(q?.typeText).not.toContain("unknown");
    // 链式成员读（守卫后）：cooked 槽
    const cooked = getHoverAtPosition("/t/tmpl.js", source, 6, 23, undefined, { loadModule });
    expect(cooked?.typeText).toContain("cooked:");
    expect(cooked?.typeText).toContain("string");
    expect(cooked?.typeText).not.toContain("unknown");
  });

  it("hover on HOF call site: intension has relations, typeText is not just signature", () => {
    const source = `function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}
function caller(items) {
  return processItems(items, (x) => x * 2, (x) => x > 0);
}
`;
    // caller 内 processItems( 的 callee
    const hover = getHoverAtPosition("/t/hof-call2.js", source, 5, 12);
    expect(hover).not.toBeNull();
    expect(hover!.intension).toContain("items: arr(A1)");
    expect(hover!.intension).toContain("B:transform");
    // 有外延侧结果时，typeText 不应被 intension 整份顶掉
    if (hover!.typeText && hover!.typeText !== hover!.intension) {
      expect(hover!.typeText.length).toBeGreaterThan(0);
    }
  });
});

describe("getAbsAtPosition", () => {
  it("evaluator binding returns lossless Abs (no TypeValue bridge)", () => {
    const source = `const x = 1 + 2;\n`;
    const abs = getAbsAtPosition("/t/abs-pos.js", source, 1, 7);
    expect(abs).not.toBeNull();
    expect(formatAbs(abs!)).toContain("3");
    expect(abs!.conf).toBe("exact");
  });

  it("identifier returns Abs through binding table (node table removed)", () => {
    const source = `const n = 40 + 2;\n`;
    const abs = getAbsAtPosition("/t/abs-pos2.js", source, 1, 6);
    expect(abs).not.toBeNull();
    expect(formatAbs(abs!)).toContain("42");
  });

  it("case body: Abs replay with selected case args (activeCases)", () => {
    const source = `/**
 * @nudo:case "n" (3)
 * @nudo:case "s" (10)
 */
function scale(x) {
  return x * 2;
}
`;
    // fail-closed：执行态 case 重放（evalSource）已删——case 选中态的
    // 节点级 Abs 无数据（显式无信息）
    const abs0 = getAbsAtPosition("/t/case-replay.js", source, 6, 9, new Map([["scale", 0]]));
    expect(abs0).toBeNull();

    const abs1 = getAbsAtPosition("/t/case-replay.js", source, 6, 9, new Map([["scale", 1]]));
    expect(abs1).toBeNull();

    const ret0 = getAbsAtPosition("/t/case-replay.js", source, 6, 10, new Map([["scale", 0]]));
    expect(ret0).toBeNull();
  });
});

// R2B-004：G2 作用域下 nested / class method / object method hover 不再 null
describe("getHoverAtPosition G2 scope (nested / class / object method)", () => {
  it("hover on class method name shows intension (Calculator.add)", () => {
    const source = `export class Calculator {\n  add(a, b) {\n    return a + b;\n  }\n}\n`;
    // `add` at line 2, col 2
    const hover = getHoverAtPosition("/t/cls.js", source, 2, 2);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toBeDefined();
    expect(hover!.intension ?? hover!.typeText).toContain("add");
  });

  it("hover on nested function name shows intension (inner)", () => {
    const source = `export function outer() {\n  function inner(x) {\n    return x + 1;\n  }\n  return inner(1);\n}\n`;
    // `inner` at line 2, col 11
    const hover = getHoverAtPosition("/t/nested.js", source, 2, 11);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toBeDefined();
    expect(hover!.intension ?? hover!.typeText).toContain("inner");
  });

  it("hover on object method name shows intension (api.get)", () => {
    const source = `export const api = {\n  get(id) {\n    return id;\n  }\n};\n`;
    // `get` at line 2, col 2
    const hover = getHoverAtPosition("/t/obj.js", source, 2, 2);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toBeDefined();
    expect(hover!.intension ?? hover!.typeText).toContain("get");
  });

  it("hover on nested class method name shows intension (Inner.m)", () => {
    const source = `export function make() {\n  class Inner {\n    m(n) {\n      return n;\n    }\n  }\n  return new Inner();\n}\n`;
    // `m` at line 3, col 4
    const hover = getHoverAtPosition("/t/nested-cls.js", source, 3, 4);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toBeDefined();
    expect(hover!.intension ?? hover!.typeText).toContain("m");
  });

  it("hover on class method name with @nudo:case still shows intension", () => {
    const source = `export class Calculator {\n  // @nudo:case "t" (1, 2)\n  add(a, b) {\n    return a + b;\n  }\n}\n`;
    // `add` at line 3, col 2
    const hover = getHoverAtPosition("/t/cls-case.js", source, 3, 2);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toBeDefined();
    expect(hover!.intension ?? hover!.typeText).toContain("add");
  });

  it("hover on nested const arrow name shows intension (helper)", () => {
    const source = `export function outer() {\n  const helper = (n) => n * 2;\n  return helper(1);\n}\n`;
    // `helper` at line 2, col 8 (const helper)
    const hover = getHoverAtPosition("/t/nested-arrow.js", source, 2, 8);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toBeDefined();
    expect(hover!.intension ?? hover!.typeText).toContain("helper");
  });
});

describe("getHoverAtPosition param projection (entryShapes + formals)", () => {
  // 绑定面只有模块级 import——参数 Abs 唯一权威源是 enclosing fn 的 generalize
  //（与函数名 hover 同源：契约种子（侧车/refine）+ 提升扫描在这里生效）
  it("destructured param declaration/usage hovers its slot Abs (sidecar contract)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-param-hover-"));
    writeFileSync(
      join(dir, "decide.nudo.js"),
      `import { fn, string, shape, array } from '@nudojs/core';
export const decide = fn(
  { grade: string(), findings: array(shape({ ruleId: string() })) },
  shape({ ok: string() }),
);
`,
      "utf-8",
    );
    const main = `export function decide({ grade, findings }) {
  return grade + String(findings.length);
}
`;
    const f = join(dir, "decide.js");
    writeFileSync(f, main, "utf-8");
    const loadModule = makeBufferAwareLoadModule(() => undefined);

    // line 1 声明处 grade（col 25）与 line 2 体内引用（col 9）
    // 均折叠为声明形态（entryReqs.display）——投影面展示的
    // generalized 参数类型与声明形态同信息
    const decl = getHoverAtPosition(f, main, 1, 25, undefined, { loadModule });
    expect(decl).not.toBeNull();
    expect(decl!.typeText).toBe("grade: string()");

    const body = getHoverAtPosition(f, main, 2, 9, undefined, { loadModule });
    expect(body).not.toBeNull();
    expect(body!.typeText).toBe("grade: string()");
    // 折叠面：单行声明形态（侧车绑定）
    expect(body!.abs).toBe(body!.typeText);
    expect(body!.absMultiline).toBeUndefined();

    rmSync(dir, { recursive: true, force: true });
  });

  it("promoted direct param hovers entryShapes snapshot", () => {
    const src = `export function processItems(items) {\n  return items.map((x) => x + 1);\n}\n`;
    // line 1: items col 26
    const hover = getHoverAtPosition("/t/param-promote.js", src, 1, 26);
    expect(hover).not.toBeNull();
    expect(hover!.abs).toBeDefined();
  });

  it("unconstrained param / non-call local stay fail-closed null", () => {
    const src = `export function scale(x) {\n  return x * 2;\n}\n`;
    // 无契约、无提升：参数与局部都不产出（诚实 unknown，不冒充 any）
    expect(getHoverAtPosition("/t/param-null.js", src, 1, 23)).toBeNull();
    const local = `export function f(n) {\n  const local = n + 1;\n  return local;\n}\n`;
    expect(getHoverAtPosition("/t/local-null.js", local, 2, 8)).toBeNull();
  });
});

describe("getHoverAtPosition body locals & refs (case fn no longer dead)", () => {
  // 复刻 npm-safe decide.js 形态：case 函数体内 = 调用初始化局部（vetos）
  // + 同文件顶层函数引用（countOf）——旧实现整体短路（case 重放已删成恒 null）
  const MAIN = `export function countOf(arr) {
  return arr.length;
}

/**
 * @nudo:case "t" ({ items: [] })
 */
export function run({ items }) {
  const kept = countOf(items);
  return kept;
}
`;

  function withSidecar(main: string, fn: string, entry: string): string {
    void entry;
    const dir = mkdtempSync(join(tmpdir(), "nudo-local-hover-"));
    writeFileSync(
      join(dir, fn),
      `import { fn, shape, array, number, boolean } from '@nudojs/core';
export const run = fn({ items: array(shape({ ok: boolean() })) }, number());
`,
      "utf-8",
    );
    const f = join(dir, "run.js");
    writeFileSync(f, main, "utf-8");
    return f;
  }

  it("call-initialized local hovers from EvalCallRecord (entry-args call)", () => {
    const f = withSidecar(MAIN, "run.nudo.js", "items");
    const loadModule = makeBufferAwareLoadModule(() => undefined);
    // line 9: `  const kept = countOf(items);` — kept col 9
    const hover = getHoverAtPosition(f, MAIN, 9, 9, undefined, { loadModule });
    expect(hover).not.toBeNull();
    expect(hover!.typeText).toMatch(/^kept: /);
    expect(hover!.typeText).toContain("number");
    rmSync(dirname(f), { recursive: true, force: true });
  });

  it("sibling top-level fn reference inside case fn body hovers (binding face)", () => {
    const f = withSidecar(MAIN, "run.nudo.js", "items");
    const loadModule = makeBufferAwareLoadModule(() => undefined);
    // line 9: `  const kept = countOf(items);` — countOf col 18（callee；
    // 本地函数 → intension 面；此处验证同文件顶层引用也走通）
    const hover = getHoverAtPosition(f, MAIN, 9, 18, undefined, { loadModule });
    expect(hover).not.toBeNull();
    expect(hover!.typeText).toMatch(/^(countOf|kept): /);
    rmSync(dirname(f), { recursive: true, force: true });
  });

  it("non-call-initialized local without contract stays fail-closed null", () => {
    const src = `export function run(items) {\n  const local = items.length + 1;\n  return local;\n}\n`;
    // MemberExpression 初始化：无调用记录、无赋值记录 → 无信息
    expect(getHoverAtPosition("/t/local-dead.js", src, 2, 8)).toBeNull();
  });
});

describe("attachHover markdown (fn name: tier + check-style signature only)", () => {
  // 函数名 hover 弹层 = 档线 + check 同口径签名一行；builder 模板 /
  // symbolic 多行 / display 签名三面不再重复（nudo.hover payload 保留无损面）
  const MAIN = `export function decide({ grade, findings }) {
  return grade + String(findings.length);
}
`;

  function setup(): { hover: (line: number, ch: number) => string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), "nudo-fn-hover-md-"));
    writeFileSync(
      join(dir, "decide.nudo.js"),
      `import { fn, string, shape, array } from '@nudojs/core';
export const decide = fn(
  { grade: string(), findings: array(shape({ ruleId: string() })) },
  shape({ ok: string() }),
);
`,
      "utf-8",
    );
    const f = join(dir, "decide.js");
    writeFileSync(f, MAIN, "utf-8");
    let handler: ((p: unknown) => unknown) | undefined;
    attachHover({
      connection: {
        onHover: (h: unknown) => {
          handler = h as typeof handler;
        },
        console: { error: () => undefined },
      } as never,
      getDocument: () => ({ getText: () => MAIN, version: 1 }) as never,
      isNudoFile: () => true,
      getActiveCases: () => new Map(),
      activeLoadModule: makeBufferAwareLoadModule(() => undefined),
    } as never);
    return {
      hover: (line, ch) =>
        String(
          (handler as unknown as (p: unknown) => { contents: { value: string } })({
            textDocument: { uri: `file://${f}` },
            position: { line: line - 1, character: ch },
          })?.contents?.value ?? "",
        ),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  }

  it("fn-name hover renders tier line + single signature block", () => {
    const { hover, cleanup } = setup();
    const md = hover(1, 16); // decide fn name
    expect(md).toContain("● contract / hw");
    expect(md).toMatch(/```nudo\ndecide\(\{ grade, findings \}: \{ grade: string,/);
    // 三面去重：builder 语法 / symbolic conf 行 / placeholder 签名不再出现
    expect(md).not.toContain("string()");
    expect(md).not.toContain("conf:");
    expect(md).not.toContain("_p0");
    cleanup();
  });

  it("identifier hover keeps one-line ext face (no tier/signature block)", () => {
    const { hover, cleanup } = setup();
    const md = hover(2, 9); // body grade
    // 档线/签名是函数名 hover 的面；标识符只有单行外延块
    expect(md).toContain("grade: string");
    expect(md).not.toMatch(/decide\(/);
    expect(md).not.toContain("●");
    cleanup();
  });
});

// #138：intension（formatPoly）参数名槽与签名面同口径走
// formalParamSignatureNames——解构形参渲染 `{ a, b }`，不落求值占位 `_p0`
describe("getHoverAtPosition intension destructure param names (#138)", () => {
  const ADD_PAIR = `export function addPair({ a, b }) {\n  return a + b;\n}\n`;

  it("纯解构形参：intension 参数名槽是 { a, b }，无 _p0", () => {
    // 函数名 addPair（L1 C16 = 名字起始前一格，同 agent-hover-interface-tier 口径）
    const hover = getHoverAtPosition("/t/addpair-pure.js", ADD_PAIR, 1, 16);
    expect(hover).not.toBeNull();
    expect(hover!.intension).toBeDefined();
    expect(hover!.intension).toContain("({ a, b }:");
    expect(hover!.intension).not.toContain("_p0");
  });

  it("契约绑定解构：名字槽 { a, b }，契约面字段类型上屏", () => {
    // 侧车 fn({a: number(), b: number()}) 绑 addPair（loader(HANDWRITTEN) 式）
    const SIDE = `
import { fn, number } from "@nudojs/core";

export const addPair = fn({ a: number(), b: number() }, number());
`;
    const loader = (spec: string) =>
      spec.endsWith("addpair.nudo.js") ? SIDE : undefined;
    const hover = getHoverAtPosition("/t/addpair.js", ADD_PAIR, 1, 16, undefined, {
      loadModule: loader,
    });
    expect(hover).not.toBeNull();
    expect(hover!.intension).toBeDefined();
    // 名字槽是解构形状，不是求值占位
    expect(hover!.intension).toContain("({ a, b }:");
    // 契约面：字段类型上屏（term echo 形态不在此断言——合成 obj 的
    // termVar 命名是另一工作面，见 #138）
    expect(hover!.intension).toContain("a: number");
    expect(hover!.intension).toContain("b: number");
  });

  it("rest 形参渲染不变：intension 仍含 ...args", () => {
    const src = `export function f(x, ...args) {\n  return args.length;\n}\n`;
    const hover = getHoverAtPosition("/t/rest-args.js", src, 1, 16);
    expect(hover).not.toBeNull();
    expect(hover!.intension).toBeDefined();
    expect(hover!.intension).toContain("...args");
  });
});

// 参数声明位 / 引用位折叠：侧车表达式原文（display）替代
// 参数折叠 + 流窄化 + 类型值变量链接：声明位 / 检查点
// 保持声明形态；早退守卫 / 成员访问对象之后剥离
// nullable 包装（流窄化）；引用标识符（如 astNode）
// 包为链接跳定义（import 表 → 依赖侧车定义行）
describe("getHoverAtPosition param display folding", () => {
  const SIDE = `import { fn, string, nullable } from '@nudojs/core';
import { astNode } from './shapes.nudo.js';
export const literal = fn({ node: nullable(astNode) }, nullable(string()));
`;
  const SHAPES = `import { union, shape, lit, string } from '@nudojs/core';
export const astNode = union(
  shape({ type: lit('Identifier'), name: string() }),
  shape({ type: lit('Literal'), value: string() }),
);
`;
  const MAIN = [
    "export function literal(node) {",
    "  if (!node) return null;",
    "  if (node.type === 'Literal') return node.value;",
    "  return node;",
    "}",
    "",
  ].join("\n");

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "nudo-param-fold-"));
    writeFileSync(join(dir, "literal.nudo.js"), SIDE, "utf-8");
    writeFileSync(join(dir, "shapes.nudo.js"), SHAPES, "utf-8");
    const f = join(dir, "literal.js");
    writeFileSync(f, MAIN, "utf-8");
    const loadModule = makeBufferAwareLoadModule(() => undefined);
    const shapesUri = `file://${dir.replace(/\\/g, "/")}/shapes.nudo.js`;
    return { dir, f, loadModule, shapesUri, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  it("声明位 / 检查点保持声明形态；成员访问与早退守卫之后窄化", () => {
    const { f, loadModule, shapesUri, cleanup } = setup();
    // L1 C24 = 参数 node 声明位（无窄化事实）
    const decl = getHoverAtPosition(f, MAIN, 1, 24, undefined, { loadModule });
    expect(decl).not.toBeNull();
    expect(decl!.typeText).toBe("node: nullable(astNode)");
    expect(decl!.abs).toBe("node: nullable(astNode)");
    expect(decl!.absMultiline).toBeUndefined();
    // 类型值变量链接：astNode 经 import 表 → 依赖侧车定义行
    // （整行渲染：前缀并入首个代码 span）
    expect(decl!.linkedText).toBe(
      "`node: nullable(`[astNode](" + shapesUri + "#L2)`)`",
    );

    // L2 C7 = 检查点（!node 守卫自身）——尚未窄化
    const check = getHoverAtPosition(f, MAIN, 2, 7, undefined, { loadModule });
    expect(check).not.toBeNull();
    expect(check!.typeText).toBe("node: nullable(astNode)");
    expect(check!.linkedText).toBeDefined();

    // L3 C6 = 成员访问对象（node.type）——窄化为 astNode
    const member = getHoverAtPosition(f, MAIN, 3, 6, undefined, { loadModule });
    expect(member).not.toBeNull();
    expect(member!.typeText).toBe("node: astNode");
    expect(member!.linkedText).toBe(
      "`node: `[astNode](" + shapesUri + "#L2)",
    );
    // L4 C9 = 早退守卫之后的裸引用——窄化为 astNode
    const after = getHoverAtPosition(f, MAIN, 4, 9, undefined, { loadModule });
    expect(after).not.toBeNull();
    expect(after!.typeText).toBe("node: astNode");
    cleanup();
  });

  it("函数名 hover：签名参数折叠为声明形态 + 契约面 display", () => {
    const { f, loadModule, cleanup } = setup();
    const fn = getHoverAtPosition(f, MAIN, 1, 16, undefined, { loadModule });
    expect(fn).not.toBeNull();
    // 签名参数折叠为声明形态（返回类型是推断值——
    // 新 MAIN 的 return node 使推断返回为判别联合：
    // 浅层联合在深度 4 内有界完整展开；lazy 自引用
    // 的指数展开被深度预算截断）
    expect(fn!.signature).toContain("literal(node: nullable(astNode))");
    expect(fn!.signature.length).toBeLessThan(300);
    expect(fn!.interfaceDisplay).toBe(
      "(node: nullable(astNode)) → union(string(), lit(null), lit(undefined))",
    );
    cleanup();
  });

  it("等值守卫 then 分支判别窄化为匹配臂 + 成员读槽位类型", () => {
    const { f, loadModule, cleanup } = setup();
    // L3 C38 = then 分支 node（return node.value 的
    // 对象）——等值守卫（node.type === 'Literal'）
    // 的 then 分支经求值器重放窄化为 Literal 臂
    // （引擎求值态——lit 判别值双引号、prim 渲染
    // 为 shape 名；闭口联合无尾臂——单臂）
    const thenNode = getHoverAtPosition(f, MAIN, 3, 38, undefined, { loadModule });
    expect(thenNode).not.toBeNull();
    // pretty 多行缩进：obj 每槽一行 + 尾逗号 + 2 空格缩进
    expect(thenNode!.typeText).toBe(
      'node: {\n  type: lit("Literal"),\n  value: string,\n}',
    );

    // L3 C43 = 成员读属性位（node.value 的 value
    // 位）——引擎记录的槽位类型
    const slot = getHoverAtPosition(f, MAIN, 3, 43, undefined, { loadModule });
    expect(slot).not.toBeNull();
    expect(slot!.typeText).toBe("value: string");
    cleanup();
  });

  it("|| 组 then 分支窄化为匹配臂联合；else 分支不窄化", () => {
    const { f, loadModule, cleanup } = setup();
    const mainOr = [
      "export function literal(node) {",
      "  if (!node) return null;",
      "  if (node.type === 'Identifier' || node.type === 'Literal') return node;",
      "  return null;",
      "}",
      "",
    ].join("\n");
    writeFileSync(f, mainOr, "utf-8");
    // L3 C69 = || 组 then 分支裸 node——两臂均匹配（声明形态判别
    // 窄化面——paramDisplayOf 口径，保持单行不受 pretty 影响）
    const orHover = getHoverAtPosition(f, mainOr, 3, 69, undefined, { loadModule });
    expect(orHover).not.toBeNull();
    expect(orHover!.typeText).toBe(
      "node: { type: lit('Identifier'), name: string() } | { type: lit('Literal'), value: string() }",
    );

    const mainElse = [
      "export function literal(node) {",
      "  if (node.type === 'Literal') {",
      "    return node.value;",
      "  } else {",
      "    return node;",
      "  }",
      "}",
      "",
    ].join("\n");
    writeFileSync(f, mainElse, "utf-8");
    // L5 C11 = else 分支裸 node——否定形态有界跳过，
    // 保持声明形态（无 !node 守卫——可空正确）
    const elseHover = getHoverAtPosition(f, mainElse, 5, 11, undefined, { loadModule });
    expect(elseHover).not.toBeNull();
    expect(elseHover!.typeText).toBe("node: nullable(astNode)");
    cleanup();
  });

  it("attachHover 渲染链接面（plain markdown）；弹窗不再含契约原文链接行", () => {
    const { dir, f, loadModule, shapesUri, cleanup } = setup();
    let handler: ((p: unknown) => unknown) | undefined;
    attachHover({
      connection: {
        onHover: (h) => {
          handler = h as typeof handler;
        },
        console: { error: () => undefined },
      } as never,
      getDocument: () => ({ getText: () => MAIN, version: 1 }) as never,
      isNudoFile: () => true,
      getActiveCases: () => new Map(),
      activeLoadModule: loadModule,
    } as never);
    const hoverMd = (line: number, ch: number) =>
      String(
        (
          handler as unknown as (p: unknown) => {
            contents: { value: string };
          }
        )({
          textDocument: { uri: `file://${f}` },
          position: { line: line - 1, character: ch },
        })?.contents?.value ?? "",
      );
    // 参数声明位（L1 C24）：链接面（astNode → 依赖侧车定义行）
    const declMd = hoverMd(1, 24);
    expect(declMd).toContain("`node: nullable(`");
    expect(declMd).toContain(`[astNode](${shapesUri}#L2)`);
    // 折叠后不再出现判别联合的无损展开
    expect(declMd).not.toContain("lit('Identifier')");
    // 链接面在场——无契约原文行
    expect(declMd).not.toContain("契约原文");
    // 体内引用（L3 C6）：窄化 + 链接
    const bodyMd = hoverMd(3, 6);
    expect(bodyMd).toContain("`node: `[astNode](" + shapesUri + "#L2)");
    expect(bodyMd).not.toContain("契约原文");
    // 引擎求值态位（L3 C38：return node.value 的 node——窄化 Literal 臂，
    // 无链接面）：弹窗也不含契约原文行（链接行已删）
    const engineMd = hoverMd(3, 38);
    expect(engineMd).toContain("node:");
    expect(engineMd).not.toContain("契约原文");
    cleanup();
  });
});

// return 表达式推导 hover（无 ident 位）：ReturnStatement 位置记录
// 键 = `return` 关键字起始位（不是 argument 起始位——后者与内部
// 根标识符值读记录同键 first-wins 丢失）；表达式内非标识符位
// （成员访问 `.`）经最小 span 候选命中；pretty 缩进断言
describe("getHoverAtPosition return expression hover (no-ident positions)", () => {
  const SHAPES = `import { union, shape, lit, string, array } from '@nudojs/core';
export const astNode = union(
  shape({ type: lit('Literal'), value: string() }),
  shape({ type: lit('TemplateLiteral'), quasis: array(shape({ value: shape({ cooked: string() }) })) }),
);
`;
  const SIDE = `import { fn, string, nullable } from '@nudojs/core';
import { astNode } from './shapes.nudo.js';
export const literal = fn({ node: nullable(astNode) }, nullable(string()));
`;
  const MAIN = [
    "export function literal(node) {",
    "  if (!node) return null;",
    "  if (node.type === 'Literal') return node.value;",
    "  const q = node.quasis?.[0];",
    "  return q ? q.value.cooked : null;",
    "}",
    "",
  ].join("\n");

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "nudo-return-hover-"));
    writeFileSync(join(dir, "shapes.nudo.js"), SHAPES, "utf-8");
    writeFileSync(join(dir, "literal.nudo.js"), SIDE, "utf-8");
    const f = join(dir, "literal.js");
    writeFileSync(f, MAIN, "utf-8");
    const loadModule = makeBufferAwareLoadModule(() => undefined);
    return { f, loadModule, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  it("return 关键字位 hover 显示整个返回表达式的推导类型（无 ident 前缀）", () => {
    const { f, loadModule, cleanup } = setup();
    // L3 `  if (node.type === 'Literal') return node.value;`——return 起始 col 31；
    // 窄化 Literal 臂后 node.value → string
    const ret = getHoverAtPosition(f, MAIN, 3, 31, undefined, { loadModule });
    expect(ret).not.toBeNull();
    expect(ret!.typeText).toBe("string");
    expect(ret!.abs).toBe(ret!.typeText);
    // L5 `  return q ? q.value.cooked : null;`——return 起始 col 2；
    // 三元 join：cooked: string 与 null
    const ret5 = getHoverAtPosition(f, MAIN, 5, 2, undefined, { loadModule });
    expect(ret5).not.toBeNull();
    expect(ret5!.typeText).toContain("string");
    expect(ret5!.typeText).toContain("null");
    cleanup();
  });

  it("表达式内非标识符位 hover（`?.[` / `[0]`）有类型", () => {
    const { f, loadModule, cleanup } = setup();
    // L4 `  const q = node.quasis?.[0];`——`?.`（col 24）与 `[0]`（col 26）
    // 都不在任何标识符跨距内：最小 span 候选 = OptionalMemberExpression
    // （起始键 = node 值读记录）→ 整体 union（pretty 按臂断行）
    const optChain = getHoverAtPosition(f, MAIN, 4, 24, undefined, { loadModule });
    expect(optChain).not.toBeNull();
    expect(optChain!.typeText).toMatch(/^\{\n  type: lit\("Literal"\),\n  value: string,\n\}\n\| \{/);
    const index = getHoverAtPosition(f, MAIN, 4, 26, undefined, { loadModule });
    expect(index).not.toBeNull();
    expect(index!.typeText).toContain('lit("TemplateLiteral")');
    cleanup();
  });

  it("pretty：窄化标识符臂多行缩进（换行 + 两空格）；纯 prim 联合仍单行", () => {
    const { f, loadModule, cleanup } = setup();
    // L3 col 38 = node（return node.value 的对象）——窄化 Literal 臂
    const node = getHoverAtPosition(f, MAIN, 3, 38, undefined, { loadModule });
    expect(node).not.toBeNull();
    expect(node!.typeText).toContain("\n");
    expect(node!.typeText).toMatch(
      /^node: \{\n  type: lit\("Literal"\),\n  value: string,\n\}$/,
    );
    // 纯 prim 联合（L5 return 记录：string | null）不断行
    const ret5 = getHoverAtPosition(f, MAIN, 5, 2, undefined, { loadModule });
    expect(ret5!.typeText).not.toContain("\n");
    cleanup();
  });
});
