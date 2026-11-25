/**
 * TS 类型注解映射的**双路径一致性棘轮**：同一段注解，文本面（`mapTsType`，
 * `absTypeForTsTypeText`）与节点面（`mapTsTypeNode`，`absTypeForTsTypeNode`）
 * 的映射结果必须对得上。
 *
 * 两条路径长期是两份实现：节点面只在 AST 消费方走，文本面在 emit / 谓词 /
 * lsp 面走；任何一边单独演化都会让「同一注解在两处映射出不同域」且没人发现。
 * 本文件把差异**显式化、可计数**：
 *
 * - 未标注行（语料的大多数）：每个环境变体下必须全等（`formatAbs` / 置信 /
 *   来源）或两边都不映射；
 * - 标注行（`diff`）：允许的差异方向写死在行上并附原因，且仍须满足硬判据
 *   ——文本面能映射 ⇒ 节点面必能映射且 `leqAbs(节点, 文本).ok`（节点不更宽），
 *   节点侧不得 any / unknown 吸收；
 * - 永不允许（进不了基线）：`text-only`（文本面映射、节点面不映射）、
 *   `node-wider`（节点面更宽）、抛错、any 吸收；`incomparable`（互不 ⊑）只许
 *   出现在 {@link KNOWN_INCOMPARABLE}（逐条原因 + 两侧输出钉）。
 *
 * 环境变体：无环境 / 同文件具名声明 / 仅文本的导入表 / 文本 + 节点导入表。
 * `NUDO_PARITY_REPORT=1 vitest run --silent=false <本文件>` 打印差异总数与按
 * 类别分布（vitest 默认吞掉通过用例的输出）。
 *
 * Invariants:
 * - 文本面能映射的每个构造，节点面都给相等或更精确的域；
 * - 基线里的每条差异都仍然成立（文本面缺陷修好了必须删标注——棘轮只朝
 *   「差异变少」一个方向转）。
 */
import { describe, expect, it } from "vitest";
import { provenanceOf, type Abs } from "../abs.ts";
import { formatAbs } from "../format/format.ts";
import { leqAbs } from "../leq.ts";
import {
  absTypeForTsTypeNode,
  absTypeForTsTypeText,
  importedTypesForSource,
  sameFileAnnotationEnv,
  tsTypeNodeOfText,
  type AnnotationEnv,
} from "../contract/ts-type-shape.ts";

type EnvName = "none" | "same" | "textImport" | "nodeImport";
type DiffKind = "node-only" | "node-precise" | "equivalent";
type Cell = {
  cat: string;
  text: string;
  /** 返回位专用语法（类型谓词 / `asserts`）。 */
  pos?: "return";
  /** 只在这些环境变体下跑（依赖名字解析的构造）。 */
  envs?: readonly EnvName[];
  /** 与文本面的已知差异方向（见行上注释）；不写 = 必须全等或两边都不映射。 */
  diff?: DiffKind;
};

const ENVS: readonly EnvName[] = ["none", "same", "textImport", "nodeImport"];
const NAMED_ENVS: readonly EnvName[] = ["same", "textImport", "nodeImport"];

/** 被导入文件：具名声明 / 别名链 / 值（`typeof`）。 */
const DEP = `
export interface User { name: string; age?: number; readonly id: number; greet(g: string): string }
export interface Base { name: string }
export interface Base2 { extra: boolean }
export interface Base2Sub extends Base2 { own: number }
export interface Admin extends Base { role: string }
export interface Admin2 extends Admin { x: number }
export interface AdminBase extends Missing {}
export interface Empty {}
export type Alias = User;
export type Alias2 = Alias;
export type Chain = Alias2 & { extra: boolean };
export type Union = "a" | "b";
export type Lit = "lit";
export type Recursive = { next: Recursive | null; value: number };
export type Generic<T> = { value: T };
export type CallSig = { (x: number): string };
export type Idx = { [k: string]: number };
export type Keyed = { a: 1; b: 2 };
export type SelfRef = { self: SelfRef };
export type A = { a: number };
export type B = { b: string };
export class Cat { name = "x"; meow(): string { return "m"; } }
export enum Color { Red, Green = "g" }
export const cfg = { port: 3000, name: "x", nested: { on: true } };
export function fn(x: number): string { return String(x); }
`;

const SAME_PRELUDE = DEP.replace(/export /g, "");
const IMPORT_LINE =
  'import type { User, Base, Base2, Base2Sub, Admin, Admin2, AdminBase, Empty, Alias, Alias2, Chain, Union, Lit, Recursive, Generic, CallSig, Idx, Keyed, SelfRef, A, B, Cat, Color, cfg, fn } from "./dep.ts";\n';

