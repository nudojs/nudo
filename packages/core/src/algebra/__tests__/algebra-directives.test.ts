/**
 * 模块套件：directive/case/expected 解析与诊断面。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue, findFnDirectiveScope, listFnDirectiveScopes, parseSource } from "../index.ts";
import { extractFileEnvNames, extractMockModuleRecords, extractNudoImportRecords, scanThrowsDecl, scanCaseTags, parseEnvPayload, extractBalancedParens, parseNudoImportPayload, scanMalformedNudoImports, scanCaseArgSpans, scanMalformedCaseTagRests } from "../directive-scan.ts";
import { takeRefineDiags, extractDeclaredThrows, extractAssumeSegs, extractInvariantSegs, extractRefinesFromSource, setRefineDiagCollector } from "../refine.ts";
import { takeContractDiags } from "../contract/contract.ts";
import { withStdImport, stdOpts, l2Count, sigOf, issuesOf, makeFiles } from "./nudo-constraints.ts";
import { resetEngineCaches, val } from "./eval-helpers.ts";
import { checkSource as checkSource_____check_check_ts } from "../check/check.ts";
import { pTrue as pTrue_____pred_ts } from "../pred.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { stripStaticExportDecls } from "../exec/export-names.ts";
import { transpileSource } from "../exec/transpile.ts";
import { litValue } from "../abs.ts";
import { parseSource as parseSource_____parse_source_ts, resetParseSourceCache } from "../parse-source.ts";

// ---------------------------------------------------------------------------
// 粘连的函数级指令必须发诊断
// ---------------------------------------------------------------------------
describe("粘连的函数级指令必须发诊断", () => {
/**
 * 函数级指令的**粘连**形态此前在扫描层**整行不匹配且无 else 分支**
 * ⇒ **零诊断**。
 *
 * - `@nudo:assumed d <= max`（引理）⇒ 公理被丢弃 ⇒ 返回契约从「已证明」退回
 * 「未证明」，而唯一信号是**归因错误**的 `nudo:unproven-return`。
 * - `@nudo:invariantdp >= 0`（不变量）⇒ 同款无声蒸发。
 * - `@nudo:throwsTypeError`（抛错申报）⇒ 申报无声蒸发 ⇒ L2 门禁按「未申报」
 * 执法（假红），而用户以为申报生效了。
 *
 * 修复：扫描层**看得见**粘连形态（口径与族 28 的 一致）⇒
 * - 引理 / 不变量 ⇒ **坏段**通道 ⇒ `nudo:assume-invalid` / `nudo:invariant-invalid`
 * - 抛错申报 ⇒ `nudo:directive-syntax`
 * （**不另造新码**）
 */



