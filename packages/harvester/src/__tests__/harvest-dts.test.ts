/**
 * 模块套件：harvest 声明面（class/interface/alias/namespace/overload/generic/record/tuple）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, literalMeetsConstraint, type Abs, getFnImpl, isNudoConstraint, $get, instantiateReturn, $new, numLit, type Slot } from "@nudojs/core";
import { dtsToContractDraft, formatDtsContractDraft } from "../dts-contract-draft.ts";
import { harvestDts, emitEnvModule } from "../harvest-dts.ts";
import { asConstraint, fnParam, loadDraftExports, makeWorkDir, removeWorkDir, runNudoCheck, writeSidecar, fnReturns } from "./harvest-helpers-draft-types.ts";
import { absToHarvestSig, harvestSigToAbs } from "../harvest-json.ts";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "@nudojs/core/internal";
import { harvestedValueToAbs } from "../harvest-to-abs.ts";
import { execFileSync } from "node:child_process";
import { makeWorkDir as makeWorkDir____harvest_bug_h8b_helpers_ts, removeWorkDir as removeWorkDir____harvest_bug_h8b_helpers_ts, runNudoCheck as runNudoCheck____harvest_bug_h8b_helpers_ts, writeSidecar as writeSidecar____harvest_bug_h8b_helpers_ts } from "./harvest-helpers-product-face.ts";

// ---------------------------------------------------------------------------
// 草稿面：同文件的 type 别名**被解析**（不再零义务）
// ---------------------------------------------------------------------------
describe("草稿面：同文件的 type 别名**被解析**（不再零义务）", () => {
/**
 * 回归（harvester **草稿面**）：同文件的 `type` 别名**不解析**
 * ⇒ `string` 降成 `any()` ⇒ 契约**零义务** ⇒ **假绿**；而**收割面**给的是
 * `(string) => string`（同一个声明，两个产物面答案不同）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h8a/e2e/b1011.ts ⇒ TS2322）：
 * `function withAlias(x: string): string { return 42; }`
 *
 * 改前（git HEAD 的草稿面）：`type Id = string;` 不在符号表里 ⇒
 * `fn({ x: any() }, any())` ⇒ 零义务 ⇒ 绿。
 * 改后（tmp/probe/fix-r27/h8a/probe.ts）：
 * `export const withAlias = fn({ x: string() }, string());`
 *
 * **两个产物面同答案**：收割面 `(string) => string`，草稿面
 * `fn({ x: string() }, string())` ⇒ 两侧都要求 string ⇒ 同一答案。
 *
 * 附带钉：**接口**（`interface`）也要能展开（`Partial<Local>` 之类依赖它），
 * 类型别名指向**对象**时同样展开成 shape。
 */









const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeDts(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug1011-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const DTS = `type Id = string;
export declare function withAlias(x: Id): Id;
`;

describe("草稿面：同文件的 type 别名**被解析**（不再零义务）", () => {
  it("别名 `type Id = string` ⇒ string()，不是 any()", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("fn({ x: string() }, string())");
    expect(draft.draftSource).not.toContain("any()");
  });

  it("契约**真的**要求 string（域隶属判定 = 零义务已消除）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    const exports = loadDraftExports(draft.draftSource);
    const param = fnParam(asConstraint(exports.withAlias), "x");
    expect(literalMeetsConstraint(42, param)).toBe(false);
    expect(literalMeetsConstraint("ok", param)).toBe(true);
  });

  it("产品面：草稿抄进侧车后 `nudo check` **红**（与 tsc 的 TS2322 同向）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    const dir = makeWorkDir("b1011");
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function withAlias(x) { return 42; }\n`,
    );
    const res = runNudoCheck(target);
    removeWorkDir(dir);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("constraint-violated");
  });

  it("收割面同答案：(string) => string", () => {
    const p = writeDts("fx.d.ts", DTS);
    const env = harvestDts([p]);
    expect(formatShape(env.globals.withAlias!)).toBe("(string) => string");
  });

  it("类型别名指向对象时展开成 shape；interface 也展开", () => {
    const p = writeDts(
      "fx.d.ts",
      `type U = { a: number };
interface Local { b: string }
export declare function withObj(x: U): U;
export declare function withIface(x: Local): Local;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("shape({ a: number() })");
    expect(draft.draftSource).toContain("shape({ b: string() })");
  });

  it("interface 的**继承成员**也在契约里（只展开自身成员 ⇒ 悄悄放宽）", () => {
    const p = writeDts(
      "fx.d.ts",
      `interface Base { base: number }
interface Ext extends Base { extra: string }
export declare function takeExt(e: Ext): void;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("base: number()");
    expect(draft.draftSource).toContain("extra: string()");
  });
});
});

// ---------------------------------------------------------------------------
// 草稿面：Partial<T> 的字段**变可选**（不比 TS 严）
// ---------------------------------------------------------------------------
describe("草稿面：Partial<T> 的字段**变可选**（不比 TS 严）", () => {
/**
 * 回归（harvester **草稿面**）：`Partial<T>` 特判把内层字段**原样
 * 透传** ⇒ 字段仍是**必填** ⇒ 契约**比 TS 更严** ⇒ **假红**（tsc 绿，
 * `nudo check` 红）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h8a/e2e/b1012.ts ⇒ 无错）：
 * `function givePartial(): Partial<{a: number; b: string}> { return {}; }`
 * ⇒ TS 允许 `{}`（两个字段都可选）⇒ 绿。
 *
 * 改前（git HEAD 的草稿面）：`Partial<{a: number; b: string}>` ⇒
 * `shape({ a: number(), b: string() })` —— 字段**必填** ⇒ 传 `{}` 违约
 * ⇒ 比 TS 严 ⇒ 假红。
 * 改后（tmp/probe/fix-r27/h8a/probe.ts）：
 * `fn({ p: partial(shape({ a: number(), b: string() })) }, any())`
 *
 * **两个产物面同答案**：收割面不建模 `Partial<T>`（该位 `unknown` ⇒ 无义务），
 * 草稿面按 TS 口径把字段**变可选** ⇒ 两侧都**接受** `{}` ⇒ 同一答案
 * （都不比 TS 严）。
 */









const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeDts(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug1012-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const DTS = `export declare function takePartial(p: Partial<{ a: number; b: string }>): void;
`;

describe("草稿面：Partial<T> 的字段**变可选**（不比 TS 严）", () => {
  it("草稿是 partial(shape({…}))，不是原样透传的 shape({…})", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("partial(shape({ a: number(), b: string() }))");
    // 改前的形态：字段仍必填（shape 直接透传，没有 partial 包装）
    expect(draft.draftSource).not.toContain("p: shape({ a: number(), b: string() })");
  });

  it("契约里两个字段都**可选**（isOptional）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    const exports = loadDraftExports(draft.draftSource);
    const param = fnParam(asConstraint(exports.takePartial), "p");
    expect(param.fields?.a?.constraint.isOptional).toBe(true);
    expect(param.fields?.b?.constraint.isOptional).toBe(true);
  });

  it("产品面：草稿抄进侧车后 `nudo check` **绿**（与 tsc 同向，不再假红）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    const dir = makeWorkDir("b1012");
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function takePartial(p) { return; }
export function use() { return takePartial({}); }
`,
    );
    const res = runNudoCheck(target);
    removeWorkDir(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain("constraint-violated");
  });

  it("收割面同答案：该位无义务（unknown）⇒ 两侧都接受 {}", () => {
    const p = writeDts("fx.d.ts", DTS);
    const env = harvestDts([p]);
    expect(formatShape(env.globals.takePartial!)).toBe("(unknown) => undefined");
  });
});
});

// ---------------------------------------------------------------------------
// 草稿面：Record 的值域**落到实现**（或如实降级，不放绿）
// ---------------------------------------------------------------------------
describe("草稿面：Record 的值域**落到实现**（或如实降级，不放绿）", () => {
/**
 * 回归（harvester **草稿面**）：`Record<K,V>` 特判把**值域整个丢掉**
 * （只写进注释）⇒ 契约**比 TS 更松** ⇒ **放绿** TS2322。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h8a/e2e/b1013.ts ⇒ TS2322）：
 * `function getRecord(): Record<string, number> { return { x: "str" }; }`
 * ⇒ TS2322（红）。
 *
 * 改前（git HEAD 的草稿面）：`Record<string, number>` ⇒ `shape({})` ＋
 * 一条注释「open Record → number()」—— **注释宣称有值域、实现里却没有**
 * ⇒ 调用点传 `{x: "str"}` 也不违约 ⇒ 放绿。
 * 改后（tmp/probe/fix-r27/h8a/probe.ts）：
 * - 键是**字面量集合**（`Record<"a" | "b", number>`）⇒ **值域落到实现**：
 * `shape({ a: number(), b: number() })` ⇒ 该位不再放绿；
 * - 键不是字面量（`Record<string, number>`）⇒ 契约 DSL **没有索引签名**
 * ⇒ **如实降级**：`shape({})` ＋ note 明说「值域**未**建模（比 TS 松）」
 * ＋ 计入 `skipped` ⇒ 丢失**可见**，不静默。
 *
 * **两个产物面同口径**：收割面把 `Record<string, number>` 建成**开放对象**
 * 且**带索引值域**（`index.value = number`，见 ）⇒ 值域在收割面没丢；
 * 草稿面如实说「DSL 表达不了」⇒ 两侧对**值域是什么**答案一致
 * （都是 number），草稿面不冒充已建模。
 *
 * ⚠️ 已知限制（**越界**，见交付报告）：契约 DSL 无索引签名 ⇒
 * `Record<string, V>` 的值域在草稿面**无法**落到实现；要彻底对齐需要 core
 * 的 DSL 支持开放 shape + 索引值域（core 冻结，本分片不改 core）。
 */









const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeDts(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug1013-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** fn Abs 的第 0 个形参（对象面） */
function paramObjShape(abs: unknown): {
  open?: boolean;
  index?: { key: unknown; value: unknown };
} | undefined {
  const s = (abs as { shape: { k: string; paramTypes?: { shape?: unknown }[] } }).shape;
  const p = s.paramTypes?.[0]?.shape as
    | { k: string; open?: boolean; index?: { key: unknown; value: unknown } }
    | undefined;
  return p?.k === "obj" ? p : undefined;
}

describe("草稿面：Record 的值域**落到实现**（或如实降级，不放绿）", () => {
  it("键是字面量集合时，**值域落到实现**（shape 的字段就是值域）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function takeRecordLit(r: Record<"a" | "b", number>): void;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("shape({ a: number(), b: number() })");
  });

  it("键不是字面量时**如实降级**：不宣称值域 + note 明说未建模 + 计入 skipped", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function takeRecord(r: Record<string, number>): void;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    // 改前的假声明：注释宣称有值域，实现里没有
    expect(draft.draftSource).not.toContain("open Record");
    expect(draft.draftSource).not.toMatch(/r: shape\(\{[^}]*number\(\)/);
    expect(draft.draftSource).toContain("Record value domain is NOT modeled");
    expect(draft.stats.skipped).toBeGreaterThanOrEqual(1);
  });

  it("产品面：值域落地的 Record **红**（与 tsc 的 TS2322 同向，不再放绿）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function takeRecordLit(r: Record<"a" | "b", number>): void;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    const dir = makeWorkDir("b1013");
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function takeRecordLit(r) { return; }
export function use() { return takeRecordLit({ a: "str", b: 1 }); }
`,
    );
    const res = runNudoCheck(target);
    removeWorkDir(dir);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("constraint-violated");
  });

  it("收割面同口径：Record 是**开放对象且带索引值域**（值域没丢）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function takeRecord(r: Record<string, number>): void;
`,
    );
    const env = harvestDts([p]);
    const obj = paramObjShape(env.globals.takeRecord)!;
    expect(obj.open).toBe(true);
    expect(obj.index).toBeDefined();
    expect(formatShape(obj.index!.value as never)).toBe("number");
  });
});
});

// ---------------------------------------------------------------------------
// TS 类型谓词的返回类型（boolean / void，不是 unknown）
// ---------------------------------------------------------------------------
describe("TS 类型谓词的返回类型（boolean / void，不是 unknown）", () => {
/**
 * 回归（harvester 收割面）：harvester 把 **TS 类型谓词**的返回类型
 * （`x is T` / `asserts x is T`）收割成 **`unknown`** ⇒
 * - 调用方的签名面变成 `unknown` ⇒ 触发 `nudo:unknown-inference`
 * 误导诊断（把「谓词返回 boolean」说成「推断失败」）；
 * - dts 面写 `unknown` ⇒ 消费方 tsc TS2322 假红。
 *
 * 根因：`mapType` 的类型节点分派表**没有 `TypePredicate` 分支**
 * ⇒ 谓词落进兜底分支（`default: return absUnknown()`）。
 *
 * 真值（TS 语义，运行时）：
 * - `x is T` ⇒ 返回 **`boolean`**（`T` 是**收窄信息**，是调用点的副作用，
 * **不是**返回面）；
 * - `asserts x is T` / `asserts x` ⇒ 返回 **`void`**（断言函数运行时返回
 * `undefined`）⇒ 与 `: void` 返回同口径。
 *
 * 负控：普通返回类型（number / string / 联合 / 泛型 / void / unknown /
 * 对象 / 数组 / 字面量 / nullable）的收割结果**不变**。
 *
 * ⚠️ 草稿面（`dts-contract-draft.ts`，`nudo contract --from-dts`）不在本钉
 * 范围：谓词在草稿面落 `fn({...}, any())` + 备注「unmodeled type → any()」
 * （**如实标注**的降级，不是 `unknown` 误报）——见交付报告。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug1054-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** fn 的返回面 Abs（shape.returnType） */
function returnTypeOf(a: unknown): { shape: { k?: string; type?: string }; term?: unknown } {
  const shape = (a as { shape?: { k?: string; returnType?: unknown } }).shape;
  if (shape?.k !== "fn") throw new Error(`not a fn: ${shape?.k}`);
  return (shape.returnType as { shape: { k?: string; type?: string }; term?: unknown });
}

describe("TS 类型谓词的返回类型（boolean / void，不是 unknown）", () => {
  it("`x is T` 的返回面是 boolean（不是 unknown，也不是被谓词的 T）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Foo { a: number }
export declare function isFoo(x: unknown): x is Foo;
`,
    );
    const env = harvestDts([p]);
    // 改前：`(unknown) => unknown`（谓词落兜底分支）
    expect(formatShape(env.globals["isFoo"]!)).toBe("(unknown) => boolean");
    const ret = returnTypeOf(env.globals["isFoo"]!);
    expect(ret.shape.k).toBe("prim");
    expect(ret.shape.type).toBe("boolean");
    // 被谓词的 `T`（Foo ⇒ brand）**不是**返回面
    expect(ret.shape.k).not.toBe("brand");
  });

  it("`asserts x is T` 的返回面与 `: void` 同口径（不是 unknown）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Foo { a: number }
export declare function assertFoo(x: unknown): asserts x is Foo;
export declare function plainVoid(x: unknown): void;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["assertFoo"]!)).toBe("(unknown) => undefined");
    // 与 `: void` 的返回面**逐字同构**（断言函数运行时返回 undefined）
    expect(returnTypeOf(env.globals["assertFoo"]!)).toEqual(
      returnTypeOf(env.globals["plainVoid"]!),
    );
  });

  it("`asserts x`（无 `is T`）也是 void 口径", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function assertPlain(x: unknown): asserts x;
export declare function plainVoid(x: unknown): void;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["assertPlain"]!)).toBe("(unknown) => undefined");
    expect(returnTypeOf(env.globals["assertPlain"]!)).toEqual(
      returnTypeOf(env.globals["plainVoid"]!),
    );
  });

  it("`this is T` / `asserts this is T` 同口径", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Foo { a: number }
export declare function isThis(x: unknown): this is Foo;
export declare function assertThis(x: unknown): asserts this is Foo;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["isThis"]!)).toBe("(unknown) => boolean");
    expect(formatShape(env.globals["assertThis"]!)).toBe("(unknown) => undefined");
  });

  it("谓词里的联合被谓词类型不影响返回面（仍是 boolean）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function isNumOrStr(x: unknown): x is number | string;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["isNumOrStr"]!)).toBe("(unknown) => boolean");
    expect(returnTypeOf(env.globals["isNumOrStr"]!).shape.type).toBe("boolean");
  });

  it("接口方法签名上的谓词同口径", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Foo { a: number }
export interface Guard {
  isFoo(x: unknown): x is Foo;
  assertFoo(x: unknown): asserts x is Foo;
}
export declare const guard: Guard;
`,
    );
    const env = harvestDts([p]);
    const slots = (
      env.globals["guard"]! as {
        shape: { shape: { shape: { slots: Record<string, { value: Abs }> } } };
      }
    ).shape.shape.shape.slots;
    expect(formatShape(slots["isFoo"]!.value)).toBe("(unknown) => boolean");
    expect(formatShape(slots["assertFoo"]!.value)).toBe("(unknown) => undefined");
  });

  it("函数类型（type literal）上的谓词同口径", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const fnType: (x: unknown) => x is string;
export declare const fnTypeAssert: (x: unknown) => asserts x is string;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["fnType"]!)).toBe("(unknown) => boolean");
    expect(formatShape(env.globals["fnTypeAssert"]!)).toBe("(unknown) => undefined");
  });

  it("负控：普通返回类型的收割结果不变", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function retNum(): number;
export declare function retStr(): string;
export declare function retBool(): boolean;
export declare function retUnion(): number | string;
export declare function retGeneric<T>(x: T): T;
export declare function retVoid(): void;
export declare function retUndef(): undefined;
export declare function retUnknown(): unknown;
export declare function retObj(): { a: number };
export declare function retArr(): string[];
export declare function retLit(): "a" | "b";
export declare function retNullable(): string | null;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["retNum"]!)).toBe("() => number");
    expect(formatShape(env.globals["retStr"]!)).toBe("() => string");
    expect(formatShape(env.globals["retBool"]!)).toBe("() => boolean");
    expect(formatShape(env.globals["retUnion"]!)).toBe("() => number | string");
    expect(formatShape(env.globals["retGeneric"]!)).toBe("(T) => T");
    expect(formatShape(env.globals["retVoid"]!)).toBe("() => undefined");
    expect(formatShape(env.globals["retUndef"]!)).toBe("() => undefined");
    expect(formatShape(env.globals["retUnknown"]!)).toBe("() => unknown");
    expect(formatShape(env.globals["retObj"]!)).toBe("() => { a: number }");
    expect(formatShape(env.globals["retArr"]!)).toBe("() => string[]");
    expect(formatShape(env.globals["retLit"]!)).toBe('() => "a" | "b"');
    expect(formatShape(env.globals["retNullable"]!)).toBe("() => string | null");
  });
});
});