const CELLS: readonly Cell[] = [
  // ---- 关键字
  { cat: "关键字", text: "string" },
  { cat: "关键字", text: "number" },
  { cat: "关键字", text: "boolean" },
  { cat: "关键字", text: "bigint" },
  { cat: "关键字", text: "symbol" },
  { cat: "关键字", text: "any" },
  { cat: "关键字", text: "unknown" },
  { cat: "关键字", text: "never" },
  { cat: "关键字", text: "object" },
  { cat: "关键字", text: "null" },
  { cat: "关键字", text: "undefined" },
  { cat: "关键字", text: "void" },
  // Abs 没有多态 this 维度：节点面取 any（不约束域），文本面不认识。
  { cat: "关键字", text: "this", diff: "node-only" },
  // ---- 字面量
  { cat: "字面量类型", text: '"a"' },
  { cat: "字面量类型", text: "'b'" },
  { cat: "字面量类型", text: "42" },
  { cat: "字面量类型", text: "-1" },
  { cat: "字面量类型", text: "0xff" },
  { cat: "字面量类型", text: "1_000" },
  { cat: "字面量类型", text: "1.5e3" },
  { cat: "字面量类型", text: "true" },
  { cat: "字面量类型", text: "false" },
  { cat: "字面量类型", text: "10n" },
  { cat: "字面量类型", text: "-10n" },
  { cat: "字面量类型", text: "0xffn" },
  { cat: "字面量类型", text: "1_000n" },
  // 无插值的模板字面量类型：文本面按模板基型给 string，节点面给字面量。
  { cat: "字面量类型", text: "`tpl`", diff: "node-precise" },
  { cat: "字面量类型", text: "`a${string}b`" },
  // ---- 数组 / readonly
  { cat: "数组", text: "string[]" },
  { cat: "数组", text: "number[][]" },
  { cat: "数组", text: "Array<string>" },
  { cat: "数组", text: "ReadonlyArray<number>" },
  { cat: "数组", text: "(string | number)[]" },
  { cat: "readonly", text: "readonly string[]" },
  { cat: "readonly", text: "readonly [string, number]" },
  { cat: "数组", text: "Promise<string>[]" },
  // ---- 元组
  { cat: "元组", text: "[string, number]" },
  { cat: "元组", text: "[]" },
  { cat: "元组", text: "[string]" },
  { cat: "元组", text: "[string, number?]" },
  { cat: "元组", text: "[string, number?, boolean?]" },
  { cat: "元组", text: "[x: string, y: number]" },
  { cat: "元组", text: "[x: string, y?: number]" },
  { cat: "元组", text: "[string, ...number[]]" },
  { cat: "元组", text: "[...string[]]" },
  { cat: "元组", text: "[...string[], number]" },
  // rest 位上的元组：文本面把内层摊成元素联合数组，节点面保留元组结构。
  { cat: "元组", text: "[...[string, number]]", diff: "node-precise" },
  { cat: "元组", text: "[number, ...[string, boolean]]", diff: "node-precise" },
  { cat: "元组", text: "[...[string, ...number[]]]", diff: "node-precise" },
  { cat: "元组", text: "[string, ...number, boolean]" },
  { cat: "元组", text: "[a: string, b?: number, ...rest: boolean[]]" },
  { cat: "元组", text: "[[string, number], boolean]" },
  { cat: "元组", text: "Readonly<[string, number]>" },
  { cat: "元组", text: "[a?: 1, b?: 2, c?: 3, d?: 4, e?: 5, f?: 6, g?: 7, ...number[]]" },
  { cat: "元组", text: "[a?: 1, b?: 2, ...number[]]" },
  { cat: "元组", text: "[...Set<string>]" },
  { cat: "元组", text: "[...number[], string[]]" },
  { cat: "元组", text: "[x: string, y: number, z: boolean]" },
  { cat: "元组", text: "[Map<string, number>]" },
  { cat: "元组", text: "[string, ...Map<string, number>[]]" },
  { cat: "元组", text: "[...(10n | 20n)[]]" },
  // ---- 联合
  { cat: "联合", text: "string | number" },
  { cat: "联合", text: "string | null" },
  { cat: "联合", text: "number | undefined" },
  { cat: "联合", text: '"a" | "b" | "c"' },
  { cat: "联合", text: "string | number | boolean | bigint | symbol" },
  { cat: "联合", text: "string | { a: number }" },
  { cat: "联合", text: "null | undefined" },
  { cat: "联合", text: "string | any" },
  { cat: "联合", text: "string | never" },
  { cat: "联合", text: "string | unknown" },
  { cat: "联合", text: "Map<string, number> | undefined" },
  { cat: "联合", text: "A | B", envs: NAMED_ENVS },
  // 单引号字面量联合：文本面读成一个垃圾字面量，与节点面的 `"a" | "b"` 互不
  // 包含（文本面缺陷，不修；登记在 KNOWN_INCOMPARABLE）。
  { cat: "联合", text: "'a' | 'b'" },
  // `keyof` 比 `|` 绑定紧：`keyof A | B` = `(keyof A) | B`。文本面切不出 ⇒
  // undefined；节点面按 `A["a"] | B` 映射。
  { cat: "联合", text: "keyof A | B", envs: NAMED_ENVS, diff: "node-only" },
  // ---- 交叉
  { cat: "交叉", text: "{ a: number } & { b: string }" },
  { cat: "交叉", text: "{ a: number } & { a: string }" },
  { cat: "交叉", text: "string & number" },
  { cat: "交叉", text: "any & { a: number }" },
  { cat: "交叉", text: "{ a: number } & any" },
  { cat: "交叉", text: "{ a: number } & { b: string } & { c: boolean }" },
  { cat: "交叉", text: "{ a: number } & string" },
  { cat: "交叉", text: "A & { c: boolean }", envs: NAMED_ENVS },
  { cat: "交叉", text: "A & B", envs: NAMED_ENVS },
  // ---- 对象
  { cat: "对象", text: "{}" },
  { cat: "对象", text: "{ }" },
  { cat: "对象", text: "{ a: number }" },
  { cat: "对象", text: "{ a: number; b: string }" },
  { cat: "对象", text: "{ a: number, b: string }" },
  { cat: "对象", text: "{ a?: number }" },
  { cat: "对象", text: "{ readonly a: number }" },
  { cat: "对象", text: "{ a: { b: { c: string } } }" },
  { cat: "对象", text: '{ "quoted": number }' },
  // 数字键 / 计算键成员：文本面丢成员（文本面缺陷，不修）。
  { cat: "对象", text: "{ 0: number }", diff: "node-precise" },
  { cat: "对象", text: "{ a: number; m(x: string): boolean }" },
  { cat: "对象", text: "{ m(x: string, y?: number): boolean }" },
  { cat: "对象", text: "{ m?(x: string): boolean }" },
  { cat: "对象", text: "{ m<T>(x: T): T }" },
  { cat: "对象", text: "{ m(...xs: number[]): number }" },
  { cat: "对象", text: "{ (x: number): string }" },
  { cat: "对象", text: "{ (x: number): string; prop: boolean }" },
  { cat: "对象", text: "{ new (x: number): { a: number } }" },
  { cat: "对象", text: "{ new (x: number): string; (x: string): number }" },
  { cat: "对象", text: "{ get x(): number }" },
  { cat: "对象", text: "{ set x(v: number) }" },
  { cat: "对象", text: "{ get x(): number; set x(v: number) }" },
  { cat: "对象", text: "{ get x(): number; set x(v: string) }" },
  { cat: "对象", text: "{ get ['k'](): number }", diff: "node-precise" },
  { cat: "对象", text: "{ get x(): number; readonly y: string }" },
  { cat: "对象", text: "{ [k: string]: number }" },
  { cat: "对象", text: "{ readonly [k: string]: number }" },
  { cat: "对象", text: "{ [k: string]: number; a: number }" },
  { cat: "对象", text: "{ [k: number]: string }" },
  // 索引键里的单引号字面量联合：文本面读成垃圾键 `"a' | 'b"`（文本面缺陷，
  // 不修）；`leqAbs` 不比索引键域 ⇒ 互 ⊑，但展示不同。
  { cat: "对象", text: "{ [k: 'a' | 'b']: string }", diff: "equivalent" },
  { cat: "对象", text: "{ [Symbol.iterator](): number }" },
  { cat: "对象", text: "{ [Symbol.iterator](): Iterator<string> }", diff: "node-precise" },
  { cat: "对象", text: "{ [Symbol.asyncIterator](): number }" },
  { cat: "对象", text: "{ [key: string]: unknown }" },
  { cat: "对象", text: "{ readonly a: number; readonly b?: string }" },
  { cat: "对象", text: "{ fn: (x: number) => string }" },
  { cat: "对象", text: "{ fn: new (x: number) => string }" },
  { cat: "对象", text: "{ a: number; (): void }" },
  { cat: "对象", text: "{ (): void }" },
  { cat: "对象", text: "{ new (): void }" },
  { cat: "对象", text: "{ m(): void }" },
  { cat: "对象", text: "{ m(this: { a: number }, x: string): number }" },
  { cat: "对象", text: "{ m: Map<string, number> }" },
  { cat: "对象", text: "{ m(x: Map<string, number>): Set<string> }" },
  { cat: "对象", text: "{ a: number; m: Map<string, number> }[string]" },
  // 成员间的 JSDoc / 行注释：文本面丢注释之后的成员（文本面缺陷，不修）。
  { cat: "对象", text: "{ name: string; /** c */ arity: number; }", diff: "node-precise" },
  { cat: "对象", text: "{ /** d */ a: number }", diff: "node-precise" },
  { cat: "对象", text: "{\n  // c\n  a: number;\n}", diff: "node-precise" },
  { cat: "对象", text: "{\n  a: number;\n  b: string;\n}" },
  // ---- 函数类型
  { cat: "函数类型", text: "() => string" },
  { cat: "函数类型", text: "(x: number) => string" },
  { cat: "函数类型", text: "(x?: number) => string" },
  { cat: "函数类型", text: "(x: number, y?: string) => void" },
  { cat: "函数类型", text: "(...xs: number[]) => number" },
  { cat: "函数类型", text: "(...xs: [string, number]) => void" },
  { cat: "函数类型", text: "(this: { a: number }, x: string) => number" },
  { cat: "函数类型", text: "(x: number) => (y: string) => boolean" },
  { cat: "函数类型", text: "(x: number | string) => boolean | undefined" },
  { cat: "函数类型", text: "(cb: (x: number) => void) => void" },
  { cat: "函数类型", text: "(x: { a: number }) => { b: string }" },
  { cat: "函数类型", text: "(x: T) => T", envs: NAMED_ENVS },
  { cat: "函数类型", text: "(x?: [string, number?]) => void" },
  { cat: "函数类型", text: "(m: Map<string, number>) => void" },
  // ---- 构造器类型
  { cat: "构造器类型", text: "new (x: number) => string" },
  { cat: "构造器类型", text: "new () => { a: number }" },
  { cat: "构造器类型", text: "new (x?: number, ...rest: string[]) => void" },
  // ---- keyof
  { cat: "keyof", text: "keyof { a: number; b: string }" },
  { cat: "keyof", text: "keyof {}" },
  { cat: "keyof", text: "keyof { [k: string]: number }" },
  { cat: "keyof", text: "keyof { [k: string]: number; a: number }" },
  { cat: "keyof", text: "keyof [string, number]" },
  { cat: "keyof", text: "keyof string[]" },
  { cat: "keyof", text: "keyof string" },
  { cat: "keyof", text: "keyof number" },
  { cat: "keyof", text: "keyof A", envs: NAMED_ENVS },
  { cat: "keyof", text: "keyof 'a' | 'b'" },
  { cat: "keyof", text: "(keyof { a: number })[]" },
  { cat: "keyof", text: "keyof { [Symbol.iterator](): number }" },
  { cat: "keyof", text: "keyof [number, ...string[]]" },
  // ---- 索引访问
  { cat: "索引访问", text: '{ a: number; b: string }["a"]' },
  { cat: "索引访问", text: '{ a: number; b: string }[string]' },
  { cat: "索引访问", text: '{ a: number }[number]' },
  { cat: "索引访问", text: "{ [k: string]: number }[string]" },
  { cat: "索引访问", text: "[string, number][0]" },
  { cat: "索引访问", text: "[string, number][number]" },
  { cat: "索引访问", text: "[string, number][5]" },
  { cat: "索引访问", text: "string[][number]" },
  { cat: "索引访问", text: 'A["a"]', envs: NAMED_ENVS },
  { cat: "索引访问", text: "{ a: { b: string } }['a']['b']" },
  { cat: "索引访问", text: "Keyed[number]", envs: NAMED_ENVS },
  { cat: "索引访问", text: "Keyed[string]", envs: NAMED_ENVS },
  // ---- mapped type
  // 窄键 mapped type：文本面摊成 `{ }`（文本面缺陷，不修），节点面按键集展开。
  { cat: "mapped type", text: "{ [K in 'a' | 'b']: number }", diff: "node-precise" },
  { cat: "mapped type", text: '{ [K in "a"]: number }', diff: "node-precise" },
  { cat: "mapped type", text: '{ [K in "a" | "b"]-?: number }', diff: "node-precise" },
  { cat: "mapped type", text: "{ readonly [K in 'a']: number }", diff: "node-precise" },
  { cat: "mapped type", text: "{ -readonly [K in 'a']: number }", diff: "node-precise" },
  { cat: "mapped type", text: "{ [K in 'a' | 'b']: { key: K } }", diff: "node-precise" },
  { cat: "mapped type", text: '{ [K in keyof { a: 1 }]: number }', diff: "node-precise" },
  { cat: "mapped type", text: "{ [K in 'a']: K[] }", diff: "node-precise" },
  // 宽键 mapped type：文本面摊成 open `{ }`，节点面给索引签名 / 可选槽；
  // open 空对象与「只有可选槽」的对象互 ⊑（展示不同）。
  { cat: "mapped type", text: "{ [K in 'a' | 'b']?: number }", diff: "equivalent" },
  { cat: "mapped type", text: "{ readonly [K in 'a']?: number }", diff: "equivalent" },
  { cat: "mapped type", text: "{ [K in string]: number }", diff: "equivalent" },
  { cat: "mapped type", text: "{ [K in number]: string }", diff: "equivalent" },
  { cat: "mapped type", text: "{ [K in string | number]: boolean }", diff: "equivalent" },
  { cat: "mapped type", text: "{ [K in 'a' | string]: number }", diff: "equivalent" },
  { cat: "mapped type", text: "{ [K in string]: { key: K } }", diff: "equivalent" },
  { cat: "mapped type", text: "{ [K in string]?: number }", diff: "equivalent" },
  // ---- typeof
  { cat: "typeof", text: "typeof cfg", envs: NAMED_ENVS },
  { cat: "typeof", text: "typeof cfg.port", envs: NAMED_ENVS },
  { cat: "typeof", text: "typeof cfg.nested", envs: NAMED_ENVS },
  { cat: "typeof", text: "typeof fn", envs: NAMED_ENVS },
  { cat: "typeof", text: "typeof missing", envs: NAMED_ENVS },
  { cat: "typeof", text: "typeof cfg | number", envs: NAMED_ENVS },
  // `typeof import(...)`：文本面不认，节点面按导入类型节点映射。
  { cat: "typeof", text: 'typeof import("./dep.ts").User', envs: ["textImport", "nodeImport"], diff: "node-only" },
  // ---- inline import
  { cat: "inline import", text: 'import("./dep.ts").User', envs: NAMED_ENVS },
  { cat: "inline import", text: 'import("./dep.ts").Alias', envs: NAMED_ENVS },
  { cat: "inline import", text: 'import("./missing.ts").X', envs: NAMED_ENVS },
  { cat: "inline import", text: '(import("./dep.ts").User)[]', envs: NAMED_ENVS },
  { cat: "inline import", text: 'import("./dep.ts").Admin2', envs: NAMED_ENVS },
  { cat: "inline import", text: 'import("./dep.ts").Keyed["a"]', envs: NAMED_ENVS },
  { cat: "inline import", text: 'Map<string, import("./dep.ts").User>', envs: NAMED_ENVS },
  // ---- interface extends / 别名链
  { cat: "interface extends", text: "Base", envs: NAMED_ENVS },
  { cat: "interface extends", text: "Admin", envs: NAMED_ENVS },
  { cat: "interface extends", text: "Admin2", envs: NAMED_ENVS },
  { cat: "interface extends", text: "AdminBase", envs: NAMED_ENVS },
  { cat: "interface extends", text: "Empty", envs: NAMED_ENVS },
  { cat: "interface extends", text: "Base2Sub", envs: NAMED_ENVS },
  { cat: "interface extends", text: "Base2", envs: NAMED_ENVS },
  { cat: "别名链", text: "Alias", envs: NAMED_ENVS },
  { cat: "别名链", text: "Alias2", envs: NAMED_ENVS },
  { cat: "别名链", text: "Chain", envs: NAMED_ENVS },
  { cat: "别名链", text: "Chain[]", envs: NAMED_ENVS },
  { cat: "别名链", text: "Union", envs: NAMED_ENVS },
  { cat: "别名链", text: "Lit", envs: NAMED_ENVS },
  { cat: "别名链", text: "Recursive", envs: NAMED_ENVS },
  { cat: "别名链", text: "{ r: Recursive | null }", envs: NAMED_ENVS },
  { cat: "别名链", text: "Generic", envs: NAMED_ENVS },
  { cat: "别名链", text: "Generic<number>", envs: NAMED_ENVS },
  { cat: "别名链", text: "Cat", envs: NAMED_ENVS },
  { cat: "别名链", text: "Color", envs: NAMED_ENVS },
  { cat: "别名链", text: "CallSig", envs: NAMED_ENVS },
  { cat: "别名链", text: "Idx", envs: NAMED_ENVS },
  { cat: "别名链", text: "Keyed", envs: NAMED_ENVS },
  { cat: "别名链", text: "SelfRef", envs: NAMED_ENVS },
  { cat: "别名链", text: "A", envs: NAMED_ENVS },
  { cat: "别名链", text: "B", envs: NAMED_ENVS },
  { cat: "别名链", text: "A[]", envs: NAMED_ENVS },
  { cat: "别名链", text: "{ x: A }", envs: NAMED_ENVS },
  { cat: "别名链", text: "(x: A) => B", envs: NAMED_ENVS },
  { cat: "别名链", text: "Map<string, User>", envs: NAMED_ENVS },
  // ---- utility type
  { cat: "utility type", text: "Partial<{ a: number; b?: string }>" },
  { cat: "utility type", text: "Required<{ a?: number; b: string }>" },
  { cat: "utility type", text: "Readonly<{ a: number; b?: string }>" },
  { cat: "utility type", text: 'Pick<{ a: number; b: string }, "a">' },
  { cat: "utility type", text: 'Omit<{ a: number; b: string }, "a">' },
  { cat: "utility type", text: 'Pick<{ a: number; b: string }, "a" | "b">' },
  { cat: "utility type", text: 'Pick<{ a: number; b: string }, \'a\'>' },
  { cat: "utility type", text: 'Pick<string, "a">' },
  { cat: "utility type", text: 'Partial<Pick<{ a?: number }, "a">>' },
  { cat: "utility type", text: "Partial<A>", envs: NAMED_ENVS },
  { cat: "utility type", text: "Partial<{ get x(): number }>" },
  { cat: "utility type", text: "NonNullable<string | null>" },
  { cat: "utility type", text: "ReturnType<typeof fn>" },
  { cat: "utility type", text: "Exclude<string | number, string>" },
  { cat: "utility type", text: "Record<K, V>", envs: NAMED_ENVS },
  // ---- 内建泛型
  { cat: "内建泛型", text: "Map<string, number>" },
  { cat: "内建泛型", text: "ReadonlyMap<string, number>" },
  { cat: "内建泛型", text: "Set<string>" },
  { cat: "内建泛型", text: "ReadonlySet<string>" },
  { cat: "内建泛型", text: "WeakMap<object, string>" },
  { cat: "内建泛型", text: "WeakSet<object>" },
  { cat: "内建泛型", text: "Promise<number>" },
  { cat: "内建泛型", text: "Promise" },
  { cat: "内建泛型", text: "Record<string, number>" },
  { cat: "内建泛型", text: 'Record<"a", number>' },
  { cat: "内建泛型", text: "Record<string, { a: number }>" },
  { cat: "内建泛型", text: "Map<string, Set<number>>" },
  { cat: "内建泛型", text: "Array<{ price: number }>" },
  { cat: "内建泛型", text: "ReadonlyArray<{ price: number }>" },
  { cat: "内建泛型", text: "Array<string | number>" },
  { cat: "内建泛型", text: "Map<string, { a: number }>" },
  { cat: "内建泛型", text: "Map<string, Map<string, number>>" },
  { cat: "内建泛型", text: "Map<string, 10n>" },
  { cat: "内建泛型", text: "ReadonlyMap<string, ReadonlySet<string>>" },
  { cat: "内建泛型", text: "Set<{ id: number }>" },
  { cat: "内建泛型", text: "WeakMap<object, Set<string>>" },
  { cat: "内建泛型", text: "Promise<Map<string, number>>" },
  { cat: "内建泛型", text: "Record<string, string[]>" },
  { cat: "内建泛型", text: "Record<'a', { get x(): number }>" },
  { cat: "内建泛型", text: "Map<string, number>[]" },
  // 迭代协议泛型：文本面的内建泛型表不认识这些名字 ⇒ undefined；节点面给
  // 迭代协议结构（元素域随实参走）。
  { cat: "内建泛型", text: "Iterable<number>", diff: "node-only" },
  { cat: "内建泛型", text: "Iterator<number>", diff: "node-only" },
  { cat: "内建泛型", text: "IterableIterator<string>", diff: "node-only" },
  { cat: "内建泛型", text: "AsyncIterable<number>", diff: "node-only" },
  { cat: "内建泛型", text: "AsyncIterator<number>", diff: "node-only" },
  { cat: "内建泛型", text: "ReadonlyIterable<number>", diff: "node-only" },
  { cat: "内建泛型", text: "AsyncIterableIterator<number>", diff: "node-only" },
  { cat: "内建泛型", text: "ReadonlySet" },
  { cat: "内建泛型", text: "Iterable", diff: "node-only" },
  { cat: "内建泛型", text: "Iterator", diff: "node-only" },
  { cat: "内建泛型", text: "AsyncIterable", diff: "node-only" },
  { cat: "内建泛型", text: "Iterable<Map<string, number>>", diff: "node-only" },
  { cat: "内建泛型", text: "Iterator<string, number, undefined>", diff: "node-only" },
  { cat: "内建泛型", text: "Map" },
  { cat: "内建泛型", text: "Set" },
  // ---- 内建类型名
  { cat: "内建类型名", text: "Date" },
  { cat: "内建类型名", text: "RegExp" },
  { cat: "内建类型名", text: "Error" },
  { cat: "内建类型名", text: "Function" },
  { cat: "内建类型名", text: "Object" },
  { cat: "内建类型名", text: "Array" },
  { cat: "内建类型名", text: "ReadonlyArray" },
  { cat: "内建类型名", text: "unknownName" },
  // ---- 条件 / infer（两边都不映射）
  { cat: "条件类型", text: 'T extends string ? "a" : "b"' },
  { cat: "条件类型", text: "string extends number ? 1 : 0" },
  { cat: "infer", text: "T extends infer U ? U : never" },
  { cat: "infer", text: "infer U" },
  // 成员位上的条件类型：文本面切不出成员 ⇒ 整体 undefined；节点面按对象
  // 折叠，不可映射成员不进槽（open）。
  { cat: "条件类型", text: "{ a: T extends string ? 1 : 0 }", diff: "node-only" },
  { cat: "条件类型", text: "(T extends string ? 1 : 0)[]" },
  { cat: "条件类型", text: "A extends string ? number : string", envs: NAMED_ENVS },
  // ---- 括号 / 杂项
  { cat: "括号", text: "(string)" },
  { cat: "括号", text: "(string | number)" },
  { cat: "括号", text: "((string))[]" },
  { cat: "括号", text: "(string) | (number)" },
  { cat: "括号", text: "{ a: (string | number) }" },
  // 类型谓词 / asserts（返回位）：节点面 → boolean；文本面只认值类型。
  { cat: "杂项", text: "x is number", pos: "return", diff: "node-only" },
  { cat: "杂项", text: "asserts x is number", pos: "return", diff: "node-only" },
  { cat: "杂项", text: "this", pos: "return", diff: "node-only" },
  { cat: "杂项", text: "unique symbol", diff: "node-only" },
  { cat: "杂项", text: "intrinsic" },
  { cat: "杂项", text: "T", envs: NAMED_ENVS },
  // 尾随块注释：文本面不做词法清洗 ⇒ undefined；节点面直接读节点。
  { cat: "杂项", text: "string /* c */", diff: "node-only" },
  { cat: "杂项", text: "string\n  | number" },
];