function check(src: string, file = "/t/bug-1032.js") {
  return checkSource(file, src, pTrue);
}


  it("@nudo:assumed → nudo:assume-invalid（error）；@nudo:invariantdp → nudo:invariant-invalid（warning）；@nudo:throwsTypeError → nudo:directive-syntax（warning）；合法形态零诊断（不误伤）", () => {
  {
    const r = check(`
/**
 * @nudo:assumed d <= max
 */
export function f1032(d, max) {
  return d;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:assume-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("error");
    expect(bad[0]!.message).toContain("@nudo:assumed d <= max");
    expect(bad[0]!.line).toBe(3);
  }
  {
    const r = check(`
/**
 * @nudo:invariantdp >= 0
 */
export function f1032b(dp) {
  return dp;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:invariant-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("warning");
    expect(bad[0]!.message).toContain("@nudo:invariantdp >= 0");
    expect(bad[0]!.line).toBe(3);
  }
  {
    const r = check(
      `
/**
 * @nudo:throwsTypeError
 */
export function f1032c(x) {
  throw new TypeError("boom");
}
`,
      "/t/bug-1032c.js",
    );
    const bad = r.issues.filter((i) => i.code === "nudo:directive-syntax");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("warning");
    expect(bad[0]!.message).toContain("@nudo:throwsTypeError");
    expect(bad[0]!.line).toBe(3);
  }
  {
    const r = check(`
/**
 * @nudo:assume d <= max
 * @nudo:invariant dp >= 0
 * @nudo:throws TypeError
 */
export function ok(d, max, dp) {
  throw new TypeError("boom");
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:assume-invalid")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-invalid")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:directive-syntax")).toEqual([]);
  }
});




});

// ---------------------------------------------------------------------------
// 文本路径 — class 体 / 对象体里的文件级指令不提升为文件级
// ---------------------------------------------------------------------------
describe("文本路径 — class 体 / 对象体里的文件级指令不提升为文件级", () => {
/**
 * 回归：core **文本路径**（`directive-scan.ts`）的文件级指令位置闸门
 * 漏掉 **class 体 / 对象字面量体** ⇒ 方法 / 字段上方的 `/// @nudo:env web`
 * 被**静默提升**成**整文件** env（零诊断）。
 *
 * 根因：`functionBodyRanges` 的区间是「函数站点」区间；对 `ClassMethod` /
 * `ObjectMethod`，Babel 给的 `node.start` 是**方法键**的位置 ⇒ 方法**上方**
 * 的行注释落在区间**之外** ⇒ 闸门不拦。
 *
 * 与 parser 的 AST 路径同款修复（`packages/parser/src/directives/file-directives.ts`
 * 的 `nestedBodyRanges`，见 `parser--file-directive-class-gate.part.ts`）：
 * 闸门区间另纳入「类体（`ClassBody`）」与「对象字面量体（`ObjectExpression`）」。
 *
 * ⚠ 类**声明上方**的注释（`/// @nudo:env node` 写在 `class A {` 之前）仍是
 * 合法顶层位置 ⇒ 不纳入 `ClassDeclaration` 整体。
 */



const ENV_IN_CLASS = `export class A {
  /// @nudo:env web
  m() {}
}
`;

const ENV_IN_OBJECT = `export const o = {
  /// @nudo:env web
  m() {},
};
`;

const MOCK_IN_CLASS = `export class A {
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  m() {}
}
`;

const IMPORT_IN_CLASS = `export class A {
  /// @nudo:import { positive } from "./shapes.nudo.js"
  m() {}
}
`;


  it("env inside a class body is not file-wide；env inside an object literal body is not file-wide；mock-module inside a class body is not file-wide；@nudo:import inside a class body is not file-wide", () => {
  {
    expect(extractFileEnvNames(ENV_IN_CLASS)).toEqual([]);
  }
  {
    expect(extractFileEnvNames(ENV_IN_OBJECT)).toEqual([]);
  }
  {
    expect(extractMockModuleRecords(MOCK_IN_CLASS)).toEqual([]);
  }
  {
    expect(extractNudoImportRecords(IMPORT_IN_CLASS)).toEqual([]);
  }
});





describe("负控制（顶层位置不回归）", () => {
  it("class **声明上方**的 env 仍是文件级（合法顶层位置）；文件头的 env 仍是文件级；class 体**之后**的顶层 env 仍是文件级", () => {
  {
    expect(
      extractFileEnvNames(`/// @nudo:env node\nexport class A { m() {} }\n`),
    ).toEqual(["node"]);
  }
  {
    expect(extractFileEnvNames(`/// @nudo:env node\nexport function f() { return 1; }\n`)).toEqual([
      "node",
    ]);
  }
  {
    expect(
      extractFileEnvNames(`export class A { m() {} }\n/// @nudo:env node\n`),
    ).toEqual(["node"]);
  }
});


});
});

// ---------------------------------------------------------------------------
// 文本路径 — 数组体 / 解构模式体里的文件级指令不提升为文件级
// ---------------------------------------------------------------------------
describe("文本路径 — 数组体 / 解构模式体里的文件级指令不提升为文件级", () => {
/**
 * 回归：core **文本路径**（`directive-scan.ts`）的文件级指令位置闸门
 * 漏掉 **array 字面量体（`ArrayExpression`）** 与 **解构模式体（`ObjectPattern`）**
 * ⇒ 写在数组元素 / 解构键**上方**的 `/// @nudo:env web` 被**静默提升**成
 * **整文件** env（零诊断）。
 *
 * 根因：闸门区间只覆盖「函数体」（）+「类体 / 对象字面量体」
 * （）；数组字面量体与解构模式体同属**嵌套体**，却**不在**闸门区间内。
 *
 * 与 parser 的 AST 路径同款修复（`packages/parser/src/directives/file-directives.ts`
 * 的 `nestedBodyRanges`，见 `parser--file-directive-gate-hole.part.ts`）：
 * 闸门区间再纳入 `ArrayExpression` 与 `ObjectPattern`（+ 同族孪生
 * `ArrayPattern`）。
 *
 * ⚠ 声明**上方**的注释（`/// @nudo:env node` 写在 `class A {` / `const a = [` /
 * `const {` 之前）仍是合法顶层位置 ⇒ 放行（负控制）。
 */



const ENV_IN_ARRAY = `export const a = [
  /// @nudo:env web
  1,
];
`;

const ENV_IN_OBJECT_PATTERN = `export const {
  /// @nudo:env web
  a,
} = obj;
`;

/** 数组解构模式体（`ArrayPattern`，`ObjectPattern` 的同族孪生）。 */
const ENV_IN_ARRAY_PATTERN = `export const [
  /// @nudo:env web
  a,
] = arr;
`;

const ENV_IN_NESTED_ARRAY = `export const a = [
  [
    /// @nudo:env web
    1,
  ],
];
`;

const MOCK_IN_ARRAY = `export const a = [
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  1,
];
`;

const IMPORT_IN_OBJECT_PATTERN = `export const {
  /// @nudo:import { positive } from "./shapes.nudo.js"
  a,
} = obj;
`;


  it("env inside an array literal body is not file-wide；env inside a destructuring pattern body is not file-wide；env inside an array-destructuring pattern body is not file-wide；env inside a nested array body is not file-wide；mock-module inside an", () => {
  {
    expect(extractFileEnvNames(ENV_IN_ARRAY)).toEqual([]);
  }
  {
    expect(extractFileEnvNames(ENV_IN_OBJECT_PATTERN)).toEqual([]);
  }
  {
    expect(extractFileEnvNames(ENV_IN_ARRAY_PATTERN)).toEqual([]);
  }
  {
    expect(extractFileEnvNames(ENV_IN_NESTED_ARRAY)).toEqual([]);
  }
  {
    expect(extractMockModuleRecords(MOCK_IN_ARRAY)).toEqual([]);
  }
  {
    expect(extractNudoImportRecords(IMPORT_IN_OBJECT_PATTERN)).toEqual([]);
  }
});







describe("负控制（合法顶层位置不回归）", () => {
  it("数组**声明上方**的 env 仍是文件级；解构**声明上方**的 env 仍是文件级；数组解构**声明上方**的 env 仍是文件级；class **声明上方**的 env 仍是文件级（Bug 1088 口径不变）", () => {
  {
    expect(extractFileEnvNames(`/// @nudo:env node\nexport const a = [1, 2];\n`)).toEqual([
      "node",
    ]);
  }
  {
    expect(extractFileEnvNames(`/// @nudo:env node\nexport const { a, b } = obj;\n`)).toEqual([
      "node",
    ]);
  }
  {
    expect(extractFileEnvNames(`/// @nudo:env node\nexport const [a, b] = arr;\n`)).toEqual([
      "node",
    ]);
  }
  {
    expect(
      extractFileEnvNames(`/// @nudo:env node\nexport class A { m() {} }\n`),
    ).toEqual(["node"]);
  }
});





});
});

// ---------------------------------------------------------------------------
// switch 分组 case 标签的 hit 收窄必须安全
// ---------------------------------------------------------------------------
describe("switch 分组 case 标签的 hit 收窄必须安全", () => {
/**
 * switch **分组 case 标签**的 `hit` 收窄不安全 ⇒ L2 may-throw 假绿。
 *
 * 根因（core/algebra/exec/transpile/stmt-predicates.ts 的 `switchCaseFacts` +
 * `narrowCaseLabelArmThunk`，本分支新增）：
 * - `switchCaseFacts` 只用**原始 prim 标签**算 `hit`，**忽略** `mine.nullish`
 * （`case null:`）与**非字面量** case 测试（`case v === null:`）⇒ 一个
 * 共享体的多标签臂（`case null: case "ab":`）也被判成「命中值 = "ab"」。
 * - `narrowCaseLabelArmThunk` 据此把判别量**重绑**为那些字面量。
 *
 * 后果（假绿）：
 * `const x = null; switch (x) { case null: case "ab": return x.length; }`
 * 原生：`case null` 命中（`null === null`）⇒ `null.length` ⇒ **TypeError**；
 * 引擎按源码推导读 `"ab".length` = 2 ⇒ **L2 may-throw 消失**（假绿）。
 *
 * 修法：只有当**同体所有标签都是原始字面量**（无 nullish 标签、无非字面量
 * 测试）时才应用 `hit` 收窄；其余形态**不产命中事实**（宁缺毋假）。
 *
 * P2（`0` 标签）：`case 0:` 命中的是 `x === 0` ⇒ 值域含 **-0**（`-0 === 0`
 * 为真但 `-0 !== 0`）⇒ 直接重绑 `$lit(0)` 会把 -0 改成 +0
 * （`const x = -0; switch (x) { case 0: return 1 / x; }` 原生是 -Infinity，
 * 引擎算成 Infinity = **自信的错值**）⇒ 数值 0 的标签按**交集细化**
 * `{0, -0}`（`$join($lit(0), $lit(-0))`）而非改写单值。
 */







/** check 一次（整段函数源码；带标准 import） */
function check(src: string, file = "/t/bug1117.js") {
  return checkSource(file, withStdImport(src), pTrue, stdOpts);
}

{
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  it("分组标签（case null + case \"ab\" 共享体）⇒ 不得把 null 重绑成 \"ab\"；含非字面量 case 测试的分组臂 ⇒ 同样不得按 prim 标签重绑；P2：`case 0:` 不得把 -0 谎报成 +0（1 / -0 = -Infinity）；负控制：单一 prim 标签的 hit 收窄**保留**（case \"ab\" ⇒ x.length = 2）；负控制：单一 nullish 标签的臂仍不产命中事实（case null ⇒ null.length ", () => {
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    // 原生：`const x = null` ⇒ `case null` 命中 ⇒ `null.length` ⇒ TypeError。
    const r = check(`
export function f() {
  const x = null;
  switch (x) {
    case null:
    case "ab":
      return x.length;
    default:
      return 0;
  }
}
`);
    // 修前：hit 收窄把 x 重绑成 "ab" ⇒ 读出 2 ⇒ may-throw 消失（假绿）。
    expect(l2Count(r)).toBeGreaterThan(0);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    // 原生：`case x` 的测试值 = null ⇒ `null === null` ⇒ 命中 ⇒ `null.length`
    // ⇒ TypeError（switch 用**严格相等**匹配 case 测试）。
    expect(() =>
      new Function(`
  const x = null;
  switch (x) {
    case x:
    case "ab":
      return x.length;
    default:
      return 0;
  }
`)(),
    ).toThrow(TypeError);
    const r = check(`
export function f() {
  const x = null;
  switch (x) {
    case x:
    case "ab":
      return x.length;
    default:
      return 0;
  }
}
`);
    expect(l2Count(r)).toBeGreaterThan(0);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const r = check(`
export function f() {
  const x = -0;
  switch (x) {
    case 0:
      return 1 / x;
    default:
      return 0;
  }
}
`);
    const sig = sigOf(r, "f");
    // 原生：`-0 === 0` 为真 ⇒ 命中 ⇒ `1 / -0` = -Infinity。
    // 修前：hit 收窄把 x 重绑成 `$lit(0)` ⇒ `1 / 0` = Infinity（自信的错值）。
    expect(sig).not.toBe("Infinity");
    expect(sig).toContain("-Infinity");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const r = check(`
export function f() {
  const x = "ab";
  switch (x) {
    case "ab":
      return x.length;
    default:
      return 0;
  }
}
`);
    expect(l2Count(r)).toBe(0);
    expect(sigOf(r, "f")).toBe("2");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const r = check(`
export function f() {
  const x = null;
  switch (x) {
    case null:
      return x.length;
    default:
      return 0;
  }
}
`);
    expect(l2Count(r)).toBeGreaterThan(0);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    // `case null:` 臂存在 ⇒ default 臂上 x 不是 null ⇒ `x.length` 不抛。
    const r = check(`
export function f() {
  const x = "ab";
  switch (x) {
    case null:
      return 0;
    default:
      return x.length;
  }
}
`);
    expect(l2Count(r)).toBe(0);
    expect(sigOf(r, "f")).toBe("2");
  }
});





}
});

// ---------------------------------------------------------------------------
// 多行 `@nudo:case … !! throws` 声明不再丢失
// ---------------------------------------------------------------------------
describe("多行 `@nudo:case … !! throws` 声明不再丢失", () => {
/**
 * 回归 —— **多行** `@nudo:case … !! throws` 声明**丢失** ⇒ 闸门**假红**。
 *
 * 缺陷（假红）：
 * `scanThrowsDecl` 的同行后缀正则要求 case 的两个括号**在同一行**
 * （`\([^\n]*\)`），续行口径又要求**前一行**以 `@nudo:case` 开头 ⇒
 * ```
 * @nudo:case "neg" (
 * 0
 * ) !! throws TypeError
 * ```
 * 的申报**整条丢失** ⇒ `extractDeclaredThrows` 消费不到 ⇒ 用户**已申报**
 * 仍被 `nudo:entry-may-throw`（error 级）卡住 ⇒ CI 闸门**假红**。
 *
 * 修法（directive-scan.ts）：**先在完整注释文本里找到 case 实参的平衡终点**
 * （`extractBalancedParens`），**再**识别后缀 —— 不再靠「单行同括号」或
 * 「上一行是 case 行」推断；单行写法行为**逐字不变**。
 *
 * ⚠ 位置锚（）**不放宽**：散文行、case **名字**内部的同形文本、
 * `=> 1 !! throws`（后缀落在期望表达式一侧）仍然**不产申报**。
 */









/** 缓存重置（仓库惯例）：同名文件跑不同源码 ⇒ 模块执行缓存 / memo 会串台 */
beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

/** 多行 case 声明（实参跨行 ⇒ 旧口径读不到后缀） */
const MULTILINE_CASE = `/**
 * @nudo:case "neg" (
 * 0
 * ) !! throws TypeError
 */
export function boom(n) {
  if (n < 0) throw new TypeError("n");
  return n;
}
`;

/** 同一函数，**不写**声明 ⇒ 闸门必须执法（对照组：证明断言不空转） */
const NO_DECL = `export function boom(n) {
  if (n < 0) throw new TypeError("n");
  return n;
}
`;

const l2 = (src: string, file: string): number =>
  checkSource_____check_check_ts(file, src, pTrue_____pred_ts, {}).issues.filter((i) => i.code === "nudo:entry-may-throw")
    .length;


  it("扫描层：多行实参的 case 后缀产出申报（修前：undefined）；消费层：extractDeclaredThrows 消费得到多行形态的申报；闸门层：已申报 ⇒ 不再假红（无声明 ⇒ 照常执法，对照组）；闸门层：多行形态 + 续行形态（`)` 行之后的下一行）都放行；护栏：单行写法行为逐字不变（`*` / kind / 续行）；护栏：位置锚不放宽（Bug 1033 口径）——散文 / case 名内部 / 期望侧都不产申报", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(
      scanThrowsDecl(['@nudo:case "neg" (', "0", ") !! throws TypeError"]),
    ).toBe("TypeError");
    // 无 kind ⇒ 任意 throw（`*`）
    expect(scanThrowsDecl(['@nudo:case "neg" (', "0", ") !! throws"])).toBe("*");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(extractDeclaredThrows(MULTILINE_CASE, "boom")).toEqual(["TypeError"]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(l2(MULTILINE_CASE, "/t/bug-1118-declared.js")).toBe(0);
    expect(l2(NO_DECL, "/t/bug-1118-undeclared.js")).toBe(1);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const cont = `/**
 * @nudo:case "neg" (
 * 0
 * )
 * !! throws TypeError
 */
export function boom(n) {
  if (n < 0) throw new TypeError("n");
  return n;
}
`;
    expect(extractDeclaredThrows(cont, "boom")).toEqual(["TypeError"]);
    expect(l2(cont, "/t/bug-1118-cont.js")).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(scanThrowsDecl(['@nudo:case "neg" (0) !! throws'])).toBe("*");
    expect(scanThrowsDecl(['@nudo:case "neg" (0) !! throws Error'])).toBe("Error");
    expect(scanThrowsDecl(['@nudo:case "neg" (0)', "!! throws Error"])).toBe("Error");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(scanThrowsDecl(["Note: this helper uses !! throws"])).toBeUndefined();
    expect(scanThrowsDecl(['@nudo:case "regression: !! throws" (1)'])).toBeUndefined();
    // `=> 1 !! throws`：后缀落在期望表达式一侧 ⇒ 不是指令位置
    expect(scanThrowsDecl(['@nudo:case "b" (0) => 1 !! throws'])).toBeUndefined();
    // 多行写法同样不放宽：散文行 / case 名内部的同形文本
    expect(
      scanThrowsDecl(['@nudo:case "regression: !! throws" (', "1", ")"]),
    ).toBeUndefined();
    expect(
      scanThrowsDecl(["@nudo:case \"neg\" (", "0", ")", "Note: this helper uses !! throws"]),
    ).toBeUndefined();
  }
});






});

// ---------------------------------------------------------------------------
// case 行尾 `!! throws` 正则不再二次回溯
// ---------------------------------------------------------------------------
describe("case 行尾 `!! throws` 正则不再二次回溯", () => {
/**
 * 回归 —— case 行尾 `!! throws` 后缀正则**二次回溯**（性能 / DoS）。
 *
 * 根因（directive-scan.ts，`CASE_THROWS_SUFFIX_TAIL_RE`）：
 * 旧式 `/!!\s*throws(?:\s+[A-Za-z*][\w*|,\s]*)?\s*$/i` 里，kind 组
 * `[\w*|,\s]*` **含空白**，其后又有结尾 `\s*$` ⇒ 同一段空白有**多种切分**
 * ⇒ 回溯**二次方**（实测：5 万空格 ≈ 1.7s；10 万空格 ≈ 6.7s）⇒ 一条
 * 注释就能把 CI / `nudo check` 打爆（DoS）。
 *
 * 修法：kind 改成**无歧义**切分 —— token 内**不含空白**
 * （`[A-Za-z*][\w*|,]*`），空白只能落在 token **之间**（`token (空白 token)*`）
 * ⇒ 空白切分**唯一** ⇒ 线性。
 *
 * ⚠ 语义**不变**：kind 组只用于**剥掉**后缀（组内容被丢弃）⇒ 剥除结果与
 * 旧式逐字一致（本断言逐字校验）。
 */






/** 缓存重置（仓库惯例） */
beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

/** 预算：修后线性（实测 ≈ 0ms）⇒ 给足余量仍远低于旧式的二次方耗时 */
const BUDGET_MS = 2000;


  it("后缀不在行尾（尾部有其它字符）⇒ 不剥除，且耗时线性；后缀在行尾（后接大段空白）⇒ 照常剥除，且耗时线性；语义护栏：普通形态的剥除结果与旧式一致", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const n = 100000;
    const src = '@nudo:case "x" (0) => 1 !! throws T' + " ".repeat(n) + "!";
    const t0 = performance.now();
    const tags = scanCaseTags(src);
    const elapsed = performance.now() - t0;
    expect(tags).toHaveLength(1);
    // 语义不变：后缀不在行尾 ⇒ 期望文本原样保留
    expect(tags[0]!.expectedText).toBe(`1 !! throws T${" ".repeat(n)}!`);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const n = 100000;
    const src = '@nudo:case "x" (0) => 1 !! throws TypeError' + " ".repeat(n);
    const t0 = performance.now();
    const tags = scanCaseTags(src);
    const elapsed = performance.now() - t0;
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("1");
    expect(elapsed).toBeLessThan(BUDGET_MS);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(scanCaseTags('@nudo:case "x" (0) => 1 !! throws TypeError')[0]!.expectedText).toBe("1");
    expect(scanCaseTags('@nudo:case "x" (0) => 1 !! throws')[0]!.expectedText).toBe("1");
    expect(scanCaseTags('@nudo:case "x" (0) => 1 !! throws Error, TypeError')[0]!.expectedText).toBe("1");
    expect(scanCaseTags('@nudo:case "x" (0) => 1 !! throws Error RangeError')[0]!.expectedText).toBe("1");
    // 非后缀文本不动
    expect(scanCaseTags('@nudo:case "x" (0) => 1')[0]!.expectedText).toBe("1");
  }
});



});