// ---------------------------------------------------------------------------
// 泛型实例化缓存键编码实参身份（不是实参个数）
// ---------------------------------------------------------------------------
describe("泛型实例化缓存键编码实参身份（不是实参个数）", () => {
/**
 * 回归（harvester 收割面）：泛型实例化缓存键只编码**实参个数** ⇒
 * 同一接口的不同类型实参命中同一条缓存 ⇒ `Box<number>` 被折成 `Box<string>`。
 *
 * 改前（tmp/probe/fix-r27/h2/before-after.ts，BEFORE 行）：
 * Box<string>.value=string Box<number>.value=string sameAbs=true
 * 改后：
 * Box<string>.value=string Box<number>.value=number sameAbs=false
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h2/oracle/）：
 * - `o791-use.ts`（`a: Box<string>` / `b: Box<number>` 分别取 `value`）
 * ⇒ tsc exit=0 ⇒ 两个 `value` 的类型**不同**（string / number）。
 * - `o791-neg.ts`（把 `a.value` 赋给 `number`）⇒ TS2322 ⇒ `Box<string>.value`
 * 确为 string（反证 `Box<number>.value` 确为 number）。
 *
 * 契约（双向）：
 * 1. 不同类型实参 ⇒ 不同实例（缓存键必须编码实参**身份**，不是个数）；
 * 2. 同一类型实参 ⇒ 同一个实例对象（缓存仍然有效，不退化成每次重算）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug791-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand 的成员面（brand → inner obj → slots） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

describe("泛型实例化缓存键编码实参身份（不是实参个数）", () => {
  it("不同类型实参 ⇒ 不同实例（改前 Box<number> 被折成 Box<string>）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T> { value: T }\n` +
        `export declare const a: Box<string>;\n` +
        `export declare const b: Box<number>;\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.a!).value!)).toBe("string");
    expect(formatShape(slots(env.globals.b!).value!)).toBe("number");
    // 两个实例不是同一个对象
    expect(env.globals.a).not.toBe(env.globals.b);
  });

  it("同一类型实参 ⇒ 命中缓存（同一个实例对象）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T> { value: T }\n` +
        `export declare const a: Box<string>;\n` +
        `export declare const c: Box<string>;\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.a!).value!)).toBe("string");
    expect(formatShape(slots(env.globals.c!).value!)).toBe("string");
    // 缓存仍有效：同实参 ⇒ 同一个 Abs 实例（不是两份等价副本）
    expect(env.globals.a).toBe(env.globals.c);
  });

  it("实参个数相同、类型不同 ⇒ 不共缓存（个数相同也必须分开）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T> { value: T }\n` +
        `export declare const a: Box<string>;\n` +
        `export declare const b: Box<number>;\n` +
        `export declare const c: Box<boolean>;\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.a!).value!)).toBe("string");
    expect(formatShape(slots(env.globals.b!).value!)).toBe("number");
    expect(formatShape(slots(env.globals.c!).value!)).toBe("boolean");
    expect(new Set([env.globals.a, env.globals.b, env.globals.c]).size).toBe(3);
  });

  it("嵌套实参也按身份区分（Box<Box<string>> ≠ Box<Box<number>>）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T> { value: T }\n` +
        `export declare const a: Box<Box<string>>;\n` +
        `export declare const b: Box<Box<number>>;\n`,
    );
    const env = harvestDts([p]);
    const innerA = slots(slots(env.globals.a!).value!).value!;
    const innerB = slots(slots(env.globals.b!).value!).value!;
    expect(formatShape(innerA)).toBe("string");
    expect(formatShape(innerB)).toBe("number");
    expect(env.globals.a).not.toBe(env.globals.b);
  });
});
});

// ---------------------------------------------------------------------------
// 命名空间限定类型引用不得并入其它命名空间的同名接口
// ---------------------------------------------------------------------------
describe("命名空间限定类型引用不得并入其它命名空间的同名接口", () => {
/**
 * 回归（harvester 收割面）：**命名空间限定**类型引用（`A.Opts`）解析到
 * **所有同名短名接口** ⇒ `A.Opts` 继承了 `B.Opts` 的成员。
 *
 * 改前（tmp/probe/fix-r27/h3/probe-h3.ts，BEFORE 行）：
 * useA 的形参 brand 槽位 = { a: number, b: string } ← 混进了 B.Opts 的 b
 * useB 的形参 brand 槽位 = { b: string, a: number }
 * 改后：
 * useA 的形参 brand 槽位 = { a: number }
 * useB 的形参 brand 槽位 = { b: string }
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o792.ts）：
 * `oa.b`（`oa: A.Opts`）⇒ TS2339 "Property 'b' does not exist on type 'Opts'"
 * ⇒ TS 侧 A.Opts 上**没有** b ⇒ 收割面不得有 b。
 *
 * 根因：`ctx.interfaces`（短名桶）不带命名空间身份 ⇒ 限定名解析无条件并入短名桶。
 * 修法：限定名只精确命中自己的限定桶；短名回退**只**认「ambient 模块块里的模块
 * 增强声明」（lodash 形态）——命名空间里的同名接口不再互相并入。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug792-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand → inner obj → 槽位名集合 */
function slotNames(a: Abs | undefined): string[] {
  if (!a) return [];
  const s = a.shape;
  if (s.k === "brand") return slotNames(s.shape);
  if (s.k !== "obj") return [];
  return Object.keys(s.slots);
}

/** 函数的第 0 个形参类型（brand） */
function firstParam(a: Abs | undefined): Abs | undefined {
  if (!a || a.shape.k !== "fn") return undefined;
  return a.shape.paramTypes?.[0];
}

const TWO_NS = `declare namespace A { interface Opts { a: number } }
declare namespace B { interface Opts { b: string } }
export declare function useA(o: A.Opts): number;
export declare function useB(o: B.Opts): string;
`;

describe("命名空间限定类型引用不得并入其它命名空间的同名接口", () => {
  it("A.Opts 只有 A 的成员（不含 B.Opts 的 b）", () => {
    const p = writeTemp("ns.d.ts", TWO_NS);
    const env = harvestDts([p]);
    const aSlots = slotNames(firstParam(env.globals.useA!));
    expect(aSlots).toContain("a");
    expect(aSlots).not.toContain("b");
  });

  it("B.Opts 只有 B 的成员（不含 A.Opts 的 a）", () => {
    const p = writeTemp("ns.d.ts", TWO_NS);
    const env = harvestDts([p]);
    const bSlots = slotNames(firstParam(env.globals.useB!));
    expect(bSlots).toContain("b");
    expect(bSlots).not.toContain("a");
  });

  it("对照：单命名空间时成员照常可见（不是「全都丢了」）", () => {
    const p = writeTemp(
      "one.d.ts",
      `declare namespace A { interface Opts { a: number } }
export declare function useA(o: A.Opts): number;
`,
    );
    const env = harvestDts([p]);
    expect(slotNames(firstParam(env.globals.useA!))).toEqual(["a"]);
  });

  it("对照：非限定引用仍解析得到接口成员（既有口径不被破坏）", () => {
    const p = writeTemp(
      "plain.d.ts",
      `interface Opts { a: number }
export declare const o: Opts;
`,
    );
    const env = harvestDts([p]);
    expect(slotNames(env.globals.o!)).toEqual(["a"]);
  });

  it("对照：lodash 形态的模块增强仍与命名空间限定名合并", () => {
    const idx = writeTemp(
      "idx.d.ts",
      `export = _;
export as namespace _;
declare const _: _.LoDashStatic;
declare namespace _ {
  interface LoDashStatic {}
}
`,
    );
    const aug = writeTemp(
      "aug.d.ts",
      `declare module "idx" {
  interface LoDashStatic {
    uniq(xs: number[]): number[];
  }
}
`,
    );
    const env = harvestDts([idx, aug]);
    const slots = slotNames(env.globals._!);
    expect(slots).toContain("uniq");
  });
});
});

// ---------------------------------------------------------------------------
// `this` 形参不算实参（元数不因它 +1）
// ---------------------------------------------------------------------------
describe("`this` 形参不算实参（元数不因它 +1）", () => {
/**
 * 回归（harvester 收割面）：harvester 把 `this` 形参当**普通形参**收割
 * ⇒ **元数错位**（arity +1，第一个真实实参被绑到 `this` 槽）+ 生成的契约草稿
 * **凭空多一个必填参数**。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h5/e2e/this/）：
 * - `export declare function withThis(this: Ctx, x: number): string;`
 * ⇒ 调用方只传 **1** 个实参（`withThis(1)`），`this` 是**调用上下文**的类型标注，
 * 不是实参（TS 编译通过，exit 0）。
 *
 * 收割侧契约：
 * 1. `this` 形参**不是**实参 ⇒ 收割时跳过（不占参数位）；
 * 2. 元数因此正确（`(number) => string`，不是 `(Ctx, number) => string`）；
 * 3. 接口方法签名上的 `this` 形参同口径。
 *
 * ⚠️ 草稿面（`dts-contract-draft.ts`）是 **H8 的文件**：本分片不改它，
 * 对应改法见交付报告（草稿里仍会出现 `this: shape({...})` 这个多余的必填参数）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug794-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** fn 形状的参数位个数 */
function arity(a: unknown): number {
  const shape = (a as { shape?: { k?: string; paramTypes?: unknown[] } }).shape;
  if (shape?.k !== "fn") return -1;
  return shape.paramTypes?.length ?? -1;
}

describe("`this` 形参不算实参（元数不因它 +1）", () => {
  it("顶层函数的 `this` 形参被跳过（元数 = 真实实参数）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Ctx { v: number }
export declare function withThis(this: Ctx, x: number): string;
export declare function plain(x: number): string;
`,
    );
    const env = harvestDts([p]);
    // 改前：`(Ctx, number) => string`（元数 2，第一个真实实参被绑到 `this` 槽）
    expect(formatShape(env.globals["withThis"]!)).toBe("(number) => string");
    expect(arity(env.globals["withThis"]!)).toBe(1);
    // 对照组不受影响
    expect(formatShape(env.globals["plain"]!)).toBe("(number) => string");
    expect(arity(env.globals["plain"]!)).toBe(1);
  });

  it("`this` 形参的类型不进入参数位", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Ctx { v: number }
export declare function withThis(this: Ctx, x: number): string;
`,
    );
    const env = harvestDts([p]);
    const shape = (env.globals["withThis"]! as { shape: { paramTypes: Array<{ shape: { k: string; type?: string } }> } })
      .shape;
    expect(shape.paramTypes).toHaveLength(1);
    expect(shape.paramTypes[0]!.shape.type).toBe("number");
  });

  it("多个真实实参时元数只算真实实参", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Ctx { v: number }
export declare function two(this: Ctx, a: number, b: string): boolean;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["two"]!)).toBe("(number, string) => boolean");
    expect(arity(env.globals["two"]!)).toBe(2);
  });

  it("接口方法签名上的 `this` 形参同口径（不进实例面的参数位）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface I {
  m(this: I, y: string): void;
}
export declare const i: I;
`,
    );
    const env = harvestDts([p]);
    const inst = env.globals["i"]!;
    const slots = (inst as { shape: { shape: { shape: { slots: Record<string, { value: unknown }> } } } }).shape.shape
      .shape.slots;
    const m = slots["m"]!.value as { shape: { k: string; paramTypes?: unknown[] } };
    expect(m.shape.k).toBe("fn");
    expect(m.shape.paramTypes?.length ?? 0).toBe(1);
  });
});
});

// ---------------------------------------------------------------------------
// declare class 的实例成员不再整体丢失，绑定不再消失
// ---------------------------------------------------------------------------
describe("declare class 的实例成员不再整体丢失，绑定不再消失", () => {
/**
 * 回归（harvester 收割面）：`declare class` 的**实例成员整体丢失**，且
 * `const p: Point` 这个**绑定从 globals 里彻底消失**。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h5/e2e/cls/）：
 * - `export declare class Point { x: number; y: number; … }` + `export declare const p: Point;`
 * ⇒ `p` 是 `Point` 的实例（`p.x` 是 number），`dist(a, b)` 的参数面是 `Point`；
 * `tsc --strict` exit 0。
 *
 * 收割侧契约：
 * 1. `declare class` 的**实例成员**进实例面（属性 / 方法 / 访问器；`static` 不进）；
 * 2. `const p: Point` 这个**绑定保留**在 globals 里（类型是 `Point` 的实例面）；
 * 3. 以类名做参数类型时，参数面是 `Point`（不是 unknown）。
 *
 * 改前（实测）：`globals = ["Point", "dist"]`（`p` 整个不见了），
 * `Point: () => unknown`（空壳），`dist: (unknown, unknown) => number`。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug796-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const CLS = `export declare class Point {
  x: number;
  y: number;
  label: string;
  move(dx: number, dy: number): void;
  origin(): Point;
}
export declare const p: Point;
export declare function dist(a: Point, b: Point): number;
`;

/** brand / obj 形状的槽位名（brand 的内层是 obj 的 Abs） */
function slotNames(a: unknown): string[] {
  const s = (a as { shape?: Record<string, unknown> }).shape;
  if (!s) return [];
  if (s["k"] === "obj") {
    const slots = s["slots"] as Record<string, unknown> | undefined;
    return slots ? Object.keys(slots) : [];
  }
  if (s["k"] === "brand") {
    const inner = (s["shape"] as { shape?: { slots?: Record<string, unknown> } } | undefined)?.shape;
    return inner?.slots ? Object.keys(inner.slots) : [];
  }
  return [];
}

describe("declare class 的实例成员不再整体丢失，绑定不再消失", () => {
  it("`const p: Point` 绑定保留在 globals 里（改前整个消失）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    expect(env.globals["p"]).toBeDefined();
    expect(Object.hasOwn(env.globals, "p")).toBe(true);
  });

  it("`p` 的类型是 Point 的实例面（不是 unknown）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    expect(formatShape(env.globals["p"]!)).toBe("Point");
  });

  it("实例成员进实例面（x / y / label / move / origin）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    const inst = env.globals["p"]!;
    expect(slotNames(inst)).toEqual(expect.arrayContaining(["x", "y", "label", "move", "origin"]));
  });

  it("以类名做参数类型时参数面是 Point（改前退化成 unknown）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    expect(formatShape(env.globals["dist"]!)).toBe("(Point, Point) => number");
  });

  it("静态成员不进实例面", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare class WithStatic {
  static counter: number;
  value: number;
}
export declare const w: WithStatic;
`,
    );
    const env = harvestDts([p]);
    const names = slotNames(env.globals["w"]!);
    expect(names).toContain("value");
    expect(names).not.toContain("counter");
  });
});
});

// ---------------------------------------------------------------------------
// extends 判定按字面量值比（不是只比 prim 标签）
// ---------------------------------------------------------------------------
describe("extends 判定按字面量值比（不是只比 prim 标签）", () => {
/**
 * 回归（harvester 收割面）：条件类型的 `extends` 判定**只比 prim 标签**
 * ⇒ 字面量信息（在 `term` 上，不在 `shape` 上）被忽略 ⇒
 * `number extends 1` / `"a" extends "b"` / `1 extends 2` **恒判为真**。
 *
 * 改前（tmp/probe/fix-r27/h1a/probe.ts，BEFORE 行）：
 * number extends 1 → "yes" （TS："no"）
 * "a" extends "b" → "yes" （TS："no"）
 * string extends "a"→ "yes" （TS："no"）
 * 1 extends 2 → "yes" （TS："no"）
 * 改后：四条全是 "no"；方向正确的三条（`1 extends 1` / `1 extends number` /
 * `"a" extends string`）仍是 "yes" ⇒ 不是「一律判假」。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h1a/ts/oracle.ts）：exit=0
 * ⇒ TS 认定 `number extends 1` 等四条的真值都是 "no"。
 *
 * 契约（双向）：
 * 1. 字面量 vs 字面量 ⇒ **按值**比（"a" ≠ "b" ⇒ 假；1 = 1 ⇒ 真）；
 * 2. 字面量 vs 类型 ⇒ 字面量可赋值给对应 prim（1 extends number ⇒ 真）；
 * 3. 类型 vs 字面量 ⇒ 假（number extends 1 ⇒ 假，方向不能反）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug797-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 函数的**返回类型**展示面（relation 优先） */
function retOf(env: { globals: Record<string, Abs> }, name: string): string {
  const fn = env.globals[name]!;
  const rel = getFnImpl(fn)?.relation;
  const rt = rel?.returnType ?? (fn.shape.k === "fn" ? fn.shape.returnType : undefined);
  return rt ? formatShape(rt) : "<none>";
}

const decls = [
  `export declare function b797a(): number extends 1 ? "yes" : "no";`,
  `export declare function b797b(): "a" extends "b" ? "yes" : "no";`,
  `export declare function b797c(): string extends "a" ? "yes" : "no";`,
  `export declare function b797d(): 1 extends 2 ? "yes" : "no";`,
  `export declare function b797e(): 1 extends 1 ? "yes" : "no";`,
  `export declare function b797f(): 1 extends number ? "yes" : "no";`,
  `export declare function b797g(): "a" extends string ? "yes" : "no";`,
].join("\n");

describe("extends 判定按字面量值比（不是只比 prim 标签）", () => {
  it("类型 vs 字面量 ⇒ 假（number extends 1 / string extends \"a\"）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b797a")).toBe('"no"');
    expect(retOf(env, "b797c")).toBe('"no"');
    // 反向：不得取真支
    expect(retOf(env, "b797a")).not.toBe('"yes"');
    expect(retOf(env, "b797c")).not.toBe('"yes"');
  });

  it("字面量 vs 字面量 ⇒ 按值比（\"a\" vs \"b\" 假；1 vs 1 真；1 vs 2 假）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b797b")).toBe('"no"');
    expect(retOf(env, "b797d")).toBe('"no"');
    expect(retOf(env, "b797e")).toBe('"yes"');
    // 反向
    expect(retOf(env, "b797b")).not.toBe('"yes"');
    expect(retOf(env, "b797d")).not.toBe('"yes"');
    expect(retOf(env, "b797e")).not.toBe('"no"');
  });

  it("字面量 vs 类型 ⇒ 真（1 extends number / \"a\" extends string）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b797f")).toBe('"yes"');
    expect(retOf(env, "b797g")).toBe('"yes"');
    // 反向：不得取假支（也不能因为「字面量一律判假」而误伤）
    expect(retOf(env, "b797f")).not.toBe('"no"');
    expect(retOf(env, "b797g")).not.toBe('"no"');
  });

  it("判定不是「一律判假」：同值字面量仍然成立", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    // 1 extends 1 / 1 extends number / "a" extends string 三条都是真
    const trues = ["b797e", "b797f", "b797g"].map((n) => retOf(env, n));
    expect(trues).toEqual(['"yes"', '"yes"', '"yes"']);
  });
});
});

// ---------------------------------------------------------------------------
// (infer E)[] 的括号穿透 + 绑定替换真支
// ---------------------------------------------------------------------------
describe("(infer E)[] 的括号穿透 + 绑定替换真支", () => {
/**
 * 回归（harvester 收割面）：`matchExtendsInfer` **不认括号节点** ⇒
 * `(infer E)[]` 里的 `infer E` 外面套了一层 `ParenthesizedTypeNode` ⇒
 * 模式匹配落到兜底分支 ⇒ **E 不绑定** ⇒ 真支退化成 α 变量 ⇒
 * `number[] extends (infer E)[] ? E : never` 收割成 `any`（TS：`number`）。
 *
 * 改前（tmp/probe/fix-r27/h1a/probe.ts，BEFORE 行）：
 * parenArr() => any （TS：number）
 * parenObj() => any （TS：number）
 * prom() => number （TS：number —— `Promise<infer U>` 无括号，能绑）
 * 改后：三条全是 number ⇒ 同一语义只差一层括号不再有别。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h1a/ts/oracle.ts）：exit=0
 * ⇒ TS 认定三条的真值都是 number。
 *
 * ⚠️ 勘误：`number[] extends infer E[] ? E : never`（**去掉**括号）在 TS 里是
 * **语法错误**（TS1005: '?' expected）⇒ 不能当「同一构造去掉括号就能绑」的
 * 对照组；能去括号的对照构造是 `Promise<infer U>`（本文件已含）。
 *
 * 契约（双向）：
 * 1. 括号必须**穿透**（`infer` 收集与模式匹配都要过括号）；
 * 2. 绑定值必须**替换**真支里的 infer 变量引用（真支 `E` 是 TypeReferenceNode，
 * 不是 InferTypeNode —— 不查绑定表就会退化成 α）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug798-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 函数的**返回类型**展示面（relation 优先） */
function retOf(env: { globals: Record<string, Abs> }, name: string): string {
  const fn = env.globals[name]!;
  const rel = getFnImpl(fn)?.relation;
  const rt = rel?.returnType ?? (fn.shape.k === "fn" ? fn.shape.returnType : undefined);
  return rt ? formatShape(rt) : "<none>";
}

const decls = [
  `export declare function b798a(): number[] extends (infer E)[] ? E : never;`,
  `export declare function b798b(): { a: number } extends { a: infer V } ? V : never;`,
  `export declare function b798c(): Promise<number> extends Promise<infer U> ? U : never;`,
].join("\n");

describe("(infer E)[] 的括号穿透 + 绑定替换真支", () => {
  it("带括号的数组 infer 绑定元素类型（改前 any）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b798a")).toBe("number");
    // 反向：不得退化成 α / unknown
    expect(retOf(env, "b798a")).not.toBe("any");
    expect(retOf(env, "b798a")).not.toBe("unknown");
  });

  it("带括号的类型字面量 infer 绑定成员类型（改前 any）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b798b")).toBe("number");
    expect(retOf(env, "b798b")).not.toBe("any");
  });

  it("无括号的 Promise infer 仍然绑定（不被括号口径改坏）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b798c")).toBe("number");
    expect(retOf(env, "b798c")).not.toBe("any");
  });

  it("同一语义（带括号 / 不带括号）得到同一个值", () => {
    const p = writeTemp(
      "a.d.ts",
      `export declare function paren(): number[] extends (infer E)[] ? E : never;\n` +
        `export declare function generic(): number[] extends Array<infer F> ? F : never;\n`,
    );
    const env = harvestDts([p]);
    expect(retOf(env, "paren")).toBe("number");
    expect(retOf(env, "generic")).toBe("number");
    expect(retOf(env, "paren")).toBe(retOf(env, "generic"));
  });
});
});