/** 互不 ⊑ 的已知差异：逐条原因 + 两侧输出钉（输出变了 = 缺陷修好了，删条目）。 */
const KNOWN_INCOMPARABLE: Readonly<
  Record<string, { why: string; text: string; node: string } | undefined>
> = {
  "'a' | 'b'": {
    why: "单引号字面量联合：文本面读成一个垃圾字面量（文本面缺陷，不修）；节点面正确",
    text: `"a' | 'b" #exact`,
    node: `"a" | "b" #exact`,
  },
};

type Verdict =
  | "same"
  | "both-unmapped"
  | "equivalent"
  | "node-precise"
  | "node-only"
  | "text-only"
  | "node-wider"
  | "incomparable"
  | "absorb"
  | "throw";

type Row = { cell: Cell; env: EnvName; verdict: Verdict; text: string; node: string };

function envFor(
  name: EnvName,
  text: string,
  pos: "return" | undefined,
): { env: AnnotationEnv | undefined; src: string } {
  const stmt = pos === "return" ? `declare function __f(x): ${text};` : `type __t = ${text};`;
  if (name === "none") return { env: undefined, src: stmt };
  if (name === "same") return { env: sameFileAnnotationEnv(SAME_PRELUDE), src: `${SAME_PRELUDE}${stmt}` };
  const src = `${IMPORT_LINE}${stmt}`;
  const tables = importedTypesForSource(src, () => DEP);
  if (name === "textImport") {
    return {
      env: sameFileAnnotationEnv(src, {
        namedTypes: tables.namedTexts,
        importTypes: tables.inlineTexts,
      }),
      src,
    };
  }
  return {
    env: sameFileAnnotationEnv(src, {
      namedTypes: tables.namedTexts,
      namedTypeNodes: tables.namedNodes,
      importTypes: tables.inlineTexts,
      importTypeNodes: tables.inlineNodes,
    }),
    src,
  };
}

