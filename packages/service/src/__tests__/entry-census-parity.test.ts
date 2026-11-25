/**
 * 顶层函数普查对拍：service `collectTopLevelFunctions` × 语义索引入口表。
 *
 * `check` 的入口表只读语义索引（core `buildSemanticIndex(ast).entryInfos`）。
 * service 的函数普查（dts / export / test 面的入口来源）是另一套规则：两侧对
 * 「什么算入口」的裁定不同（见下表，双向都有独有项），外加**返回形状**的结构性
 * 差异（对象属性成员 service 取函数值节点、索引取属性节点；`assignedName` 是
 * service 独有概念）、**重复**（service 不去重）与**顺序**（service 把类方法统一
 * 追加在末尾，索引在类声明处登记；只在类与函数交错的源上出现）⇒ 改读索引会改
 * service 产物（丢 S3–S5、多出 I3 / I6 等），不是等价替换，无法让 service 逐项
 * 同序改读索引。所以保留各自实现，由本测试把分歧**双向钉死**：任何一侧的普查
 * 规则变化都必须在这里显式更新，不得静默漂移。
 *
 * 断言口径（两个方向都断言，失败信息 = 文件 + 两侧多出的名字集）：
 * - 合成夹具（覆盖全部入口形态）：两侧名字序列各自逐项等于钉住值（含顺序与
 *   重复），且 `索引 − service` / `service − 索引` 恰等于夹具声明的差异清单。
 * - `docs/examples` 语料（仓库根从 `import.meta.url` 推，不依赖 cwd）：除类名
 *   入口（索引登记类导出入口，函数普查只收函数）外，两侧名字集合一致。
 *
 * 已知差异——索引登记、service 不登记。归类：〔口径〕check 入口表专用的入口
 * 形态（旧普查面同样没有，或函数普查本就只收函数）；〔service 缺陷〕旧普查面 /
 * 索引能给对的名字，service 没给：
 *   I1 类名：`class` / `class-value` 形态（`export class C`、`export const C = class`、
 *      `export { C }`、`export default C`、匿名 `export default class`、CJS 类槽）。
 *      〔口径〕函数普查只收函数。
 *   I2 实例导出的类方法：`export const svc = new Svc()` ⇒ `Svc.m`。
 *      〔service 缺陷〕旧普查面有。
 *   I3 CJS 类的方法：`module.exports = class C { m() {} }` ⇒ `C.m`。〔口径〕
 *   I4 右值不是函数字面量 / 不在顶层语句位置的 CJS 槽：`exports.greet = boom`、
 *      `if (c) exports.cond = fn` ⇒ `greet` / `cond`（`cjs-slot`）。〔口径〕
 *   I5 字符串计算键的 CJS 槽：`exports["quoted"] = fn` ⇒ `quoted`。
 *      〔service 缺陷〕即 S1 的另一面。
 *   I6 解构绑定到函数值：`const { a } = { a: () => 1 }`（未导出也登记，
 *      `destructured`）。〔口径〕
 *   I7 模板字面量键：对象 `{ [\`tpl\`]() {} }`、类 `class C { [\`m\`() {} }`。
 *      〔口径〕
 *   I8 常量计算键的对象成员：`{ [k]: fn }`（`const k = "computed"`）⇒ `computed`
 *      （配 S2）。〔service 缺陷〕旧普查面有。
 * 已知差异——service 登记、索引不登记：
 *   S1 `exports["quoted"] = fn` ⇒ `default`。〔service 缺陷〕槽名求值不中时回退。
 *   S2 `{ [k]: fn }` ⇒ 键上的标识符名 `k`。〔service 缺陷〕
 *   S3 匿名默认导出类的继承方法：`export default class extends B {}` ⇒ `default.bm`。
 *      〔索引缺口〕旧普查面同样没有。
 *   S4 `export const { b: bb } = { b: fn }` ⇒ `b`。〔service 缺陷〕真实绑定是 `bb`；
 *      索引对重命名的解构绑定也没登记（〔索引缺口〕）。
 *   S5 `obj.method = fn` 赋值链的属性名：`stub.returns = fn` ⇒ `returns`。
 *      〔口径〕service 独有规则，check 入口表从来没有。
 * 重复：同名成员两侧都可能重复出现（service 不去重，索引只登记一次）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "@nudojs/parser";
import {
  buildSemanticIndex,
  SUPPLEMENTARY_ENTRY_FORMS,
  type EntryForm,
  type EntryInfo,
  type SemanticIndex,
} from "@nudojs/core/internal";
import { collectTopLevelFunctions } from "../analyzer-ast.ts";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const examplesDir = join(repoRoot, "docs/examples");
const exampleFiles: readonly string[] = readdirSync(join(repoRoot, "docs/examples"), {
  recursive: true,
  encoding: "utf8",
})
  .filter((p) => /\.(?:[cm]?[jt]sx?)$/.test(p))
  .sort()
  .map((p) => join(examplesDir, p));

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

interface CensusPin {
  /** 场景。 */
  title: string;
  source: string;
  /** service `collectTopLevelFunctions` 的名字序列（含顺序与重复）。 */
  service: readonly string[];
  /** 语义索引 `entries`（登记序）。 */
  index: readonly string[];
  /** 索引登记、service 不登记（原因编号见文件头）。 */
  indexOnly?: readonly string[];
  /** service 登记、索引不登记（原因编号见文件头）。 */
  serviceOnly?: readonly string[];
}