// ---------------------------------------------------------------------------
// 交叉类型合并两侧成员（不再只保留 A）
// ---------------------------------------------------------------------------
describe("交叉类型合并两侧成员（不再只保留 A）", () => {
/**
 * 回归（harvester 收割面）：交叉类型 `A & B` **只保留 A**
 * ⇒ `Point & Size` 与 `Point` 在 Abs 层面**完全不可区分**（错值）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u799.ts，tsc exit=0）：
 * `interface Point { x: number; y: number }` + `interface Size { w: number; h: number }`
 * ⇒ `ps: Point & Size` 的 `.x` / `.w` **都是 number**（交叉类型的成员是并集）。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 * ps: Point pt: Point same? true ← Size 的成员整个没了
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 * ps: { x: number, y: number, w: number, h: number } pt: Point same? false
 *
 * 根因：`mapType` 的交叉分支的合并守卫要求每个成员都是 `obj` 形状，
 * 而**接口引用经 `instanceFor` 产出的是 `brand` 形状** ⇒ 守卫失败 ⇒
 * `return members[0]`（只留第一侧）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug799-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand / obj 形状的成员名（取自 Abs 的槽面） */
function memberNames(a: unknown): string[] {
  const s = (a as {
    shape: { k: string; slots?: Record<string, { value: unknown }>; shape?: unknown };
  }).shape;
  if (s.k === "brand") return memberNames(s.shape);
  if (s.k === "obj") return Object.keys(s.slots ?? {});
  return [];
}

describe("交叉类型合并两侧成员（不再只保留 A）", () => {
  it("Point & Size 的成员是并集（x/y/w/h 四个）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Point { x: number; y: number }
export interface Size { w: number; h: number }
export declare const ps: Point & Size;
export declare const pt: Point;
`,
    );
    const env = harvestDts([p]);
    const ps = env.globals["ps"]!;
    const names = memberNames(ps).sort();
    expect(names).toEqual(["h", "w", "x", "y"]);
  });

  it("交叉类型与单侧**可区分**（改前两者完全同形）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Point { x: number; y: number }
export interface Size { w: number; h: number }
export declare const ps: Point & Size;
export declare const pt: Point;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["ps"]!)).not.toBe(formatShape(env.globals["pt"]!));
    // 反向钉：交叉类型不能塌回单侧 Point
    expect(formatShape(env.globals["ps"]!)).not.toBe("Point");
  });

  it("成员的值域保留（不是 unknown / never）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Point { x: number; y: number }
export interface Size { w: number; h: number }
export declare const ps: Point & Size;
`,
    );
    const env = harvestDts([p]);
    const shape = formatShape(env.globals["ps"]!);
    expect(shape).toContain("x: number");
    expect(shape).toContain("w: number");
    expect(shape).not.toContain("unknown");
  });

  it("同名冲突成员取 never（TS 的 A & B 属性冲突语义）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface A { v: number }
export interface B { v: string }
export declare const ab: A & B;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["ab"]!)).toContain("never");
  });

  it("纯字面量交叉（无对象面）不崩，兜底取第一侧", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const s: string & { a: number };
`,
    );
    const env = harvestDts([p]);
    expect(env.globals["s"]).toBeDefined();
  });
});
});

// ---------------------------------------------------------------------------
// 泛型别名按类型实参实例化（实参不再被丢弃）
// ---------------------------------------------------------------------------
describe("泛型别名按类型实参实例化（实参不再被丢弃）", () => {
/**
 * 回归（harvester 收割面）：泛型**别名** `Box<number>` 与 `Box<string>`
 * **完全相同**且成员值域丢失（`{ v: unknown }`）（错值）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u800.ts，tsc exit=0）：
 * `type Box<T> = { v: T }` ⇒ `bn: Box<number>` 的 `.v` 是 **number**，
 * `bs: Box<string>` 的 `.v` 是 **string**（`bn.v` 赋给 string ⇒ TS 报错）。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 * a: { v: unknown } b: { v: unknown } same? true
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 * a: { v: number } b: { v: string } same? false
 *
 * 根因：`mapTypeRef` 的别名分支直接展开别名体、**丢弃实参** ⇒ 别名体内的
 * `T` 没有实参可代入 ⇒ 落到 `unknown`。同一文件里**接口**路径
 * （`instanceFor(ctx, name, args…)`）却是会代入实参的 ⇒ 同一语义、
 * 不同路径的成对缺口。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug800-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand / obj 形状的成员面（成员名 → 类型显示串） */
function memberSlots(a: unknown): Record<string, string> {
  const s = (a as {
    shape: { k: string; slots?: Record<string, { value: unknown }>; shape?: unknown };
  }).shape;
  if (s.k === "brand") return memberSlots(s.shape);
  if (s.k === "obj") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.slots ?? {})) out[k] = formatShape(v.value as never);
    return out;
  }
  return {};
}

describe("泛型别名按类型实参实例化（实参不再被丢弃）", () => {
  it("Box<number> / Box<string> 的成员值域分别是 number / string", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export type Box<T> = { v: T };
export declare const a: Box<number>;
export declare const b: Box<string>;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["a"]!)).toBe("{ v: number }");
    expect(formatShape(env.globals["b"]!)).toBe("{ v: string }");
  });

  it("两个实例**可区分**（改前完全同形）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export type Box<T> = { v: T };
export declare const a: Box<number>;
export declare const b: Box<string>;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["a"]!)).not.toBe(formatShape(env.globals["b"]!));
  });

  it("别名路径与接口路径**同口径**（两者都会代入实参）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export type Box<T> = { v: T };
export interface IBox<T> { v: T }
export declare const a: Box<number>;
export declare const b: IBox<number>;
`,
    );
    const env = harvestDts([p]);
    // 接口路径产出的是 brand（显示名 IBox），别名路径产出的是 obj ⇒
    // 比较**成员面**（同口径），不是显示串
    expect(memberSlots(env.globals["a"]!)).toEqual({ v: "number" });
    expect(memberSlots(env.globals["b"]!)).toEqual({ v: "number" });
  });

  it("别名体内是数组时也代入实参（Box<T> = T[]）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export type List<T> = T[];
export declare const a: List<number>;
export declare const b: List<string>;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["a"]!)).toBe("number[]");
    expect(formatShape(env.globals["b"]!)).toBe("string[]");
  });

  it("非泛型别名不受影响（不凭空多出实参）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export type Pair = { a: number; b: string };
export declare const p: Pair;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["p"]!)).toBe("{ a: number, b: string }");
  });
});
});

// ---------------------------------------------------------------------------
// 草稿面：TS 的 null 是**真 null 面**（不是 any()）
// ---------------------------------------------------------------------------
describe("草稿面：TS 的 null 是**真 null 面**（不是 any()）", () => {
/**
 * 回归（harvester **草稿面**）：TypeScript 的 `null` 被映射成
 * `any()` ⇒ 契约**是空的** ⇒ **假绿**（tsc 报 TS2322，`nudo check` 却绿）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h8a/e2e/b801.ts ⇒ TS2322）：
 * `function choose(flag: boolean): number | null { return "totally wrong"; }`
 *
 * 改前（git HEAD 的草稿面）：`null` → `any()` ⇒ 返回位无约束 ⇒ 绿。
 * 改后（tmp/probe/fix-r27/h8a/probe.ts）：
 * `export const choose = fn({ flag: boolean() }, union(number(), null));`
 *
 * **两个产物面同口径**：收割面把 `null` 建成 `{shape: unknown, term: lit null}`
 * （真 null 面，渲染成 `number | null`）；草稿面的 `union(…, null)` 经 core 的
 * `asNestedConstraint` 落成 `litC(null)`（同一个 entry Abs）⇒ 同一答案。
 *
 * 附带钉：`null` / 字面量出现在**约束位**（导出顶层、fn 返回位）时必须是
 * `union(…)` 包裹的**真约束**——裸写 `export const x = null;` 抄进侧车后
 * 根本不是约束（装载报「not a Nudo contract」）。
 */









const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeDts(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug801-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("草稿面：TS 的 null 是**真 null 面**（不是 any()）", () => {
  it("`number | null` 的草稿是 union(number(), null)，不是 any()", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function choose(flag: boolean): number | null;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("union(number(), null)");
    expect(draft.draftSource).not.toContain("any()");
    // 假绿根因：`any()` 会把整个返回位变成空约束
    expect(draft.draftSource).not.toMatch(/union\(number\(\), any\(\)\)/);
  });

  it("契约**真的**拒绝字符串（域隶属判定 = 假绿已消除）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function choose(flag: boolean): number | null;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    const exports = loadDraftExports(draft.draftSource);
    const ret = fnReturns(asConstraint(exports.choose));
    expect(literalMeetsConstraint("totally wrong", ret)).toBe(false);
    expect(literalMeetsConstraint(null, ret)).toBe(true);
    expect(literalMeetsConstraint(42, ret)).toBe(true);
  });

  it("产品面：草稿抄进侧车后 `nudo check` **红**（与 tsc 的 TS2322 同向）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function choose(flag: boolean): number | null;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    const dir = makeWorkDir("b801");
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function choose(flag) { return "totally wrong"; }\n`,
    );
    const res = runNudoCheck(target);
    removeWorkDir(dir);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("constraint-violated");
  });

  it("收割面同口径：`null` 是真 null 面（渲染成 number | null）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function choose(flag: boolean): number | null;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals.choose!)).toBe("(boolean) => number | null");
  });

  it("约束位上的裸字面量是**真约束**（顶层 null 导出不是 `export const x = null`）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare const x: null;
export declare const v: "1.0";
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("export const x = union(null)");
    expect(draft.draftSource).toContain('export const v = union("1.0")');
    const exports = loadDraftExports(draft.draftSource);
    expect(isNudoConstraint(exports.x)).toBe(true);
    expect(isNudoConstraint(exports.v)).toBe(true);
    expect(literalMeetsConstraint(null, asConstraint(exports.x))).toBe(true);
    expect(literalMeetsConstraint("other", asConstraint(exports.x))).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// 元组按逐槽映射（不再按首元素近似）
// ---------------------------------------------------------------------------
describe("元组按逐槽映射（不再按首元素近似）", () => {
/**
 * 回归（harvester 收割面）：元组类型按「**首元素**」近似
 * ⇒ 槽位 ≥1 的元素域是**错的具体类型**（假红 + 假绿）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u802.ts，tsc exit=0）：
 * `t1: [number, string]` ⇒ `t1[1]` 是 **string**；
 * `t2: [number, boolean]` ⇒ `t2[1]` 是 **boolean**（赋给 string ⇒ TS 报错）。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 * t1: number[] t2: number[] t3: number[] ← 三个不同类型完全同形
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 * t1: [number, string] t2: [number, boolean] t3: [number, ...string[]]
 *
 * 根因：`mapType` 的元组分支 `for (…) { return absArr(…) }` ⇒ **取首元素就返回**。
 * 这不是精度债，是**错的**具体类型（真实值域与断言值域不相交）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug802-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** tuple 形状的逐槽元素类型（brand / obj 之外直接读 shape） */
function tupleElements(a: unknown): string[] {
  const s = (a as { shape: { k: string; elements?: unknown[] } }).shape;
  if (s.k !== "tuple") return [];
  return (s.elements ?? []).map((e) => formatShape(e as never));
}

describe("元组按逐槽映射（不再按首元素近似）", () => {
  it("[number, string] 的槽位分别是 number / string", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const t1: [number, string];
`,
    );
    const env = harvestDts([p]);
    expect(tupleElements(env.globals["t1"]!)).toEqual(["number", "string"]);
  });

  it("槽位 ≥1 的元素域是**各自**的类型（不再与首元素相同）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const t1: [number, string];
export declare const t2: [number, boolean];
`,
    );
    const env = harvestDts([p]);
    expect(tupleElements(env.globals["t1"]!)).toEqual(["number", "string"]);
    expect(tupleElements(env.globals["t2"]!)).toEqual(["number", "boolean"]);
    // 两个不同元组不再收割成完全相同的东西
    expect(formatShape(env.globals["t1"]!)).not.toBe(formatShape(env.globals["t2"]!));
  });

  it("元组不再是数组（不再折成 number[]）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const t1: [number, string];
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["t1"]!)).not.toBe("number[]");
    expect(env.globals["t1"]!.shape.k).toBe("tuple");
  });

  it("rest 槽位保留自己的元素类型（[number, ...string[]]）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const t3: [number, ...string[]];
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["t3"]!.shape as { k: string; elements: unknown[]; rest?: unknown };
    expect(shape.k).toBe("tuple");
    expect(shape.elements.map((e) => formatShape(e as never))).toEqual(["number"]);
    expect(formatShape(shape.rest as never)).toBe("string[]");
  });

  it("具名元组成员保留自己的类型", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const tn: [a: number, b: string];
`,
    );
    const env = harvestDts([p]);
    expect(tupleElements(env.globals["tn"]!)).toEqual(["number", "string"]);
  });
});
});

