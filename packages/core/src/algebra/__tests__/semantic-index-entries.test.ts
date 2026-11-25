/**
 * 语义索引的**入口表**（`entries` / `entryInfos`）：`check` 入口面的唯一来源
 * （ADR 0001 阶段 3）。
 *
 * 三层契约：
 * - 登记：每个导出形态都进入口表。夹具源码逐字固化自 `tmp/bug-report.md`
 *   （审计批次 2026-11-14）的主路径形态；原始报告与 /tmp/** 夹具被 .gitignore
 *   忽略，故本文件是评审与回归的唯一依据。
 * - 与旧函数普查面的关系：入口表 ⊇ `listTopFunctions` ∪ `listClassEntryNames`
 *   （旧面仍在 `@nudojs/core/internal` 公共面上，这里只作对照基准）。旧面
 *   不登记而索引登记的名字 = `SUPPLEMENTARY_ENTRY_FORMS` 形态，`check` 据此
 *   派生 `addedNames`；登记序即签名序（见 `entry-face-precision.test.ts`）。
 * - `entryInfos` 元数据：形态 / 值节点 / 所在模块顶层语句。形态联合的每个
 *   成员都必须有夹具产出（死形态会让 `check` 的 `addedNames` 口径失真）。
 *
 * 绑定索引的其余只读面（imports / declarations / exportSlotInfos /
 * memberNodes / 词法区间 / 调用点）是 service dts 面与 LSP 的单点来源，
 * 契约一并钉在这里。
 */
import { describe, it, expect } from "vitest";
import { parseSource, resetParseSourceCache } from "../parse-source.ts";
import { listTopFunctions, listClassEntryNames } from "../scan/scan-top-functions.ts";
import {
  buildSemanticIndex,
  resolveBindingAt,
  lexicalKindAt,
  resetSemanticIndexCache,
  SUPPLEMENTARY_ENTRY_FORMS,
  type EntryForm,
  type EntryInfo,
} from "../scan/semantic-index.ts";

interface Fixture {
  /** bug-report.md 的编号（只作清单标签）。 */
  id: string;
  source: string;
  entries: readonly string[];
  slots?: readonly string[];
}

const FIXTURES: readonly Fixture[] = [
  {
    id: "BUG-002",
    source: `function boom() { throw new Error("boom"); }
exports.greet = boom;`,
    entries: ["boom"],
    slots: ["exports.greet"],
  },
  {
    id: "BUG-015a",
    source: `export const { a } = { a: () => null.x };`,
    entries: ["a"],
    slots: ["a"],
  },
  {
    id: "BUG-015b",
    source: `export const [a] = [() => null.x];`,
    entries: ["a"],
    slots: ["a"],
  },
  {
    id: "BUG-016",
    source: `export default { m() { return null.x; } };`,
    entries: ["m"],
    slots: ["default"],
  },
  {
    id: "BUG-017",
    source: `export default class { m() { return null.x; } }`,
    entries: ["default.m"],
    slots: ["default"],
  },
  {
    id: "BUG-023a",
    source: `class C {
  constructor() { throw new TypeError("no ctor"); }
  m() { return null.x; }
}
module.exports = C;`,
    entries: ["C", "C.m"],
    slots: ["module.exports"],
  },
  {
    id: "BUG-023b",
    source: `exports.C = class C { m() { return null.x; } };`,
    entries: ["C", "C.m"],
    slots: ["exports.C"],
  },
  {
    id: "BUG-024a",
    source: `const C = class { m() { return null.x; } };
export { C };`,
    entries: ["C", "C.m"],
    slots: ["C"],
  },
  {
    id: "BUG-024b",
    source: `const C = class { constructor() { throw new TypeError("no ctor"); } };
export default C;`,
    entries: ["C"],
    slots: ["default"],
  },
  {
    id: "BUG-004/032",
    source: `export class K { m(a) { return a; } }
const c = new K();
export function tplKey() { return c[\`m\`](-1); }
export function optMember() { return c?.m(-1); }
export function optCall() { return c.m?.(-1); }`,
    entries: ["tplKey", "optMember", "optCall"],
  },
];

/** 旧函数普查面同样登记的形态（索引独有形态见 `SUPPLEMENTARY_ENTRY_FORMS`）。 */
const CENSUS_ENTRY_FORMS = [
  "function",
  "function-value",
  "default-function",
  "cjs-function",
  "class",
  "class-method",
  "object-member",
] as const satisfies readonly EntryForm[];

