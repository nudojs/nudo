/**
 * Bug 425 —— `static` 方法与实例方法**共用指令 scope 名 `C.m`**
 * ⇒ 叠加 Bug 424 的「按名首个命中」⇒ **只存活一条** `@nudo:contract`，
 * 且被**同时套到两个方法**上（静态的契约套到实例方法 ⇒ 参数名不匹配假红）。
 *
 * 根因（`directive-scan.ts` 的 `ClassMethod` 分支）：scope 名由
 * `${cname}.${keyName}` 合成，**不区分 `static` 与实例**。
 *
 * 修法：类里有**同名实例方法**时，静态方法的 scope 改名 `C.static.m`
 * （实例方法保名 `C.m`）。口径与**普查面**（`scan-top-functions.ts` 的
 * `collectClassMethods`：同名时只登记**实例**方法）一致 ⇒ 指令面与普查面
 * 对「`C.m` 是哪个方法」的理解一致。
 */
import { describe, it, expect } from "vitest";
import {
  extractRefinesFromSource,
  findFnDirectiveScope,
  listFnDirectiveScopes,
  parseSource,
} from "../index.ts";
import { listTopFunctions } from "../scan.ts";
import { stdOpts, withStdImport } from "./nudo-constraints.ts";

const STATIC_AND_INST = `export class C {
  /**
   * @nudo:contract a positive
   */
  static m(a) { return a; }

  /**
   * @nudo:contract b shortName
   */
  m(b) { return b; }
}
`;

const STATIC_ONLY = `export class C {
  /**
   * @nudo:contract a positive
   */
  static m(a) { return a; }
}
`;

const INST_ONLY = `export class C {
  /**
   * @nudo:contract b shortName
   */
  m(b) { return b; }
}
`;

function scopesOf(src: string) {
  return listFnDirectiveScopes(parseSource(src));
}

describe("Bug 425 — static / 实例同名：指令 scope 名必须区分", () => {
  it("同名时：静态方法改名 C.static.m，实例方法保名 C.m", () => {
    const names = scopesOf(STATIC_AND_INST).map((s) => s.name);
    expect(names).toEqual(["C.static.m", "C.m"]);
  });

  it("同名时：按名查找 C.m 命中的是**实例**方法的注释块", () => {
    const scope = findFnDirectiveScope(parseSource(STATIC_AND_INST), "C.m");
    expect(scope?.commentLines.join(" ")).toContain("@nudo:contract b shortName");
    expect(scope?.commentLines.join(" ")).not.toContain("@nudo:contract a positive");
  });

  it("同名时：两条契约各自可见（互不顶替）", () => {
    const src = withStdImport(STATIC_AND_INST);
    expect(extractRefinesFromSource(src, "C.m", stdOpts).map((e) => e.param)).toEqual(["b"]);
    expect(extractRefinesFromSource(src, "C.static.m", stdOpts).map((e) => e.param)).toEqual([
      "a",
    ]);
  });

  it("只有静态方法时：scope 名仍是 C.m（与普查面同名，不改名）", () => {
    expect(scopesOf(STATIC_ONLY).map((s) => s.name)).toEqual(["C.m"]);
    expect(listTopFunctions(STATIC_ONLY)).toEqual(["C.m"]);
  });

  it("只有实例方法时：scope 名仍是 C.m（对照）", () => {
    expect(scopesOf(INST_ONLY).map((s) => s.name)).toEqual(["C.m"]);
    expect(listTopFunctions(INST_ONLY)).toEqual(["C.m"]);
  });

  it("同名时：普查面仍只登记 C.m（族 11 口径未变）", () => {
    expect(listTopFunctions(STATIC_AND_INST)).toEqual(["C.m"]);
  });
});
