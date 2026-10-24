/**
 * 族 51 · harvester **草稿面**（`nudo contract --from-dts`）8 条。
 *
 * 背景：harvester 有两面 —— **收割面**（`harvest-dts.ts` → Abs）与**草稿面**
 * （`dts-contract-draft.ts` → `*.nudo.js` 草稿）。台账族 27 记了 8 条**草稿面**
 * 的纯缺口（收割面已修，草稿面没跟上）⇒ 同一份 `.d.ts`，收割面说得准、草稿面
 * 说不了（草稿比 TS **松**，**不是假红**，但用户拿到的是残缺草稿）。
 *
 * 共同症状：草稿面**静默降级**成 `any()` / 丢成员，而**汇总行不说谎** ⇒ 用户
 * 看不出草稿缺了什么。本钉逐条钉住「草稿面与收割面同源」+「汇总行诚实」。
 *
 * 本钉的断言口径：**逐字断言草稿产物文本**（不是「不抛」），并**钉住统计**
 * （`stats` ⇒ CLI 汇总行「N projectable exports · M skipped · K d.ts」的来源）。
 *
 * 反向闸（改前）：条件类型降级 `any()`、计算成员名整条消失、`A.Opts` 解析不到、
 * 构造器签名不进草稿、ambient 模块体不可见也不计数、重载 arity 口径未标注、
 * 跨文件再导出的名字虽可见但类型缺失。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dtsToContractDraft } from "../dts-contract-draft.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeDts(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-draft51-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("族 51 · 草稿面 8 条（收割面已修、草稿面同源）", () => {
  it("① 条件类型：不再降级 any() ⇒ 两支并集（收割面同口径），且**明确可见**", () => {
    const p = writeDts(
      "cond.d.ts",
      `export type IsString<T> = T extends string ? "yes" : "no";
export declare function pick(x: IsString<number>): "yes" | "no";
`,
    );
    const draft = dtsToContractDraft([p], "cond");
    // 改前：`fn({ x: any() }, union("yes", "no"))`（条件类型整条降级 any()）
    expect(draft.draftSource).toContain(
      'export const pick = fn({ x: union("yes", "no") }, union("yes", "no"));',
    );
    expect(draft.draftSource).not.toContain("unmodeled type → any()");
    // 降级标注**可见**（note ⇒ 该导出计入 skipped）
    expect(draft.draftSource).toContain("conditional type");
    expect(draft.stats.skipped).toBe(1);
  });

  it("①b 条件类型（extends unknown ⇒ 恒真）：只取真支（收割面同口径）", () => {
    const p = writeDts(
      "cond2.d.ts",
      `export type Always<T> = T extends unknown ? string : never;
export declare function pick2(x: Always<number>): string;
`,
    );
    const draft = dtsToContractDraft([p], "cond2");
    expect(draft.draftSource).toContain("export const pick2 = fn({ x: string() }, string());");
    expect(draft.draftSource).toContain("always true");
  });

  it("② 计算成员名**不被整条丢弃**：`[Symbol.iterator]()` 进契约（收割面同口径）", () => {
    const p = writeDts(
      "computed.d.ts",
      `export interface Iter {
  [Symbol.iterator](): Iterator<number>;
  a: string;
}
export declare function useIt(x: Iter): void;
`,
    );
    const draft = dtsToContractDraft([p], "computed");
    // 改前：`shape({ a: string() })`（计算成员名整条消失 ⇒ 契约被悄悄放宽）
    expect(draft.draftSource).toContain('"@@iterator": fn({}, any())');
    expect(draft.draftSource).toContain("a: string()");
    expect(draft.draftSource).not.toContain("shape({ a: string() })");
    // 部分丢失（`Iterator` 未建模）⇒ 汇总行**必须**看得见
    expect(draft.stats.skipped).toBe(1);
  });

  it("②b 计算成员名（字符串字面量键）⇒ 正常字段", () => {
    const p = writeDts(
      "computed2.d.ts",
      `export interface Hdr {
  ["content-type"]: string;
  a: string;
}
export declare function useHdr(x: Hdr): void;
`,
    );
    const draft = dtsToContractDraft([p], "computed2");
    expect(draft.draftSource).toContain('"content-type": string()');
    expect(draft.stats.skipped).toBe(0);
  });

  it("③ `extends` 基接口成员**进草稿**（含命名空间限定名基类）", () => {
    const p = writeDts(
      "ext.d.ts",
      `export interface Base { b: string }
export interface Derived extends Base { d: number }
export declare function useDerived(x: Derived): void;
`,
    );
    const draft = dtsToContractDraft([p], "ext");
    expect(draft.draftSource).toContain("shape({ b: string(), d: number() })");
    expect(draft.stats.skipped).toBe(0);
  });

  it("③b `extends A.Base`（限定名基类）⇒ 解析到 A 的成员（不串到 B）", () => {
    const p = writeDts(
      "ext2.d.ts",
      `export declare namespace A { interface Base { a: string } }
export declare namespace B { interface Base { b: number } }
export interface Derived extends A.Base { d: boolean }
export declare function useDerived2(x: Derived): void;
`,
    );
    const draft = dtsToContractDraft([p], "ext2");
    expect(draft.draftSource).toContain("shape({ a: string(), d: boolean() })");
    expect(draft.draftSource).not.toContain("b: number()");
    expect(draft.stats.skipped).toBe(0);
  });

  it("④ 命名空间限定名 `A.Opts` 能解析（不再降级 any()）", () => {
    const p = writeDts(
      "ns.d.ts",
      `export declare namespace A {
  interface Opts { o: string }
}
export declare function useOpts(x: A.Opts): void;
`,
    );
    const draft = dtsToContractDraft([p], "ns");
    // 改前：`fn({ x: any() }, any())`（`A.Opts` 解析不到）
    expect(draft.draftSource).toContain("shape({ o: string() })");
    expect(draft.draftSource).not.toContain("unmodeled type reference 'A.Opts'");
    expect(draft.stats.skipped).toBe(0);
  });

  it("④b 同短名的两个命名空间**不互相并入**（限定名分桶）", () => {
    const p = writeDts(
      "ns2.d.ts",
      `export declare namespace A { interface Opts { o: string } }
export declare namespace B { interface Opts { p: number } }
export declare function useA(x: A.Opts): void;
export declare function useB(x: B.Opts): void;
`,
    );
    const draft = dtsToContractDraft([p], "ns2");
    expect(draft.draftSource).toContain("shape({ o: string() })");
    expect(draft.draftSource).toContain("shape({ p: number() })");
  });

  it("⑤ class 构造器签名**进草稿**且**进 skipped 统计**", () => {
    const p = writeDts(
      "cls.d.ts",
      `export declare class Thing {
  constructor(a: string);
  go(): number;
}
`,
    );
    const draft = dtsToContractDraft([p], "cls");
    // 改前：只有 `Thing.go`（构造器签名整条消失 ⇒ `new Thing(…)` 零义务）
    expect(draft.draftSource).toContain("export const Thing = fn({ a: string() }, any());");
    expect(draft.draftSource).toContain("export const Thing_go = fn({}, number());");
    // 汇总行诚实：构造器签名**计入 skipped**（DSL 无 `new` 语义 ⇒ 需人工审阅）
    expect(draft.stats.exports).toBe(2);
    expect(draft.stats.skipped).toBe(1);
    expect(draft.draftSource).toContain("constructor signature");
  });

  it("⑥ ambient module 的内部导出**进草稿**且**计数**", () => {
    const p = writeDts(
      "amb.d.ts",
      `declare module "x" {
  export declare function f(): void;
}
`,
    );
    const draft = dtsToContractDraft([p], "amb");
    // 改前：`exports: 0 · skipped: 0`（整块不遍历 ⇒ 不可见也不计数）
    expect(draft.draftSource).toContain("export const x_f = fn({}, any());");
    expect(draft.stats.exports).toBe(1);
    expect(draft.stats.skipped).toBe(1);
    expect(draft.draftSource).toContain('ambient module "x"');
  });

  it("⑥b ambient module 里的重载也合并 + 标注来源", () => {
    const p = writeDts(
      "amb2.d.ts",
      `declare module "y" {
  export declare function f(a: string): string;
  export declare function f(a: string, b: number): number;
}
`,
    );
    const draft = dtsToContractDraft([p], "amb2");
    expect(draft.draftSource).toContain("export const y_f = fn({ a: string() }, union(string(), number()));");
    expect(draft.draftSource).toContain('ambient module "y"');
  });

  it("⑦ 重载 arity：元数不同 ⇒ **明确标注窄口径**（收割面同口径：不改成最宽）", () => {
    const p = writeDts(
      "ovl.d.ts",
      `export declare function over(x: string): string;
export declare function over(x: string, y: number): number;
`,
    );
    const draft = dtsToContractDraft([p], "ovl");
    expect(draft.draftSource).toContain(
      "export const over = fn({ x: string() }, union(string(), number()));",
    );
    // 窄口径**写明**（调用方看得见「多参调用不在契约覆盖内」）
    expect(draft.draftSource).toContain("arity 1");
    expect(draft.draftSource).toContain("calls with more arguments are not covered");
    expect(draft.stats.skipped).toBe(1);
  });

  it("⑦b 重载元数相同 ⇒ 形参**按位合并**（并集，不比 TS 更严）", () => {
    const p = writeDts(
      "ovl2.d.ts",
      `export declare function conv(x: string): string;
export declare function conv(x: number): number;
`,
    );
    const draft = dtsToContractDraft([p], "ovl2");
    expect(draft.draftSource).toContain(
      "export const conv = fn({ x: union(string(), number()) }, union(string(), number()));",
    );
    expect(draft.draftSource).toContain("parameters merged position by position");
  });

  it("⑧ 本地再导出：名字**类型不丢**", () => {
    const p = writeDts(
      "ree.d.ts",
      `export declare function localFn(a: string): number;
export { localFn as renamed };
`,
    );
    const draft = dtsToContractDraft([p], "ree");
    expect(draft.draftSource).toContain(
      "export const renamed = fn({ a: string() }, number());",
    );
    expect(draft.stats.skipped).toBe(0);
  });

  it("⑧b 跨文件再导出：名字**可见**且**计入 skipped**（类型需模块解析器 ⇒ 如实降级）", () => {
    const p = writeDts(
      "ree2.d.ts",
      `export { other } from "./other";
export declare function keep(a: string): number;
`,
    );
    const draft = dtsToContractDraft([p], "ree2");
    expect(draft.draftSource).toContain("other");
    expect(draft.draftSource).toContain('re-export from "./other" is not projected');
    expect(draft.stats.skipped).toBe(1);
  });

  it("⑧c 跨文件导入的类型：降级**可见**且**计数**（不静默）", () => {
    const p = writeDts(
      "ree3.d.ts",
      `import { Opts } from "./other";
export declare function useOpts(x: Opts): void;
`,
    );
    const draft = dtsToContractDraft([p], "ree3");
    expect(draft.draftSource).toContain("unmodeled type reference 'Opts' → any()");
    expect(draft.stats.skipped).toBe(1);
  });

  it("负控：与族 51 无关的形态，草稿输出**逐字不变**", () => {
    const p = writeDts(
      "plain.d.ts",
      `export type Id = string;
export interface Base { b: string }
export interface Ext extends Base { e: number }
export declare function plain(x: Id, y: Ext): string;
export declare const flag: boolean;
export declare function local(a: number): number;
export { local as localAliased };
export enum Color { Red, Green }
`,
    );
    const draft = dtsToContractDraft([p], "plain");
    expect(draft.draftSource).toContain(
      "export const plain = fn({ x: string(), y: shape({ b: string(), e: number() }) }, string());",
    );
    expect(draft.draftSource).toContain("export const flag = boolean();");
    expect(draft.draftSource).toContain("export const local = fn({ a: number() }, number());");
    expect(draft.draftSource).toContain("export const localAliased = fn({ a: number() }, number());");
    expect(draft.draftSource).toContain("export const Color = shape({ Red: 0, Green: 1 });");
    expect(draft.stats.exports).toBe(5);
    expect(draft.stats.skipped).toBe(0);
  });

  it("汇总行诚实：多类降级**全部**计入 skipped（CLI 汇总行的来源）", () => {
    const p = writeDts(
      "mixed.d.ts",
      `export interface Iter {
  [Symbol.iterator](): Iterator<number>;
  a: string;
}
export declare function useIt(x: Iter): void;
export declare class Thing {
  constructor(a: string);
  go(): number;
}
declare module "x" {
  export declare function f(): void;
}
export { other } from "./other";
`,
    );
    const draft = dtsToContractDraft([p], "mixed");
    // 4 类降级各计 1：Iterator 未建模 / 构造器签名需审阅 / ambient 模块导出 / 跨文件再导出
    expect(draft.stats.skipped).toBe(4);
    expect(draft.stats.exports).toBe(4);
  });
});