/** 展示串（空白折叠）：语料里的输出钉与 `formatAbs` 的排版细节解耦。 */
const show = (a: Abs | undefined): string =>
  a === undefined ? "undefined" : formatAbs(a).replace(/\s+/g, " ");

function isTop(a: Abs): boolean {
  return a.shape.k === "any" || a.shape.k === "unknown";
}

function verdictOf(cell: Cell, env: EnvName): Row {
  const { env: annotationEnv, src } = envFor(env, cell.text, cell.pos);
  const { node, source } = tsTypeNodeOfText(cell.text, cell.pos);
  if (!node) throw new Error(`语料解析失败：${JSON.stringify(cell.text)}`);
  let textAbs: Abs | undefined;
  let nodeAbs: Abs | undefined;
  try {
    textAbs = absTypeForTsTypeText(cell.text, annotationEnv);
  } catch (e) {
    return { cell, env, verdict: "throw", text: `文本面抛错：${String(e)}`, node: "" };
  }
  try {
    nodeAbs = absTypeForTsTypeNode(node, annotationEnv, source);
  } catch (e) {
    return { cell, env, verdict: "throw", text: show(textAbs), node: `节点面抛错：${String(e)}` };
  }
  const text = show(textAbs);
  const nodeStr = show(nodeAbs);
  const base = { cell, env, text, node: nodeStr };
  if (textAbs === undefined && nodeAbs === undefined) return { ...base, verdict: "both-unmapped" };
  if (textAbs === undefined) return { ...base, verdict: "node-only" };
  if (nodeAbs === undefined) return { ...base, verdict: "text-only" };
  if (
    formatAbs(textAbs) === formatAbs(nodeAbs) &&
    textAbs.conf === nodeAbs.conf &&
    provenanceOf(textAbs) === provenanceOf(nodeAbs)
  ) {
    return { ...base, verdict: "same" };
  }
  const nodeLeqText = leqAbs(nodeAbs, textAbs).ok;
  const textLeqNode = leqAbs(textAbs, nodeAbs).ok;
  if (nodeLeqText && textLeqNode) {
    return { ...base, verdict: isTop(textAbs) === isTop(nodeAbs) ? "equivalent" : "absorb" };
  }
  if (nodeLeqText) return { ...base, verdict: "node-precise" };
  if (textLeqNode) return { ...base, verdict: "node-wider" };
  return { ...base, verdict: "incomparable" };
}