// ---------------------------------------------------------------------------
// Record / 索引签名建成开放对象（带索引值域）
// ---------------------------------------------------------------------------
describe("Record / 索引签名建成开放对象（带索引值域）", () => {
/**
 * 回归（harvester 收割面）：`Record<K,V>` / 索引签名对象被建成
 * **闭**空对象 ⇒ 成员读出 **exact undefined** ⇒ 链式读取定抛 TypeError
 * （假红 + 错值）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u803.ts，tsc exit=0）：
 * `rec: Record<string, number>` ⇒ `rec.anyKey` 是 **number**；
 * `recS: Record<string, string>` ⇒ `recS.anyKey` 是 **string**。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 * r.shape: {"k":"obj","slots":{}} ← 闭、无索引值域
 * r: { } r2: { } ← 两个 Record 完全同形
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 * r.shape: {"k":"obj","slots":{},"index":{"key":string→…,"value":number},"open":true}
 *
 * 根因：`mapTypeRef` 的 `Record` 分支 `return absObj({})` —— 注释说
 * 「approximated as an open object type」，代码给的是**闭** `absObj({})`
 * ⇒ 注释与实现自相矛盾；索引值域整个丢失。
 *
 * ⚠️ 收割面（`mapTypeMembers` / `mapTypeRef` / `mapType`）在本分片的区间内，
 * 已修；**interface 路径**（`instanceFor`）的索引签名仍被跳过 ——
 * 那是 H2 的区间，见交付报告的「未修 / 保留」段。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug803-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

type ObjShape = {
  k: string;
  slots?: Record<string, { value: unknown }>;
  index?: { key: unknown; value: unknown };
  open?: boolean;
};

/** obj / brand 内层 obj 的形状 */
function objShapeOf(a: unknown): ObjShape | undefined {
  const s = (a as { shape: { k: string; shape?: unknown } }).shape;
  if (s.k === "brand") return objShapeOf(s.shape);
  if (s.k === "obj") return s as unknown as ObjShape;
  return undefined;
}

describe("Record / 索引签名建成开放对象（带索引值域）", () => {
  it("Record<string, number> 是开放对象且带索引值域 number", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const rec: Record<string, number>;
`,
    );
    const env = harvestDts([p]);
    const shape = objShapeOf(env.globals["rec"]!)!;
    expect(shape.open).toBe(true);
    expect(shape.index).toBeDefined();
    expect(formatShape(shape.index!.value as never)).toBe("number");
    expect(formatShape(shape.index!.key as never)).toBe("string");
  });

  it("两个不同的 Record **可区分**（改前都是闭空对象、完全同形）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const rec: Record<string, number>;
export declare const recS: Record<string, string>;
`,
    );
    const env = harvestDts([p]);
    const a = objShapeOf(env.globals["rec"]!)!;
    const b = objShapeOf(env.globals["recS"]!)!;
    expect(formatShape(a.index!.value as never)).toBe("number");
    expect(formatShape(b.index!.value as never)).toBe("string");
    expect(formatShape(a.index!.value as never)).not.toBe(
      formatShape(b.index!.value as never),
    );
  });

  it("类型字面量的索引签名也建成开放对象", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const lit: { [k: string]: number };
`,
    );
    const env = harvestDts([p]);
    const shape = objShapeOf(env.globals["lit"]!)!;
    expect(shape.open).toBe(true);
    expect(formatShape(shape.index!.value as never)).toBe("number");
  });

  it("索引签名 + 具名成员共存时两者都在（具名成员不被索引吞掉）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const lit: { known: string; [k: string]: number | string };
`,
    );
    const env = harvestDts([p]);
    const shape = objShapeOf(env.globals["lit"]!)!;
    expect(Object.keys(shape.slots ?? {})).toEqual(["known"]);
    expect(shape.open).toBe(true);
    expect(shape.index).toBeDefined();
  });

  it("没有索引签名的类型字面量仍是**闭**对象（开放性不被乱加）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const lit: { a: number };
`,
    );
    const env = harvestDts([p]);
    const shape = objShapeOf(env.globals["lit"]!)!;
    expect(shape.open).toBeUndefined();
    expect(shape.index).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// 类型判不出时 `declare const` 绑定仍保留（不判 ReferenceError）
// ---------------------------------------------------------------------------
describe("类型判不出时 `declare const` 绑定仍保留（不判 ReferenceError）", () => {
/**
 * 回归（harvester 收割面）：映射类型 / 模板字面量类型 / 索引访问类型
 * （以及 `keyof` / `typeof`）落 `unknown` 后，**`declare const` 整条绑定被丢弃**
 * ⇒ 用户代码引用它时被判「**确定抛 ReferenceError**」（L2 假红）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h5/e2e/unknown/）：
 * - `declare const mappedLit: { [K in "a" | "b"]: number };` 等在 .d.ts 里是
 * **运行时存在的全局**（TS 编译通过，exit 0）⇒ 引擎不得判 ReferenceError。
 *
 * 收割侧契约：
 * 1. 类型判不出（退成 `unknown`）时**绑定仍要保留** —— 收割 env 是分析面
 * 唯一的全局事实来源，绑定被删 ⇒ 引擎判决与事实相反；
 * 2. 「类型未建模」是**降级**（值域未知），不是「符号不存在」。
 *
 * 改前（实测）：`globals` 里 m1 / m3 / m4 / m5 / m6 一个都没有，
 * `stats.skipped` 8 → 13（+5 正好是这 5 条）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug804-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const FIXTURE = `export interface Box { a: string; b: number; }
export declare const mappedLit: { [K in "a" | "b"]: number };
export declare const tplStr: \`a\${string}\`;
export declare const idxA: Box["a"];
export declare const keyOfBox: keyof Box;
export declare const typeOfIdx: typeof idxA;
`;

describe("类型判不出时 `declare const` 绑定仍保留（不判 ReferenceError）", () => {
  it("映射类型 / 模板字面量 / 索引访问 / keyof / typeof 的绑定全部保留", () => {
    const p = writeTemp("fx.d.ts", FIXTURE);
    const env = harvestDts([p]);
    for (const name of ["mappedLit", "tplStr", "idxA", "keyOfBox", "typeOfIdx"]) {
      // 反向断言：改前这些绑定整个不在 globals 里 ⇒ 引擎判「确定抛 ReferenceError」
      expect(Object.hasOwn(env.globals, name)).toBe(true);
      expect(env.globals[name]).toBeDefined();
    }
  });

  it("值域未知时退成 unknown（降级，不是符号不存在）", () => {
    const p = writeTemp("fx.d.ts", FIXTURE);
    const env = harvestDts([p]);
    expect(formatShape(env.globals["mappedLit"]!)).toBe("unknown");
    expect(formatShape(env.globals["tplStr"]!)).toBe("unknown");
    expect(formatShape(env.globals["idxA"]!)).toBe("unknown");
  });

  it("可判定的类型不受影响（对照组：仍是确切类型）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const plain: number;
export declare const named: string;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["plain"]!)).toBe("number");
    expect(formatShape(env.globals["named"]!)).toBe("string");
  });

  it("没有类型标注的 `declare const` 也保留绑定", () => {
    const p = writeTemp("fx.d.ts", `export declare const untyped;\n`);
    const env = harvestDts([p]);
    expect(Object.hasOwn(env.globals, "untyped")).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// 接口成员的重载集全部保留
// ---------------------------------------------------------------------------
describe("接口成员的重载集全部保留", () => {
/**
 * 回归（harvester 收割面）：接口成员的**重载集**只保留第一个 overload ⇒
 * 第二个 overload 的返回类型被**整体抹除**（假红 + 假绿，与 TS 完全倒置）。
 *
 * 改前（tmp/probe/fix-r27/h2/before-after.ts，BEFORE 行）：
 * member m = (number) => string
 * 改后：
 * member m = (number | string) => string | number
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h2/oracle/）：
 * - `o805-use.ts`：`iov.m("hello")` 赋给 `number`、`iov.m(1)` 赋给 `string`
 * ⇒ tsc exit=0 ⇒ TS 按**实参类型**选 overload（两个返回类型都在契约里）。
 *
 * 契约：
 * 1. 成员面上的重载集**全部保留**（返回位并集，参数位逐位并集）；
 * 2. 与顶层函数路径（materialize 的 fn 分支，H4 的 ）**同口径**——
 * 同一实体两条收割路径不得给出两种形态。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug805-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand 的成员面（brand → inner obj → slots） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

function returnTypeOf(a: Abs | undefined): string {
  if (!a || a.shape.k !== "fn") return "<not a fn>";
  return formatShape(a.shape.returnType!);
}

function paramTypesOf(a: Abs | undefined): string {
  if (!a || a.shape.k !== "fn") return "<not a fn>";
  return (a.shape.paramTypes ?? []).map((p) => formatShape(p)).join(" | ");
}

describe("接口成员的重载集全部保留", () => {
  it("同名 overload 的返回类型不再被抹除（并集）", () => {
    const p = writeTemp(
      "over.d.ts",
      `export interface IOver { m(a: number): string; m(a: string): number; }\n` +
        `export declare const iov: IOver;\n`,
    );
    const env = harvestDts([p]);
    const m = slots(env.globals.iov!).m!;
    // 改前只有 (number) => string；改后两个返回类型都在
    expect(returnTypeOf(m)).toBe("string | number");
    expect(returnTypeOf(m)).not.toBe("string");
  });

  it("参数位逐位并集（与顶层函数路径同口径）", () => {
    const p = writeTemp(
      "over.d.ts",
      `export interface IOver { m(a: number): string; m(a: string): number; }\n` +
        `export declare const iov: IOver;\n`,
    );
    const env = harvestDts([p]);
    const m = slots(env.globals.iov!).m!;
    expect(paramTypesOf(m)).toBe("number | string");
  });

  it("顶层函数路径与接口成员路径同形（同一实体两条路径不得分叉）", () => {
    const p = writeTemp(
      "over.d.ts",
      `export declare function top(a: number): string;\n` +
        `export declare function top(a: string): number;\n` +
        `export interface IOver { m(a: number): string; m(a: string): number; }\n` +
        `export declare const iov: IOver;\n`,
    );
    const env = harvestDts([p]);
    const top = env.globals.top!;
    const member = slots(env.globals.iov!).m!;
    expect(returnTypeOf(member)).toBe(returnTypeOf(top));
    expect(paramTypesOf(member)).toBe(paramTypesOf(top));
  });

  it("单个签名（无重载）不受影响", () => {
    const p = writeTemp(
      "over.d.ts",
      `export interface ISingle { m(a: number): string; }\n` +
        `export declare const is: ISingle;\n`,
    );
    const env = harvestDts([p]);
    const m = slots(env.globals.is!).m!;
    expect(returnTypeOf(m)).toBe("string");
    expect(paramTypesOf(m)).toBe("number");
  });

  it("重载成员仍可调用（relation 面完整：参数位 + 返回位都在）", () => {
    const p = writeTemp(
      "over.d.ts",
      `export interface IOver { m(a: number): string; m(a: string): number; }\n` +
        `export declare const iov: IOver;\n`,
    );
    const env = harvestDts([p]);
    const m = slots(env.globals.iov!).m!;
    expect(m.shape.k).toBe("fn");
    if (m.shape.k !== "fn") return;
    expect((m.shape.paramTypes ?? []).length).toBe(1);
    expect(m.shape.returnType).toBeDefined();
  });
});
});

// ---------------------------------------------------------------------------
// 递归类型别名惰性/引用式建模（不指数展开）
// ---------------------------------------------------------------------------
describe("递归类型别名惰性/引用式建模（不指数展开）", () => {
/**
 * 回归（harvester 收割面）：递归**类型别名**按 depth 硬展开 ⇒
 * 展开 8 层且**指数级**（6 个自引用成员 ⇒ 54MB env 模块）⇒ 末层折成 unknown。
 *
 * 改前（tmp/probe/fix-r27/h2/probe-h2.ts）：
 * tree = { v: number, kids: { v: number, kids: { … 8 层 … unknown[] }[] }[] }
 * blow6: harvest 673ms, env module 54083943 bytes
 * 改后：
 * tree = brand(Tree) { v: number, kids: brand(Tree){unknown}[] } ← 惰性/引用式
 * blow6: harvest 0ms, env module 983 bytes（≈ 55000× 更小）
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h2/oracle/）：
 * - `o806-use.ts`（`tree.v` 与 `tree.kids[0].v` 都赋给 `number`）⇒ tsc exit=0
 * ⇒ TS 侧递归别名可以任意深度解引用。
 *
 * 契约：
 * 1. 递归别名**惰性/引用式**建模（自引用点 = 按名 brand 引用，不内联展开）；
 * 2. 展开深度有界（自引用点的内层是「形状待定」，不是又一层展开）；
 * 3. 规模有界（env 模块体积不随自引用成员数指数增长）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug806-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand 的成员面（brand → inner obj → slots） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

describe("递归类型别名惰性/引用式建模（不指数展开）", () => {
  it("递归别名 = 按名 brand（不是内联展开的对象）", () => {
    const p = writeTemp(
      "tree.d.ts",
      `export type Tree = { v: number; kids: Tree[] };\n` +
        `export declare const tree: Tree;\n`,
    );
    const env = harvestDts([p]);
    const tree = env.globals.tree!;
    expect(tree.shape.k).toBe("brand");
    if (tree.shape.k !== "brand") return;
    expect(tree.shape.name).toBe("Tree");
    // 成员面照搬类型字面量（v: number 仍然可见）
    expect(formatShape(slots(tree).v!)).toBe("number");
  });

  it("自引用点 = 按名 brand 引用（内层「形状待定」，不再展开一层）", () => {
    const p = writeTemp(
      "tree.d.ts",
      `export type Tree = { v: number; kids: Tree[] };\n` +
        `export declare const tree: Tree;\n`,
    );
    const env = harvestDts([p]);
    const kids = slots(env.globals.tree!).kids!;
    expect(kids.shape.k).toBe("arr");
    if (kids.shape.k !== "arr") return;
    const elem = kids.shape.element;
    expect(elem.shape.k).toBe("brand");
    if (elem.shape.k !== "brand") return;
    expect(elem.shape.name).toBe("Tree");
    // 自引用点的内层是「形状待定」⇒ 深度有界（改前是又一层完整展开）
    expect(elem.shape.shape.shape.k).toBe("unknown");
  });

  it("规模有界：自引用成员数增加时 env 模块不指数增长", () => {
    const sizes: number[] = [];
    for (const n of [2, 4, 6]) {
      const members = Array.from({ length: n }, (_, i) => `  m${i}: R;`).join("\n");
      const p = writeTemp(
        `blow${n}.d.ts`,
        `export type R = {\n${members}\n};\nexport declare const r: R;\n`,
      );
      const env = harvestDts([p]);
      sizes.push(emitEnvModule(env, "blow").length);
    }
    // 改前 blow6 = 54,083,943 bytes；改后是 KB 级（≈ 2700× 更小）
    expect(sizes[2]!).toBeLessThan(20_000);
    // 指数曲线下 n=6 / n=2 ≈ 3900×；线性（惰性引用）下应当 < 100×
    expect(sizes[2]!).toBeLessThan(sizes[0]! * 100);
  });

  it("互引别名（type A = { b: B }; type B = { a: A }）也被识别为递归", () => {
    const p = writeTemp(
      "mutual.d.ts",
      `export type A = { b: B };\n` +
        `export type B = { a: A };\n` +
        `export declare const a: A;\n`,
    );
    const env = harvestDts([p]);
    const a = env.globals.a!;
    expect(a.shape.k).toBe("brand");
    if (a.shape.k !== "brand") return;
    expect(a.shape.name).toBe("A");
    // 互引链（A → B → A → …）必须在有限跳内落到「形状待定」的按名引用
    let cur = a;
    let hops = 0;
    for (; hops < 5; hops++) {
      if (cur.shape.k !== "brand") break;
      const inner = cur.shape.shape;
      if (inner.shape.k === "unknown") break; // 形状待定 ⇒ 链终止
      const next = slots(inner);
      const key = Object.keys(next)[0];
      if (key === undefined) break;
      cur = next[key]!;
    }
    expect(hops).toBeLessThan(4);
  });
});
});

// ---------------------------------------------------------------------------
// 同一接口方法在两条收割路径上必须是同一个类型
// ---------------------------------------------------------------------------
describe("同一接口方法在两条收割路径上必须是同一个类型", () => {
/**
 * 回归（harvester 收割面）：同一个接口方法被收割成**两个不同类型**
 * （brand 成员 vs 模块级提升全局）。
 *
 * 两条收割路径：
 * - brand 面（`instanceFor`）：接口成员 → brand 槽位；
 * - 提升面（`expandInterfaceAsModuleMembers`）：接口成员 → 模块级 fn/var。
 * 此前两条路径用了**两套不同的重载合并策略** ⇒ 同一方法、同一份 .d.ts，两个类型。
 *
 * 改前（报告 tmp/probe/r15h/ifmeth.d.ts）：
 * brand `M.three` = (number) => string ← 只剩第一个 overload
 * 全局 `three` = (number) => string | number | boolean
 * 改后：两条路径给出**同一个**形态（返回位并集 / 参数位逐位并集）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o807.ts）：exit=0
 * ⇒ TS 侧三个 overload 都在契约里（按实参类型选分支）。
 *
 * 泛型接口的补充口径：提升路径**看不到类型实参** ⇒ 提升出来的是未绑定 α，
 * 与 brand 面（实参已代入）不是同一个类型 ⇒ 泛型接口的成员不提升。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug807-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand → inner obj → 槽位（值） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

const OVERLOADS = `declare module "m" {
  export interface M {
    three(a: number): string;
    three(a: string): number;
    three(a: boolean): boolean;
  }
  export declare const m: M;
}
`;

describe("同一接口方法在两条收割路径上必须是同一个类型", () => {
  it("brand 成员与**模块级**提升成员的形态完全一致（BUG-253：提升只对模块作用域成立）", () => {
    const p = writeTemp("ifmeth.d.ts", OVERLOADS);
    const env = harvestDts([p]);
    const member = slots(env.modules.m!.m!).three!;
    const promoted = env.modules.m!.three!;
    expect(promoted).toBeDefined();
    expect(JSON.stringify(promoted.shape)).toBe(JSON.stringify(member.shape));
  });

  it("重载集保留全部返回类型（不是只剩第一个 overload）", () => {
    const p = writeTemp("ifmeth.d.ts", OVERLOADS);
    const env = harvestDts([p]);
    const member = slots(env.modules.m!.m!).three!;
    expect(member.shape.k).toBe("fn");
    if (member.shape.k !== "fn") return;
    const ret = formatShape(member.shape.returnType!);
    expect(ret).toContain("string");
    expect(ret).toContain("number");
    expect(ret).toContain("boolean");
  });

  it("对照：单签名方法两条路径同样一致", () => {
    const p = writeTemp(
      "single.d.ts",
      `declare module "m" {
  export interface S { one(a: number): string; }
  export declare const s: S;
}
`,
    );
    const env = harvestDts([p]);
    const member = slots(env.modules.m!.s!).one!;
    const promoted = env.modules.m!.one!;
    expect(promoted).toBeDefined();
    expect(JSON.stringify(promoted.shape)).toBe(JSON.stringify(member.shape));
    expect(formatShape(member.shape.k === "fn" ? member.shape.returnType! : member)).toBe("string");
  });

  it("泛型接口：brand 面用类型实参（string），提升面不产出未绑定 α", () => {
    const p = writeTemp(
      "gen.d.ts",
      `declare module "m" {
  export interface Box<T> { get(): T; }
  export declare const box: Box<string>;
}
`,
    );
    const env = harvestDts([p]);
    const member = slots(env.modules.m!.box!).get!;
    expect(member.shape.k).toBe("fn");
    if (member.shape.k !== "fn") return;
    // brand 面：T 已被实参 string 代入
    expect(formatShape(member.shape.returnType!)).toBe("string");
    // 提升路径看不到实参 ⇒ 泛型接口的成员不提升（否则两条路径分叉）
    expect(env.modules.m!.get).toBeUndefined();
    expect(env.globals.get).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// 接口 extends 的继承成员并入实例模型
// ---------------------------------------------------------------------------
describe("接口 extends 的继承成员并入实例模型", () => {
/**
 * 回归（harvester 收割面）：接口 `extends` 的**继承成员在实例模型里整体消失**
 * ⇒ `derived.b` 折 `undefined`、`.length` **定抛 TypeError**（L2 假红）。
 *
 * 根因：收接口成员时只搬接口**自身**声明的成员，**不解析 `extends` 子句**
 * ⇒ 继承来的成员在实例模型里根本不存在 → 成员读落到「无此槽」→ 折 exact
 * `undefined` → 后续 `.length` 被判「确定抛 TypeError」。
 *
 * 改前（tmp/probe/fix-r27/h3/probe-h3b.ts，BEFORE 行）：
 * brand Derived 槽位 = { d: number } ← 继承来的 b 整条消失
 * 改后：
 * brand Derived 槽位 = { d: number, b: string }
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o809.ts）：exit=0
 * `derived.b` 是 string、`derived.b.length` 是 number ⇒ TS 侧继承成员必然存在。
 *
 * 产品面（`nudo check`，tmp/probe/fix-r27/h3/e2e/inherit/）：
 * 改前 `readBaseFieldLen() => never throws TypeError`（L2 假红）
 * 改后 `readBaseFieldLen() => number`
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug809-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand → inner obj → 槽位（值） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

const EXTENDS = `export interface Base { b: string; }
export interface Derived extends Base { d: number; }
export declare const derived: Derived;
export declare const base: Base;
`;

describe("接口 extends 的继承成员并入实例模型", () => {
  it("Derived 的实例面含基接口的成员 b", () => {
    const p = writeTemp("ext.d.ts", EXTENDS);
    const env = harvestDts([p]);
    const s = slots(env.globals.derived!);
    expect(Object.keys(s).sort()).toEqual(["b", "d"]);
    expect(formatShape(s.b!)).toBe("string");
    expect(formatShape(s.d!)).toBe("number");
  });

  it("继承来的成员不是「读不到」（不是 exact undefined）", () => {
    const p = writeTemp("ext.d.ts", EXTENDS);
    const env = harvestDts([p]);
    const s = slots(env.globals.derived!);
    expect(formatShape(s.b!)).not.toBe("undefined");
    expect(s.b!.term?.op).not.toBe("lit");
  });

  it("对照：基接口自身只有自己的成员（不被子接口的成员污染）", () => {
    const p = writeTemp("ext.d.ts", EXTENDS);
    const env = harvestDts([p]);
    expect(Object.keys(slots(env.globals.base!)).sort()).toEqual(["b"]);
  });

  it("对照：多级继承链（extends 递归）", () => {
    const p = writeTemp(
      "chain.d.ts",
      `export interface A1 { a: number; }
export interface A2 extends A1 { b: string; }
export interface A3 extends A2 { c: boolean; }
export declare const a3: A3;
`,
    );
    const env = harvestDts([p]);
    expect(Object.keys(slots(env.globals.a3!)).sort()).toEqual(["a", "b", "c"]);
  });

  it("对照：无 extends 时成员表不变（既有口径不被破坏）", () => {
    const p = writeTemp(
      "plain.d.ts",
      `export interface Plain { x: number; }
export declare const plain: Plain;
`,
    );
    const env = harvestDts([p]);
    expect(Object.keys(slots(env.globals.plain!))).toEqual(["x"]);
  });
});
});

// ---------------------------------------------------------------------------
// 方法的类型形参遮蔽外层同名形参（α 作用域隔离）
// ---------------------------------------------------------------------------
describe("方法的类型形参遮蔽外层同名形参（α 作用域隔离）", () => {
/**
 * 回归（harvester 收割面）：泛型**方法**自带类型形参与**接口**形参
 * **同名** ⇒ 接口的 α 代入把方法自身的 α 一并替换 ⇒ 方法被**去泛型化**
 * ⇒ `sh.m("text")` 折 `number`（真值 `string`）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u810.ts，tsc exit=0）：
 * `interface Shadow<T> { v: T; m<T>(x: T): T }` + `sh: Shadow<number>`
 * ⇒ `sh.v` 是 number（接口的 T）；
 * `sh.m("text")` 是 **string**（方法自己的 `<T>` **就近遮蔽**接口的 `<T>`，
 * m 对任意参数返回同类型）。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 * sh.v: string sh.m: (string) => string ← 方法被接口的实参去泛型化
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 * sh.v: string sh.m: (T@1fu64lg34) => T@1fu64lg34 ← 方法的 α 活着
 *
 * 根因：`ctx.typeParams` 是一个**扁平集合**（接口的 `T` 与方法自己的 `T`
 * 混在一起）⇒ `substAbs` 代入接口实参时把方法内部的 α 一并替换。
 *
 * 修法：α 身份按**作用域**隔离 —— `typeParamVarId` 取「AST 链上最近的
 * 声明者」；同名若还被外层声明过（= 遮蔽），内层用独立 id（`T@<tag>`）
 * ⇒ 外层代入不再穿透它。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug810-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand / obj 形状的成员面（成员名 → Abs） */
function memberSlots(a: unknown): Record<string, unknown> {
  const s = (a as {
    shape: { k: string; slots?: Record<string, { value: unknown }>; shape?: unknown };
  }).shape;
  if (s.k === "brand") return memberSlots(s.shape);
  if (s.k === "obj") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.slots ?? {})) out[k] = v.value;
    return out;
  }
  return {};
}

/** fn 形状的 α term id 列表 */
function varIds(a: unknown): string[] {
  const s = (a as { shape: { k: string; paramTypes?: unknown[]; returnType?: unknown } }).shape;
  const out: string[] = [];
  const push = (x: unknown): void => {
    const t = (x as { term?: { op: string; id?: string } })?.term;
    if (t?.op === "var" && t.id) out.push(t.id);
  };
  for (const p of s.paramTypes ?? []) push(p);
  push(s.returnType);
  return out;
}

describe("方法的类型形参遮蔽外层同名形参（α 作用域隔离）", () => {
  it("接口的 α 照常代入（sh.v 是实参类型）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Shadow<T> { v: T; m<T>(x: T): T }
export declare const sh: Shadow<string>;
`,
    );
    const env = harvestDts([p]);
    const slots = memberSlots(env.globals["sh"]!);
    expect(formatShape(slots["v"] as never)).toBe("string");
  });

  it("方法自己的 α **不被**接口实参替换（方法仍是泛型的）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Shadow<T> { v: T; m<T>(x: T): T }
export declare const sh: Shadow<string>;
`,
    );
    const env = harvestDts([p]);
    const slots = memberSlots(env.globals["sh"]!);
    const m = slots["m"] as { shape: { k: string; paramTypes?: unknown[]; returnType?: unknown } };
    expect(m.shape.k).toBe("fn");
    const ids = varIds(m);
    expect(ids.length).toBeGreaterThan(0);
    // 方法的 α 不得是接口实参「string」——必须仍是一个自由 var
    for (const id of ids) expect(id).not.toBe("string");
    // 反向钉：方法不能被去泛型化成 (string) => string
    expect(formatShape(m as never)).not.toBe("(string) => string");
  });

  it("遮蔽的 α 与外层 α 是**不同**的身份", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Shadow<T> { v: T; m<T>(x: T): T }
export declare const sh: Shadow<string>;
`,
    );
    const env = harvestDts([p]);
    const slots = memberSlots(env.globals["sh"]!);
    const m = slots["m"] as { shape: { paramTypes?: unknown[]; returnType?: unknown } };
    const ids = varIds(m);
    // 形参与返回位是同一个 α（同一个方法作用域）
    expect(new Set(ids).size).toBe(1);
    // 且它带作用域 tag（`T@…`），与外层裸名 `T` 不同
    expect(ids[0]).toMatch(/^T@/);
  });

  it("无同名遮蔽时，方法的 α 仍可被接口实参代入（不误伤）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Box<T> { v: T; m<U>(x: U): U }
export declare const b: Box<string>;
`,
    );
    const env = harvestDts([p]);
    const slots = memberSlots(env.globals["b"]!);
    expect(formatShape(slots["v"] as never)).toBe("string");
    // 方法自己的 U 仍然是自由 var（接口没有同名 U 可代入）
    const ids = varIds(slots["m"]);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0]).not.toBe("string");
  });
});
});