// ---------------------------------------------------------------------------
// 同名嵌套函数的 case 见证不对外层契约负责
// ---------------------------------------------------------------------------
describe("同名嵌套函数的 case 见证不对外层契约负责", () => {
/**
 * 回归：`@nudo:case` 的**见证作用域**不得与 `@nudo:contract` 的
 * **契约作用域**按裸名字混在一起。
 *
 * 根因：`packages/core/src/algebra/check-case-scan.ts` 的 `scanCaseInconsistency`
 * 遍历 `listFnDirectiveScopes(file)`，只按 `knownFns.includes(scope.name)` 做
 * **裸名字匹配**（无 depth 裁决）⇒ 导出函数体内**同名**辅助函数上的
 * `@nudo:case` 见证被拿去对着**外层**函数的 `@nudo:contract` 执法 ⇒
 * `nudo:case-inconsistency`（error）⇒ 门禁**假红 / exit 1**。
 * 契约面走的是 `findFnDirectiveScope`（同名取**词法最浅**）——两面用相反的
 * 同名裁决 ⇒ 见证与契约串了作用域。
 *
 * 修法：case 面与契约面同款 depth 裁决（同名 scope 中只有最浅者参与契约对账）。
 */



const caseIssues = (src: string, path: string) =>
  issuesOf(src, path).issues.filter((i) => i.code === "nudo:case-inconsistency");


  it("内层同名 function f() 的见证 ⇒ 不报 case-inconsistency；对照组 1：内层函数改名 g ⇒ 同样不报（单变量对照）；对照组 2：外层函数自己的违例见证仍报 error（不因修复而假绿）；对照组 3：外层函数自己的合规见证不报", () => {
  {
    const r = caseIssues(
      `/**
 * @nudo:contract x positive
 */
export function f(x) {
  /** @nudo:case "inner" (-1) */
  function f() { return 1; }
  return f() + x;
}
`,
      "/t/bug-282-a.js",
    );
    expect(r).toEqual([]);
  }
  {
    const r = caseIssues(
      `/**
 * @nudo:contract x positive
 */
export function f(x) {
  /** @nudo:case "inner" (-1) */
  function g() { return 1; }
  return g() + x;
}
`,
      "/t/bug-282-b.js",
    );
    expect(r).toEqual([]);
  }
  {
    const r = caseIssues(
      `/**
 * @nudo:contract x positive
 * @nudo:case "outer-bad" (-1)
 */
export function f(x) {
  return x;
}
`,
      "/t/bug-282-c.js",
    );
    expect(r.length).toBe(1);
    expect(r[0]!.severity).toBe("error");
    expect(r[0]!.message).toContain("outer-bad");
  }
  {
    const r = caseIssues(
      `/**
 * @nudo:contract x positive
 * @nudo:case "outer-ok" (5)
 */
export function f(x) {
  return x;
}
`,
      "/t/bug-282-d.js",
    );
    expect(r).toEqual([]);
  }
});




});

// ---------------------------------------------------------------------------
// 导出名回收覆盖 $ / 非 ASCII
// ---------------------------------------------------------------------------
describe("导出名回收覆盖 $ / 非 ASCII", () => {
/**
 * 导出名回收正则的捕获组是 **ASCII-only**（`\w`）⇒ 任何含
 * **`$`** 或**非 ASCII** 字符的**导出函数名被整条丢掉**：函数体**从不被
 * 分析** ⇒ 签名塌 `unknown` ⇒ 追加**假** `nudo:unknown-inference` ⇒
 * L2 `nudo:entry-may-throw` 门禁假绿。
 *
 * 改前：`/^export function (\w+)/gm` / `/^export (?:const|let) (\w+)/gm`
 * —— `\w` 只认 ASCII 字母数字下划线。
 * 改后：捕获组放宽为 JS 标识符（`$` / `_` / Unicode ID_Start 开头，
 * ID_Continue 后续），与 `export * as` 的名口径同源（IDENT_NAME_SRC）。
 */







  it("含 $ 的导出函数名被回收；含非 ASCII 的导出函数名被回收；含 $ / 非 ASCII 的导出 const 名被回收；导出函数**被分析**（throws 面如实，不再从不被分析）；stripStaticExportDecls 文本口径也放宽（$ / 非 ASCII）；ASCII 同形口径不变（对照组）", () => {
  {
    const exports = runTranspiled(`export function $d(x) { return x + 1; }`, {
      mode: "exec",
    });
    expect(Object.keys(exports)).toEqual(["$d"]);
  }
  {
    const exports = runTranspiled(`export function 导出(x) { return x + 1; }`, {
      mode: "exec",
    });
    expect(Object.keys(exports)).toEqual(["导出"]);
  }
  {
    const exports = runTranspiled(`export const $c = 7;\nexport const 数 = 8;`, {
      mode: "exec",
    });
    expect(Object.keys(exports).sort()).toEqual(["$c", "数"]);
  }
  {
    const exports = runTranspiled(`export function $d(x) { return null.x; }`, {
      mode: "exec",
    });
    const full = callTranspiledExportFull(exports, "$d", []);
    expect(full.throws?.shape?.k ?? "never").toBe("brand");
  }
  {
    expect(stripStaticExportDecls(transpileSource(`export function $d(){}`)).names).toEqual([
      "$d",
    ]);
    expect(stripStaticExportDecls(transpileSource(`export function 导出(){}`)).names).toEqual([
      "导出",
    ]);
  }
  {
    const exports = runTranspiled(`export function ascii(x) { return x + 1; }`, {
      mode: "exec",
    });
    expect(Object.keys(exports)).toEqual(["ascii"]);
    expect(litValue(exports["ascii"] as never)).toEqual({ ok: false });
  }
});






});