/** 形态联合的全体成员（编译期与 `EntryForm` 互钉）。 */
const ALL_ENTRY_FORMS = [
  ...CENSUS_ENTRY_FORMS,
  "cjs-slot",
  "class-value",
  "class-value-method",
  "destructured",
  "object-member-indirect",
  "object-member-collision",
  "template-key",
] as const satisfies readonly EntryForm[];
type UnlistedForm = Exclude<EntryForm, (typeof ALL_ENTRY_FORMS)[number]>;
const noUnlistedForm: UnlistedForm extends never ? true : never = true;

interface FormPin {
  form: EntryForm;
  source: string;
  /** 入口名。 */
  name: string;
  /** 入口值声明节点的类型。 */
  nodeType: string;
  /** 入口值声明节点在源码里的首次出现（定位 `node`）。 */
  nodeText: string;
  /** 承载入口的模块顶层语句在源码里的起始文本（定位 `stmt`）。 */
  stmtText: string;
}

const FORM_PINS: readonly FormPin[] = [
  {
    form: "function",
    source: `export function f(): number { return 1; }`,
    name: "f",
    nodeType: "FunctionDeclaration",
    nodeText: "function f(",
    stmtText: "export function f(",
  },
  {
    form: "function-value",
    source: `export const g = () => 2;`,
    name: "g",
    nodeType: "ArrowFunctionExpression",
    nodeText: "() => 2",
    stmtText: "export const g =",
  },
  {
    form: "default-function",
    source: `export default function (): number { return 1; }`,
    name: "default",
    nodeType: "FunctionDeclaration",
    nodeText: "function ()",
    stmtText: "export default function",
  },
  {
    form: "cjs-function",
    source: `module.exports.slot = function () { return 1; };`,
    name: "slot",
    nodeType: "FunctionExpression",
    nodeText: "function ()",
    stmtText: "module.exports.slot =",
  },
  {
    form: "cjs-slot",
    source: `function boom() {}
exports.greet = boom;`,
    name: "greet",
    nodeType: "Identifier",
    nodeText: "boom;",
    stmtText: "exports.greet =",
  },
  {
    form: "class",
    source: `export class C { m() { return 1; } }`,
    name: "C",
    nodeType: "ClassDeclaration",
    nodeText: "class C {",
    stmtText: "export class C {",
  },
  {
    form: "class-method",
    source: `export class C { m() { return 1; } }`,
    name: "C.m",
    nodeType: "ClassMethod",
    nodeText: "m() {",
    stmtText: "export class C {",
  },
  {
    form: "class-value",
    source: `export default class { m() { return 1; } }`,
    name: "default",
    nodeType: "ClassDeclaration",
    nodeText: "class {",
    stmtText: "export default class {",
  },
  {
    form: "class-value-method",
    source: `export default class { m() { return 1; } }`,
    name: "default.m",
    nodeType: "ClassMethod",
    nodeText: "m() {",
    stmtText: "export default class {",
  },
  {
    form: "object-member",
    source: `export const api = { m() { return 1; } };`,
    name: "m",
    nodeType: "ObjectMethod",
    nodeText: "m() {",
    stmtText: "export const api =",
  },
  {
    form: "object-member-indirect",
    source: `const local = { m() { return 1; } };
export { local };`,
    name: "m",
    nodeType: "ObjectMethod",
    nodeText: "m() {",
    stmtText: "const local =",
  },
  {
    form: "object-member-collision",
    source: `const handle = 1;
export const api = { handle() {} };`,
    name: "handle",
    nodeType: "ObjectMethod",
    nodeText: "handle() {}",
    stmtText: "export const api =",
  },
  {
    form: "destructured",
    source: `export const { a } = { a: () => 1 };`,
    name: "a",
    nodeType: "ObjectExpression",
    nodeText: "{ a: () => 1 }",
    stmtText: "export const { a } =",
  },
  {
    form: "template-key",
    source: "export const o = { [`tpl`]() { return 1; } };",
    name: "tpl",
    nodeType: "ObjectMethod",
    nodeText: "[`tpl`]() {",
    stmtText: "export const o =",
  },
];

function indexOf(source: string) {
  return buildSemanticIndex(parseSource(source));
}