// ---------------------------------------------------------------------------
// 递归 interface 的自引用 = 形状待定（不是闭合空 brand）
// ---------------------------------------------------------------------------
describe("递归 interface 的自引用 = 形状待定（不是闭合空 brand）", () => {
/**
 * 回归（harvester 收割面）：递归 interface 的自引用被铸成**空 brand**
 * （`absBrand(name, {})` ⇒ 闭合空对象）⇒ 成员读走「槽位缺失 ⇒ exact undefined」
 * ⇒ 合法代码被判「定抛 TypeError」（L2 门禁假红）；且三条收割路径给出三种类型。
 *
 * 改前（tmp/probe/fix-r27/h2/before-after.ts，BEFORE 行）：
 * next.inner = { } （闭合空对象）
 * $get(next).value = undefined conf=exact ← 假红的成因
 * 改后：
 * next.inner = unknown （形状待定）
 * $get(next).value = unknown conf=partial ← 不再折成 exact undefined
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h2/oracle/）：
 * - `o812-use.ts`（`node.next.value` 赋给 `number`，再 `.toFixed(2)`）⇒ tsc exit=0
 * ⇒ TS 侧递归 interface 的成员读完全合法。
 *
 * 契约：
 * 1. 递归引用点 = 按名 brand + **形状待定**（不是闭合空对象）；
 * 2. 成员读不得折成 exact undefined（否则 L2 门禁假红）；
 * 3. 三条收割路径（收割面 / 磁盘往返面 / 落盘发射面）给出**同一个**类型。
 */








const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug812-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand 的成员面（brand → inner obj → slots） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

/** brand 的内层形状（brand → inner Abs） */
function brandInner(a: Abs): Abs | undefined {
  return a.shape.k === "brand" ? a.shape.shape : undefined;
}

const RECURSE_DTS =
  `export interface Node { value: number; next: Node; }\n` +
  `export declare const node: Node;\n`;

describe("递归 interface 的自引用 = 形状待定（不是闭合空 brand）", () => {
  it("自引用点是 brand 且内层「形状待定」", () => {
    const p = writeTemp("node.d.ts", RECURSE_DTS);
    const env = harvestDts([p]);
    const next = slots(env.globals.node!).next!;
    expect(next.shape.k).toBe("brand");
    if (next.shape.k !== "brand") return;
    expect(next.shape.name).toBe("Node");
    // 改前：闭合空对象（=「确定没有成员」）⇒ 成员读折 exact undefined ⇒ 假红
    expect(next.shape.shape.shape.k).toBe("unknown");
  });

  it("非递归成员仍然精确（value: number 不受影响）", () => {
    const p = writeTemp("node.d.ts", RECURSE_DTS);
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.node!).value!)).toBe("number");
  });

  it("成员读不折成 exact undefined（L2 假红的成因消失）", () => {
    const p = writeTemp("node.d.ts", RECURSE_DTS);
    const env = harvestDts([p]);
    const node = env.globals.node!;
    const next = $get(node, "next");
    expect(formatShape(next)).toBe("Node");
    const value = $get(next, "value");
    expect(formatShape(value)).toBe("unknown");
    // 关键断言：不是「确定为 undefined」（闭合空对象会折成这个）
    expect(value.conf).not.toBe("exact");
    expect(value.term?.op === "lit" && (value.term as { value?: unknown }).value === undefined).toBe(false);
  });

  it("三条收割路径给出同一个类型（收割面 / 磁盘往返面 / 落盘发射面）", () => {
    const p = writeTemp("node.d.ts", RECURSE_DTS);
    const env = harvestDts([p]);
    const inMemory = slots(env.globals.node!).next!;

    // 磁盘往返面：harvest-json 的投影 → 反序列化
    const roundTrip = harvestSigToAbs(absToHarvestSig(env.globals.node!));
    const onDisk = slots(roundTrip).next!;

    expect(formatShape(onDisk)).toBe(formatShape(inMemory));
    expect(formatShape(brandInner(onDisk)!)).toBe(formatShape(brandInner(inMemory)!));
    expect(brandInner(onDisk)!.shape.k).toBe("unknown");

    // 落盘发射面：env 模块里递归引用同样是「形状待定」
    const emitted = emitEnvModule(env, "node");
    expect(emitted).toContain('name: "Node", shape: absUnknown');
  });
});
});

// ---------------------------------------------------------------------------
// 泛型类型形参默认值生效（不留未绑定 α）
// ---------------------------------------------------------------------------
describe("泛型类型形参默认值生效（不留未绑定 α）", () => {
/**
 * 回归（harvester 收割面）：泛型**类型形参默认值**被丢弃 ⇒ 无参引用
 * 留下**未绑定 α**（T）⇒ 引擎侧「未绑定 α」= 无约束值 ⇒ 其上的任意方法调用
 * 被建模为定抛 TypeError（L2 门禁假红）。
 *
 * 改前（tmp/probe/fix-r27/h2/before-after.ts，BEFORE 行）：
 * Box(no args).v = any
 * 改后：
 * Box(no args).v = string （默认值生效）
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h2/oracle/）：
 * - `o813-use.ts`（`box.v.toUpperCase()` 赋给 `string`）⇒ tsc exit=0
 * ⇒ TS 侧 `Box`（无实参）取形参默认值 `string`。
 *
 * 契约：
 * 1. 类型形参默认值生效（无实参 ⇒ 取默认值）；
 * 2. 无默认值时取约束（TS 语义：推断不出 ⇒ 约束面）；
 * 3. 两者皆无 ⇒ 推断 unknown（不留未绑定 α ⇒ 不产生「定抛」假红）；
 * 4. `Box` ≡ `Box<string>`（默认路径与显式实参路径同形）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug813-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand 的成员面（brand → inner obj → slots） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

describe("泛型类型形参默认值生效（不留未绑定 α）", () => {
  it("无实参引用取默认值（改前是 any = 未绑定 α）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T extends string = string> { v: T }\n` +
        `export declare const box: Box;\n`,
    );
    const env = harvestDts([p]);
    const v = slots(env.globals.box!).v!;
    expect(formatShape(v)).toBe("string");
    // 改前：any（未绑定 α ⇒ 其上方法调用被判「定抛」）
    expect(formatShape(v)).not.toBe("any");
    // 未绑定 α 的形状（any + var term）不得残留
    expect(v.term?.op).not.toBe("var");
  });

  it("`Box` ≡ `Box<string>`（默认路径与显式实参路径同形）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T extends string = string> { v: T }\n` +
        `export declare const box: Box;\n` +
        `export declare const explicit: Box<string>;\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.box!).v!)).toBe("string");
    expect(formatShape(slots(env.globals.explicit!).v!)).toBe("string");
  });

  it("显式实参仍然优先于默认值", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T extends string = string> { v: T }\n` +
        `export declare const box: Box<"lit">;\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.box!).v!)).toBe('"lit"');
  });

  it("无默认值时取约束面（不留完全无约束的 α）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T extends string> { v: T }\n` +
        `export declare const box: Box;\n`,
    );
    const env = harvestDts([p]);
    const v = slots(env.globals.box!).v!;
    expect(formatShape(v)).toBe("string");
    expect(v.term?.op).not.toBe("var");
  });

  it("既无默认值也无约束 ⇒ 推断 unknown（不是未绑定 α）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T> { v: T }\n` +
        `export declare const box: Box;\n`,
    );
    const env = harvestDts([p]);
    const v = slots(env.globals.box!).v!;
    expect(formatShape(v)).toBe("unknown");
    expect(v.term?.op).not.toBe("var");
  });

  it("多形参：部分显式 + 其余取默认值", () => {
    const p = writeTemp(
      "pair.d.ts",
      `export interface Pair<A = string, B = number> { a: A; b: B }\n` +
        `export declare const pair: Pair<boolean>;\n`,
    );
    const env = harvestDts([p]);
    const s = slots(env.globals.pair!);
    expect(formatShape(s.a!)).toBe("boolean");
    expect(formatShape(s.b!)).toBe("number");
  });
});
});

// ---------------------------------------------------------------------------
// brand-vs-brand 按结构判 extends（不是只比名字）
// ---------------------------------------------------------------------------
describe("brand-vs-brand 按结构判 extends（不是只比名字）", () => {
/**
 * 回归（harvester 收割面）：条件类型的 `extends` 判定在 **brand-vs-brand**
 * 上**只比名字** ⇒ 结构相同、名字不同的两个 interface 被判「不 extends」⇒
 * 条件类型**确定地**走错分支（**硬错值**：与 TS 相反的确切字面量）。
 *
 * 改前（tmp/probe/fix-r27/h1a/probe.ts，BEFORE 行）：
 * same() => "no" （TS："yes" —— A/B 结构相同）
 * diff() => "no" （TS："no" —— A/C 成员类型不同，碰巧对）
 * self() => "yes" （TS："yes" —— 靠**同名**蒙对）
 * 改后：same() => "yes"、diff() => "no"、self() => "yes"。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h1a/ts/oracle.ts）：exit=0
 * ⇒ TS 认定 `B816A extends B816B` 成立（结构可赋值）、`B816A extends B816C` 不成立。
 *
 * 契约（双向）：
 * 1. brand 比较要看**结构**（同构即等），不能只比名字；
 * 2. 结构不同 ⇒ 仍然判假（不是「一律判真」的放宽）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug816-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 函数的**返回类型**展示面（relation 优先） */
function retOf(env: { globals: Record<string, Abs> }, name: string): string {
  const fn = env.globals[name]!;
  const rel = getFnImpl(fn)?.relation;
  const rt = rel?.returnType ?? (fn.shape.k === "fn" ? fn.shape.returnType : undefined);
  return rt ? formatShape(rt) : "<none>";
}

const decls = [
  `export interface B816A { x: number }`,
  `export interface B816B { x: number }`,
  `export interface B816C { x: string }`,
  `export declare function b816a(): B816A extends B816B ? "yes" : "no";`,
  `export declare function b816b(): B816A extends B816C ? "yes" : "no";`,
  `export declare function b816c(): B816A extends B816A ? "yes" : "no";`,
].join("\n");

describe("brand-vs-brand 按结构判 extends（不是只比名字）", () => {
  it("结构相同的两个 interface ⇒ 判真（改前按名字判假）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b816a")).toBe('"yes"');
    // 反向：不得取假支
    expect(retOf(env, "b816a")).not.toBe('"no"');
  });

  it("结构不同的两个 interface ⇒ 判假（不能因为放宽而一律判真）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b816b")).toBe('"no"');
    expect(retOf(env, "b816b")).not.toBe('"yes"');
  });

  it("同名 interface ⇒ 判真（不得被结构口径改坏）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b816c")).toBe('"yes"');
    expect(retOf(env, "b816c")).not.toBe('"no"');
  });

  it("多成员结构相同 ⇒ 判真；源上**缺成员** ⇒ 判假", () => {
    const p = writeTemp(
      "a.d.ts",
      `export interface P { x: number; y: string }` +
        `export interface Q { x: number; y: string }` +
        `export interface R { x: number }` +
        `export declare function same(): P extends Q ? "yes" : "no";` +
        `export declare function extra(): P extends R ? "yes" : "no";` +
        `export declare function fewer(): R extends P ? "yes" : "no";`,
    );
    const env = harvestDts([p]);
    expect(retOf(env, "same")).toBe('"yes"');
    // 源上多出成员仍然可赋值（TS：P extends R 成立）
    expect(retOf(env, "extra")).toBe('"yes"');
    // 源上**缺**成员 ⇒ 不可赋值
    expect(retOf(env, "fewer")).toBe('"no"');
    expect(retOf(env, "fewer")).not.toBe('"yes"');
  });
});
});

// ---------------------------------------------------------------------------
// 内联类型字面量的访问器成员不再被丢掉
// ---------------------------------------------------------------------------
describe("内联类型字面量的访问器成员不再被丢掉", () => {
/**
 * 回归（harvester 收割面）：**内联类型字面量**丢 `get` / `set`
 * 访问器 ⇒ 成员从**闭合对象**上读出 **exact `undefined`**（真值是 number）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u819.ts，tsc exit=0）：
 * `inline: { get value(): number; plain: string }` ⇒ `inline.value` 是
 * **number**、`inline.plain` 是 string；`vi: I`（interface 形态）同口径。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 * inline slots: [ 'plain' ] ← 访问器 `value` 整条被丢掉
 * iface slots: [ 'value', 'plain' ] ← interface 路径是好的（instanceFor）
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 * inline slots: [ 'plain', 'value' ] inline.value: number
 *
 * 根因：`mapTypeMembers`（内联类型字面量路径）只处理 `isPropertySignature` /
 * `isMethodSignature`，**没有访问器分支** ⇒ 访问器成员被静默跳过 ⇒ 对象面
 * **闭合** ⇒ 未建模成员的读取语义是 **exact undefined**（一个**具体的错值**）。
 *
 * 契约：
 * 1. 内联类型字面量与 interface 两条路径的**成员集合必须一致**；
 * 2. 读面来自 **getter**（TS 的 `getTypeOfSymbol` 对 get/set 对取 getter
 * 的返回类型），且**与声明顺序无关**（set 在前 / get 在后也取 getter）；
 * 3. 写面（setter 的形参类型）与读面**分开建模**。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug819-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand / obj 形状的成员面（成员名 → 类型显示串） */
function memberSlots(a: unknown): Record<string, string> {
  const s = (a as {
    shape: { k: string; slots?: Record<string, { value: unknown }>; shape?: unknown };
  }).shape;
  if (s.k === "brand") return memberSlots(s.shape);
  if (s.k === "obj") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.slots ?? {})) out[k] = formatShape(v.value as never);
    return out;
  }
  return {};
}