// ---------------------------------------------------------------------------
// Unicode 标识符的指令文法
// ---------------------------------------------------------------------------
describe("Unicode 标识符的指令文法", () => {
/**
 * 回归：指令文法（`@nudo:assume` / `@nudo:invariant` / `@nudo:contract`
 * 目标名）用 ASCII 正则 ⇒ **中文标识符**被判 malformed ⇒ L1 假红；而侧车面
 * 把同一个中文名当一等公民 ⇒ 跨面自相矛盾。
 *
 * 修法：三条源码指令统一走 **JS 绑定名文法**（`isJsBindingIdent`，Unicode
 * 合法；`$x` 也合法）。
 */




beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});


  it("@nudo:assume 中文名 → 合法（不再是 malformed）；@nudo:assume `>=` 仍翻转为 le（中文名同样成立）；@nudo:invariant 中文名 → 合法；@nudo:invariant 中文路径段 → 合法；@nudo:contract 中文形参名 → 契约生效；@nudo:contract `$x` 形参名 → 合法（旧 ASCII 正则不收 `$`）；非法的形参名仍被判 malformed（不放宽成任意串）", () => {
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const src = `
/**
 * @nudo:assume 小数 <= 大数
 */
export function 差(小数, 大数) {
  return 大数 - 小数;
}
`;
    const segs = extractAssumeSegs(src, "差");
    expect(segs).toHaveLength(1);
    // 段带指令位置（line/column）⇒ 用 toMatchObject（不锁死新字段）
    expect(segs[0]).toMatchObject({ kind: "ok", lhs: "小数", rhs: "大数" });
  }
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const src = `
/**
 * @nudo:assume 大数 >= 小数
 */
export function 差(小数, 大数) {
  return 大数 - 小数;
}
`;
    const segs = extractAssumeSegs(src, "差");
    expect(segs).toMatchObject([{ kind: "ok", lhs: "小数", rhs: "大数" }]);
  }
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const src = `
/**
 * @nudo:invariant 计数 >= 0
 */
export function inc(计数) {
  return 计数 + 1;
}
`;
    const segs = extractInvariantSegs(src, "inc");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ kind: "ok", name: "计数", rel: "ge", value: 0 });
  }
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const src = `
/**
 * @nudo:invariant 记录.计数 >= 0
 */
export function inc(记录) {
  return 记录;
}
`;
    const segs = extractInvariantSegs(src, "inc");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ kind: "ok", name: "记录" });
  }
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const src = `
/// @nudo:import { positive } from "./positive.nudo.js"
/**
 * @nudo:contract 计数 positive
 */
export function inc(计数) {
  return 计数 + 1;
}
`;
    const { loadModule } = makeFiles({
      "/t/positive.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
    });
    const entries = extractRefinesFromSource(src, "inc", {
      loadModule,
      fromFile: "/t/cjk.js",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.param).toBe("计数");
  }
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const src = `
/// @nudo:import { positive } from "./positive.nudo.js"
/**
 * @nudo:contract $x positive
 */
export function inc($x) {
  return $x + 1;
}
`;
    const { loadModule } = makeFiles({
      "/t/positive.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
    });
    const entries = extractRefinesFromSource(src, "inc", {
      loadModule,
      fromFile: "/t/dollar.js",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.param).toBe("$x");
  }
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const src = `
/// @nudo:import { positive } from "./positive.nudo.js"
/**
 * @nudo:contract x-y positive
 */
export function inc(x) {
  return x + 1;
}
`;
    const diags: Array<{ code: string; message: string }> = [];
    setRefineDiagCollector((d) => diags.push(d));
    const { loadModule } = makeFiles({
      "/t/positive.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
    });
    const entries = extractRefinesFromSource(src, "inc", {
      loadModule,
      fromFile: "/t/bad.js",
    });
    expect(entries).toHaveLength(0);
    expect(
      diags.some((d) => d.code === "nudo:contract-syntax"),
    ).toBe(true);
  }
});







});

// ---------------------------------------------------------------------------
// case 见证与字段级 / shape 契约对账
// ---------------------------------------------------------------------------
describe("case 见证与字段级 / shape 契约对账", () => {
/**
 * 回归钉：`@nudo:case` 见证**从不与字段级 / shape 契约比对**
 * ⇒ 违反契约的见证**静默放行**（假绿，exit 0）。
 *
 * 改前有**两条独立**机制，任一条都足以让违例见证消失（只修一条不够）：
 * ① 字段级 / shape 契约**整条跳过**：`if (entry.constraint.fields) continue;`
 * ⇒ 带 `fields` 的契约在见证面零义务；
 * ② 非字面量实参（对象 / 数组）**归一成 unknown 后静默 continue**
 * ⇒ 对象 / 数组见证对任何契约都零义务。
 *
 * 改后：对象 / 数组字面量解析成真 Abs（obj / tuple），shape 契约**逐字段**
 * 对账；缺字段 → `missing field <path>`；字段 prim 不符 → `typeof <path> = "<prim>"`
 * （文案口径对齐调用点面 scan/literal-shapes.ts）。
 *
 * 负控制：满足契约的见证不报；既有标量通道（bounds / int / eq）输出零改动。
 */



/** 取见证面（nudo:case-inconsistency）的全部诊断 */
function witnessIssues(src: string, file: string) {
  return issuesOf(src, file).issues.filter((i) => i.code === "nudo:case-inconsistency");
}


  it("error: 对象见证 ⊭ 标量契约（number()）——改前机制②归一成 unknown 后静默跳过；error: shape 契约的字段类型不符——改前机制①把 fields 契约整条跳过；error: shape 契约缺字段 → missing field <path>；error: 嵌套 shape 的字段违例（路径逐段下钻）；error: shape 契约的字段数值界违例；ok: 满足 shape 契约的见证不报；ok: 满足标量契约的对象见证不报（any() 通", () => {
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a num
 * @nudo:case "bad" ({ a: "x" })
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-scalar.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.severity).toBe("error");
    expect(errs[0]!.message).toContain("bad");
    expect(errs[0]!.expected).toContain("number");
  }
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a userShape
 * @nudo:case "bad" ({ id: "x", name: "n" })
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-field-type.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.severity).toBe("error");
    expect(errs[0]!.expected).toBe('typeof id = "number"');
  }
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a userShape
 * @nudo:case "miss" ({ name: "n" })
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-missing.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.severity).toBe("error");
    expect(errs[0]!.expected).toBe("missing field id");
  }
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a orderShape
 * @nudo:case "bad" ({ user: { id: "x", name: "n" }, tags: [] })
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-nested.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.expected).toBe('typeof user.id = "number"');
  }
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a userShape
 * @nudo:case "bad" ({ id: 0, name: "n" })
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-bound.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.severity).toBe("error");
  }
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a userShape
 * @nudo:case "ok" ({ id: 7, name: "n" })
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-ok.js",
    );
    expect(errs).toEqual([]);
  }
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract a num
 * @nudo:case "bad" (5)
 */
function g(a) {
  return a;
}
`,
      "/t/case-371-scalar-ok.js",
    );
    expect(errs).toEqual([]);
  }
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "neg" (-1)
 */
function needsPositive(x) {
  return x;
}
`,
      "/t/case-371-scalar-bounds.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.expected).toContain(">");
  }
});








});

