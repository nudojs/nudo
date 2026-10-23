/**
 * Bug 428 —— **CJS 赋值形态**（`exports.f = function` / `module.exports.f =` /
 * `module.exports = fn`）的**函数级指令整条被静默丢弃**
 * ⇒ L1 契约**假绿** + `@nudo:throws` 抑制**失效**（假红）+ `@nudo:case`
 * **蒸发**——零诊断。
 *
 * 根因（`directive-scan.ts` 的 `AssignmentExpression` 分支）：CJS 赋值形态
 * **没有 AST 绑定名可取**（`exports.f` 的 `f` 不是绑定）⇒ scope 名落成
 * `<anonymous>` ⇒ 消费口按**导出名**（`f`）查不到 ⇒ 指令全部蒸发。
 *
 * 修法：识别 CJS 导出槽（`exports.f` / `module.exports.f` / `module.exports`）
 * ⇒ 给该形态一个**绑定名**（导出槽名）并把**语句级**注释挂上去。
 */
import { describe, it, expect } from "vitest";
import {
  extractDeclaredThrows,
  extractRefinesFromSource,
  findFnDirectiveScope,
  listFnDirectiveScopes,
  parseSource,
} from "../index.ts";
import { issuesOf, l2Count, stdOpts, withStdImport } from "./nudo-constraints.ts";
import { listTopFunctions } from "../scan.ts";

const CJS_CONTRACT = `/**
 * @nudo:contract x positive
 */
exports.f = function (x) {
  return x + 1;
};
`;

const CJS_MODULE_CONTRACT = `/**
 * @nudo:contract x positive
 */
module.exports.f = function (x) {
  return x + 1;
};
`;

const CJS_MODULE_DEFAULT = `/**
 * @nudo:contract x positive
 */
module.exports = function (x) {
  return x + 1;
};
`;

const CJS_MODULE_NAMED = `/**
 * @nudo:contract x positive
 */
module.exports = function inner(x) {
  return x + 1;
};
`;

const CJS_ARROW = `/**
 * @nudo:contract x positive
 */
exports.f = (x) => x + 1;
`;

const CJS_THROWS = `/**
 * @nudo:throws TypeError
 */
exports.f = function (x) {
  return x + 1;
};
`;

const ESM_CONTROL = `/**
 * @nudo:contract x positive
 */
export function f(x) {
  return x + 1;
}
`;

function scopeNames(src: string): string[] {
  return listFnDirectiveScopes(parseSource(src)).map((s) => s.name);
}

describe("Bug 428 — CJS 赋值形态：指令必须落在导出名上", () => {
  it("exports.f = function ⇒ scope 名是导出槽名 f", () => {
    expect(scopeNames(CJS_CONTRACT)).toEqual(["f"]);
  });

  it("module.exports.f = function ⇒ scope 名是 f", () => {
    expect(scopeNames(CJS_MODULE_CONTRACT)).toEqual(["f"]);
  });

  it("module.exports = function ⇒ scope 名是 default", () => {
    expect(scopeNames(CJS_MODULE_DEFAULT)).toEqual(["default"]);
  });

  it("module.exports = function inner() ⇒ 回退内层 id（普查面同口径）", () => {
    expect(scopeNames(CJS_MODULE_NAMED)).toEqual(["inner"]);
  });

  it("exports.f = 箭头 ⇒ scope 名是 f", () => {
    expect(scopeNames(CJS_ARROW)).toEqual(["f"]);
  });

  it("语句级 JSDoc 挂到 CJS scope 上（不再蒸发）", () => {
    const scope = findFnDirectiveScope(parseSource(CJS_CONTRACT), "f");
    expect(scope?.commentLines.join(" ")).toContain("@nudo:contract x positive");
  });

  it("L1 契约在 CJS 形态上生效（与 ESM 同口径）", () => {
    const cjs = extractRefinesFromSource(
      withStdImport(CJS_CONTRACT),
      "f",
      stdOpts,
    ).map((e) => e.param);
    const esm = extractRefinesFromSource(
      withStdImport(ESM_CONTROL),
      "f",
      stdOpts,
    ).map((e) => e.param);
    expect(cjs).toEqual(["x"]);
    expect(cjs).toEqual(esm);
  });

  it("@nudo:throws 在 CJS 形态上生效（不再假红）", () => {
    expect(extractDeclaredThrows(CJS_THROWS, "f")).toEqual(["TypeError"]);
  });

  it("L2 门禁：CJS 形态的 @nudo:throws 抑制不再失效", () => {
    expect(l2Count(issuesOf(CJS_THROWS, "/t/b428/throws.js"), "f")).toBe(0);
  });

  it("对照：ESM 形态行为不变", () => {
    expect(scopeNames(ESM_CONTROL)).toEqual(["f"]);
    expect(
      extractRefinesFromSource(withStdImport(ESM_CONTROL), "f", stdOpts).map((e) => e.param),
    ).toEqual(["x"]);
  });

  it("指令面的绑定名与普查面（分析面）对齐", () => {
    expect(listTopFunctions(CJS_CONTRACT)).toEqual(["f"]);
    expect(scopeNames(CJS_CONTRACT)).toEqual(listTopFunctions(CJS_CONTRACT));
    expect(listTopFunctions(CJS_MODULE_CONTRACT)).toEqual(["f"]);
    expect(scopeNames(CJS_MODULE_CONTRACT)).toEqual(listTopFunctions(CJS_MODULE_CONTRACT));
    expect(listTopFunctions(CJS_MODULE_NAMED)).toEqual(["inner"]);
    expect(scopeNames(CJS_MODULE_NAMED)).toEqual(listTopFunctions(CJS_MODULE_NAMED));
  });
});