describe("内联类型字面量的访问器成员不再被丢掉", () => {
  it("内联字面量与 interface 两条路径的成员集合**一致**", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const inline: { get value(): number; plain: string };
export interface I { get value(): number; plain: string }
export declare const vi: I;
`,
    );
    const env = harvestDts([p]);
    const inline = memberSlots(env.globals["inline"]!);
    const iface = memberSlots(env.globals["vi"]!);
    expect(Object.keys(inline).sort()).toEqual(["plain", "value"]);
    expect(Object.keys(inline).sort()).toEqual(Object.keys(iface).sort());
  });

  it("访问器的读面是 getter 的返回类型（不是 exact undefined）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const inline: { get value(): number; plain: string };
`,
    );
    const env = harvestDts([p]);
    const inline = memberSlots(env.globals["inline"]!);
    expect(inline["value"]).toBe("number");
    expect(inline["plain"]).toBe("string");
    // 反向钉：不能折成 exact undefined
    expect(inline["value"]).not.toBe("undefined");
  });

  it("get / set 对的读面**与声明顺序无关**（set 在前也取 getter）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const setFirst: { set value(v: number); get value(): number };
export declare const getFirst: { get value(): number; set value(v: number); };
`,
    );
    const env = harvestDts([p]);
    expect(memberSlots(env.globals["setFirst"]!)["value"]).toBe("number");
    expect(memberSlots(env.globals["getFirst"]!)["value"]).toBe("number");
    expect(memberSlots(env.globals["setFirst"]!)).toEqual(
      memberSlots(env.globals["getFirst"]!),
    );
  });

  it("只有 setter 时读面不折 exact undefined（写面单独建模）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const onlySet: { set value(v: number); };
`,
    );
    const env = harvestDts([p]);
    const v = memberSlots(env.globals["onlySet"]!)["value"]!;
    expect(v).not.toBe("undefined");
    expect(v).toContain("number");
  });

  it("无访问器的普通字面量不受影响", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const plain: { a: number; b: string };
`,
    );
    const env = harvestDts([p]);
    expect(memberSlots(env.globals["plain"]!)).toEqual({ a: "number", b: "string" });
  });
});
});

// ---------------------------------------------------------------------------
// 条件元数据按条目隔离（不跨签名泄漏）
// ---------------------------------------------------------------------------
describe("条件元数据按条目隔离（不跨签名泄漏）", () => {
/**
 * 回归（harvester 收割面）：条件类型的 `infer` 元数据经**上下文级单槽**
 * （`ctx.pendingCond`）泄漏进**下一条**签名 ⇒ **逐字相同**的两条声明得到
 * **不同**类型 ⇒ 门禁**冷缓存假红 / 热缓存绿**（结论随缓存状态翻转）。
 *
 * 泄漏链（改前）：接口**属性位**的条件类型把元数据写进上下文级单槽 ⇒ 没人
 * 消费（属性不是签名）⇒ **下一条**函数签名无条件捡走 ⇒ 该签名的返回被换成
 * `condFallback`（假支）⇒ 调用点折出 `0` 而不是 `string`。
 *
 * 改前（tmp/probe/fix-r27/h1a/probe.ts，BEFORE 行）：
 * one.inferFrom = {"fromVar":"T","via":"promise","inferVar":"U"} ← 捡来的
 * two.inferFrom = undefined
 * one(x) => 0 ← ★ 泄漏的 condFallback（假支）
 * two(x) => string
 * 改后：
 * one.inferFrom = undefined two.inferFrom = undefined
 * one(x) => string two(x) => string
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h1a/ts/oracle.ts）：exit=0
 * ⇒ TS 认为 one / two 都返回 string（逐字相同 ⇒ 必须一致）。
 *
 * 契约（双向）：
 * 1. 条件元数据**按条目隔离**：属性位 / 类型位的元数据不属于任何签名，
 * 不许被下一条签名捡走；
 * 2. **逐字相同**的两条声明必须得到**完全相同**的类型（不论遍历顺序、
 * 不论收割几次 ⇒ 冷 / 热缓存两种状态同口径）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug821-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** fn 的 relation 元数据 */
function relOf(env: { globals: Record<string, Abs> }, name: string) {
  return getFnImpl(env.globals[name]!)?.relation;
}

/** 声明的返回类型展示面 */
function retOf(env: { globals: Record<string, Abs> }, name: string): string {
  const rel = relOf(env, name);
  const rt = rel?.returnType;
  return rt ? formatShape(rt) : "<none>";
}

/** 调用点实例化后的返回类型展示面 */
function callOf(env: { globals: Record<string, Abs> }, name: string, arg: Abs): string {
  return formatShape(instantiateReturn(env.globals[name]!, [arg]));
}

const sameFile = [
  `export declare interface Box<T> {`,
  `  payload: T extends Promise<infer U> ? U : 0;`,
  `}`,
  `export declare function one(x: Box<Promise<string>>): string;`,
  `export declare function two(x: Box<Promise<string>>): string;`,
].join("\n");

describe("条件元数据按条目隔离（不跨签名泄漏）", () => {
  it("逐字相同的两条声明 ⇒ 调用点返回类型完全一致", () => {
    const p = writeTemp("a.d.ts", sameFile);
    const env = harvestDts([p]);
    const arg = env.globals.Box!;
    expect(callOf(env, "one", arg)).toBe("string");
    expect(callOf(env, "two", arg)).toBe("string");
    // 反向：不得出现泄漏的假支（0）
    expect(callOf(env, "one", arg)).not.toBe("0");
    expect(callOf(env, "two", arg)).not.toBe("0");
  });

  it("属性位的条件元数据不被下一条签名捡走（inferFrom 必须为空）", () => {
    const p = writeTemp("a.d.ts", sameFile);
    const env = harvestDts([p]);
    // 两条声明的返回位都是 `string`（不是条件类型）⇒ 谁都不该带 inferFrom
    expect(relOf(env, "one")?.inferFrom).toBeUndefined();
    expect(relOf(env, "two")?.inferFrom).toBeUndefined();
    // 反向：显式否掉「捡到了」
    expect(relOf(env, "one")?.inferFrom).not.toBeDefined();
  });

  it("冷 / 热缓存两种状态同口径（重复收割结果不变）", () => {
    const p = writeTemp("a.d.ts", sameFile);
    const cold = harvestDts([p]);
    const hot = harvestDts([p]);
    const arg1 = cold.globals.Box!;
    const arg2 = hot.globals.Box!;
    expect(callOf(cold, "one", arg1)).toBe(callOf(hot, "one", arg2));
    expect(callOf(cold, "two", arg1)).toBe(callOf(hot, "two", arg2));
    expect(callOf(cold, "one", arg1)).toBe("string");
    expect(callOf(hot, "two", arg2)).toBe("string");
  });

  it("遍历顺序不影响结论（接口单独一个文件 / 换文件顺序）", () => {
    const iface = writeTemp(
      "box.d.ts",
      `export declare interface Box<T> { payload: T extends Promise<infer U> ? U : 0; }\n`,
    );
    const fns = writeTemp(
      "fns.d.ts",
      `export declare function one(x: Box<Promise<string>>): string;\n` +
        `export declare function two(x: Box<Promise<string>>): string;\n`,
    );
    const a = harvestDts([iface, fns]);
    const b = harvestDts([fns, iface]);
    expect(callOf(a, "one", a.globals.Box!)).toBe("string");
    expect(callOf(a, "two", a.globals.Box!)).toBe("string");
    expect(callOf(b, "one", b.globals.Box!)).toBe("string");
    expect(callOf(b, "two", b.globals.Box!)).toBe("string");
    expect(retOf(a, "one")).toBe(retOf(b, "one"));
    expect(retOf(a, "two")).toBe(retOf(b, "two"));
  });

  it("真支就是 infer 变量时，元数据仍挂在**自己那条**签名上", () => {
    const p = writeTemp(
      "a.d.ts",
      `export declare function unpack<T>(x: T): T extends Promise<infer U> ? U : T;\n`,
    );
    const env = harvestDts([p]);
    // 自己那条签名必须拿到 inferFrom（否则调用点解不出 U）
    expect(relOf(env, "unpack")?.inferFrom?.via).toBe("promise");
    expect(relOf(env, "unpack")?.inferFrom?.inferVar).toBe("U");
  });
});
});

// ---------------------------------------------------------------------------
// extends 位判不出 ⇒ 不取支（不是恒真）
// ---------------------------------------------------------------------------
describe("extends 位判不出 ⇒ 不取支（不是恒真）", () => {
/**
 * 回归（harvester 收割面）：`keyof` / `typeof` / 未解析类型在条件类型的
 * **`extends` 位**被当成 `unknown`（退化哨兵）⇒ 判定**恒为真** ⇒ 条件类型
 * **取错支**（与 TS 相反的确切字面量）。
 *
 * 改前（tmp/probe/fix-r27/h1a/probe.ts，BEFORE 行）：
 * ko() => "yes" （TS："no" —— "z" 不是 {a,b} 的键）
 * ko2() => "yes" （TS："yes" —— 碰巧对）
 * tq() => "yes" （typeof 判不出 ⇒ 不该取支）
 * un() => "yes" （未解析类型 ⇒ 不该取支）
 * 改后：ko() => "no"、ko2() => "yes"、tq()/un() => "yes" | "no"（判不出 ⇒
 * **不取支**，取两支并集）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h1a/ts/oracle.ts）：exit=0
 * ⇒ TS 认定 `"z" extends keyof { a: 1; b: 2 }` 为假（真值 "no"）、
 * `"a" extends keyof { a: 1; b: 2 }` 为真（真值 "yes"）。
 *
 * 契约（双向）：
 * 1. `extends` 位**判不出**（退化哨兵）⇒ 结果是 **unknown**（三分支里的第三
 * 支）⇒ **不取支**（取两支并集），绝不能当 unknown 恒真；
 * 2. `keyof` **能算出来**时（字面量键名集合）必须**照常判定**
 * —— 不能因为「keyof 一律判不出」而把 "no" 也放成并集。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug822-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 函数的**返回类型**展示面（relation 优先） */
function retOf(env: { globals: Record<string, Abs> }, name: string): string {
  const fn = env.globals[name]!;
  const rel = getFnImpl(fn)?.relation;
  const rt = rel?.returnType ?? (fn.shape.k === "fn" ? fn.shape.returnType : undefined);
  return rt ? formatShape(rt) : "<none>";
}

const decls = [
  `export declare function b822a(): "z" extends keyof { a: 1; b: 2 } ? "yes" : "no";`,
  `export declare function b822b(): "a" extends keyof { a: 1; b: 2 } ? "yes" : "no";`,
  `export declare function b822c(): "z" extends typeof globalThis ? "yes" : "no";`,
  `export declare function b822d(): "z" extends UnresolvedThing ? "yes" : "no";`,
].join("\n");

describe("extends 位判不出 ⇒ 不取支（不是恒真）", () => {
  it("keyof 可算 ⇒ 照常判定（\"z\" 不在 {a,b} ⇒ 假）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b822a")).toBe('"no"');
    // 反向：不得取真支
    expect(retOf(env, "b822a")).not.toBe('"yes"');
  });

  it("keyof 可算 ⇒ 在键集合里 ⇒ 真（不能一律判不出）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b822b")).toBe('"yes"');
    expect(retOf(env, "b822b")).not.toBe('"no"');
  });

  it("typeof 判不出 ⇒ 不取支（两支并集，不是恒真）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    const s = retOf(env, "b822c");
    expect(s).toContain('"yes"');
    expect(s).toContain('"no"');
    // 反向：不得落成任何一支
    expect(s).not.toBe('"yes"');
    expect(s).not.toBe('"no"');
  });

  it("未解析的类型引用判不出 ⇒ 不取支（两支并集）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    const s = retOf(env, "b822d");
    expect(s).toContain('"yes"');
    expect(s).toContain('"no"');
    expect(s).not.toBe('"yes"');
    expect(s).not.toBe('"no"');
  });

  it("keyof 的判定方向不随「判不出」放宽（对拍 TS 的两条断言）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b822a")).toBe('"no"');
    expect(retOf(env, "b822b")).toBe('"yes"');
  });
});
});

// ---------------------------------------------------------------------------
// 真支是嵌套条件类型 ⇒ 递归求值（不被 infer 变量顶替）
// ---------------------------------------------------------------------------
describe("真支是嵌套条件类型 ⇒ 递归求值（不被 infer 变量顶替）", () => {
/**
 * 回归（harvester 收割面）：外层条件类型的**真支本身是嵌套条件类型**时，
 * 真支被 `infer` 变量**顶替** ⇒ 返回**错误确切字面量**（与 TS 相反）。
 *
 * 改前（tmp/probe/fix-r27/h1a/probe.ts，BEFORE 行）：
 * nst() => any ← 真支（嵌套条件类型）被 infer 变量 E 顶替
 * nst2() => any
 * 改后：
 * nst() => "s" | "n" | "x" ← 真支**递归求值**（"s"/"n"）+ 假支 "x"
 * nst2() => any ← 真支**就是** infer 变量（合法的 α 捷径）
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h1a/ts/oracle.ts）：exit=0
 * ⇒ TS 认定 `b823(["a"])` 的类型是 "s"（外层真支 → 内层 `E extends string`
 * 成立 ⇒ "s"）；改前的 "any" 与之相反（把元素值域当成了结果）。
 *
 * 契约（双向）：
 * 1. 真支是**嵌套条件类型** ⇒ 必须**递归求值**（真支的取值出现在结果里），
 * 不得被 infer 变量顶替；
 * 2. 真支**就是** infer 变量 ⇒ 仍走 α 捷径（`relation.inferFrom` 在位，
 * 调用点能绑出元素类型）—— 不能把这条路径一起砍掉。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug823-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 函数的**返回类型**展示面（relation 优先） */
function retOf(env: { globals: Record<string, Abs> }, name: string): string {
  const fn = env.globals[name]!;
  const rel = getFnImpl(fn)?.relation;
  const rt = rel?.returnType ?? (fn.shape.k === "fn" ? fn.shape.returnType : undefined);
  return rt ? formatShape(rt) : "<none>";
}

const decls = [
  `export declare function b823<T>(x: T): T extends (infer E)[] ? (E extends string ? "s" : "n") : "x";`,
  `export declare function b823b<T>(x: T): T extends (infer E)[] ? E : "x";`,
].join("\n");

describe("真支是嵌套条件类型 ⇒ 递归求值（不被 infer 变量顶替）", () => {
  it("嵌套条件类型的真支被递归求值（真支取值出现在结果里）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    const s = retOf(env, "b823");
    // 真支（嵌套条件类型）的两个取值都在
    expect(s).toContain('"s"');
    expect(s).toContain('"n"');
    // 假支也在（外层未决 ⇒ 保守并集）
    expect(s).toContain('"x"');
  });

  it("不再返回 infer 变量顶替出来的错误确切值", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    const s = retOf(env, "b823");
    // 反向：不得只剩 α（"any"）、不得只剩假支 "x"、不得是元素值域
    expect(s).not.toBe("any");
    expect(s).not.toBe('"x"');
    expect(s).not.toBe('"a"');
  });

  it("真支就是 infer 变量时仍走 α 捷径（inferFrom 在位）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    const rel = getFnImpl(env.globals.b823b!)?.relation;
    expect(rel?.inferFrom?.via).toBe("arr");
    expect(rel?.inferFrom?.inferVar).toBe("E");
    // 反向：不得被当成「真支是别的东西」而丢掉元数据
    expect(rel?.inferFrom).toBeDefined();
  });

  it("嵌套真支不被当成 infer 变量 ⇒ 不挂 inferFrom", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    const rel = getFnImpl(env.globals.b823!)?.relation;
    // 真支不是 infer 变量 ⇒ 不该走 α 捷径（元数据不该被写上去）
    expect(rel?.inferFrom).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// --from-dts 的重载集
// ---------------------------------------------------------------------------
describe("--from-dts 的重载集", () => {
/**
 * `nudo contract --from-dts` 把**重载集静默塌成第一个 overload**
 * ⇒ 草稿**少声明**签名，且被丢掉的 overload **不计入 `skipped`**
 * ⇒ 汇总行**看不出任何丢失**。
 *
 * 修法（草稿面）：
 * 1. 重载**全部保留**：合并后的返回类型取**全部 overload 的 union**
 * （与收割面 `harvest-dts.ts` 的重载合并**同口径**），形参取首个；
 * 2. 每条 overload 的**签名写进 note** ⇒ 审阅者看得见「这里本来有 N 条」；
 * 3. 被合并掉的 overload **计入 `stats.skipped`** ⇒ 汇总行说真话。
 *
 * 反向闸：改前（塌成第一个 overload、`skipped` 不计数）⇒ 本文件全部失败。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeDts(name: string, src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug825-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, src, "utf-8");
  return file;
}

describe("-from-dts 的重载集", () => {
  it("重载集保留**全部** overload 的返回类型（不被塌成第一个）", () => {
    const file = writeDts(
      "kt14.d.ts",
      `export declare function over(x: string): string;
export declare function over(x: string, y: number): number;
`,
    );
    const draft = dtsToContractDraft([file], "kt14");
    // 合并后的返回类型 = 两条 overload 的 union
    expect(draft.draftSource).toContain("union(string(), number())");
    // 改前：只保留第一个 overload ⇒ 这行会出现在草稿里
    expect(draft.draftSource).not.toContain("export const over = fn({ x: string() }, string());");
  });

  it("每条 overload 的签名都看得见（note 里逐条列出）", () => {
    const file = writeDts(
      "kt14.d.ts",
      `export declare function over(x: string): string;
export declare function over(x: string, y: number): number;
`,
    );
    const draft = dtsToContractDraft([file], "kt14");
    expect(draft.draftSource).toContain("2 overloads merged");
    expect(draft.draftSource).toContain("fn({ x: string() }, string())");
    expect(draft.draftSource).toContain("fn({ x: string(), y: number() }, number())");
  });

  it("被合并掉的 overload **计入 skipped**（汇总行说真话）", () => {
    const file = writeDts(
      "kt14.d.ts",
      `export declare function over(x: string): string;
export declare function over(x: string, y: number): number;
`,
    );
    const draft = dtsToContractDraft([file], "kt14");
    expect(draft.stats.exports).toBe(1);
    // 2 条声明 → 1 条条目 ⇒ 丢失 1 条 ⇒ skipped = 1（改前报 0）
    expect(draft.stats.skipped).toBe(1);
  });

  it("N 条 overload ⇒ N−1 条丢失被逐条计数", () => {
    const file = writeDts(
      "kt14.d.ts",
      `export declare function over(x: string): string;
export declare function over(x: string, y: number): number;
export declare function over(x: string, y: number, z: boolean): boolean;
`,
    );
    const draft = dtsToContractDraft([file], "kt14");
    expect(draft.stats.exports).toBe(1);
    expect(draft.stats.skipped).toBe(2);
    expect(draft.draftSource).toContain("3 overloads merged");
    expect(draft.draftSource).toContain("union(string(), number(), boolean())");
  });

  it("单条声明（无重载）不算丢失", () => {
    const file = writeDts(
      "single.d.ts",
      `export declare function only(x: string): string;
`,
    );
    const draft = dtsToContractDraft([file], "single");
    expect(draft.stats.exports).toBe(1);
    expect(draft.stats.skipped).toBe(0);
    expect(draft.draftSource).toContain("export const only = fn({ x: string() }, string());");
    expect(draft.draftSource).not.toContain("overloads merged");
  });
});
});

// ---------------------------------------------------------------------------
// 收割的 declare class 类值带 ctor facet（new 不再 may-throw）
// ---------------------------------------------------------------------------
describe("收割的 declare class 类值带 ctor facet（new 不再 may-throw）", () => {
/**
 * 回归（harvester 收割面）：收割的 **`declare class` 类值没有 `ctor` facet**
 * ⇒ `new X()` 被判「**可能抛 TypeError**（可构造性未知）」⇒ **L2 假红**
 * （`tsc --strict` 对同一份代码 exit 0）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h5/e2e/cls/app.ts，tsc exit=0）：
 * - `export declare class Gadget { label: string; compute(input: number): number }`
 * ⇒ `new Gadget()` 是**构造调用**（合法），`g.label` 是 string。
 *
 * 收割侧契约：
 * 1. 类值（构造函数）带 **`ctor: true` facet** —— core 的 `new` 路径按 callee 的
 * `ctor` facet 判可构造性（`Shape k:"fn".ctor`）：缺省 = 「可构造性未知」
 * ⇒ 记 may TypeError；
 * 2. mock 化（`harvestedValueToAbs`）时**透传**该 facet（否则又变回未知）；
 * 3. `new X()` 走构造分支 ⇒ 产出**实例面**（不是 may-throw）。
 *
 * 产品面（闸②）：改前 `buildGadget() => number | string throws TypeError`
 * （`new on function value of unknown constructibility`）；改后 0 error。
 */









const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug826-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const CLS = `export declare class Gadget {
  label: string;
  compute(input: number): number;
}
`;

/** fn 形状的 ctor facet */
function ctorFacet(a: Abs | undefined): boolean | undefined {
  return (a?.shape as { ctor?: boolean } | undefined)?.ctor;
}

/** `new X()` 的效果面（may-throw 收集） */
function newEffects(callee: Abs): { kinds: string[]; value: string } {
  const effects: MayThrowEffect[] = [];
  let value = "";
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    const built = $new(callee, []);
    value = formatShape(built);
    setMayThrowCollector(null);
  });
  return { kinds: effects.map((e) => e.kind), value };
}

describe("收割的 declare class 类值带 ctor facet（new 不再 may-throw）", () => {
  it("类值带 `ctor: true` facet（改前缺省 = 可构造性未知）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    expect(ctorFacet(env.globals["Gadget"])).toBe(true);
  });

  it("mock 化时透传 ctor facet（否则又变回「可构造性未知」）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    const mock = harvestedValueToAbs(env.globals["Gadget"]!);
    expect(ctorFacet(mock)).toBe(true);
  });

  it("`new Gadget()` 不记 may TypeError（改前记「可构造性未知」）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    const mock = harvestedValueToAbs(env.globals["Gadget"]!);
    const r = newEffects(mock);
    expect(r.kinds).not.toContain("TypeError");
  });

  it("`new Gadget()` 产出实例面（Point/Gadget 品牌，不是 unknown）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    const mock = harvestedValueToAbs(env.globals["Gadget"]!);
    const r = newEffects(mock);
    expect(r.value).toBe("Gadget");
  });

  it("反向：去掉 ctor facet ⇒ 同一个 new 记 may TypeError（证明判据就是这个 facet）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    const mock = harvestedValueToAbs(env.globals["Gadget"]!);
    const noCtor: Abs = {
      ...mock,
      shape: { ...mock.shape },
      // A2 残余：mock 现在还带 `facets.callable = false`。反向对照要回到
      // 「既无 ctor facet、也无可调用性承载位」的旧状态；否则 `$new` 回落
      // `$call` 时命中 `isClassValueCallee` 直接定抛 NudoThrow，而不是
      // 记 may-throw —— 对照条件就不再成立。
      facets: mock.facets ? { ...mock.facets } : undefined,
    };
    delete (noCtor.shape as { ctor?: boolean }).ctor;
    delete noCtor.facets?.callable;
    const r = newEffects(noCtor);
    expect(r.kinds).toContain("TypeError");
  });

  it("普通函数（不是类）不带 ctor facet（可构造性保持未知，不误报可构造）", () => {
    const p = writeTemp("fx.d.ts", `export declare function plain(x: number): string;\n`);
    const env = harvestDts([p]);
    expect(ctorFacet(env.globals["plain"])).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// 顶层函数的重载集不被塌成单个签名
// ---------------------------------------------------------------------------
describe("顶层函数的重载集不被塌成单个签名", () => {
/**
 * 回归（harvester 收割面）：顶层函数的**重载集塌成 union 返回**
 * （参数只取第一个 overload）⇒ union 面上调用 ⇒ **L5 假红**（`tsc --strict` exit 0）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/e2e/app-ovpkg.ts，tsc exit=0）：
 * - `export declare function convert(x: string): string;` + `export declare function convert(x: number): number;`
 * ⇒ `convert("a").toUpperCase()` 与 `convert(1).toFixed()` **都合法**（TS 按实参选 arm）。
 *
 * 收割侧契约（本次交付的部分）：
 * 1. 重载集**不塌成单个签名**：参数位保留**每个** overload 的参数类型（逐位 union），
 * 返回位是各 overload 返回类型的 union —— 不再只取 `sigs[0]` 的参数。
 * 2. 收割产物里 overload 的信息**不丢**（两个 arm 的参数与返回都进面）。
 *
 * ⚠️ 仍未闭环（core 侧，越界发现见交付报告）：
 * - 「按实参形态选 arm」需要 core 的 Abs fn 形状承载 overload 集合（现在没有），
 * 且 core 的 union 方法分派只认 `string` 成员（）——
 * 假红本身要 core 改完才消；harvester 侧无法单独消掉 L5 假红。
 */








const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug827-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

type PrimShape = { k: string; type?: string; members?: { shape: PrimShape }[] };

/** 展开 sum（union）里的原语标签 */
function primLabels(a: unknown): string[] {
  const shape = (a as { shape?: PrimShape }).shape;
  if (!shape) return [];
  if (shape.k === "prim" && shape.type) return [shape.type];
  if (shape.k === "sum") {
    const out: string[] = [];
    for (const m of shape.members ?? []) out.push(...primLabels(m));
    return out;
  }
  return [];
}

/** fn 的参数位原语标签（relation 的 paramTypes —— 泛型 fn 的参数面在 relation 上） */
function primTypes(a: unknown): string[] {
  const rel = getFnImpl(a as never)?.relation;
  const pts = rel?.paramTypes ?? [];
  const out: string[] = [];
  for (const p of pts) out.push(...primLabels(p));
  return out;
}

/** fn 返回位里的原语标签（union 展开） */
function returnPrims(a: unknown): string[] {
  const rel = getFnImpl(a as never)?.relation;
  return primLabels(rel?.returnType);
}

describe("顶层函数的重载集不被塌成单个签名", () => {
  it("参数位保留每个 overload 的参数类型（不再只取 sigs[0]）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function convert(x: string): string;
export declare function convert(x: number): number;
`,
    );
    const env = harvestDts([p]);
    const fn = env.globals["convert"]!;
    // 改前：参数位只有第一个 overload 的 `string`
    const params = primTypes(fn);
    expect(params).toContain("string");
    expect(params).toContain("number");
    // 返回位：各 overload 返回类型的 union
    const rets = returnPrims(fn);
    expect(rets).toContain("string");
    expect(rets).toContain("number");
    expect(formatShape(fn)).toBe("(string | number) => string | number");
  });

  it("单个声明的函数不受影响（参数位不被改写）", () => {
    const p = writeTemp("fx.d.ts", `export declare function only(x: string): number;\n`);
    const env = harvestDts([p]);
    expect(formatShape(env.globals["only"]!)).toBe("(string) => number");
  });

  it("参数个数不同的 overload 不改参数位（arity 不能被改）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function f(x: string): string;
export declare function f(x: string, y: number): number;
`,
    );
    const env = harvestDts([p]);
    // arity 仍是第一个 overload 的 1（改成 2 会让 `f("a")` 变成「参数不够」）
    expect(formatShape(env.globals["f"]!)).toBe("(string) => string | number");
  });

  it("带泛型 α 的 overload 不改参数位（α 是逐参数绑定的）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function g<T>(x: T): T;
export declare function g(x: string): number;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["g"]!)).toContain("T");
  });

  it("A6：overloads 随磁盘签名投影往返（缓存命中不丢派发面）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function convert(x: string): string;
export declare function convert(x: number): number;
`,
    );
    const env = harvestDts([p]);
    const fn = env.globals["convert"]!;
    const sig = absToHarvestSig(fn);
    const back = harvestSigToAbs(sig);
    const shape = (back as { shape?: { overloads?: unknown[] } }).shape;
    expect(shape?.overloads).toHaveLength(2);
    // 回放后派发仍精确：number 实参 ⇒ number arm
    expect(formatShape(instantiateReturn(back, [numLit(1)]))).toBe("number");
    expect(formatShape(instantiateReturn(back, [numLit(0)]))).toBe("number");
  });

  it("A6：重载集进入 fn shape 的 overloads 承载位（声明序逐 arm）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function convert(x: string): string;
export declare function convert(x: number): number;
`,
    );
    const env = harvestDts([p]);
    const shape = (env.globals["convert"] as { shape?: { overloads?: unknown[] } })
      .shape;
    const arms = shape?.overloads;
    expect(Array.isArray(arms)).toBe(true);
    expect(arms).toHaveLength(2);
    const armPrims = (arms as { paramTypes: unknown[]; returnType: unknown }[]).map(
      (a) => ({ p: primLabels(a.paramTypes[0]), r: primLabels(a.returnType) }),
    );
    expect(armPrims).toEqual([
      { p: ["string"], r: ["string"] },
      { p: ["number"], r: ["number"] },
    ]);
    // union 面（权威外延面）不变
    expect(formatShape(env.globals["convert"]!)).toBe(
      "(string | number) => string | number",
    );
  });
});
});

// ---------------------------------------------------------------------------
// 构造签名投影成**可构造**面（ctor facet）
// ---------------------------------------------------------------------------
describe("构造签名投影成**可构造**面（ctor facet）", () => {
/**
 * 回归（harvester 收割面）：类型字面量的**构造签名**
 * （`{ new (x: number): T }`）被投影成**普通可调用 fn** ⇒ `new C(1)`
 * **假红**（may-throw）+ `C(1)` **假绿**（TS 明确 TS2348 不可调用）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u829.ts，tsc exit=0）：
 * `new WidgetCtor(1)` 合法 ⇒ `w.v` 是 number；
 * `WidgetCtor(1)` **不合法**（TS2348: 不带 `new` 的调用）⇒ 夹具里用
 * `@ts-expect-error` 钉住（tsc 消费掉了它 ⇒ TS 确实报错）。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 * C: (number) => { tag: string } ctor facet: undefined
 * ⇒ `new C(1)` 落 core 的「fn 形 callee 可构造性未知」臂 ⇒ **记 may-throw**
 * ⇒ L2 门禁假红。
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 * C: (number) => { tag: string } ctor facet: true
 * ⇒ core 的 `fs.ctor === true` 臂 ⇒ 走声明的实例面 ⇒ **不记 may-throw**。
 *
 * 根因：`mapType` 的类型字面量分支对构造签名只产出 `absFnSig` —— 一个
 * **没有构造面**的普通可调用 fn（注释明写「是构造函数形状」，实现没给）。
 *
 * ⚠️ 剩余半边（**需要 core**）：TS 的「不可裸调用」要 core 的 fn 形状带
 * `callable: false` facet（core 目前只有 `ctor`，没有 `callable`）。
 * core 是冻结面 ⇒ 本片只落 `ctor: true` + 构造形参，剩余部分见交付报告。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug829-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

type FnShape = {
  k: string;
  ctor?: boolean;
  paramTypes?: unknown[];
  returnType?: unknown;
  slots?: Record<string, { value: unknown }>;
};

describe("构造签名投影成**可构造**面（ctor facet）", () => {
  it("构造签名产出 fn 形状且带 ctor: true facet", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Widget { v: number }
export declare const WidgetCtor: { new (x: number): Widget };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["WidgetCtor"]!.shape as FnShape;
    expect(shape.k).toBe("fn");
    expect(shape.ctor).toBe(true);
    // 反向钉：不能是「可构造性未知」（undefined ⇒ core 记 may-throw ⇒ 假红）
    expect(shape.ctor).not.toBeUndefined();
  });

  it("构造形参与实例面保留（new C(1) 的实例类型是声明的返回类型）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Widget { v: number }
export declare const WidgetCtor: { new (x: number): Widget };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["WidgetCtor"]!.shape as FnShape;
    expect((shape.paramTypes ?? []).map((t) => formatShape(t as never))).toEqual(["number"]);
    expect(formatShape(shape.returnType as never)).toBe("Widget");
  });

  it("构造形参是可选时带上 undefined（与普通形参同口径）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const C: { new (x?: number): { tag: string } };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["C"]!.shape as FnShape;
    expect(shape.ctor).toBe(true);
    expect(formatShape((shape.paramTypes ?? [])[0] as never)).toContain("number");
  });

  it("与构造签名共存的具名成员不丢（静态槽）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const C: { new (x: number): { tag: string }; version: number };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["C"]!.shape as FnShape;
    expect(Object.keys(shape.slots ?? {})).toEqual(["version"]);
  });

  it("无构造签名的普通字面量不带 ctor facet", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const plain: { a: number };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["plain"]!.shape as FnShape;
    expect(shape.k).toBe("obj");
    expect(shape.ctor).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// 调用签名投影成 fn（不再折成空对象）
// ---------------------------------------------------------------------------
describe("调用签名投影成 fn（不再折成空对象）", () => {
/**
 * 回归（harvester 收割面）：类型字面量的**调用签名**
 * （`{ (a: number): string }`）**整条跳过** ⇒ 该值被折成**空对象** ⇒
 * 调用即 `TypeError` ⇒ **L2 假红**（`tsc --strict` exit 0 的合法代码被判
 * 「确定抛」）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u830.ts，tsc exit=0）：
 * `handler: { (a: number): string }` ⇒ `handler(1)` 是 **string**（完全合法）。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 * f: { } k: obj ← 零槽位的空对象 ⇒ 引擎按「不是函数」判 ⇒ 调用即 TypeError
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 * f: (number) => string k: fn
 *
 * 根因：`mapType` 的类型字面量分支先找构造签名、找不到就走
 * `absObj(mapTypeMembers(...))`；而 `mapTypeMembers` 把**调用签名成员跳过**
 * ⇒ 结果是**零槽位的空对象**。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug829-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

type FnShape = {
  k: string;
  ctor?: boolean;
  paramTypes?: unknown[];
  returnType?: unknown;
  slots?: Record<string, { value: unknown }>;
};

describe("调用签名投影成 fn（不再折成空对象）", () => {
  it("调用签名产出 fn 形状（不是空 obj）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const handler: { (a: number): string };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["handler"]!.shape as FnShape;
    expect(shape.k).toBe("fn");
    // 反向钉：不能是零槽位的空对象
    expect(shape.k).not.toBe("obj");
  });

  it("形参与返回面保留（形参位是 number、返回位是 string）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const handler: { (a: number): string };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["handler"]!.shape as FnShape;
    expect((shape.paramTypes ?? []).map((t) => formatShape(t as never))).toEqual(["number"]);
    expect(formatShape(shape.returnType as never)).toBe("string");
    expect(formatShape(env.globals["handler"]!)).toBe("(number) => string");
  });

  it("多形参 / 可选形参按普通签名同口径", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const handler: { (a: number, b?: string): boolean };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["handler"]!.shape as FnShape;
    expect((shape.paramTypes ?? []).map((t) => formatShape(t as never))).toEqual([
      "number",
      "string | undefined",
    ]);
    expect(formatShape(shape.returnType as never)).toBe("boolean");
  });

  it("与调用签名共存的具名成员不丢（静态槽）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const handler: { (a: number): string; version: number };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["handler"]!.shape as FnShape;
    expect(Object.keys(shape.slots ?? {})).toEqual(["version"]);
  });

  it("无调用签名的普通字面量仍是 obj（不误投影成 fn）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const plain: { a: number };
`,
    );
    const env = harvestDts([p]);
    expect(env.globals["plain"]!.shape.k).toBe("obj");
  });
});
});