let rowsCache: Row[] | undefined;
function allRows(): Row[] {
  rowsCache ??= CELLS.flatMap((cell) =>
    (cell.envs ?? ENVS).map((env) => verdictOf(cell, env)),
  );
  return rowsCache;
}

const labelOf = (r: Row): string => `[${r.env}] ${r.cell.cat} ${JSON.stringify(r.cell.text)}`;

describe("TS 类型注解映射一致性（文本面 vs 节点面）", () => {
  it("文本面能映射的每个构造，节点面给相等或更精确的域", () => {
    const rows = allRows();
    const problems: string[] = [];
    const usedDiffs = new Set<Cell>();
    for (const r of rows) {
      const expected = r.cell.diff ?? "全等";
      const detail = `（text: ${r.text} / node: ${r.node}）`;
      switch (r.verdict) {
        case "throw":
          problems.push(`${labelOf(r)}：抛错 ${detail}`);
          continue;
        case "text-only":
          problems.push(`${labelOf(r)}：文本面映射、节点面不映射 ${detail}`);
          continue;
        case "node-wider":
          problems.push(`${labelOf(r)}：节点面更宽 ${detail}`);
          continue;
        case "absorb":
          problems.push(`${labelOf(r)}：any / unknown 吸收 ${detail}`);
          continue;
        case "incomparable":
          // 逐条核对见下方用例。
          continue;
      }
      if (r.verdict === r.cell.diff) usedDiffs.add(r.cell);
      const ok = r.verdict === "same" || r.verdict === "both-unmapped" || r.verdict === r.cell.diff;
      if (!ok) problems.push(`${labelOf(r)}：期望 ${expected}，实际 ${r.verdict} ${detail}`);
    }
    // 标注必须仍然成立：文本面追上来之后标注要删（棘轮只朝差异变少转）。
    for (const cell of CELLS) {
      if (cell.diff && !usedDiffs.has(cell)) {
        problems.push(
          `${JSON.stringify(cell.text)}：标注 diff: "${cell.diff}" 已不成立（所有环境变体下都全等 / 不映射），删掉标注`,
        );
      }
    }
    expect(problems.join("\n")).toBe("");
  });

  it("互不包含的差异只许是登记过的（附原因与两侧输出钉）", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const r of allRows()) {
      const known = KNOWN_INCOMPARABLE[r.cell.text];
      if (r.verdict !== "incomparable") {
        if (known) seen.add(r.cell.text);
        continue;
      }
      if (!known) {
        problems.push(`${labelOf(r)}：未登记的互不包含（text: ${r.text} / node: ${r.node}）`);
        continue;
      }
      seen.add(r.cell.text);
      if (r.text !== known.text || r.node !== known.node) {
        problems.push(
          `${labelOf(r)}：登记的两侧输出已变（登记 text: ${known.text} / node: ${known.node}；` +
            `实际 text: ${r.text} / node: ${r.node}）`,
        );
      }
    }
    for (const text of Object.keys(KNOWN_INCOMPARABLE)) {
      if (!seen.has(text)) problems.push(`${JSON.stringify(text)}：已不是互不包含，删掉登记`);
    }
    expect(problems.join("\n")).toBe("");
  });

  it("语料覆盖了每一个环境变体与每一种差异方向", () => {
    const rows = allRows();
    expect(new Set(rows.map((r) => r.env))).toEqual(new Set(ENVS));
    // 棘轮的三类标注 + 登记的互不包含都得有实例，否则判据退化成空转。
    for (const kind of ["node-only", "node-precise", "equivalent"] as const) {
      expect(rows.some((r) => r.cell.diff === kind && r.verdict === kind), kind).toBe(true);
    }
    expect(rows.some((r) => r.verdict === "incomparable")).toBe(true);
    // 大多数格必须全等：语料不是一份差异清单。
    const same = rows.filter((r) => r.verdict === "same").length;
    expect(same / rows.length).toBeGreaterThan(0.7);
    if (process.env.NUDO_PARITY_REPORT) report(rows);
  });
});

function report(rows: Row[]): void {
  const byVerdict = new Map<Verdict, number>();
  const byCat = new Map<string, Map<Verdict, number>>();
  for (const r of rows) {
    byVerdict.set(r.verdict, (byVerdict.get(r.verdict) ?? 0) + 1);
    const m = byCat.get(r.cell.cat) ?? new Map<Verdict, number>();
    m.set(r.verdict, (m.get(r.verdict) ?? 0) + 1);
    byCat.set(r.cell.cat, m);
  }
  const lines = [`parity cells: ${rows.length}`];
  for (const [k, n] of [...byVerdict].sort()) lines.push(`  ${k}: ${n}`);
  for (const [cat, m] of byCat) {
    const parts = [...m].filter(([k]) => k !== "same").map(([k, n]) => `${k}=${n}`);
    if (parts.length > 0) lines.push(`  ${cat}: ${parts.join(" ")}`);
  }
  console.log(lines.join("\n"));
}