// ---------------------------------------------------------------------------
// 多行 case 实参不再被静默跳过
// ---------------------------------------------------------------------------
describe("多行 case 实参不再被静默跳过", () => {
/**
 * 回归钉：check 面的 case 实参**切分**必须与共享单源
 * （parser 的 `splitTopLevelArgs` + JSDoc 续行前缀剥离）**同口径**。
 *
 * （多行实参 ⇒ 整条见证被静默跳过）：
 * 共享单源 `scanCaseTags` 产出的 `argsText` **仍带 JSDoc 续行前缀 ` * `**
 * ⇒ check 面不剥前缀 ⇒ 实参认不出 ⇒ 整条见证被静默跳过（假绿，exit 0）。
 * 同一见证写成**单行**则正常报红 ⇒ 症状取决于排版，不是契约。
 *
 * （`\` 被当转义 ⇒ 实参个数不同 ⇒ 违例见证被静默跳过）：
 * check 面的**私有**切分器把 `\` 当转义 ⇒ `"a\", -1` 只切出 1 个实参
 * ⇒ 第二个实参上的违例见证**根本不存在** ⇒ 被静默跳过
 * ⇒ **L2 见证门禁假绿**；而 `nudo test`（共享单源）看到的是**另一个**
 * 实参列表（2 个）⇒ 两个面看到不同的世界。
 *
 * 改后：check 面剥续行前缀 + 按共享单源口径切分 ⇒ 实参个数与 `nudo test` 一致，
 * 违例见证必现在诊断里。
 *
 * R3（不静默 continue）：契约位上的实参**认不出**或**缺位** ⇒ 产可见诊断
 * （nudo:directive-syntax，warning 级）⇒ 不再静默跳过、也不再假绿。
 *
 * 负控制：同一见证写成单行仍报同一条（改前只多行形态假绿）。
 */



/** 取见证面（nudo:case-inconsistency）的全部诊断 */
function witnessIssues(src: string, file: string) {
  return issuesOf(src, file).issues.filter((i) => i.code === "nudo:case-inconsistency");
}


  it("error: 多行实参的违例见证（改前整条见证被跳过 ⇒ 零诊断 / 假绿）；ok: 多行实参满足契约不报；负控制: 同一见证写成单行仍报同一条（改前只多行形态假绿）", () => {
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "neg" (
 *   -1
 * )
 */
function needsPositive(x) {
  return x;
}
`,
      "/t/case-375-multi.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.severity).toBe("error");
    expect(errs[0]!.message).toContain("neg");
    expect(errs[0]!.expected).toContain(">");
  }
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "ok" (
 *   5
 * )
 */
function needsPositive(x) {
  return x;
}
`,
      "/t/case-375-multi-ok.js",
    );
    expect(errs).toEqual([]);
  }
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "neg" (-1)
 */
function needsPositive(x) {
  return x;
}
`,
      "/t/case-375-single.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.expected).toContain(">");
  }
});




describe("`\\` 不是转义：实参个数与共享单源一致", () => {
  it("error: `\"a\\\", -1` 切 2 个实参 ⇒ 第二个实参的违例见证被检出；负控制: 无转义引号的同形见证报同一条（改前两条都报 ⇒ 实参个数相同）", () => {
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract y positive
 * @nudo:case "c" ("a\\", -1)
 */
function f(x, y) {
  return y;
}
`,
      "/t/case-1009-escaped.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.severity).toBe("error");
    expect(errs[0]!.message).toContain("c");
    expect(errs[0]!.expected).toContain(">");
  }
  {
    const errs = witnessIssues(
      `
/**
 * @nudo:contract y positive
 * @nudo:case "c" ("a", -1)
 */
function f(x, y) {
  return y;
}
`,
      "/t/case-1009-control.js",
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.expected).toContain(">");
  }
});

});

describe("R3 — 实参认不出 / 缺位 ⇒ 可见诊断，不再静默 continue", () => {
  it("warning: 契约位上的实参认不出 ⇒ nudo:directive-syntax；warning: 契约位上没有见证实参 ⇒ nudo:directive-syntax；负控制: 无契约位的认不出实参不产见证面诊断（parser 面自行诊断）；负控制: 约束构建器实参（number()）是合法形态 ⇒ 跳过但**不产诊断**", () => {
  {
    const r = issuesOf(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "c" (someIdentifier)
 */
function f(x) {
  return x;
}
`,
      "/t/case-r3-unparsable.js",
    );
    const d = r.issues.find((i) => i.code === "nudo:directive-syntax");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("warning");
    expect(d!.message).toContain("could not be parsed");
  }
  {
    const r = issuesOf(
      `
/**
 * @nudo:contract y positive
 * @nudo:case "c" (1)
 */
function f(x, y) {
  return y;
}
`,
      "/t/case-r3-missing-arg.js",
    );
    const d = r.issues.find((i) => i.code === "nudo:directive-syntax");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("warning");
    expect(d!.message).toContain("no witness argument");
  }
  {
    const r = issuesOf(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "c" (5)
 */
function f(x) {
  return x;
}
`,
      "/t/case-r3-control.js",
    );
    expect(r.issues.filter((i) => i.code === "nudo:directive-syntax")).toEqual([]);
  }
  {
    // 符号见证（一个域，不是具体值）⇒ 见证面无比对对象 ⇒ 跳过；
    // 它**不是**文法缺口 ⇒ 不得产 directive-syntax（否则 examples 假红）。
    const r = issuesOf(
      `
/**
 * @nudo:contract x positive
 * @nudo:case "symbolic" (number())
 */
function f(x) {
  return x;
}
`,
      "/t/case-r3-builder.js",
    );
    expect(r.issues.filter((i) => i.code === "nudo:directive-syntax")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency")).toEqual([]);
  }
});



});
});

// ---------------------------------------------------------------------------
// @nudo:env payload grammar
// ---------------------------------------------------------------------------
describe("@nudo:env payload grammar", () => {
/**
 * `@nudo:env` 的载荷文法**静默丢掉整条列表**：空格分隔
 * （`node web`）与裸标签（`/// @nudo:env`）都不生效、零诊断。
 *
 * 根因（core 载荷文法）：`parseEnvPayload` **只按 `,` 切分** ⇒ 空格分隔
 * 列表（`node web`）被切成**一个** token 后整条滤掉；裸标签
 * `/// @nudo:env` 因正则要求 `\s+(.+)` 而**根本不匹配** ⇒ 两种形态都
 * **零诊断**地丢弃 ⇒ env 未解析 ⇒ 全局 `unknown` ⇒ `conf=opaque`。
 *
 * 本钉锁：逗号**与**空白两种分隔符都认；裸标签不产出 env 名（诊断由
 * parser AST 通道落，见 parser 侧同族钉）。
 */




  it("space-separated env list is recognized (was dropped as one token)；comma-separated env list still works (control)；mixed separators are accepted；trailing line comment is stripped；path-like env names survive whitespace splitting；bare tag yield", () => {
  {
    expect(parseEnvPayload("node web")).toEqual(["node", "web"]);
    expect(extractFileEnvNames(`/// @nudo:env node web\n`)).toEqual(["node", "web"]);
  }
  {
    expect(parseEnvPayload("node, web")).toEqual(["node", "web"]);
    expect(extractFileEnvNames(`/// @nudo:env node, web\n`)).toEqual(["node", "web"]);
  }
  {
    expect(parseEnvPayload("node, web es")).toEqual(["node", "web", "es"]);
  }
  {
    expect(parseEnvPayload("node // only node")).toEqual(["node"]);
  }
  {
    expect(parseEnvPayload("es ./other.env.ts")).toEqual(["es", "./other.env.ts"]);
  }
  {
    expect(extractFileEnvNames(`/// @nudo:env\n`)).toEqual([]);
    expect(extractFileEnvNames(`/// @nudo:env \n`)).toEqual([]);
  }
  {
    expect(parseEnvPayload(`node";`)).toEqual([]);
    expect(extractFileEnvNames(`// @nudo:env node";\n`)).toEqual([]);
  }
});







});

// ---------------------------------------------------------------------------
// 箭头初始化器上的内联 JSDoc 绑到绑定名
// ---------------------------------------------------------------------------
describe("箭头初始化器上的内联 JSDoc 绑到绑定名", () => {
/**
 * 箭头函数**初始化器上的** JSDoc 绑到 `<anonymous>` 而不是导出名 `f`
 * → 见证落在错的函数名下（`nudo test` 打出 `=== <anonymous> ===`）。
 *
 * 根因（`directive-scan.ts` 的 `VariableDeclaration` 分支）：它按**语句**的
 * `leadingComments` 建了一个名为 `f` 的 scope（内联形态下为空），而**内联**
 * JSDoc 落在初始化器（`ArrowFunctionExpression`）节点上 ⇒ 见证被登记在
 * `<anonymous>` 名下。
 *
 * 修法：变量声明的函数初始化器**只建一个** scope，名字取**绑定名**（`f`），
 * 注释取「函数节点自身 + 语句宿主」的合并（语句级与内联两种形态都可见）。
 */



const INLINE = `const f = /** @nudo:case "inline" (1) */ () => 1;
export { f };
`;

const ABOVE = `/**
 * @nudo:case "inline" (1)
 */
const f = () => 1;
export { f };
`;

const INLINE_FN_EXPR = `const f = /** @nudo:case "inline" (1) */ function () { return 1; };
export { f };
`;

function scopesOf(src: string) {
  return listFnDirectiveScopes(parseSource(src));
}


  it("内联形态：见证落在 f 上；内联形态：不再产生 <anonymous> 影子 scope；内联形态：按名查找拿到 f 的注释行；语句级形态（对照）：见证同样落在 f 上；函数表达式初始化器的内联形态同样绑到绑定名", () => {
  {
    const f = scopesOf(INLINE).find((s) => s.name === "f");
    expect(f?.commentLines).toContain('@nudo:case "inline" (1)');
  }
  {
    const names = scopesOf(INLINE).map((s) => s.name);
    expect(names).toEqual(["f"]);
    expect(names).not.toContain("<anonymous>");
  }
  {
    const scope = findFnDirectiveScope(parseSource(INLINE), "f");
    expect(scope?.commentLines).toContain('@nudo:case "inline" (1)');
  }
  {
    const f = scopesOf(ABOVE).find((s) => s.name === "f");
    expect(f?.commentLines).toContain('@nudo:case "inline" (1)');
    expect(scopesOf(ABOVE).map((s) => s.name)).toEqual(["f"]);
  }
  {
    const f = scopesOf(INLINE_FN_EXPR).find((s) => s.name === "f");
    expect(f?.commentLines).toContain('@nudo:case "inline" (1)');
  }
});





});

// ---------------------------------------------------------------------------
// 配平扫描器转义感知：转义引号不再吃掉整条 case
// ---------------------------------------------------------------------------
describe("配平扫描器转义感知：转义引号不再吃掉整条 case", () => {
/**
 * 括号配平扫描器**不感知转义** ⇒ 双引号串里的 `\"` 被当成**字符串结束**
 * ⇒ 括号**提前闭合** ⇒ **整条 case 被丢弃**（只剩一条归因错误的「unclosed argument
 * list」警告）⇒ 断言从不运行、零见证（假绿）。
 *
 * 根因行：`packages/core/src/algebra/directive-scan.ts` 的 `extractBalancedParens`
 * —— 字符串感知，但 `\` 不当转义。
 *
 * 改后：配平**优先**按 JS 转义语义走（`\"` 不结束字符串）⇒ 括号配平正确 ⇒
 * 含转义引号的 case 被正常抽出、正常执法。
 *
 * ⚠ 口径边界（钉住）：串**未闭合**（`"a\", -1` —— 非法 JS 串）时**回退**
 * 宽松口径（`\` 不是转义）⇒ 实参个数与共享单源保持一致。
 */




  it("extractBalancedParens: 双引号串里的 `\\\"` 不结束字符串；extractBalancedParens: 对象 / 数组字面量里的转义引号同样配平；extractBalancedParens: 单引号串里的 `\\'` 不结束字符串；scanCaseTags: 含转义引号的 case 被抽出（改前整条被丢弃）；负控制（Bug 1009 口径保留）: 串未闭合时回退宽松口径 ⇒ 实参个数不变；负控制: 无转义引号的普通实参不受影响", () => {
  {
    const text = '("a\\"b")';
    expect(extractBalancedParens(text, 0)).toBe('"a\\"b"');
  }
  {
    expect(extractBalancedParens('({ a: "x\\"y" })', 0)).toBe('{ a: "x\\"y" }');
    expect(extractBalancedParens('(["x\\"y"])', 0)).toBe('["x\\"y"]');
  }
  {
    expect(extractBalancedParens("('it\\'s')", 0)).toBe("'it\\'s'");
  }
  {
    const tags = scanCaseTags('@nudo:case "k" ("a\\"b") => 3');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.name).toBe("k");
    expect(tags[0]!.argsText).toBe('"a\\"b"');
    expect(tags[0]!.expectedText).toBe("3");
  }
  {
    // `"a\", -1` 是**非法** JS 串（未闭合）⇒ 宽松口径切成 2 个实参
    expect(extractBalancedParens('("a\\", -1)', 0)).toBe('"a\\", -1');
    const tags = scanCaseTags('@nudo:case "c" ("a\\", -1)');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.argsText).toBe('"a\\", -1');
  }
  {
    expect(extractBalancedParens("(1, 2)", 0)).toBe("1, 2");
    expect(extractBalancedParens("(", 0)).toBeNull();
  }
});






});

