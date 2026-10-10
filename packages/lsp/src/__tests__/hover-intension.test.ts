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

  it("hover on call callee keeps call-site typeText and attaches intension", () => {
    const source = `function scale(x) { return x * 2; }
const r = scale(3);
`;
    // scale( 的 callee 列
    const hover = getHoverAtPosition("/t/hof-call-hover.js", source, 2, 11);
    expect(hover).not.toBeNull();
    // intension 来自 generalize，不是 arity-only
    expect(hover!.intension).toBeDefined();
    expect(hover!.intension).toContain("scale");
    // typeText 落 evaluator/TypeValue（调用点结果），不是「只有签名」的早退
    expect(hover!.typeText).toBeDefined();
    expect(hover!.typeText).not.toBe(hover!.intension);
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
    const decl = getHoverAtPosition(f, main, 1, 25, undefined, { loadModule });
    expect(decl).not.toBeNull();
    expect(decl!.typeText).toBe("grade: string");

    const body = getHoverAtPosition(f, main, 2, 9, undefined, { loadModule });
    expect(body).not.toBeNull();
    expect(body!.typeText).toBe("grade: string");
    // 标识符面单行外延：内涵（term/pred/conf 多行）留给函数名 hover 的契约面
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
        onHover: (h) => {
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