// ---------------------------------------------------------------------------
// 计算成员名（[Symbol.iterator]）不得整条丢弃
// ---------------------------------------------------------------------------
describe("计算成员名（[Symbol.iterator]）不得整条丢弃", () => {
/**
 * 回归（harvester 收割面）：接口的**计算成员名**（`[Symbol.iterator]()`）
 * **整条丢弃** ⇒ 接口的**迭代协议整体丢失** ⇒ `for…of` 被判「对不可迭代值迭代」
 * ⇒ L2 假红（而 `tsc --strict` 对同一份代码 exit 0）。
 *
 * 根因：成员收集只处理**具名**成员（`memberName` 对计算属性名返回 undefined ⇒
 * `continue`），且没有任何诊断说「这条成员被丢了」。计算成员名是 **ES 规范的一等公民**
 * ——`[Symbol.iterator]` 是迭代协议的标准入口，丢弃它等于丢掉整个迭代协议。
 *
 * 改前（tmp/probe/fix-r27/h3/probe-h3b.ts，BEFORE 行）：brand Range 槽位 = { size }
 * 改后：brand Range 槽位 = { size, "@@iterator" }（引擎把 symbol 键投影成 `@@name`）
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o832.ts）：exit=0
 * ⇒ `for (const v of range)` 在 TS 侧完全合法。
 *
 * 产品面（`nudo check`，tmp/probe/fix-r27/h3/e2e/iter/）：
 * 改前 `drain() => number | string throws TypeError`（L2 假红）
 * 改后 `drain() => number | string`（无 throws）
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug832-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand → inner obj → 槽位（值） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

const ITER = `export interface Range { [Symbol.iterator](): Iterator<number>; size: number; }
export declare const range: Range;
`;

describe("计算成员名（[Symbol.iterator]）不得整条丢弃", () => {
  it("迭代协议成员进入实例模型（@@iterator 槽存在且可调用）", () => {
    const p = writeTemp("iter.d.ts", ITER);
    const env = harvestDts([p]);
    const s = slots(env.globals.range!);
    expect(Object.keys(s)).toContain("@@iterator");
    expect(s["@@iterator"]!.shape.k).toBe("fn");
  });

  it("具名成员不受影响（对照组：只有计算成员名被丢）", () => {
    const p = writeTemp("iter.d.ts", ITER);
    const env = harvestDts([p]);
    expect(Object.keys(slots(env.globals.range!))).toContain("size");
  });

  it("异步迭代协议同样保留（@@asyncIterator）", () => {
    const p = writeTemp(
      "asynciter.d.ts",
      `export interface ARange { [Symbol.asyncIterator](): AsyncIterator<number>; size: number; }
export declare const arange: ARange;
`,
    );
    const env = harvestDts([p]);
    expect(Object.keys(slots(env.globals.arange!))).toContain("@@asyncIterator");
  });

  it("不可静态判定的计算成员名被跳过（不产出错误成员名，也不崩）", () => {
    const p = writeTemp(
      "dyn.d.ts",
      `export interface Dyn { [key]: number; size: number; }
export declare const dyn: Dyn;
`,
    );
    const env = harvestDts([p]);
    const names = Object.keys(slots(env.globals.dyn!));
    expect(names).toContain("size");
    expect(names).not.toContain("key");
  });

  it("计算成员名不影响具名成员的类型（不被覆盖成 unknown）", () => {
    const p = writeTemp("iter.d.ts", ITER);
    const env = harvestDts([p]);
    const s = slots(env.globals.range!);
    expect(s.size!.shape.k).toBe("prim");
    expect(s.size!.shape.k === "prim" ? s.size!.shape.type : "").toBe("number");
  });
});
});

// ---------------------------------------------------------------------------
// --from-dts 的属性键转义
// ---------------------------------------------------------------------------
describe("--from-dts 的属性键转义", () => {
/**
 * `nudo contract --from-dts` 对**带引号 / 连字符的属性键**产出
 * **语法非法**的草稿 ⇒ 按草稿指引抄进 `*.nudo.js` 后 sidecar **加载失败**
 * ⇒ `nudo check` 门禁由绿转红（exit 1）。
 *
 * 改前（真实产品面取证）：
 * ```
 * export const withHeaders = fn({ x: shape({ content-type: string(), … }) }, any());
 * ```
 * ⇒ `node --check` SyntaxError；抄进侧车 ⇒ `nudo:contract-load` ⇒ exit 1。
 *
 * 修法（草稿面）：属性键走**合法转义**（`formatObjectKey`：JS 标识符 /
 * 字符串字面量两种合法形态）；`__proto__` 走**计算属性名**（对象字面量里的
 * `__proto__: v` 即便带引号也会触发 `[[SetPrototypeOf]]` ⇒ 成员消失）。
 *
 * 回归钉**真把草稿抄进侧车再跑 `nudo check`**（语法非法 ⇒ 加载失败）。
 */








const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const KEYS_DTS = `export declare function withHeaders(x: { "content-type": string; "x-foo": number; plain: boolean }): void;
export declare function plainFn(a: number, b: string): boolean;
`;

function writeDts(name: string, src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug834-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, src, "utf-8");
  return file;
}

/** `node --check`：草稿必须是**合法 JavaScript** */
function nodeCheck(file: string): { ok: boolean; stderr: string } {
  try {
    execFileSync(process.execPath, ["--check", file], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

describe("-from-dts 的属性键转义", () => {
  it("带引号 / 连字符的键产出**合法**的 DSL（引号串形态）", () => {
    const file = writeDts("keys.d.ts", KEYS_DTS);
    const draft = dtsToContractDraft([file], "keys");
    expect(draft.draftSource).toContain('"content-type": string()');
    expect(draft.draftSource).toContain('"x-foo": number()');
    // 改前：裸键（`content-type: string()` ⇒ `content - type` 被解析成减法）
    expect(draft.draftSource).not.toContain("content-type: string()");
    expect(draft.draftSource).not.toContain("x-foo: number()");
    // 标识符键仍是裸写（合法形态）
    expect(draft.draftSource).toContain("plain: boolean()");
  });

  it("草稿产物真能过 `node --check`（改前：Unexpected token）", () => {
    const file = writeDts("keys.d.ts", KEYS_DTS);
    const draft = dtsToContractDraft([file], "keys");
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug834-check-"));
    dirs.push(dir);
    const out = join(dir, "keys.nudo.draft.js");
    writeFileSync(out, draft.draftSource, "utf-8");
    const check = nodeCheck(out);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("`__proto__` 键走计算属性名（对象字面量的 __proto__ 会改原型）", () => {
    const file = writeDts(
      "proto.d.ts",
      `export declare function withProto(x: { "__proto__": string; ok: number }): void;
`,
    );
    const draft = dtsToContractDraft([file], "proto");
    expect(draft.draftSource).toContain('["__proto__"]: string()');
    // 裸 `__proto__:` 会触发 [[SetPrototypeOf]] ⇒ 成员从字面量里消失
    expect(draft.draftSource).not.toContain('"__proto__": string()');
  });

  it("**抄进侧车后 `nudo check` 仍然绿**（改前：sidecar 加载失败 ⇒ exit 1）", () => {
    const file = writeDts("keys.d.ts", KEYS_DTS);
    const draft = dtsToContractDraft([file], "keys");
    const dir = makeWorkDir____harvest_bug_h8b_helpers_ts("834");
    dirs.push(dir);
    const { target } = writeSidecar____harvest_bug_h8b_helpers_ts(
      dir,
      draft.draftSource,
      `export function withHeaders(x) {\n  return x;\n}\n`,
    );
    const res = runNudoCheck____harvest_bug_h8b_helpers_ts(target);
    expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
    expect(res.stdout).not.toContain("nudo:contract-load");
    // 契约真的落到侧车上了（签名里带引号的键）
    expect(res.stdout).toContain('"content-type"');
  }, 120_000);

  it("反向闸：语法非法的侧车**必定**加载失败（证明上一条不是永真断言）", () => {
    const dir = makeWorkDir____harvest_bug_h8b_helpers_ts("834-broken");
    dirs.push(dir);
    const { target } = writeSidecar____harvest_bug_h8b_helpers_ts(
      dir,
      `import { fn, number, string, shape } from "@nudojs/core";\n\nexport const withHeaders = fn({ x: shape({ content-type: string() }) }, number());\n`,
      `export function withHeaders(x) {\n  return x;\n}\n`,
    );
    const res = runNudoCheck____harvest_bug_h8b_helpers_ts(target);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("nudo:contract-load");
  }, 120_000);

  it("导出名撞 builder import ⇒ 走别名形态（草稿仍是合法 JS）", () => {
    // 与 同一族（草稿的 import ↔ export 撞名 ⇒ SyntaxError）：
    // 这里用**当前**的 builder（`number`）钉住「撞名走别名」这条不变量。
    const src = formatDtsContractDraft("types", ["types.d.ts"], [
      { name: "number", dsl: "number()", kind: "value" },
    ]);
    expect(src).not.toMatch(/^export const number = /m);
    expect(src).toContain("export { _nudo_1 as number };");
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug834-clash-"));
    dirs.push(dir);
    const out = join(dir, "types.nudo.draft.js");
    writeFileSync(out, src, "utf-8");
    const check = nodeCheck(out);
    expect(check.ok, check.stderr).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// 草稿面：Promise 外壳**不剥**（与收割面同口径，不假红）
// ---------------------------------------------------------------------------
describe("草稿面：Promise 外壳**不剥**（与收割面同口径，不假红）", () => {
/**
 * 回归（harvester **草稿面**）：`Promise<T>` 特判**剥掉**了 Promise
 * 外壳 ⇒ 契约要求的是 **resolve 之后**的值 ⇒ 契约**先天不可满足**
 * ⇒ **假红**（tsc 绿，`nudo check` 红）；且与**收割面相反**（收割面保留
 * `eff/promise` 外壳）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h8a/e2e/b916.ts ⇒ 无错）：
 * `function fetchUser(id: number): Promise<{id: number; name: string}> {
 * return Promise.resolve({ id, name: "n" });
 * }`
 *
 * 改前（git HEAD 的草稿面）：`Promise<T>` → `fn({…}, shape({ id: number(), name: string() }))`
 * ⇒ 返回义务落在 resolve 后的值上 ⇒ 实现返回 Promise ⇒ 必然违约。
 * 改后（tmp/probe/fix-r27/h8a/probe.ts）：
 * `export const fetchUser = fn({ id: number() }, any());`
 * ＋ note 明说「Promise 外壳保留（与收割面同口径），该位无约束」。
 *
 * **两个产物面同口径**：收割面保留外壳（`(number) => promise<{…}>`），
 * 草稿面也**不剥**（该位无约束 + 标注丢失）⇒ 两侧都不对 resolve 后的值
 * 设义务 ⇒ 同一答案（不假红）。
 */









const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeDts(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug916-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const DTS = `export declare function fetchUser(id: number): Promise<{ id: number; name: string }>;
`;

describe("草稿面：Promise 外壳**不剥**（与收割面同口径，不假红）", () => {
  it("草稿的返回位**不是** resolve 后的类型（外壳不被剥掉）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("export const fetchUser");
    // 剥壳的旧形态：返回位 = resolve 后的对象
    expect(draft.draftSource).not.toMatch(/fn\(\{ id: number\(\) \}, shape\(/);
    expect(draft.draftSource).not.toContain("name: string()");
  });

  it("该位的丢失**如实标注**（note + skipped 计数），不静默放宽", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("Promise shell is kept");
    expect(draft.stats.skipped).toBeGreaterThanOrEqual(1);
  });

  it("产品面：草稿抄进侧车后 `nudo check` **绿**（与 tsc 同向，不再假红）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    const dir = makeWorkDir("b916");
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function fetchUser(id) { return Promise.resolve({ id, name: "n" }); }\n`,
    );
    const res = runNudoCheck(target);
    removeWorkDir(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain("constraint-violated");
  });

  it("收割面同口径：Promise 外壳**保留**（promise<…>）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const env = harvestDts([p]);
    expect(formatShape(env.globals.fetchUser!)).toBe(
      "(number) => promise<{ id: number, name: string }>",
    );
  });
});
});

// ---------------------------------------------------------------------------
// 草稿面：方法签名成员**不被丢**（不悄悄放宽）
// ---------------------------------------------------------------------------
describe("草稿面：方法签名成员**不被丢**（不悄悄放宽）", () => {
/**
 * 回归（harvester **草稿面**）：类型字面量里的**方法签名**成员被丢
 * ⇒ 契约被**悄悄放宽** ⇒ **假绿**（tsc 报 TS2345，`nudo check` 却绿）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h8a/e2e/b945.ts ⇒ TS2345）：
 * `takeCfg({ host: "h" })` —— 缺 `port` ⇒ TS2345（红）。
 *
 * 改前（git HEAD 的草稿面）：`{ host: string; port(): number }` ⇒
 * `shape({ host: string() })` —— `port` **整个消失** ⇒ 调用点少传一个成员
 * 也不违约 ⇒ 假绿。
 * 改后（tmp/probe/fix-r27/h8a/probe.ts）：
 * `fn({ c: shape({ host: string(), port: fn({}, number()) }) }, string())`
 *
 * 同族：**数字键成员**（`{ 0: string; 1: number }`）也不能被丢。
 *
 * **两个产物面同口径**：收割面把方法成员建成 `port: () => number`
 * （`({ host: string, port: () => number }) => string`），草稿面建成
 * `port: fn({}, number())` ⇒ 两侧都**要求** `port` 成员 ⇒ 同一答案。
 */









const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeDts(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug945-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const DTS = `export declare function takeCfg(c: { host: string; port(): number }): string;
`;

describe("草稿面：方法签名成员**不被丢**（不悄悄放宽）", () => {
  it("方法成员进契约：`port: fn({}, number())`", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("port: fn({}, number())");
    // 改前的形态：方法成员整个消失
    expect(draft.draftSource).not.toContain("shape({ host: string() })");
  });

  it("数字键成员也不被丢", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function takeNum(c: { 0: string; 1: number }): string;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("0: string()");
    expect(draft.draftSource).toContain("1: number()");
  });

  it("产品面：草稿抄进侧车后 `nudo check` **红**（与 tsc 的 TS2345 同向）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    const dir = makeWorkDir("b945");
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function takeCfg(c) { return c.host; }
export function use() { return takeCfg({ host: "h" }); }
`,
    );
    const res = runNudoCheck(target);
    removeWorkDir(dir);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("port");
  });

  it("收割面同口径：方法成员在收割面也在（port: () => number）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const env = harvestDts([p]);
    expect(formatShape(env.globals.takeCfg!)).toBe(
      "({ host: string, port: () => number }) => string",
    );
  });
});
});

// ---------------------------------------------------------------------------
// 可选方法成员与可选属性同口径
// ---------------------------------------------------------------------------
describe("可选方法成员与可选属性同口径", () => {
/**
 * 回归（harvester 收割面）：可选**方法**成员的 `?` 丢失（同函数里的可选
 * **属性**却保住了）⇒ 成员被断言成「**必定存在**」⇒ `nudo check` 放行，
 * `tsc --strict` 报 **TS2722**（**假绿**）。
 *
 * 根因：`.d.ts` 的可选性标记挂在**成员节点**上（`member.questionToken`），属性与
 * 方法都是如此；harvester 的**属性**分支读了它、**方法**分支没读 ⇒ `m?(): void`
 * 的可省性被静默丢掉 ⇒ 收割出的形状把「可能不存在的方法」断言成「必定存在」。
 *
 * 改前（tmp/probe/fix-r27/h3/probe-h3b.ts，BEFORE 行）：
 * brand Holder 槽位 m = () => undefined ← 没有任何 optional 标记
 * 改后：
 * brand Holder 槽位 m = (() => undefined) | undefined
 * （与同接口的可选属性 p = number | undefined 同口径）
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o977.ts）：
 * `i.m()` ⇒ TS2722 "Cannot invoke an object which is possibly 'undefined'"
 * ⇒ TS 侧 m 确实「可能不存在」⇒ 收割面不得断言它必定存在。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug977-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand → inner obj → 槽位（值） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

/** 类型里是否含 undefined（可省性的建模口径） */
function hasUndefined(a: Abs | undefined): boolean {
  if (!a) return false;
  if (a.term?.op === "lit" && a.term.value === undefined) return true;
  const s = a.shape;
  if (s.k === "sum") return s.members.some(hasUndefined);
  return false;
}

// 成员提升只对**模块作用域**成立（顶层值位置声明不得泄漏成全局）
const HOLDER = `declare module "holder" {
  export interface Holder { m?(): void; p?: number; q(): string; }
  export declare const h: Holder;
}
`;

describe("可选方法成员与可选属性同口径", () => {
  it("可选方法的槽位含 undefined（可能不存在，不是必定存在）", () => {
    const p = writeTemp("holder.d.ts", HOLDER);
    const env = harvestDts([p]);
    const s = slots(env.modules.holder!.h!);
    expect(s.m).toBeDefined();
    expect(hasUndefined(s.m!)).toBe(true);
  });

  it("可选方法与可选属性的可省性口径一致（两者都含 undefined）", () => {
    const p = writeTemp("holder.d.ts", HOLDER);
    const env = harvestDts([p]);
    const s = slots(env.modules.holder!.h!);
    expect(hasUndefined(s.m!)).toBe(hasUndefined(s.p!));
    expect(formatShape(s.p!)).toBe("number | undefined");
  });

  it("必选方法不被加上 undefined", () => {
    const p = writeTemp("holder.d.ts", HOLDER);
    const env = harvestDts([p]);
    const s = slots(env.modules.holder!.h!);
    expect(hasUndefined(s.q!)).toBe(false);
    expect(s.q!.shape.k).toBe("fn");
  });

  it("提升面同口径（可选方法提升出的模块成员也含 undefined）", () => {
    const p = writeTemp("holder.d.ts", HOLDER);
    const env = harvestDts([p]);
    const promoted = env.modules.holder!.m!;
    expect(promoted).toBeDefined();
    expect(hasUndefined(promoted)).toBe(true);
  });

  it("对照：内联类型字面量的可选方法同口径（第二条成员收集路径）", () => {
    const p = writeTemp(
      "inline.d.ts",
      `export declare const inline: { m?(): void; p?: number };
`,
    );
    const env = harvestDts([p]);
    const s = slots(env.globals.inline!);
    expect(hasUndefined(s.m!)).toBe(true);
    expect(hasUndefined(s.p!)).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// 可选 / rest 形参的可省略性
// ---------------------------------------------------------------------------
describe("可选 / rest 形参的可省略性", () => {
/**
 * 回归：可选 / rest 形参的「可省略」语义丢失 ⇒ 收割出的 fn 最少实参数
 * 偏大（`g(a: string, b?: number)` 被数成 2 个必填，而 TS `minArgumentCount` = 1）
 * ⇒ 收割结果**不满足它自己声明的类型**。
 *
 * 契约：`optionalParams` 逐位标记可选性，必选元数与 TS 的 `minArgumentCount` 一致。
 */








const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug126-"));
  dirs.push(dir);
  const p = join(dir, "d.d.ts");
  writeFileSync(p, content, "utf-8");
  return p;
}

type FnShape = {
  k: string;
  params: string[];
  paramTypes?: Abs[];
  optionalParams?: boolean[];
};

function fnShape(a: Abs | undefined): FnShape {
  return a!.shape as FnShape;
}

/** core `fnMinArity` 的口径：最后一个必选位 + 1 */
function minArity(s: FnShape): number {
  let last = -1;
  for (let i = 0; i < s.params.length; i++) {
    if (s.params[i]!.startsWith("...")) continue;
    if (s.optionalParams ? s.optionalParams[i] === true : s.params[i]!.endsWith("?")) continue;
    last = i;
  }
  return last + 1;
}

const env = harvestDts([
  writeTemp(
    `export declare function g(a: string, b?: number): boolean;
export declare function rest(...xs: number[]): void;
export declare function req(a: string, b: number): void;
`,
  ),
]);

describe("可选 / rest 形参的可省略性", () => {
  it("可选形参记进 optionalParams，必选元数 = TS minArgumentCount（1）", () => {
    const s = fnShape(env.globals.g);
    expect(s.params).toHaveLength(2);
    expect(s.optionalParams).toEqual([false, true]);
    expect(minArity(s)).toBe(1);
    // 类型面仍是 `number | undefined`（可省略 ≠ 去掉 undefined）
    expect(s.paramTypes![1]!.shape.k).toBe("sum");
  });

  it("rest 形参不是必选位（元数 0）", () => {
    const s = fnShape(env.globals.rest);
    expect(s.optionalParams).toEqual([true]);
    expect(minArity(s)).toBe(0);
  });

  it("对照：全必选签名不受影响（元数 2）", () => {
    const s = fnShape(env.globals.req);
    expect(s.optionalParams).toBeUndefined();
    expect(minArity(s)).toBe(2);
  });

  it("磁盘投影往返保留 optionalParams（冷 / 热同元数）", () => {
    const back = harvestSigToAbs(absToHarvestSig(env.globals.g!));
    expect(fnShape(back).optionalParams).toEqual([false, true]);
    expect(minArity(fnShape(back))).toBe(1);
  });
});
});

// ---------------------------------------------------------------------------
// 同名 namespace 的成员取并集
// ---------------------------------------------------------------------------
describe("同名 namespace 的成员取并集", () => {
/**
 * 回归：同名 `namespace` 的第二份声明（TS declaration merging）成员
 * 被整块丢弃（只留一个 `skipped++`）⇒ 调用它们被判「未定义」⇒ L2 假红。
 *
 * 契约：同名 namespace 的成员取**并集**，且与声明顺序无关。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug141-"));
  dirs.push(dir);
  const p = join(dir, "ns.d.ts");
  writeFileSync(p, content, "utf-8");
  return p;
}

function slotsOf(a: Abs | undefined): Record<string, Slot> {
  const s = a!.shape;
  if (s.k === "obj") return s.slots;
  if (s.k === "fn") return s.slots ?? {};
  return {};
}

const FIRST = `declare namespace Foo {
  function bar(x: number): string;
  const baz: number;
  namespace Inner {
    function qux(): boolean;
  }
}
declare namespace Foo {
  function extra(): void;
}
`;

const SECOND = `declare namespace Foo {
  function extra(): void;
}
declare namespace Foo {
  function bar(x: number): string;
  const baz: number;
  namespace Inner {
    function qux(): boolean;
  }
}
`;

describe("同名 namespace 的成员取并集", () => {
  it("第二份声明的成员不丢（extra 在）", () => {
    const env = harvestDts([writeTemp(FIRST)]);
    const names = Object.keys(slotsOf(env.globals.Foo));
    expect(names).toEqual(expect.arrayContaining(["bar", "baz", "Inner", "extra"]));
    expect(env.stats.skipped).toBe(0);
  });

  it("声明顺序不影响成员集合", () => {
    const a = Object.keys(slotsOf(harvestDts([writeTemp(FIRST)]).globals.Foo)).sort();
    const b = Object.keys(slotsOf(harvestDts([writeTemp(SECOND)]).globals.Foo)).sort();
    expect(a).toEqual(b);
  });
});
});

// ---------------------------------------------------------------------------
// overload 合并不得留下悬空 α
// ---------------------------------------------------------------------------
describe("overload 合并不得留下悬空 α", () => {
/**
 * 回归：合并 α（类型形参）overload 时按「带 α 的那一池」**整池替换**
 * 返回类型 ⇒ 其它 overload 的返回类型被抹掉 + 悬空 α ⇒ CLI **静默 `any`、零诊断**，
 * 且结论随声明顺序翻转。
 *
 * 契约：返回位取并集；α 只有在**参数表能绑定**时才保留（不得悬空）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug142-"));
  dirs.push(dir);
  const p = join(dir, "ovl.d.ts");
  writeFileSync(p, content, "utf-8");
  return p;
}

function termVarIds(a: Abs, depth = 0, out = new Set<string>()): Set<string> {
  if (depth > 6) return out;
  if (a.term?.op === "var") out.add(a.term.id);
  const s = a.shape;
  if (s.k === "fn") {
    for (const p of s.paramTypes ?? []) termVarIds(p, depth + 1, out);
    if (s.returnType) termVarIds(s.returnType, depth + 1, out);
  } else if (s.k === "sum") for (const m of s.members) termVarIds(m, depth + 1, out);
  return out;
}

const CONCRETE_FIRST = `declare function h(x: string): string;
declare function h<T>(x: T): T;
`;

const GENERIC_FIRST = `declare function h<T>(x: T): T;
declare function h(x: string): string;
`;

describe("overload 合并不得留下悬空 α", () => {
  it("具体 overload 在前：返回位保留具体类型（不是悬空 T / any）", () => {
    const h = harvestDts([writeTemp(CONCRETE_FIRST)]).globals.h!;
    expect(formatShape(h)).toBe("(string) => string");
    // 返回位的 α 必须能在参数表里绑定 ⇒ 这里返回位不应有 var
    const shape = h.shape;
    if (shape.k !== "fn") throw new Error(`expected fn shape, got ${shape.k}`);
    expect([...termVarIds(shape.returnType!)]).toEqual([]);
  });

  it("泛型 overload 在前：保留 α（可被实参绑定）", () => {
    const h = harvestDts([writeTemp(GENERIC_FIRST)]).globals.h!;
    expect(formatShape(h)).toBe("(T) => T");
  });

  it("两种声明顺序不被抹成静默 any（旧行为：(string) => T ⇒ any）", () => {
    const a = harvestDts([writeTemp(CONCRETE_FIRST)]).globals.h!;
    expect(formatShape(a)).not.toContain("any");
  });
});
});

// ---------------------------------------------------------------------------
// 收割面保留 enum 成员与字面值
// ---------------------------------------------------------------------------
describe("收割面保留 enum 成员与字面值", () => {
/**
 * 回归：收割面的 `case "enum"` 把 enum 整体抹成 `unknown`（成员 / 字面值
 * 全丢）却报 `skipped: 0`，而同一 harvester 的契约草稿面完整建模成
 * `shape({ Red: 1, Green: 2 })` ⇒ **两面矛盾**。
 *
 * 契约：收割面与草稿面同款建模（成员名 → 字面量；数字 enum 复现自增序号）。
 */








const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// module 形态（`export`）：契约草稿面只登记导出，两面可比
const DTS = `export declare enum Color { Red = 1, Green = 2 }
export declare enum Name { A = "a", B = "b" }
export declare const enum CE { X = 1, Y = 2 }
export declare enum Auto { First, Second }
`;

function writeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug144-"));
  dirs.push(dir);
  const p = join(dir, "enum.d.ts");
  writeFileSync(p, DTS, "utf-8");
  return p;
}

function slotLits(a: Abs | undefined): Record<string, unknown> {
  const s = a!.shape;
  if (s.k !== "obj") return {};
  const out: Record<string, unknown> = {};
  for (const [k, sl] of Object.entries(s.slots)) {
    out[k] = sl.value.term?.op === "lit" ? sl.value.term.value : undefined;
  }
  return out;
}

const file = writeTemp();
const env = harvestDts([file]);

describe("收割面保留 enum 成员与字面值", () => {
  it("数字 / 字符串 / const enum 都有成员面（不再是 unknown）", () => {
    for (const name of ["Color", "Name", "CE"]) {
      expect(env.globals[name]!.shape.k).toBe("obj");
    }
    expect(slotLits(env.globals.Color)).toEqual({ Red: 1, Green: 2 });
    expect(slotLits(env.globals.Name)).toEqual({ A: "a", B: "b" });
    expect(slotLits(env.globals.CE)).toEqual({ X: 1, Y: 2 });
  });

  it("无初始化器的成员按 TS 语义从 0 自增", () => {
    expect(slotLits(env.globals.Auto)).toEqual({ First: 0, Second: 1 });
  });

  it("与契约草稿面同口径（两面不再矛盾）", () => {
    const draft = dtsToContractDraft([file]);
    const draftColor = draft.exports.find((e) => e.name === "Color");
    expect(draftColor).toBeDefined();
    // 草稿面把成员写成 shape({ Red: 1, Green: 2 })；收割面现在给同一个成员集
    expect(draftColor!.dsl).toContain("Red: 1");
    expect(draftColor!.dsl).toContain("Green: 2");
  });
});
});

// ---------------------------------------------------------------------------
// 可选成员在共享 DAG 上不得指数爆炸
// ---------------------------------------------------------------------------
describe("可选成员在共享 DAG 上不得指数爆炸", () => {
/**
 * 回归：可选成员建模走 `absUnion` ⇒ core 的 `absShapeKey` 在**共享 DAG**
 * 上做去重键（键长 ∝ 路径数）⇒ 指数增长 ⇒ `RangeError: Invalid string length`
 * （或进程 OOM）。同一接口的必选形态毫秒级完成 ⇒ 触发点是「可选」这条路径。
 *
 * 契约：可选成员**有界**完成（不抛错、不指数爆炸），且仍是 `T | undefined`。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const N = 27;

function genDts(optional: boolean): string {
  const lines: string[] = ["export interface L0 { x: number; }"];
  for (let i = 1; i < N; i++) lines.push(`export interface L${i} { a: L${i - 1}; b: L${i - 1}; }`);
  lines.push(`export interface Holder { m${optional ? "?" : ""}: L${N - 1}; }`);
  lines.push("export declare function f(): Holder;");
  return lines.join("\n") + "\n";
}

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug213-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const optFile = writeTemp("opt.d.ts", genDts(true));
const reqFile = writeTemp("req.d.ts", genDts(false));

/** `f(): Holder` 的返回面 → Holder brand 的成员表 */
function memberOfHolder(a: Abs, key: string): Abs {
  const shape = a.shape;
  if (shape.k !== "fn") throw new Error("f is not a fn");
  const ret = shape.returnType!.shape;
  if (ret.k !== "brand") throw new Error(`Holder is not a brand: ${ret.k}`);
  // brand 的 `shape` 字段本身是一个 Abs（brand 指向接口的成员面对象）
  const innerShape = (ret as unknown as { shape: Abs }).shape.shape;
  if (innerShape.k !== "obj") throw new Error(`Holder brand has no slots: ${innerShape.k}`);
  const slot = (innerShape as { slots: Record<string, { value: Abs }> }).slots[key];
  if (!slot) throw new Error(`missing member ${key}`);
  return slot.value;
}

describe("可选成员在共享 DAG 上不得指数爆炸", () => {
  it("必选形态完成（基线）", () => {
    const t0 = Date.now();
    const env = harvestDts([reqFile]);
    expect(memberOfHolder(env.globals.f!, "m").shape.k).toBe("brand");
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it("可选形态同样完成，且成员是 `L26 | undefined`", () => {
    const t0 = Date.now();
    const env = harvestDts([optFile]);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(memberOfHolder(env.globals.f!, "m").shape.k).toBe("sum");
  });
});
});

// ---------------------------------------------------------------------------
// --from-dts 草稿的 import ↔ export 撞名
// ---------------------------------------------------------------------------
describe("--from-dts 草稿的 import ↔ export 撞名", () => {
/**
 * `nudo contract --from-dts` 写出的草稿模块里，**builder 的 import
 * 绑定**与生成的 `export const <name>` **撞名** ⇒ 写出的文件是**非法
 * JavaScript**（`node --check` 直接 SyntaxError）。
 *
 * 症状（旧口径）：
 * ```js
 * import { fn, any, number, union } from "@nudojs/core";
 * export const number = fn({ l: union(number(), number()) }, any());
 * ```
 * ⇒ `SyntaxError: Identifier 'number' has already been declared`。
 *
 * 修法：侧车键取**导出身份**，绑定名与 builder import 撞名时走别名形态
 * `const _nudo_N = …; export { _nudo_N as <identity> };`。
 *
 * 勘误（族 27 收口）：本夹具原用 `lit` 作导出名，但草稿面的 builder 名单
 * **不含** `lit`（公共 API 的 `lit` 是 Term 构造器，不是约束构建器）⇒
 * `lit` 不再产生 import ⇒ 原断言的「撞名」前提不成立。改用名单内的
 * `number` 作导出名，撞名前提与被钉的不变量（别名形态）均保持。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function nodeCheck(file: string): { ok: boolean; stderr: string } {
  try {
    execFileSync(process.execPath, ["--check", file], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

describe("-from-dts 草稿的 import ↔ export 撞名", () => {
  it("导出名撞 builder import ⇒ 走别名形态（改前：export const number）", () => {
    const src = formatDtsContractDraft("types", ["types.d.ts"], [
      { name: "number", dsl: `fn({ l: union(number(), number()) }, any())`, kind: "function" },
    ]);
    expect(src).not.toMatch(/^export const number = /m);
    expect(src).toContain("export { _nudo_1 as number };");
  });

  it("草稿产物真能过 node --check（改前：Identifier 'number' has already been declared）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-from-dts-545-"));
    dirs.push(dir);
    const src = formatDtsContractDraft("types", ["types.d.ts"], [
      { name: "number", dsl: `fn({ l: union(number(), number()) }, any())`, kind: "function" },
    ]);
    const file = join(dir, "types.nuco.draft.js");
    writeFileSync(file, src, "utf-8");
    const check = nodeCheck(file);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("负控制：普通导出名仍是 export const <name>（不误改别名形态）", () => {
    const src = formatDtsContractDraft("types", ["types.d.ts"], [
      { name: "lineTotal", dsl: "fn({ price: number() }, number())", kind: "function" },
    ]);
    expect(src).toContain("export const lineTotal = fn({ price: number() }, number());");
    expect(src).not.toContain("_nudo_1");
  });
});
});