// ---------------------------------------------------------------------------
// 空载荷的 assume / invariant 必须发诊断
// ---------------------------------------------------------------------------
describe("空载荷的 assume / invariant 必须发诊断", () => {
/**
 * `@nudo:assume` / `@nudo:invariant` 的**空载荷**此前**零诊断**。
 *
 * 根因：段扫描用严格正则 `^@nudo:assume\s+(.+)$`（载荷非空）⇒ 空载荷行
 * **整行不匹配**且**无 else 分支** ⇒ 段列表为空 ⇒ 消费方（check）连一条
 * bad 段都拿不到 ⇒ 用户的引理/不变量**无声丢失**（返回契约从「已证明」退回
 * 「未证明」，唯一信号是**归因错误**的 nudo:unproven-return）。
 *
 * 修复：空载荷产出**坏段**（raw = ""）⇒ 既有的 `nudo:assume-invalid` /
 * `nudo:invariant-invalid` 通道自然接管（**不另造新码**）。
 */



function check(src: string) {
  return checkSource("/t/bug-421.js", src, pTrue);
}


  it("@nudo:assume 空载荷 → nudo:assume-invalid（error）；@nudo:invariant 空载荷 → nudo:invariant-invalid（warning）；空载荷（纯空白）与合法载荷不回归；合法 assume / invariant 零诊断（不误伤）", () => {
  {
    const r = check(`
/**
 * @nudo:assume
 */
export function f421(x) {
  return x;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:assume-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("error");
    expect(bad[0]!.message).toContain("malformed @nudo:assume");
    expect(bad[0]!.fn).toBe("f421");
    // 位置 = 出错指令行（不是文件首行 / 函数声明行）
    expect(bad[0]!.line).toBe(3);
  }
  {
    const r = check(`
/**
 * @nudo:invariant
 */
export function f421b(dp) {
  return dp;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:invariant-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("warning");
    expect(bad[0]!.message).toContain("malformed @nudo:invariant");
    expect(bad[0]!.line).toBe(3);
  }
  {
    const r = check(`
/**
 * @nudo:assume
 */
export function empty(x) {
  return x;
}
/**
 * @nudo:assume d <= max
 */
export function ok(d, max) {
  return d;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:assume-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.fn).toBe("empty");
  }
  {
    const r = check(`
/**
 * @nudo:assume d <= max
 */
export function ok(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:assume-invalid")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-invalid")).toEqual([]);
  }
});




});

// ---------------------------------------------------------------------------
// empty @nudo:import payload is diagnosable
// ---------------------------------------------------------------------------
describe("empty @nudo:import payload is diagnosable", () => {
/**
 * `@nudo:import` 的**空载荷**被**静默丢弃**（零诊断），而同一条
 * 指令的**其它**未识别形态有 `nudo:contract-syntax` 警告。
 *
 * 根因（core 文本扫描通道）：空载荷在 `nudoImportPayloads` 这一层就被丢弃
 * （连 payload 都没产出）⇒ 畸形扫描器**永远看不到它** ⇒ 「标签命中但载荷
 * 为空」**零诊断**。
 *
 * 本钉锁：标签命中但载荷为空 ⇒ 产出一条**可诊断的载荷**（`malformed`），
 * 让既有的 `nudo:contract-syntax` 通道自然接管。
 */




  it("bare tag is reported as a malformed import；bare tag with trailing blank is reported as a malformed import；empty payload produces no import record (only a diagnostic)；empty payload is malformed at the grammar level too；valid and other malfor", () => {
  {
    expect(scanMalformedNudoImports(`/// @nudo:import\n`)).toEqual(["malformed"]);
  }
  {
    expect(scanMalformedNudoImports(`/// @nudo:import \n`)).toEqual(["malformed"]);
  }
  {
    expect(extractNudoImportRecords(`/// @nudo:import\n`)).toEqual([]);
  }
  {
    expect(parseNudoImportPayload("")).toBe("malformed");
    expect(parseNudoImportPayload("   ")).toBe("malformed");
  }
  {
    expect(scanMalformedNudoImports(`/// @nudo:import { a } from "./x.nudo.js"\n`)).toEqual([]);
    expect(scanMalformedNudoImports(`/// @nudo:import ./nope.js\n`)).toEqual(["malformed"]);
  }
});





});

// ---------------------------------------------------------------------------
// CRLF 源文件里 `=> expected` 不再被吞掉
// ---------------------------------------------------------------------------
describe("CRLF 源文件里 `=> expected` 不再被吞掉", () => {
/**
 * CRLF 源文件里 `=> expected` 的期望值被**整条吞掉** ⇒ 该 case 判
 * `[unchecked]` ⇒ 断言**不执法**、`nudo test` **exit 0**、**屏幕上零诊断**（假绿）。
 *
 * 根因行：`packages/core/src/algebra/directive-scan.ts` 的 `extractCaseExpectedExpr`
 * —— 切行用 `split("\n")`，取行尾用 `.`（**不匹配 `\r`**）⇒ CRLF 的 `\r` 留在
 * 期望文本尾部 ⇒ 期望解析失败 ⇒ 期望被丢弃。
 *
 * 改后：切行按 `\r?\n`、行尾 `\r` 不再污染期望 ⇒ 期望被抽出 ⇒ 断言照常执法。
 */




  it("CRLF: 期望被抽出（改前整条期望消失）；LF（负控制）: 期望照旧被抽出；CRLF: 块注释续行形态的期望同样被抽出；CRLF: 无期望的 case 不受影响（expectedText 仍为 undefined）", () => {
  {
    const tags = scanCaseTags('@nudo:case "c" (1) => 999\r\n');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("999");
  }
  {
    const tags = scanCaseTags('@nudo:case "c" (1) => 999\n');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("999");
  }
  {
    const text = '*\r\n * @nudo:case "c" (1) => 999\r\n ';
    const tags = scanCaseTags(text);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("999");
  }
  {
    const tags = scanCaseTags('@nudo:case "c" (1)\r\n');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBeUndefined();
  }
});




});

// ---------------------------------------------------------------------------
// `!! throws [Kind]` 后缀不再吃掉期望值
// ---------------------------------------------------------------------------
describe("`!! throws [Kind]` 后缀不再吃掉期望值", () => {
/**
 * case 行上的 `!! throws [Kind]` **后缀**（文档化形态）被当**期望值文本**
 * ⇒ 期望**整条丢失**（后缀在 `=>` 之前：判 `[unchecked]`、零诊断）或**被腐蚀**
 * （后缀在 `=>` 之后：`1 !! throws` 解析失败 ⇒ 退化成「什么都接受」/ 假红）。
 *
 * 根因行：`packages/core/src/algebra/directive-scan.ts` 的 `extractCaseExpectedExpr`
 * —— 期望文本 = `=>` 之后的原始剩余，**不认** `!! throws` 后缀。
 *
 * 改后：**只**在**期望表达式文本**里剥后缀 ⇒ 期望不再被顶掉/腐蚀。
 *
 * ⚠ 硬规则（回归护栏）：**不得改写 case 行本身** ⇒ 函数级 `!! throws` 申报
 * （`scanThrowsDecl` 读的是**原文行**）必须**照旧**看得见后缀。
 */




  it("后缀在 `=>` 之前: 期望照旧被抽出（改前整条期望消失）；后缀在 `=>` 之后: 期望文本不被腐蚀（改前是 `1 !! throws`）；后缀带 kind: 期望文本只剩期望本身；文档化形态（只有后缀、没有 `=>`）: 没有期望（后缀是**申报**不是期望）；回归护栏: case 行本身不被改写 ⇒ `!! throws` 后缀申报仍在；回归护栏: 后缀在 `=>` 之后时**申报口径不变**（既有约定：后缀须紧跟实参括号）", () => {
  {
    const tags = scanCaseTags('@nudo:case "a" (0) !! throws => 1');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("1");
  }
  {
    const tags = scanCaseTags('@nudo:case "b" (0) => 1 !! throws');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("1");
  }
  {
    const tags = scanCaseTags('@nudo:case "c" (0) => 1 !! throws TypeError');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("1");
  }
  {
    const tags = scanCaseTags('@nudo:case "neg" (0) !! throws');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBeUndefined();
  }
  {
    // 片 4 的 case 后缀申报读的是**原文行**——426 只在期望文本的局部副本上剥后缀
    const lines = ['@nudo:case "neg" (0) !! throws'];
    expect(scanThrowsDecl(lines)).toBe("*");
  }
  {
    // 收紧后的口径：后缀申报只在**实参括号闭合之后**、紧邻 `!! throws`
    // 时产出 ⇒ `=> 1 !! throws` **本来就没有**申报（改前改后一致）
    const lines = ['@nudo:case "b" (0) => 1 !! throws'];
    expect(scanThrowsDecl(lines)).toBeUndefined();
  }
});






});

// ---------------------------------------------------------------------------
// 期望表达式的冗余括号被剥掉
// ---------------------------------------------------------------------------
describe("期望表达式的冗余括号被剥掉", () => {
/**
 * 期望表达式带**一层冗余括号**（`=> (999)` / `=> ("a")` / `=> ({ b: 1 })`）
 * ⇒ 期望解析失败 ⇒ 断言退化成「什么都接受」（空洞通过）或**恒假红**
 * ⇒ case 形同虚设。
 *
 * 根因行：`packages/core/src/algebra/directive-scan.ts` 的 `extractCaseExpectedExpr`
 * —— 期望文本 = `=>` 之后的原始剩余（**不剥**外层括号），而实参侧
 * （`extractBalancedParens`）**剥**外层括号 ⇒ 两面口径不一致。
 *
 * 改后：期望文本剥**外层冗余括号**（与实参侧同口径）；箭头函数
 * （`(x) => y`）**不受影响**。
 */




  it("数字字面量: `=> (999)` ⇒ `999`；字符串字面量: `=> (\"abc\")` ⇒ `\"abc\"`；对象字面量: `=> ({ b: 1 })` ⇒ `{ b: 1 }`；元组字面量: `=> ([1, 2])` ⇒ `[1, 2]`；多层括号: 逐层剥到表达式本体；负控制: 无括号形态不受影响；负控制: 箭头函数不被误剥（`(x) => y` 的括号不是冗余层）", () => {
  {
    const tags = scanCaseTags('@nudo:case "a" (1) => (999)');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("999");
  }
  {
    const tags = scanCaseTags('@nudo:case "a" (1) => ("abc")');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe('"abc"');
  }
  {
    const tags = scanCaseTags('@nudo:case "a" ({ a: 1 }) => ({ b: 1 })');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("{ b: 1 }");
  }
  {
    const tags = scanCaseTags('@nudo:case "a" (1) => ([1, 2])');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("[1, 2]");
  }
  {
    const tags = scanCaseTags('@nudo:case "a" (1) => ((999))');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("999");
  }
  {
    const tags = scanCaseTags('@nudo:case "a" (1) => 999');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("999");
  }
  {
    const tags = scanCaseTags('@nudo:case "a" (1) => (x) => x + 1');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("(x) => x + 1");
  }
});







});

// ---------------------------------------------------------------------------
// .ts 尖括号类型断言不再整文件解析失败
// ---------------------------------------------------------------------------
describe(".ts 尖括号类型断言不再整文件解析失败", () => {
/**
 * 解析器**无条件**启用 `jsx` 插件 ⇒ `.ts`（非 `.tsx`）里**合法**的
 * 尖括号类型断言 `<T>x` 被 Babel 当成 JSX ⇒ **整文件解析失败**
 * （`check` / `test` / `export` / `migrate strip` 全废）。
 *
 * 根因：`parseSource(source, opts)` 拿不到文件名 ⇒ 对所有源一律
 * `["typescript", "jsx"]`；TS+JSX 双插件下 `<` 起始的表达式**优先**按 JSX 解析。
 *
 * 修法（路线 A，单文件 / 零调用面改动 / `parseSource` 签名不变）：
 * `packages/core/src/algebra/parse-source.ts` 的 `parseWithJsxFallback` ——
 * 解析**硬失败**时去掉 `jsx` **重试一次**。
 *
 * 已知**未覆盖**形态：`errorRecovery: true` 下 `<T>(x) => x`（泛型箭头无尾逗号）
 * 在 TS+JSX 下是「软成功」（errors=1、AST 失真）⇒ 不抛错 ⇒ 不触发重试。
 */




const TS_ANGLE = `const n = <number>1;
export function f(x: number): number {
  return x + n;
}
`;


  it("无 filename 时 `<number>1` 解析成功（降级重试命中）；带 filename=x.ts 时同样解析成功；引擎端到端：`<number>1` 求值为字面量 1（剥除面已就绪）；泛型箭头 `<T>(x) => x`（无尾逗号）在硬失败路径下被重试救回；真 JSX 源不受降级影响（TS+JSX 本就解析成功 ⇒ 不触发重试）；模式分流仍在：`.ts` 收 TS 语法、`.js` 不收（缓存键含模式 ⇒ 不串味）", () => {
  {
    resetParseSourceCache();
    const ast = parseSource_____parse_source_ts(TS_ANGLE);
    expect(ast.program.body.length).toBe(2);
  }
  {
    resetParseSourceCache();
    const ast = parseSource_____parse_source_ts(TS_ANGLE, { filename: "x.ts" });
    expect(ast.program.body.length).toBe(2);
  }
  {
    resetParseSourceCache();
    const v = val(`const n = <number>1;
export function f() { return n; }
`);
    expect(v).toEqual({ ok: true, value: 1 });
  }
  {
    resetParseSourceCache();
    const ast = parseSource_____parse_source_ts(`const g = <T>(x: T) => x;
export function f(x: number) { return x; }
`);
    expect(ast.program.body.length).toBe(2);
  }
  {
    resetParseSourceCache();
    const ast = parseSource_____parse_source_ts(`export const el = <div a={1} />;
`);
    expect(ast.program.body.length).toBe(1);
  }
  {
    resetParseSourceCache();
    const tsOnly = `const x: number = 1;
export function f() { return x; }
`;
    expect(parseSource_____parse_source_ts(tsOnly, { filename: "x.ts" }).program.body.length).toBe(2);
    // `.js` 模式不开 typescript 插件 ⇒ TS 注解是**真语法错**（重试也救不回 ⇒ 仍抛）
    expect(() => parseSource_____parse_source_ts(tsOnly, { filename: "x.js" })).toThrow();
  }
});

// ---------------------------------------------------------------------------
// TS 4.9 accessor 与 TS 5 标准装饰器
// ---------------------------------------------------------------------------
describe("TS 4.9 accessor 与 TS 5 标准装饰器整文件解析成功", () => {
  it("accessor 字段 ⇒ ClassAccessorProperty；类 / 方法 / 字段装饰器 ⇒ decorators 长度 1；@dec export 与 export @dec 两种顺序均可解析", () => {
    {
      const ast = parseSource_____parse_source_ts(`export class C { accessor x = 1; }\n`, { keepTs: true });
      const cls = (ast.program.body[0] as any).declaration;
      expect(cls.body.body[0].type).toBe("ClassAccessorProperty");
      expect(cls.body.body[0].key.name).toBe("x");
    }
    {
      const ast = parseSource_____parse_source_ts(`function dec(v: any) { return v; }
@dec
export class D {
  @dec accessor x = 1;
  @dec m() {}
}
`, { keepTs: true });
      const cls = (ast.program.body[1] as any).declaration;
      expect(cls.decorators).toHaveLength(1);
      expect(cls.body.body.map((m: any) => m.decorators?.length)).toEqual([1, 1]);
    }
    {
      const before = parseSource_____parse_source_ts(`function dec(v: any) { return v; }
@dec export class E {}
`, { keepTs: true });
      const after = parseSource_____parse_source_ts(`function dec(v: any) { return v; }
export @dec class F {}
`, { keepTs: true });
      expect((before.program.body[1] as any).declaration.decorators).toHaveLength(1);
      expect((after.program.body[1] as any).declaration.decorators).toHaveLength(1);
    }
  });
});

});

// ---------------------------------------------------------------------------
// malformed @nudo:case argument regions are masked too
// ---------------------------------------------------------------------------
describe("malformed @nudo:case argument regions are masked too", () => {
/**
 * **畸形**的 `@nudo:case` 不登记**参数区间掩码** ⇒ case 参数里的
 * `@nudo:mock` / `@nudo:skip` **泄漏**成真指令 ⇒ 假红 / d.ts 丢方法。
 *
 * 根因：`scanCaseArgSpans` 只登记**合法** case 形态（双引号名 + 同行实参括号）的
 * 区间；畸形形态（单引号名 / 空名 / 缺括号…）的实参区间没被遮罩。
 *
 * 修复：畸形 case 也登记实参区间（**只遮罩实参、不遮罩标签本身**——标签本身仍要报
 * 「畸形 case 名」诊断）。
 */



const MALFORMED = `\n * @nudo:case 'bad' (\n *   @nudo:mock fetch = (u) => ({ ok: true }))\n`;


  it("the argument region of a malformed case is registered as a span；the tag itself is NOT masked (the malformed-name diagnostic still fires)；a well-formed case still masks its whole tag+arguments region；a case without an argument list registers", () => {
  {
    const spans = scanCaseArgSpans(MALFORMED);
    expect(spans).toHaveLength(1);
    const mockIdx = MALFORMED.indexOf("@nudo:mock");
    expect(spans.some(([s, e]) => mockIdx >= s && mockIdx < e)).toBe(true);
  }
  {
    const spans = scanCaseArgSpans(MALFORMED);
    const tagIdx = MALFORMED.indexOf("@nudo:case");
    expect(spans.some(([s, e]) => tagIdx >= s && tagIdx < e)).toBe(false);
  }
  {
    const text = `\n * @nudo:case "ok" (\n *   1)\n`;
    const spans = scanCaseArgSpans(text);
    expect(spans).toHaveLength(1);
    const tagIdx = text.indexOf("@nudo:case");
    expect(spans.some(([s, e]) => tagIdx >= s && tagIdx < e)).toBe(true);
  }
  {
    expect(scanCaseArgSpans(`\n * @nudo:case "ok"\n`)).toEqual([]);
  }
});




});

// ---------------------------------------------------------------------------
// text-level file-level extraction is position-gated
// ---------------------------------------------------------------------------
describe("text-level file-level extraction is position-gated", () => {
/**
 * **文件级** `@nudo:env` / `@nudo:mock-module` / `@nudo:import` 写在
 * **函数体内部**也被当成文件级指令 ⇒ 整文件 env / 模块替换 / 约束模板被静默改写，
 * **零诊断**。
 *
 * 根因（core 文本路径）：`directiveCommentLinesRaw` 把注释**拍平成只带文本、不带
 * 位置**的列表，`extractFileEnvNames` / `extractMockModuleRecords` / `nudoImportPayloads`
 * 只按文本取载荷 ⇒ 函数体里的指令与文件顶部的指令**无法区分**。
 *
 * 位置闸门口径（与 parser AST 路径同口径）：文件级指令**不得落在任何函数体内**；
 * 顶层位置（文件头 / `export` 行 / 语句之间）一律放行。
 */



const ENV_IN_FN = `export function f(a) {
  /// @nudo:env node
  return process.pid;
}
`;

const MOCK_MODULE_IN_FN = `export function f(a) {
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  return a;
}
`;

const IMPORT_IN_FN = `export function f(a) {
  /// @nudo:import { positive } from "./shapes.nudo.js"
  return a;
}
`;


  it("env inside a function body is not file-wide；mock-module inside a function body is not file-wide；@nudo:import inside a function body is not file-wide；the same directives at the top of the file are honored；a top-level directive after other st", () => {
  {
    expect(extractFileEnvNames(ENV_IN_FN)).toEqual([]);
  }
  {
    expect(extractMockModuleRecords(MOCK_MODULE_IN_FN)).toEqual([]);
  }
  {
    expect(extractNudoImportRecords(IMPORT_IN_FN)).toEqual([]);
  }
  {
    expect(extractFileEnvNames(`/// @nudo:env node\nexport function f() { return 1; }\n`)).toEqual([
      "node",
    ]);
    expect(
      extractMockModuleRecords(
        `/// @nudo:mock-module "fs" from "./m.js"\nexport function f() { return 1; }\n`,
      ).map((r) => r.source),
    ).toEqual(["fs"]);
    expect(
      extractNudoImportRecords(
        `/// @nudo:import { positive } from "./std.nudo.js"\nexport function f() { return 1; }\n`,
      ),
    ).toHaveLength(1);
  }
  {
    expect(
      extractFileEnvNames(`export function g() { return 1; }\n/// @nudo:env node\n`),
    ).toEqual(["node"]);
  }
  {
    expect(
      extractFileEnvNames(`export /// @nudo:env node\nfunction f() { return 1; }\n`),
    ).toEqual(["node"]);
  }
});






});

// ---------------------------------------------------------------------------
// `=> expected` 的排版不再让期望静默消失
// ---------------------------------------------------------------------------
describe("`=> expected` 的排版不再让期望静默消失", () => {
/**
 * `=> expected` 在「期望值不与 `=>` 同行」（形态 A）或「`=>` 后为空」
 * （形态 B）时，期望被**静默丢弃** ⇒ 该 case 判 `[unchecked]` ⇒ 断言**不执法**、
 * `nudo test` **exit 0**、**屏幕上零诊断**（完全静默的假绿）。
 *
 * 根因行：`packages/core/src/algebra/directive-scan.ts` 的 `extractCaseExpectedExpr`
 * —— 只取**同行**剩余；本行为空 ⇒ 直接放弃（形态 A）；`=>` 后为空 ⇒ 同样放弃
 * （形态 B），且**没有任何诊断**。
 *
 * 改后：
 * - 形态 A：往下找一行拿期望值；
 * - 形态 B：**产出行首锚的语法错**（`expectedIssue`）⇒ 消费方发
 * `nudo:directive-syntax`（不再静默吞错）。
 */




  it("形态 A: 期望值在下一行 ⇒ 期望被抽出；形态 A（无续行前缀）: 期望值在下一行 ⇒ 期望被抽出；形态 B: `=>` 后为空 ⇒ 没有期望，但**产出行首锚的语法错**（不再静默）；形态 B（续行也没有值）: 同样产出行首锚的语法错；负控制: 同行形态照旧（期望被抽出、无语法错）；负控制: 没有 `=>` 的 case（本就无期望）不产语法错", () => {
  {
    const text = '@nudo:case "multi" (2) =>\n *   4\n ';
    const tags = scanCaseTags(text);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("4");
  }
  {
    const text = '@nudo:case "multi" (2) =>\n4\n';
    const tags = scanCaseTags(text);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("4");
  }
  {
    const tags = scanCaseTags('@nudo:case "empty" (1) => ');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBeUndefined();
    expect(tags[0]!.expectedIssue).toBe("missing expected expression after '=>'");
  }
  {
    const text = '@nudo:case "empty" (1) =>\n * @nudo:pure\n ';
    const tags = scanCaseTags(text);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedIssue).toBe("missing expected expression after '=>'");
  }
  {
    const tags = scanCaseTags('@nudo:case "ok" (2) => 4');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("4");
    expect(tags[0]!.expectedIssue).toBeUndefined();
  }
  {
    const tags = scanCaseTags('@nudo:case "plain" (1)');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBeUndefined();
    expect(tags[0]!.expectedIssue).toBeUndefined();
  }
});






});

// ---------------------------------------------------------------------------
// 粘连写法 `@nudo:case"c1"` 不再静默蒸发
// ---------------------------------------------------------------------------
describe("粘连写法 `@nudo:case\"c1\"` 不再静默蒸发", () => {
/**
 * `@nudo:case"c1" (1, 2)`（标签与名字之间**无空白**）⇒ 抽取侧（严格
 * `[ \t]+`）**不匹配** + 诊断侧（宽松 `[ \t]*`）**判合法** ⇒ 整条 case **静默
 * 蒸发** ⇒ `nudo test` 一个 case 都不跑、**零诊断**（假绿）。
 *
 * 根因：`CASE_NAME_REGEX`（抽取）与 `CASE_TAG_REGEX`（诊断）**文法不一致**；
 * `scanMalformedCaseTagRests` 的畸形判据**没跟抽取侧的真实文法对齐**。
 *
 * 改后：两条正则**共用同一段文法**（宽松侧**捕获分隔空白**），诊断侧按「标签后
 * 没有空白 ⇒ 畸形」判定 ⇒ 粘连写法**看得见**（口径与族 28 的 一致）。
 */




  it("粘连写法: 不被抽成 case（抽取侧要求 `[ \\t]+`）；粘连写法: 在诊断面**看得见**（畸形剩余文本非空）；负控制: 规范形态照旧被抽成 case、且不产畸形剩余；负控制: 其它畸形形态仍被诊断面看见", () => {
  {
    const tags = scanCaseTags('@nudo:case"c1" (1, 2)');
    expect(tags).toEqual([]);
  }
  {
    const rests = scanMalformedCaseTagRests('@nudo:case"c1" (1, 2)');
    expect(rests).toEqual(['"c1" (1, 2)']);
  }
  {
    const tags = scanCaseTags('@nudo:case "c1" (1, 2)');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.name).toBe("c1");
    expect(tags[0]!.argsText).toBe("1, 2");
    expect(scanMalformedCaseTagRests('@nudo:case "c1" (1, 2)')).toEqual([]);
  }
  {
    expect(scanMalformedCaseTagRests("@nudo:case 'c1' (1, 2)")).toEqual(["'c1' (1, 2)"]);
  }
});




});