describe("语义索引入口表", () => {
  it.each(FIXTURES)("$id 登记入口与导出槽", (f) => {
    const idx = indexOf(f.source);
    for (const e of f.entries) {
      expect(idx.entries, `${f.id} 应登记入口 ${e}，实际 ${idx.entries.join(",")}`).toContain(e);
    }
    for (const s of f.slots ?? []) {
      expect([...idx.exportSlots.keys()], `${f.id} 应登记导出槽 ${s}`).toContain(s);
    }
  });

  it.each(FIXTURES)("$id 旧函数普查面登记的名字索引全部登记（超集）", (f) => {
    const oldNames = [...new Set([
      ...listTopFunctions(f.source),
      ...listClassEntryNames(f.source),
    ])];
    const indexed = indexOf(f.source).entries;
    expect(
      oldNames.filter((n) => !indexed.includes(n)),
      `${f.id} 旧普查面登记、索引缺失的名字`,
    ).toEqual([]);
  });

  it("entries 是 entryInfos 的名字投影，名字唯一", () => {
    const idx = indexOf(FIXTURES.find((f) => f.id === "BUG-023a")!.source);
    expect(idx.entries).toEqual(idx.entryInfos.map((e) => e.name));
    expect(new Set(idx.entryInfos.map((e) => e.name)).size).toBe(idx.entryInfos.length);
  });

  it("每个入口形态都有夹具产出，形态联合没有未列出的成员", () => {
    const pinned = new Set(FORM_PINS.map((p) => p.form));
    expect([...pinned].sort()).toEqual([...ALL_ENTRY_FORMS].sort());
    expect([...ALL_ENTRY_FORMS].filter((f) => !SUPPLEMENTARY_ENTRY_FORMS.has(f))).toEqual(
      [...CENSUS_ENTRY_FORMS],
    );
    expect(noUnlistedForm).toBe(true);
  });

  it.each(FORM_PINS)("$form：$name 的形态 / 值节点 / 顶层语句", (pin) => {
    const file = parseSource(pin.source);
    const info: EntryInfo | undefined = buildSemanticIndex(file).entryInfos.find(
      (e) => e.name === pin.name,
    );
    expect(info, `应登记入口 ${pin.name}`).toBeDefined();
    expect(info!.form).toBe(pin.form);
    expect(info!.node.type).toBe(pin.nodeType);
    expect(info!.node.start).toBe(pin.source.indexOf(pin.nodeText));
    // stmt 是 Program.body 的直接子节点，且定位在承载该入口的那条语句上
    expect(file.program.body).toContain(info!.stmt);
    expect(info!.stmt.start).toBe(pin.source.indexOf(pin.stmtText));
  });

  it("继承方法的入口挂在导出子类所在语句上", () => {
    const src = `class Base { base() { return 1; } }
export class D extends Base {}`;
    const file = parseSource(src);
    const infos = buildSemanticIndex(file).entryInfos;
    expect(infos.map((e) => `${e.name}:${e.form}`)).toEqual([
      "D:class",
      "D.base:class-method",
    ]);
    const base = infos.find((e) => e.name === "D.base")!;
    expect(base.node.type).toBe("ClassMethod");
    expect(base.node.start).toBe(src.indexOf("base() {"));
    expect(base.stmt.start).toBe(src.indexOf("export class D"));
  });

  it.each([
    ["static 在前", `export class C {
  static bind(): number { return 1; }
  bind(): number { return 2; }
}`],
    ["实例在前", `export class C {
  bind(): number { return 2; }
  static bind(): number { return 1; }
}`],
  ] as const)("同名静态 / 实例方法并存（%s）：入口值节点取实例方法", (_label, src) => {
    const infos = indexOf(src).entryInfos;
    expect(infos.map((e) => `${e.name}:${e.form}`)).toEqual(["C:class", "C.bind:class-method"]);
    const info = infos.find((e) => e.name === "C.bind")!;
    expect(info.node.type).toBe("ClassMethod");
    expect(info.node.start).toBe(src.indexOf("bind(): number { return 2; }"));
  });

  it("同名再登记不重复、不换位", () => {
    const src = `export function f(): number { return 1; }
function f2() { return f(); }
export { f as g };`;
    expect(indexOf(src).entries).toEqual(["f", "f2"]);
  });

  it("namespace 体不是模块顶层：其内部声明不进入口表", () => {
    const src = `export namespace N {
  export function f(): number { return 1; }
  export const v = (): number => 2;
  export class K { m(): number { return 1; } }
  export const o = { m(): number { return 1; } };
}
export function g(): number { return N.f(); }`;
    expect(indexOf(src).entries).toEqual(["g"]);
  });

  it("函数体内的声明不是模块顶层入口", () => {
    const src = `export function f(): number {
  function g() { return 1; }
  const h = () => 2;
  return g() + h();
}`;
    expect(indexOf(src).entries).toEqual(["f"]);
  });
});