const PINS: readonly CensusPin[] = [
  {
    title: "函数声明 / 箭头 / 函数表达式 / 具名默认导出",
    source: `export function a(): number { return 1; }
function inner(): number { return 2; }
export const b = (): number => 3;
export const c = function (): number { return 4; };
const d = function named(): number { return 5; };
let e = () => 6;
export default function main(): number { return 7; }`,
    service: ["a", "inner", "b", "c", "d", "e", "main"],
    index: ["a", "inner", "b", "c", "d", "e", "main"],
  },
  {
    title: "匿名默认导出函数",
    source: `export default function (): number { return 1; }`,
    service: ["default"],
    index: ["default"],
  },
  {
    title: "导出类：实例 / 静态 / 继承 / 说明符 / 默认导出 / 类表达式",
    source: `class Base { base(): number { return 1; } static sbase(): number { return 1; } get g(): number { return 1; } }
export class D extends Base { own(): number { return 2; } static own(): number { return 2; } constructor() {} }
export const E = class { em(): number { return 1; } };
class Hidden { run(): number { return 1; } }
export const svc = new Hidden();
class Spec { m(): number { return 1; } }
export { Spec };
class Def { m(): number { return 1; } }
export default Def;
export class Same { static x(): number { return 1; } x(): number { return 2; } }`,
    service: ["D.own", "D.base", "D.sbase", "Spec.m", "Def.m", "Same.x", "E.em"],
    // D / Same / E / Spec / Def = I1；Hidden.run = I2；Same.x 两侧都只留实例方法
    index: [
      "D", "Same", "D.own", "E", "E.em", "Spec", "Spec.m", "Def", "Def.m", "Same.x",
      "D.base", "D.sbase", "Hidden.run",
    ],
    indexOnly: ["D", "Same", "E", "Spec", "Def", "Hidden.run"],
  },
  {
    title: "具名默认导出类",
    source: `class B2 { m(): number { return 1; } }
export default class G extends B2 { gm(): number { return 1; } }`,
    service: ["G.gm", "G.m"],
    index: ["G", "G.gm", "G.m"],
    indexOnly: ["G"], // I1
  },
  {
    title: "匿名默认导出类的继承方法",
    source: `class B { bm(): number { return 1; } }
export default class extends B { m(): number { return 1; } }`,
    service: ["default.m", "default.bm"],
    index: ["default", "default.m"],
    indexOnly: ["default"], // I1
    serviceOnly: ["default.bm"], // S3
  },
  {
    title: "对象字面量导出：方法 / 属性函数 / 字符串与数字键 / 展开覆盖",
    source: `export const api = { a: 1, m(): number { return 1; }, f: function (): number { return 2; }, g: () => 3, get acc(): number { return 0; }, "str"(): number { return 1; }, 7(): number { return 1; } };
const base = { helper: 1, other(): number { return 1; } };
export const spread = { ...base, helper: 2, extra(): number { return 1; } };
const local = { lm(): number { return 1; } };
export { local };
export default { dm(): number { return 1; } };
const late = { lm(): number { return 9; } };
export { late as local2 };`,
    service: ["m", "f", "g", "str", "7", "other", "extra", "lm", "dm", "lm"],
    index: ["m", "f", "g", "str", "7", "other", "extra", "lm", "dm"],
  },
  {
    title: "与模块级绑定同名的对象成员键",
    source: `import { ping } from "node:net";
function list(): number { return 1; }
class get {}
const ok = 1;
export const api = { ping() {}, list() {}, get() {}, ok() {}, fine() {} };`,
    service: ["list", "ping", "list", "get", "ok", "fine"],
    index: ["list", "ping", "get", "ok", "fine"],
  },
  {
    title: "模板字面量键 / 计算键的常量绑定",
    source: `const k = "computed";
export const o2 = { [k]() {} };
export const o3 = { [\`tpl\`]() {} };
const withTmpl = { [\`tm\`]() {} };
export { withTmpl };
class C { [\`m\`]() {} ["s"]() {} [k]() {} }
export { C };`,
    service: ["k", "C.s", "C.computed"],
    index: ["C", "C.m", "C.s", "tpl", "tm", "computed", "C.computed"],
    // C = I1；C.m / tpl / tm = I7；computed = I8
    indexOnly: ["C", "C.m", "tpl", "tm", "computed"],
    serviceOnly: ["k"], // S2
  },
  {
    title: "字符串计算键的 CJS 槽",
    source: `exports["quoted"] = function () { return 2; };`,
    service: ["default"],
    index: ["quoted"],
    indexOnly: ["quoted"], // I5
    serviceOnly: ["default"], // S1
  },
  {
    title: "CJS 槽与对象导出",
    source: `function boom() { return 1; }
exports.greet = boom;
exports.fn = function () { return 2; };
exports.arrow = () => 3;
module.exports.slot = function () {};
exports.obj = { m() {} };
exports.notFn = 42;
if (c) exports.cond = function () {};
module.exports = { m() {}, f: function () {}, g: () => 1, n: 1, get acc() {}, "s": function () {} };
module.exports = class {};`,
    service: ["boom", "fn", "arrow", "slot", "m", "f", "g", "s"],
    // greet / cond = I4；default（匿名类）= I1
    index: ["boom", "greet", "fn", "arrow", "slot", "cond", "default", "m", "f", "g", "s"],
    indexOnly: ["greet", "cond", "default"],
  },
  {
    title: "CJS 命名类 / 类槽",
    source: `module.exports = class C { m() {} };
exports.K = class { m() {} };
const L = class { lm() {} };
exports.L = L;`,
    service: [],
    // C / K / L / default = I1；C.m / K.m / L.lm = I3
    index: ["L", "C", "C.m", "K", "K.m", "L.lm", "default"],
    indexOnly: ["L", "C", "C.m", "K", "K.m", "L.lm", "default"],
  },
  {
    title: "解构声明绑定到函数值",
    source: `export const { a, b: bb } = { a: () => 1, b: function () {} };
export const [x, y] = [() => 1, 2];
const { c } = { c: () => 1 };`,
    service: ["a", "b"],
    index: ["a", "x", "c"],
    indexOnly: ["x", "c"], // I6
    serviceOnly: ["b"], // S4
  },
  {
    title: "多声明符里的类表达式 / 对象 / 实例导出",
    source: `class Hidden { m(): number { return 1; } }
export const f1 = () => 1, f2 = function () {}, o1 = { m() {} }, C1 = class { m() {} }, s1 = new Hidden();`,
    service: ["f1", "f2", "m", "C1.m"],
    index: ["f1", "f2", "C1", "C1.m", "m", "Hidden.m"],
    indexOnly: ["C1", "Hidden.m"], // I1 / I2
  },
  {
    title: "obj.method = fn 赋值链",
    source: `stub.returns = function () { return 1; };`,
    service: ["returns"],
    index: [],
    serviceOnly: ["returns"], // S5
  },
];