// ---------------------------------------------------------------------------
// 粘连的 @nudo:contract 必须发语法诊断
// ---------------------------------------------------------------------------
describe("粘连的 @nudo:contract 必须发语法诊断", () => {
/**
 * `@nudo:contract` 的**粘连**形态（`@nudo:contractx …`）此前
 * **零诊断**地蒸发。
 *
 * 根因：段扫描用严格正则 `^@nudo:contract\s+(.+)$`（标签后必须有分隔空白）
 * ⇒ 粘连写法**整行不匹配**且**无 else 分支** ⇒ 契约整条不见 ⇒ 用户以为契约
 * 生效了（**假绿**）；同族的其它畸形载荷（`x > 0` 等）反而会落到
 * `nudo:contract-syntax` ⇒ 口径不一致。
 *
 * 修复：诊断面**看得见**粘连形态（口径与族 28 的 一致——严格文法仍
 * 要求分隔空白，宽松形态只用于诊断）⇒ 发既有码 `nudo:contract-syntax`。
 */





  it("@nudo:contractx → nudo:contract-syntax（warning）；@nudo:contract 空载荷 → nudo:contract-syntax（warning）；合法 @nudo:contract 零 contract-syntax（不误伤）；散文里的 @nudo:contract（行中提及）不算指令（不误伤）", () => {
  {
    const r = checkSource(
      "/t/bug-981.js",
      `
/**
 * @nudo:contractx positive
 */
export function f981(x) {
  return x;
}
`,
      pTrue,
    );
    const bad = r.issues.filter((i) => i.code === "nudo:contract-syntax");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("warning");
    expect(bad[0]!.message).toContain("@nudo:contractx positive");
    expect(bad[0]!.line).toBe(3);
  }
  {
    const r = checkSource(
      "/t/bug-981b.js",
      `
/**
 * @nudo:contract
 */
export function f981b(x) {
  return x;
}
`,
      pTrue,
    );
    const bad = r.issues.filter((i) => i.code === "nudo:contract-syntax");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("warning");
    expect(bad[0]!.message).toContain("Malformed @nudo:contract directive");
  }
  {
    const r = issuesOf(`
/**
 * @nudo:contract x positive
 */
export function ok(x) {
  return x;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:contract-syntax")).toEqual([]);
  }
  {
    const r = checkSource(
      "/t/bug-981c.js",
      `
/**
 * 声明 @nudo:contractx 不是指令（行中提及）
 */
export function prose(x) {
  return x;
}
`,
      pTrue,
    );
    expect(r.issues.filter((i) => i.code === "nudo:contract-syntax")).toEqual([]);
  }
});




});