describe("语义索引绑定事实", () => {
  it("imports / declarations 暴露声明事实（LSP 单点）", () => {
    const idx = indexOf(`import def, { a as b } from "./m.js";
import * as ns from "./n.js";
export function f() { return b; }`);
    expect(idx.imports.get("b")).toMatchObject({
      source: "./m.js",
      importedName: "a",
      kind: "named",
    });
    expect(idx.imports.get("def")).toMatchObject({
      importedName: "default",
      kind: "default",
    });
    expect(idx.imports.get("ns")).toMatchObject({
      importedName: "*",
      kind: "namespace",
    });
    const fId = [...idx.symbols.values()].find((s) => s.name === "f")?.id;
    expect(fId).toBeDefined();
    expect(idx.declarations.get(fId!)).toBeDefined();
  });

  it("exportSlotInfos 归一默认 / CJS / 再导出（dts 单点）", () => {
    const idx = indexOf(`export default function named() {}
export { x as y } from "./x.js";
exports.foo = function() {};
module.exports = { bar() {} };
export interface I { x: number }`);
    const info = (slot: string) => {
      const e = idx.exportSlotInfos.get(slot);
      return e ? { local: e.local, kind: e.kind } : undefined;
    };
    expect(info("default")).toEqual({ local: "named", kind: "default" });
    expect(info("y")).toEqual({ local: "", kind: "reexport" });
    expect(info("foo")).toEqual({ local: "foo", kind: "cjs" });
    expect(info("bar")).toEqual({ local: "bar", kind: "cjs" });
    expect(info("I")).toBeUndefined();
  });

  it("memberNodes 给出类成员声明节点（dts 类面）", () => {
    const idx = indexOf(`export class C { x = 1; m() {} static s() {} get g() { return 1; } }`);
    const c = [...idx.symbols.values()].find((s) => s.name === "C");
    expect(c).toBeDefined();
    const nodes = idx.memberNodes.get(c!.id);
    expect(nodes).toBeDefined();
    expect([...nodes!.keys()].sort()).toEqual(["g", "m", "s", "x"]);
  });

  it("classBodyNodes / namespaceBodyNodes 提供 dts 面成员节点", () => {
    const idx = indexOf(`export class C { x = 1; m() {} }
export namespace NS { export const q = 1; }`);
    const c = [...idx.symbols.values()].find((s) => s.name === "C");
    expect(c).toBeDefined();
    // 声明节点是 class id，不是类体；按 classBodyNodes 的 owner 断言更直接。
    const classBodies = [...idx.classBodyNodes.values()];
    expect(classBodies.some((nodes) => nodes.length === 2)).toBe(true);
    const nsBodies = [...idx.namespaceBodyNodes.values()];
    expect(nsBodies.some((nodes) => nodes.length === 1)).toBe(true);
  });

  it("稳定键：跨 parse 重建产生同一组 SymbolId", () => {
    const src = `export const x = 1; export function f(y) { return y + x; }`;
    resetParseSourceCache();
    const first = indexOf(src);
    resetParseSourceCache();
    resetSemanticIndexCache();
    const second = indexOf(src);
    expect([...first.symbols.keys()].sort()).toEqual([...second.symbols.keys()].sort());
  });

  it("按身份解析：形参遮蔽模块级 const 时不回落到外层（BUG-003）", () => {
    const src = `const LIMIT = -1;
export function f(LIMIT) { return g(LIMIT); }`;
    const idx = indexOf(src);
    const offset = src.indexOf("g(LIMIT)") + 2;
    const paramId = resolveBindingAt(idx, "LIMIT", offset);
    expect(paramId).toBeDefined();
    expect(idx.symbols.get(paramId!)?.kind).toBe("param");
    const moduleId = [...idx.symbols.values()].find(
      (s) => s.name === "LIMIT" && s.kind === "const",
    )?.id;
    expect(moduleId).toBeDefined();
    expect(paramId).not.toBe(moduleId);
  });

  it("词法区间按 offset 查询，续行仍属模板字面量（BUG-019 判据基础）", () => {
    const src = "export const msg = `first line\nmodObj.`;\nexport const n = 1;";
    const idx = indexOf(src);
    expect(lexicalKindAt(idx, src.indexOf("modObj") + 1)).toBe("template");
  });

  it("调用点：可选链与静态模板键都登记（BUG-032 / BUG-004）", () => {
    const fixture = FIXTURES.find((f) => f.id === "BUG-004/032")!;
    const idx = indexOf(fixture.source);
    expect(idx.calls.filter((c) => c.optional)).toHaveLength(2);
    expect(idx.calls.filter((c) => c.memberKey === "m")).toHaveLength(3);
  });
});