function census(source: string): { service: string[]; index: SemanticIndex } {
  const ast = parse(source, { filename: "census.ts" });
  return {
    service: collectTopLevelFunctions(ast).map((f) => f.name),
    index: buildSemanticIndex(ast),
  };
}

/** 两侧普查的名字集差异（索引 → service / service → 索引），带文件标签。 */
function divergence(
  label: string,
  service: readonly string[],
  index: SemanticIndex,
): { indexOnly: EntryInfo[]; serviceOnly: string[]; text: string } {
  const serviceSet = new Set(service);
  const indexSet = new Set<string>(index.entries);
  const indexOnly = index.entryInfos.filter((e) => !serviceSet.has(e.name));
  const serviceOnly = [...new Set(service.filter((n) => !indexSet.has(n)))];
  return {
    indexOnly,
    serviceOnly,
    text:
      `${label} 索引→service 多出 [${indexOnly.map((e) => `${e.name}(${e.form})`).join(", ")}]` +
      `；service→索引 多出 [${serviceOnly.join(", ")}]`,
  };
}

const isClassNameEntry = (e: EntryInfo): boolean => e.form === "class" || e.form === "class-value";

describe("顶层函数普查对拍", () => {
  it.each(PINS)("$title：两侧序列与差异清单逐项等于钉住值", (pin) => {
    const { service, index } = census(pin.source);
    expect(service, "service 普查序列").toEqual([...pin.service]);
    expect([...index.entries], "索引入口表序列").toEqual([...pin.index]);
    const d = divergence(pin.title, service, index);
    expect(d.indexOnly.map((e) => e.name), `${pin.title} 索引→service`).toEqual([
      ...(pin.indexOnly ?? []),
    ]);
    expect(d.serviceOnly, `${pin.title} service→索引`).toEqual([...(pin.serviceOnly ?? [])]);
  });

  it("形态清单与索引导出互钉：旧普查形态之外恰是索引独有形态", () => {
    const supplementary = ALL_ENTRY_FORMS.filter(
      (f) => !(CENSUS_ENTRY_FORMS as readonly EntryForm[]).includes(f),
    );
    expect(supplementary).toEqual([...SUPPLEMENTARY_ENTRY_FORMS]);
    expect(noUnlistedForm).toBe(true);
  });

  it("夹具覆盖全部入口形态", () => {
    const seen = new Set<EntryForm>();
    for (const pin of PINS) {
      for (const e of census(pin.source).index.entryInfos) seen.add(e.form);
    }
    expect(ALL_ENTRY_FORMS.filter((f) => !seen.has(f))).toEqual([]);
  });

  it("docs/examples 语料：除类名入口外，索引 → service / service → 索引两侧名字集合一致", () => {
    expect(exampleFiles.length).toBeGreaterThan(0);
    const drift: string[] = [];
    for (const file of exampleFiles) {
      const { service, index } = census(readFileSync(file, "utf8"));
      const d = divergence(file.slice(examplesDir.length + 1), service, index);
      // 类名入口（索引登记类导出入口，函数普查只收函数）是唯一允许的差异
      const classNameOnly = d.indexOnly.every(isClassNameEntry);
      if (!classNameOnly || d.serviceOnly.length > 0) drift.push(d.text);
    }
    expect(drift, "docs/examples 两侧普查分歧").toEqual([]);
  });
});
