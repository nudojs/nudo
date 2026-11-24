/**
 * SemanticIndex —— ADR 0001 阶段 0 骨架（core/algebra/scan）。
 *
 * 一次 binding 产出的**纯数据**索引：以身份（`SymbolId`）取代字符串名字作为
 * 跨面引用的唯一键。本文件不参与求值、`leqAbs`、`formatShape`，也不是值 IR
 * ——Abs 仍是唯一类型表示（AGENT.md:9 / kernel-merge.md）。
 *
 * 阶段 0 范围（ADR §10 决议 5）：仅 ESM / CJS 主路径的导出槽与入口形态；
 * namespace、`.ts` 参数属性、完整块级作用域链留阶段 1。经
 * `@nudojs/core/internal` 供 `check` / service / LSP 只读。
 *
 * 入口表（{@link SemanticIndex.entries} / {@link SemanticIndex.entryInfos}）是
 * `check` 入口面的**唯一来源**（阶段 3）：登记序即签名序，形态见
 * {@link EntryForm}。namespace 体不是模块顶层，其内部声明不进入口表。
 *
 * 与 ADR 的两处实施细化（见 ADR §13 实施记录）：
 * - 缓存用 WeakMap<File, SemanticIndex> 而非修改 parseSource 的 LRU —— 同样
 *   保证「索引与 AST 同生命周期」，且阶段 0 保持纯新增文件、可独立 revert。
 * - 解构模式收集与 `scope-collect.ts::collectPatternNames` 同形实现，未直接
 *   import，避免 algebra/scan → exec/transpile 的反向依赖与该模块的加载副作用。
 */
import type { File, Node } from "@babel/types";
import { literalConstValuesOf, memberKeyNameOf } from "./member-keys.ts";

export type SymbolId = string & { readonly __brand: "SymbolId" };
export type NodeId = string & { readonly __brand: "NodeId" };
export type ExportSlot = string;
export type EntryId = string;

export type SymbolKind =
  | "const" | "let" | "var" | "param" | "catch" | "loop" | "import" | "reexport"
  | "function" | "class" | "classExpr" | "method" | "value";

export interface SymbolInfo {
  readonly id: SymbolId;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly scopeUid: string;
  readonly declarationStart: number;
}

export interface MemberTable {
  readonly ownFields: readonly string[];
  readonly protoMethods: readonly string[];
  readonly staticMembers: readonly string[];
  readonly accessors: readonly string[];
}

/** 一条 ESM import 绑定的声明事实（按本地名索引）。 */
export interface ImportBindingInfo {
  readonly local: string;
  readonly source: string;
  readonly importedName: string;
  readonly kind: "named" | "default" | "namespace";
  readonly localNode: Node;
  readonly importedNode: Node;
}

export type ExportSlotKind =
  | "value" | "type" | "reexport" | "cjs" | "default" | "namespace";

/**
 * 导出槽的声明事实（dts / export / LSP 共用）。
 * `local` 是声明侧名字；再导出与匿名默认导出按 dts 面口径置空。
 */
export interface ExportSlotInfo {
  readonly slot: ExportSlot;
  readonly local: string;
  readonly kind: ExportSlotKind;
  /** 再导出目标模块说明符（仅 kind = "reexport"）。 */
  readonly source?: string;
  /** 目标模块里的导入名（仅 kind = "reexport"；`*` 表示命名空间）。 */
  readonly imported?: string;
  /** 本地导出别名的导出侧说明符节点（`export { a as b }` 的 b）。 */
  readonly exportedNode?: Node;
}

export interface CallSiteInfo {
  readonly calleeName: string | undefined;
  readonly memberKey: string | undefined;
  readonly optional: boolean;
  readonly start: number;
  readonly argCount: number;
}

export type LexicalKind = "string" | "template" | "regex" | "comment";

export interface LexicalSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: LexicalKind;
}

/**
 * 入口表单项的产生形态。
 *
 * 不在 {@link SUPPLEMENTARY_ENTRY_FORMS} 里的形态，与旧函数普查面
 * （`listTopFunctions` / `listClassEntryNames`）的触发器一一对应：这些名字
 * 旧普查面同样登记。索引独有的规则单列——`check` 据此派生 `addedNames`
 * （只在签名面可见、不进 L1 执法的导出槽形态）。
 */
export type EntryForm =
  // —— 旧普查面同样登记 ——
  /** 模块顶层的具名函数声明（含 `export function f` / `export default function f`）。 */
  | "function"
  /** 顶层标识符绑定到函数值（`const f = () => {…}` / `const f = function g() {…}`；声明种类、导出与否不限）。 */
  | "function-value"
  /** 匿名默认导出函数（`export default () => {…}` / `export default function () {…}`）。 */
  | "default-function"
  /**
   * 顶层表达式语句里的 CJS 出口槽直挂函数值：`module.exports = fn` ⇒ 槽名
   * default 或具名函数表达式的内层名；`exports.x = fn` ⇒ 槽名。
   */
  | "cjs-function"
  /**
   * 旧类入口面登记的导出类名：`export class C` / `export default class C` /
   * `export const C = class {…}` / `export { C }` / `export default C`（本地类
   * 声明）/ `module.exports = class {…}` ⇒ default。
   */
  | "class"
  /** 旧函数普查面登记的类方法（`C.m`；含实例导出 `export const svc = new Svc()` 与继承方法）。 */
  | "class-method"
  /**
   * 随声明直接导出的对象字面量的可调用成员：`export const api = {…}` /
   * 顶层表达式语句 `module.exports = {…}`。
   */
  | "object-member"
  // —— 索引独有（旧普查面不登记） ——
  /**
   * 旧普查面不登记的 CJS 出口槽：`exports.greet = boom`（右值是标识符，
   * BUG-002）；不在顶层表达式语句位置的槽赋值（`if (c) exports.x = fn`）。
   */
  | "cjs-slot"
  /**
   * 旧类入口面不登记的类名：匿名默认导出类（default）、经说明符 / 默认标识符
   * 导出的类表达式、`module.exports = C`、`exports.C = class`、具名
   * `module.exports = class C` 的 C。
   */
  | "class-value"
  /** `class-value` 类的方法（`default.m` / `C.m`）。 */
  | "class-value-method"
  /** 解构模式绑定到函数值（`const { a } = { a: () => 1 }` / `const [f] = [() => 1]`）。 */
  | "destructured"
  /**
   * 对象字面量不是随声明导出时的可调用成员：`export default {…}` /
   * `export { api }` / `export default api`。
   */
  | "object-member-indirect"
  /** BUG-358：`export const api = {…}` 里与模块级绑定同名的成员键（旧普查面跳过）。 */
  | "object-member-collision"
  /** 无表达式的模板字面量键（BUG-004：旧键提取只认 Identifier / 字符串 / 数字）。 */
  | "template-key";

/** 索引独有的入口形态（见 {@link EntryForm}）。 */
export const SUPPLEMENTARY_ENTRY_FORMS: ReadonlySet<EntryForm> = new Set<EntryForm>([
  "cjs-slot",
  "class-value",
  "class-value-method",
  "destructured",
  "object-member-indirect",
  "object-member-collision",
  "template-key",
]);

/** 入口表单项。 */
export interface EntryInfo {
  readonly name: EntryId;
  readonly form: EntryForm;
  /** 入口值的声明节点（函数 / 类 / 对象成员 / 赋值右值；类方法为方法成员节点）。 */
  readonly node: Node;
  /** 承载该入口的模块顶层语句（Program.body 的直接子节点）。 */
  readonly stmt: Node;
}

export interface SemanticIndex {
  readonly symbols: ReadonlyMap<SymbolId, SymbolInfo>;
  /** NodeId = `${scopeUid}@${start}`；每个 Identifier 引用 → 绑定身份。 */
  readonly refs: ReadonlyMap<NodeId, SymbolId>;
  /** 便利查询：源码 offset → 绑定身份（与 refs 同源，不是第二份事实）。 */
  readonly refByOffset: ReadonlyMap<number, SymbolId>;
  readonly exportSlots: ReadonlyMap<ExportSlot, SymbolId>;
  /** 归一后的导出槽表（含 CJS / 默认 / 再导出；dts 面的唯一来源）。 */
  readonly exportSlotInfos: ReadonlyMap<ExportSlot, ExportSlotInfo>;
  /** 按本地名索引的 ESM import 声明事实（source / imported / 节点）。 */
  readonly imports: ReadonlyMap<string, ImportBindingInfo>;
  /** 每个符号 id 的声明节点（synthetic 导出槽取对应说明符节点）。 */
  readonly declarations: ReadonlyMap<SymbolId, Node>;
  /** 入口表的名字投影（= `entryInfos.map(e => e.name)`；登记序）。 */
  readonly entries: readonly EntryId[];
  /** 入口表单项（登记序，名字唯一）。`check` 的入口面只读这里。 */
  readonly entryInfos: readonly EntryInfo[];
  readonly members: ReadonlyMap<SymbolId, MemberTable>;
  /** 类成员名 → 声明节点（dts 类面迁移用的只读成员事实）。 */
  readonly memberNodes: ReadonlyMap<SymbolId, ReadonlyMap<string, Node>>;
  /** 类声明节点 start → owner SymbolId。 */
  readonly classNodeIds: ReadonlyMap<number, SymbolId>;
  /** owner SymbolId → 类体成员节点（源码序，含构造器 / 索引签名 / 静态块）。 */
  readonly classBodyNodes: ReadonlyMap<SymbolId, readonly Node[]>;
  /** namespace 声明 start → 体语句节点（源码序，dts namespace 面）。 */
  readonly namespaceBodyNodes: ReadonlyMap<number, readonly Node[]>;
  readonly spans: readonly LexicalSpan[];
  readonly calls: readonly CallSiteInfo[];
}

type AnyNode = {
  type?: string;
  start?: number | null;
  end?: number | null;
  [key: string]: unknown;
};

const SKIP_KEYS = new Set([
  "loc", "start", "end", "range", "extra", "leadingComments", "trailingComments",
  "innerComments", "comments", "tokens", "errors", "directives",
]);

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
  "ObjectMethod", "ClassMethod", "ClassPrivateMethod",
]);

const MEMBER_KEY_PARENTS = new Set([
  "ObjectProperty", "ObjectMethod", "ClassMethod", "ClassPrivateMethod",
  "MethodDefinition", "ClassProperty", "PropertyDefinition", "ClassAccessorProperty",
]);

function isNode(v: unknown): v is AnyNode {
  return typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";
}

function startOf(n: AnyNode): number {
  return typeof n.start === "number" ? n.start : 0;
}

function endOf(n: AnyNode): number {
  return typeof n.end === "number" ? n.end : startOf(n);
}

function nameOf(n: AnyNode | undefined): string | undefined {
  const v = n?.name;
  return typeof v === "string" ? v : undefined;
}

function childrenOf(n: AnyNode): Array<{ key: string; node: AnyNode }> {
  const out: Array<{ key: string; node: AnyNode }> = [];
  for (const key of Object.keys(n)) {
    if (SKIP_KEYS.has(key)) continue;
    const v = n[key];
    if (Array.isArray(v)) {
      for (const item of v) if (isNode(item)) out.push({ key, node: item });
    } else if (isNode(v)) {
      out.push({ key, node: v });
    }
  }
  return out;
}

/**
 * 静态成员键：Identifier（非 computed）/ 字符串 / 数字 / **无表达式的模板字面量**。
 * 最后一项是 BUG-004 的入口（旧键提取只认 Identifier / StringLiteral）。
 */
function staticKeyOf(raw: unknown, computed = false): string | undefined {
  if (!isNode(raw)) return undefined;
  if (raw.type === "Identifier") return computed ? undefined : nameOf(raw);
  if (raw.type === "StringLiteral" || raw.type === "NumericLiteral") {
    const v = raw.value;
    return typeof v === "string" || typeof v === "number" ? String(v) : undefined;
  }
  if (raw.type === "TemplateLiteral") {
    if (Array.isArray(raw.expressions) && raw.expressions.length > 0) return undefined;
    const quasis = raw.quasis;
    if (!Array.isArray(quasis) || quasis.length === 0) return undefined;
    const q = isNode(quasis[0]) ? (quasis[0] as AnyNode) : undefined;
    const value = q?.value as { cooked?: unknown; raw?: unknown } | undefined;
    if (typeof value?.cooked === "string") return value.cooked;
    if (typeof value?.raw === "string") return value.raw;
  }
  return undefined;
}

interface BindingName {
  name: string;
  node: AnyNode;
}

/** 与 scope-collect.ts::collectPatternNames 同形（见文件头「实施细化」）。 */
function bindingNamesOf(raw: unknown, out: BindingName[]): void {
  if (!isNode(raw)) return;
  if (raw.type === "Identifier") {
    const n = nameOf(raw);
    if (n) out.push({ name: n, node: raw });
    return;
  }
  if (raw.type === "RestElement") {
    bindingNamesOf(raw.argument, out);
    return;
  }
  if (raw.type === "AssignmentPattern") {
    bindingNamesOf(raw.left, out);
    return;
  }
  if (raw.type === "ObjectPattern" && Array.isArray(raw.properties)) {
    for (const p of raw.properties) {
      if (!isNode(p)) continue;
      if (p.type === "RestElement") bindingNamesOf(p.argument, out);
      else bindingNamesOf(p.value, out);
    }
    return;
  }
  if (raw.type === "ArrayPattern" && Array.isArray(raw.elements)) {
    for (const e of raw.elements) bindingNamesOf(e, out);
  }
}

interface Frame {
  readonly uid: string;
  readonly parent: Frame | undefined;
  readonly bindings: Map<string, SymbolId>;
}

/**
 * 稳定键 = scopeUid + declarationStart（ADR §10 决议 1）；name 仅用于同一
 * pattern 内消歧，不参与身份的时间稳定性。
 */
function symbolIdOf(uid: string, start: number, name: string): SymbolId {
  return `${uid}@${start}#${name}` as SymbolId;
}

function isModuleExportsNode(n: AnyNode | undefined): boolean {
  if (!n || n.type !== "MemberExpression" || n.computed === true) return false;
  const obj = isNode(n.object) ? n.object : undefined;
  const prop = isNode(n.property) ? n.property : undefined;
  return obj?.type === "Identifier" && nameOf(obj) === "module" &&
    prop?.type === "Identifier" && nameOf(prop) === "exports";
}

/** CJS 导出槽统一命名：module.exports / exports.<key> / module.exports.<key> → exports.<key>。 */
function cjsSlotOf(left: AnyNode | undefined): string | undefined {
  if (!left || left.type !== "MemberExpression") return undefined;
  if (isModuleExportsNode(left)) return "module.exports";
  const obj = isNode(left.object) ? left.object : undefined;
  const propKey = staticKeyOf(left.property, left.computed === true);
  if (!propKey || !obj) return undefined;
  if (obj.type === "Identifier" && nameOf(obj) === "exports") return `exports.${propKey}`;
  if (isModuleExportsNode(obj)) return `exports.${propKey}`;
  return undefined;
}

function isFunctionValue(raw: unknown): boolean {
  if (!isNode(raw)) return false;
  return raw.type === "FunctionExpression" || raw.type === "ArrowFunctionExpression" ||
    raw.type === "ObjectMethod" || raw.type === "ClassMethod";
}

/** 超类的本地名（`extends Base`）；namespace 限定 / 表达式 ⇒ undefined。 */
function superClassNameOf(d: AnyNode): string | undefined {
  const sc = isNode(d.superClass) ? d.superClass : undefined;
  return sc?.type === "Identifier" ? nameOf(sc) : undefined;
}

let indexCache = new WeakMap<File, SemanticIndex>();

/** 阶段 0 只在测试内使用；生产侧切换由阶段 1 接线。 */
export function resetSemanticIndexCache(): void {
  indexCache = new WeakMap<File, SemanticIndex>();
}

/**
 * 构建（或命中同 File 的缓存）语义索引。纯读 AST，不改写节点、不触发求值。
 */
export function buildSemanticIndex(file: File): SemanticIndex {
  const hit = indexCache.get(file);
  if (hit) return hit;
  const built = buildIndex(file);
  indexCache.set(file, built);
  return built;
}

/** 按 offset 查询引用绑定（BUG-003 的「身份 vs 名字」判据）。 */
export function resolveBindingAt(
  index: SemanticIndex,
  name: string,
  offset: number,
): SymbolId | undefined {
  const id = index.refByOffset.get(offset);
  if (!id) return undefined;
  return index.symbols.get(id)?.name === name ? id : undefined;
}

/** 按 offset 查询词法区间（BUG-019 的续行判据，取代按行掩码回退）。 */
export function lexicalKindAt(index: SemanticIndex, offset: number): LexicalKind | undefined {
  for (const s of index.spans) if (offset >= s.start && offset < s.end) return s.kind;
  return undefined;
}

/** 可调用成员：入口键 + 成员节点。 */
interface MemberRef {
  key: string;
  node: AnyNode;
}

interface ClassDef {
  cname: string;
  symbolId: SymbolId;
  /** 类节点（ClassDeclaration / ClassExpression）。 */
  node: AnyNode;
  /** 类声明所在的模块顶层语句。 */
  stmt: AnyNode;
  /** own 可调用成员（`memberTableOf` 口径：静态键，不解析计算键）。 */
  keys: MemberRef[];
  direct: boolean;
  /** 声明在 namespace 体内 ⇒ 不是模块入口。 */
  inNamespace: boolean;
  /** 旧类入口面登记该类名（`class` 形态；否则 `class-value`）。 */
  nameListed: boolean;
  /** 旧函数普查面的类方法触发器命中 ⇒ own 方法键是 `class-method` 形态。 */
  methodsListed: boolean;
}

/** 对象字面量成为导出的方式（决定成员键的入口形态）。 */
type ObjectDefKind =
  /** `export const api = {…}`（随声明导出） */
  | "declaration"
  /** `export default {…}` */
  | "default"
  /** 顶层表达式语句 `module.exports = {…}` */
  | "cjs"
  /** 本地声明（`const api = {…}`，之后经 `export { api }` 等成为导出）或非语句位置的槽赋值 */
  | "local";

interface ObjectDef {
  symbolId: SymbolId;
  /** 可调用成员（静态键口径；BUG-385 的计算键由 census 补位）。 */
  members: MemberRef[];
  direct: boolean;
  kind: ObjectDefKind;
  /** 承载语句（变量声明时为所在语句）。 */
  stmt: AnyNode;
  /** 声明在 namespace 体内 ⇒ 不是模块入口。 */
  inNamespace: boolean;
}

/**
 * 旧函数普查面的补位步骤（按其登记顺序回放）：索引的 walk + pass 2 只发
 * 静态键能定名的 own 成员；旧普查面还登记的（继承方法、BUG-385 计算键、
 * TSDeclareMethod、匿名默认导出函数声明、具名 CJS 默认类的 default 槽）
 * 在这里按**旧顺序**补齐——登记序即签名序，顺序也必须一致。
 */
type CensusStep =
  | { kind: "class"; def: ClassDef }
  | { kind: "object"; obj: AnyNode; esm: boolean; stmt: AnyNode }
  | { kind: "default-function"; node: AnyNode; stmt: AnyNode }
  | { kind: "cjs-default-class"; node: AnyNode; stmt: AnyNode };

function buildIndex(file: File): SemanticIndex {
  const symbols = new Map<SymbolId, SymbolInfo>();
  const refs = new Map<NodeId, SymbolId>();
  const refByOffset = new Map<number, SymbolId>();
  const exportSlots = new Map<ExportSlot, SymbolId>();
  const exportSlotInfos = new Map<ExportSlot, ExportSlotInfo>();
  const imports = new Map<string, ImportBindingInfo>();
  const declarations = new Map<SymbolId, Node>();
  const members = new Map<SymbolId, MemberTable>();
  const memberNodes = new Map<SymbolId, ReadonlyMap<string, Node>>();
  const classNodeIds = new Map<number, SymbolId>();
  const classBodyNodes = new Map<SymbolId, readonly Node[]>();
  const namespaceBodyNodes = new Map<number, readonly Node[]>();
  const spans: LexicalSpan[] = [];
  const calls: CallSiteInfo[] = [];
  const entryInfos: EntryInfo[] = [];
  const entryAt = new Map<string, number>();
  const classDefs: ClassDef[] = [];
  /** 类节点 → 定义（同一类节点只登记一次；旧普查面的触发器按节点回查）。 */
  const classDefByNode = new WeakMap<AnyNode, ClassDef>();
  const objectDefs: ObjectDef[] = [];
  const declNodes = new WeakSet<object>();
  const seenDefs = new Set<string>();
  const root: Frame = { uid: "m", parent: undefined, bindings: new Map() };

  const rootNode = file as unknown as AnyNode;
  /**
   * 当前所在的模块顶层语句（Program.body 的直接子节点）与 namespace 嵌套
   * 深度：入口表项的 `stmt` 取前者；namespace 体不建 frame（阶段 1 范围），
   * 其内部声明不得以裸名进入口表——引擎解析不到 `N.f` 的裸名 `f`，只会
   * 产出假 `nudo:opaque-result`，或顶掉同名顶层函数。
   */
  let topStmt: AnyNode = rootNode;
  let namespaceDepth = 0;
  const programBody = (rootNode as { program?: { body?: AnyNode[] } }).program?.body ?? [];
  /** 顶层 `const k = "dyn"`（BUG-385：旧普查面据此给计算键 `[k]` 定名）。 */
  const literalConsts = literalConstValuesOf(programBody as unknown as Node[]);
  /** 索引口径的成员键：静态键（见 staticKeyOf）；计算键 `[k]` 不解析。 */
  const staticObjectKeyOf = (p: AnyNode): string | undefined =>
    staticKeyOf(p.key, p.computed === true);
  /**
   * 旧普查面口径的成员键（`memberKeyNameOf`）：不认模板字面量键，但认绑定
   * 到顶层字面量 const 的计算键。
   */
  const censusObjectKeyOf = (p: AnyNode): string | undefined => memberKeyNameOf(p, literalConsts);
  const comments = (file as unknown as { comments?: unknown[] }).comments;
  if (Array.isArray(comments)) {
    for (const c of comments) {
      if (isNode(c)) spans.push({ start: startOf(c), end: endOf(c), kind: "comment" });
    }
  }

  /**
   * 入口登记：按名去重，保留**首次**登记的位置（登记序 = 签名序）。
   * 同名入口再次被旧普查面登记的形态命中时改记该形态：「索引新增」只看
   * 名字——旧普查面只要以任何规则登记过这个名字，它就不在 `addedNames` 里。
   */
  function addEntry(
    name: string | undefined, form: EntryForm, node: AnyNode, stmt: AnyNode,
  ): void {
    if (!name) return;
    const at = entryAt.get(name);
    if (at === undefined) {
      entryAt.set(name, entryInfos.length);
      entryInfos.push({
        name, form, node: node as unknown as Node, stmt: stmt as unknown as Node,
      });
      return;
    }
    const prev = entryInfos[at]!;
    if (SUPPLEMENTARY_ENTRY_FORMS.has(prev.form) && !SUPPLEMENTARY_ENTRY_FORMS.has(form)) {
      entryInfos[at] = {
        name, form, node: node as unknown as Node, stmt: stmt as unknown as Node,
      };
    }
  }

  function declare(frame: Frame, name: string, node: AnyNode, kind: SymbolKind): SymbolId {
    const id = symbolIdOf(frame.uid, startOf(node), name);
    declNodes.add(node);
    if (!symbols.has(id)) {
      symbols.set(id, { id, name, kind, scopeUid: frame.uid, declarationStart: startOf(node) });
    }
    declarations.set(id, node as unknown as Node);
    if (!frame.bindings.has(name)) frame.bindings.set(name, id);
    return id;
  }

  function synthetic(frame: Frame, name: string, node: AnyNode, kind: SymbolKind): SymbolId {
    const id = symbolIdOf(frame.uid, startOf(node), name);
    if (!symbols.has(id)) {
      symbols.set(id, { id, name, kind, scopeUid: frame.uid, declarationStart: startOf(node) });
    }
    declarations.set(id, node as unknown as Node);
    return id;
  }

  function resolveName(frame: Frame, name: string): SymbolId | undefined {
    let cur: Frame | undefined = frame;
    while (cur) {
      const hit = cur.bindings.get(name);
      if (hit) return hit;
      cur = cur.parent;
    }
    return undefined;
  }

  function localOrSynthetic(frame: Frame, node: AnyNode, slotName: string): SymbolId {
    if (node.type === "Identifier") {
      const nm = nameOf(node) ?? slotName;
      return resolveName(frame, nm) ?? synthetic(frame, nm, node, "value");
    }
    return synthetic(frame, slotName, node, "value");
  }

  /** 语句列表的声明登记（不深入嵌套块；嵌套块由 walker 自建 frame）。 */
  function collectDeclarations(statements: readonly unknown[], frame: Frame): void {
    for (const raw of statements) {
      if (!isNode(raw)) continue;
      const n = raw;
      if (n.type === "VariableDeclaration") {
        const kind: SymbolKind = n.kind === "var" ? "var" : n.kind === "let" ? "let" : "const";
        if (Array.isArray(n.declarations)) {
          for (const d of n.declarations) {
            if (!isNode(d)) continue;
            const names: BindingName[] = [];
            bindingNamesOf(d.id, names);
            for (const b of names) declare(frame, b.name, b.node, kind);
          }
        }
      } else if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") {
        if (isNode(n.id)) {
          const nm = nameOf(n.id);
          if (nm) declare(frame, nm, n.id, n.type === "FunctionDeclaration" ? "function" : "class");
        }
      } else if (n.type === "ImportDeclaration" && Array.isArray(n.specifiers)) {
        const sourceNode = isNode(n.source) ? n.source : undefined;
        const source = typeof sourceNode?.value === "string" ? sourceNode.value : "";
        for (const s of n.specifiers) {
          if (!isNode(s) || !isNode(s.local)) continue;
          const nm = nameOf(s.local);
          if (!nm) continue;
          declare(frame, nm, s.local, "import");
          if (s.type === "ImportSpecifier") {
            const imported = isNode(s.imported) ? nameOf(s.imported) ?? nm : nm;
            imports.set(nm, {
              local: nm,
              source,
              importedName: imported,
              kind: "named",
              localNode: s.local as unknown as Node,
              importedNode: (isNode(s.imported) ? s.imported : s.local) as unknown as Node,
            });
          } else if (s.type === "ImportDefaultSpecifier") {
            imports.set(nm, {
              local: nm,
              source,
              importedName: "default",
              kind: "default",
              localNode: s.local as unknown as Node,
              importedNode: s.local as unknown as Node,
            });
          } else if (s.type === "ImportNamespaceSpecifier") {
            imports.set(nm, {
              local: nm,
              source,
              importedName: "*",
              kind: "namespace",
              localNode: s.local as unknown as Node,
              importedNode: s.local as unknown as Node,
            });
          }
        }
      } else if (n.type === "ExportNamedDeclaration" && isNode(n.declaration)) {
        collectDeclarations([n.declaration], frame);
      } else if (n.type === "ExportDefaultDeclaration" && isNode(n.declaration)) {
        const d = n.declaration;
        if ((d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") && isNode(d.id)) {
          const nm = nameOf(d.id);
          if (nm) declare(frame, nm, d.id, d.type === "FunctionDeclaration" ? "function" : "class");
        }
      }
    }
  }

  function memberTableOf(decl: AnyNode): MemberTable & { keys: string[]; nodes: Map<string, Node> } {
    const table = {
      ownFields: [] as string[],
      protoMethods: [] as string[],
      staticMembers: [] as string[],
      accessors: [] as string[],
      keys: [] as string[],
      nodes: new Map<string, Node>(),
    };
    const body = isNode(decl.body) ? decl.body : undefined;
    const raw = body?.body;
    if (!Array.isArray(raw)) return table;
    for (const m of raw) {
      if (!isNode(m)) continue;
      const keyName = staticKeyOf(m.key, m.computed === true);
      if (!keyName) continue;
      const isStatic = m.static === true;
      const kind = typeof m.kind === "string" ? m.kind : "method";
      if (kind === "constructor") continue;
      table.nodes.set(keyName, m as unknown as Node);
      if (m.type === "ClassProperty" || m.type === "PropertyDefinition" || m.type === "ClassAccessorProperty") {
        (isStatic ? table.staticMembers : table.ownFields).push(keyName);
      } else if (kind === "get" || kind === "set") {
        table.accessors.push(keyName);
      } else if (m.type === "ClassMethod" || m.type === "MethodDefinition" ||
        m.type === "ObjectMethod" || m.type === "ClassPrivateMethod") {
        (isStatic ? table.staticMembers : table.protoMethods).push(keyName);
        table.keys.push(keyName);
      } else if (m.type === "ObjectProperty" || m.type === "Property") {
        if (isFunctionValue(m.value)) {
          table.ownFields.push(keyName);
          table.keys.push(keyName);
        }
      }
    }
    return table;
  }

  function collectClassDef(
    decl: AnyNode, ownerId: SymbolId, cname: string, direct: boolean, nameListed: boolean,
  ): void {
    const dedup = `${ownerId}#${cname}`;
    if (seenDefs.has(dedup)) return;
    seenDefs.add(dedup);
    const table = memberTableOf(decl);
    members.set(ownerId, {
      ownFields: table.ownFields, protoMethods: table.protoMethods,
      staticMembers: table.staticMembers, accessors: table.accessors,
    });
    memberNodes.set(ownerId, table.nodes);
    classNodeIds.set(startOf(decl), ownerId);
    const body = isNode(decl.body) ? decl.body : undefined;
    if (body && Array.isArray(body.body)) {
      classBodyNodes.set(ownerId, body.body.filter(isNode) as unknown as Node[]);
    }
    const memberOf = (key: string): AnyNode => (table.nodes.get(key) ?? decl) as unknown as AnyNode;
    const def: ClassDef = {
      cname, symbolId: ownerId, node: decl, stmt: topStmt,
      keys: table.keys.map((key) => ({ key, node: memberOf(key) })),
      direct, inNamespace: namespaceDepth > 0, nameListed, methodsListed: false,
    };
    classDefByNode.set(decl, def);
    classDefs.push(def);
  }

  /**
   * BUG-108：顶层对象字面量按**绑定名**索引（spread 来源查表用）。
   * `const base = { bad(){…} }; export default { ...base }` 里 `base` 是普通
   * 顶层声明，不是导出槽 ⇒ 只能按名字找它的成员定义。
   *
   * 只收顶层 **`const`** 初值：`let` / `var` 可能被重赋值
   * （`let base = { stale(){} }; base = { fresh(){} }`）⇒ 旧初值不是当前对象，
   * 展开/查表会把已经不存在的成员登记成入口（陈旧成员 = 假红）。重赋值后的
   * 新值不是词法事实 ⇒ 不猜（与 service `localObjectLiteralsOf` / core
   * `scan-top-functions` 同口径）。
   */
  const objectLiteralsByName = new Map<string, AnyNode>();
  for (const raw of programBody) {
    let d: AnyNode = raw;
    if (d.type === "ExportNamedDeclaration" || d.type === "ExportDefaultDeclaration") {
      d = (isNode(d.declaration) ? d.declaration : d) as AnyNode;
    }
    if (d.type !== "VariableDeclaration") continue;
    if (d.kind !== "const") continue;
    for (const dd of (d.declarations ?? []) as AnyNode[]) {
      const id = dd.id as AnyNode | undefined;
      const init = dd.init as AnyNode | undefined;
      if (
        isNode(id) && id.type === "Identifier" &&
        typeof id.name === "string" &&
        isNode(init) && init.type === "ObjectExpression"
      ) {
        objectLiteralsByName.set(id.name, init);
      }
    }
  }

  /**
   * `{ ...base }` 展开后的**成员节点**（源顺序；spread 源只认顶层 `const`
   * 对象字面量 / 内联对象）。环保护按**路径**生效（复制一份向下传）：
   * 同一字面量出现在兄弟展开里（`{...base, ...base}`）时后一次仍参与
   * last-wins；真·循环（`const a = {...a}`）在展开时已被路径挡住。
   */
  function objectMembersOf(obj: AnyNode, path: ReadonlySet<AnyNode> = new Set()): AnyNode[] {
    const out: AnyNode[] = [];
    if (!Array.isArray(obj.properties)) return out;
    if (path.has(obj)) return out;
    const nextPath = new Set(path);
    nextPath.add(obj);
    for (const p of obj.properties) {
      if (!isNode(p)) continue;
      // BUG-108：`{ ...base }` 的 SpreadElement 没有 key，但 `base` 的方法
      // 在运行时确实是导出对象的成员 ⇒ 展开同名对象字面量（含多跳），
      // 只认静态可解析的 Identifier / 内联 ObjectExpression，不猜动态值。
      if (p.type === "SpreadElement" || p.type === "SpreadProperty") {
        const arg = (p as { argument?: AnyNode }).argument;
        if (!isNode(arg)) continue;
        const src =
          arg.type === "Identifier" && typeof arg.name === "string"
            ? objectLiteralsByName.get(arg.name)
            : arg.type === "ObjectExpression"
              ? arg
              : undefined;
        if (src) out.push(...objectMembersOf(src, nextPath));
        continue;
      }
      out.push(p);
    }
    return out;
  }

  /**
   * 对象字面量的**最终**成员表（last-wins）。
   *
   * 原生对象字面量同一静态键后出现的成员覆盖先出现的（覆盖目标含可调用 /
   * 访问器 / 非可调用）⇒ 旧实现按源顺序直接产键 ⇒ `{...base, helper: 42}`
   * 里 base 的 `helper` 仍存活（把已被覆盖的成员登记成入口 = 假红），
   * `{...base, helper(){…}}` 又可能留下重复记录。这里先展开 + 去重，
   * 下游（`objectKeyMembers`）只按**最终**成员的形态判可调用性。
   * `keyOf` 定不出名的键（动态计算键）⇒ 不参与去重（保留，不猜）。
   */
  function finalObjectMembersOf(
    obj: AnyNode, keyOf: (p: AnyNode) => string | undefined = staticObjectKeyOf,
  ): AnyNode[] {
    const out: AnyNode[] = [];
    const at = new Map<string, number>();
    for (const p of objectMembersOf(obj)) {
      const keyName = keyOf(p);
      if (keyName === undefined) {
        // 动态计算键 / 不可静态定名的键 ⇒ 不参与去重（保留，不猜）
        out.push(p);
        continue;
      }
      const idx = at.get(keyName);
      if (idx === undefined) {
        at.set(keyName, out.length);
        out.push(p);
      } else {
        out[idx] = p;
      }
    }
    return out;
  }

  /**
   * 最终成员里的可调用键。BUG-996 同口径：getter / setter 是访问器，不是
   * 可调用入口。`isFunctionValue(p)` 对 ObjectMethod 恒为 true，只看 type 会把
   * `get f() {}` / `set f(v) {}` 登记成入口 ⇒ check 造出假的
   * `nudo:entry-may-throw` / `nudo:opaque-result`（与 service 侧
   * `analyzer-ast.ts` 的 `prop.kind !== "method"` 判据一致）。
   * 只有**最终**成员是访问器 / 非函数时才排除（被覆盖的旧成员不再复活）。
   */
  function objectKeyMembers(
    obj: AnyNode, keyOf: (p: AnyNode) => string | undefined = staticObjectKeyOf,
  ): MemberRef[] {
    const out: MemberRef[] = [];
    for (const p of finalObjectMembersOf(obj, keyOf)) {
      const kind = typeof p.kind === "string" ? p.kind : "method";
      if (kind === "get" || kind === "set") continue;
      const key = keyOf(p);
      if (key && (isFunctionValue(p) || isFunctionValue(p.value))) out.push({ key, node: p });
    }
    return out;
  }

  function destructureFunctionNames(pattern: AnyNode, init: AnyNode | undefined): string[] {
    if (!init) return [];
    const names: BindingName[] = [];
    bindingNamesOf(pattern, names);
    const out: string[] = [];
    if (pattern.type === "ObjectPattern" && init.type === "ObjectExpression") {
      const props = Array.isArray(init.properties) ? init.properties : [];
      for (const b of names) {
        for (const p of props) {
          if (!isNode(p)) continue;
          const key = staticKeyOf(p.key, p.computed === true);
          if (key === b.name && isFunctionValue(p.value)) {
            out.push(b.name);
            break;
          }
        }
      }
    } else if (pattern.type === "ArrayPattern" && init.type === "ArrayExpression") {
      const els = Array.isArray(init.elements) ? init.elements : [];
      names.forEach((b, i) => {
        if (isFunctionValue(els[i])) out.push(b.name);
      });
    }
    return out;
  }

  function childFrame(node: AnyNode, parent: Frame): Frame {
    return { uid: `${parent.uid}/${startOf(node)}`, parent, bindings: new Map() };
  }

  function visit(node: AnyNode, frame: Frame, parentType: string, parentKey: string): void {
    const type = node.type ?? "";
    const start = startOf(node);
    // 入口面只收**模块顶层**形态。绑定表（symbols / refs / spans / calls）
    // 仍遍历整棵 AST，但函数体内嵌套的 FunctionDeclaration / VariableDeclarator
    // / CJS 赋值不得成为公共入口：否则 check 解析不到该名字 ⇒ 假
    // `nudo:opaque-result`（BUG-1149 / 1159 实测：嵌套 `function g(){}`）。
    const topLevel = frame.uid === root.uid;
    /** 入口面：模块顶层且不在 namespace 体内（见 topStmt / namespaceDepth 注释）。 */
    const entryLevel = topLevel && namespaceDepth === 0;

    if (type === "TSModuleDeclaration") {
      const body = isNode(node.body) ? node.body : undefined;
      if (body && Array.isArray(body.body)) {
        namespaceBodyNodes.set(start, body.body.filter(isNode) as unknown as Node[]);
      }
    }

    if (type === "Identifier") {
      const isProperty = parentKey === "property" &&
        (parentType === "MemberExpression" || parentType === "OptionalMemberExpression");
      const isKey = parentKey === "key" && MEMBER_KEY_PARENTS.has(parentType);
      const isLabel = parentKey === "label";
      if (!declNodes.has(node) && !isProperty && !isKey && !isLabel) {
        const nm = nameOf(node);
        if (nm) {
          const id = resolveName(frame, nm);
          if (id) {
            refs.set(`${frame.uid}@${start}` as NodeId, id);
            refByOffset.set(start, id);
          }
        }
      }
      return;
    }

    if (type === "StringLiteral") spans.push({ start, end: endOf(node), kind: "string" });
    else if (type === "TemplateLiteral") spans.push({ start, end: endOf(node), kind: "template" });
    else if (type === "RegExpLiteral") spans.push({ start, end: endOf(node), kind: "regex" });

    if (type === "CallExpression" || type === "OptionalCallExpression") {
      const callee = isNode(node.callee) ? node.callee : undefined;
      let calleeName: string | undefined;
      let memberKey: string | undefined;
      let optional = type === "OptionalCallExpression";
      if (callee) {
        if (callee.type === "Identifier") {
          calleeName = nameOf(callee);
        } else if (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") {
          optional = optional || callee.type === "OptionalMemberExpression";
          memberKey = staticKeyOf(callee.property, callee.computed === true);
          if (isNode(callee.object) && callee.object.type === "Identifier") {
            calleeName = nameOf(callee.object);
          }
        }
      }
      const args = node.arguments;
      calls.push({
        calleeName, memberKey, optional, start,
        argCount: Array.isArray(args) ? args.length : 0,
      });
    }

    // 顶层函数声明无条件进普查面（与 listTopFunctions 同口径，便于对拍）。
    if (entryLevel && type === "FunctionDeclaration" && isNode(node.id)) {
      const nm = nameOf(node.id);
      if (nm) addEntry(nm, "function", node, topStmt);
    }

    if (topLevel && type === "AssignmentExpression") {
      const left = isNode(node.left) ? node.left : undefined;
      const right = isNode(node.right) ? node.right : undefined;
      const slot = cjsSlotOf(left);
      if (slot && right) {
        const id = localOrSynthetic(frame, right, slot);
        exportSlots.set(slot, id);
        /** 旧普查面只认顶层表达式语句位置的槽赋值（`if (c) exports.x = fn` 不登记）。 */
        const censusPosition = entryLevel && parentType === "ExpressionStatement" &&
          topStmt.expression === node;
        const cname = slot === "module.exports"
          ? (isNode(right.id) ? nameOf(right.id) ?? "default" : "default")
          : slot.slice("exports.".length);
        if (right.type === "ObjectExpression") {
          objectDefs.push({
            symbolId: id, members: objectKeyMembers(right), direct: true,
            kind: censusPosition ? "cjs" : "local", stmt: topStmt, inNamespace: !entryLevel,
          });
        } else if (right.type === "ClassExpression" || right.type === "ClassDeclaration") {
          // 旧类入口面只登记匿名 `module.exports = class {…}` 的 default 槽
          collectClassDef(right, id, cname, true,
            censusPosition && slot === "module.exports" && !isNode(right.id));
        } else if (isFunctionValue(right)) {
          const templateKey = left?.computed === true && isNode(left.property) &&
            left.property.type === "TemplateLiteral";
          addEntry(
            cname === "default" ? "default" : cname,
            templateKey ? "template-key" : censusPosition ? "cjs-function" : "cjs-slot",
            right, topStmt,
          );
        } else if (right.type === "Identifier" && slot.startsWith("exports.")) {
          // BUG-002：`exports.greet = boom` 的公共入口名是**槽名** greet，
          // 不是本地函数名 boom。右值是标识符时不登记 ⇒ 该导出在门禁
          // 候选里完全缺席（槽映射解析得到也无人执法）。
          addEntry(cname, "cjs-slot", right, topStmt);
        }
      }
    }

    if (topLevel && type === "ExportNamedDeclaration") {
      const decl = isNode(node.declaration) ? node.declaration : undefined;
      if (decl) {
        const names: BindingName[] = [];
        if (decl.type === "VariableDeclaration" && Array.isArray(decl.declarations)) {
          for (const d of decl.declarations) if (isNode(d)) bindingNamesOf(d.id, names);
        } else if (isNode(decl.id)) {
          const nm = nameOf(decl.id);
          if (nm) names.push({ name: nm, node: decl.id });
        }
        for (const b of names) {
          const id = resolveName(frame, b.name) ?? synthetic(frame, b.name, b.node, "value");
          exportSlots.set(b.name, id);
          if (entryLevel && decl.type === "FunctionDeclaration") addEntry(b.name, "function", decl, topStmt);
          if (decl.type === "ClassDeclaration") {
            if (entryLevel) addEntry(b.name, "class", decl, topStmt);
            collectClassDef(decl, id, b.name, true, entryLevel);
          }
        }
      }
      const specs = node.specifiers;
      if (Array.isArray(specs)) {
        for (const s of specs) {
          if (!isNode(s) || s.type !== "ExportSpecifier") continue;
          const local = isNode(s.local) ? nameOf(s.local) : undefined;
          const exportedNode = isNode(s.exported) ? s.exported : undefined;
          const exported = exportedNode
            ? nameOf(exportedNode) ?? (typeof exportedNode.value === "string" ? String(exportedNode.value) : undefined)
            : undefined;
          if (!exported) continue;
          const fromSource = isNode(node.source) && typeof node.source.value === "string";
          const id = fromSource
            ? synthetic(frame, `reexport:${exported}`, s, "reexport")
            : local
              ? resolveName(frame, local) ?? synthetic(frame, local, s, "reexport")
              : undefined;
          if (id) exportSlots.set(exported, id);
        }
      }
    }

    if (topLevel && type === "ExportDefaultDeclaration") {
      const d = isNode(node.declaration) ? node.declaration : undefined;
      if (d) {
        let id: SymbolId;
        if (d.type === "Identifier") {
          const nm = nameOf(d) ?? "default";
          id = resolveName(frame, nm) ?? synthetic(frame, nm, d, "value");
        } else {
          id = synthetic(frame, "default", d, "value");
        }
        exportSlots.set("default", id);
        if (d.type === "ObjectExpression") {
          objectDefs.push({
            symbolId: id, members: objectKeyMembers(d), direct: true,
            kind: "default", stmt: node, inNamespace: !entryLevel,
          });
        } else if (d.type === "ClassExpression" || d.type === "ClassDeclaration") {
          const nm = isNode(d.id) ? nameOf(d.id) ?? "default" : "default";
          collectClassDef(d, id, nm, true,
            entryLevel && d.type === "ClassDeclaration" && isNode(d.id));
        } else if (isFunctionValue(d)) {
          if (entryLevel) addEntry("default", "default-function", d, node);
        }
      }
    }

    if (topLevel && type === "VariableDeclarator") {
      const idNode = isNode(node.id) ? node.id : undefined;
      const init = isNode(node.init) ? node.init : undefined;
      const names: BindingName[] = [];
      bindingNamesOf(node.id, names);
      const singleBinding = idNode?.type === "Identifier";
      for (const b of names) {
        const symId = resolveName(frame, b.name) ?? declare(frame, b.name, b.node, "const");
        if (entryLevel && init && isFunctionValue(init)) {
          addEntry(b.name, singleBinding ? "function-value" : "destructured", init, topStmt);
        }
        if (init && (init.type === "ClassExpression" || init.type === "ClassDeclaration")) {
          collectClassDef(init, symId, b.name, false, false);
        }
        if (init && init.type === "ObjectExpression" && singleBinding) {
          objectDefs.push({
            symbolId: symId, members: objectKeyMembers(init), direct: false,
            kind: topStmt.type === "ExportNamedDeclaration" ? "declaration" : "local",
            stmt: topStmt, inNamespace: !entryLevel,
          });
        }
      }
      if (entryLevel && idNode && idNode.type !== "Identifier" && init) {
        for (const n of destructureFunctionNames(idNode, init)) addEntry(n, "destructured", init, topStmt);
      }
    }

    if (topLevel && (type === "ClassDeclaration" || type === "ClassExpression")) {
      if (parentType !== "VariableDeclarator" && parentType !== "AssignmentExpression" &&
          parentType !== "ExportDefaultDeclaration" && parentType !== "ExportNamedDeclaration") {
        const nm = isNode(node.id) ? nameOf(node.id) : undefined;
        if (nm) {
          const id = resolveName(frame, nm) ?? synthetic(frame, nm, node, "class");
          collectClassDef(node, id, nm, false, false);
        }
      }
    }

    // 作用域：函数 / 块 / catch / 循环各自建 frame，绑定先登记再遍历子节点。
    let nextFrame = frame;
    if (FUNCTION_TYPES.has(type)) {
      nextFrame = childFrame(node, frame);
      if (Array.isArray(node.params)) {
        for (const p of node.params) {
          const names: BindingName[] = [];
          bindingNamesOf(p, names);
          for (const b of names) declare(nextFrame, b.name, b.node, "param");
        }
      }
      const body = isNode(node.body) ? node.body : undefined;
      if (body?.type === "BlockStatement" && Array.isArray(body.body)) {
        collectDeclarations(body.body, nextFrame);
      }
    } else if (type === "BlockStatement" && !FUNCTION_TYPES.has(parentType)) {
      nextFrame = childFrame(node, frame);
      if (Array.isArray(node.body)) collectDeclarations(node.body, nextFrame);
    } else if (type === "CatchClause") {
      nextFrame = childFrame(node, frame);
      if (isNode(node.param)) {
        const names: BindingName[] = [];
        bindingNamesOf(node.param, names);
        for (const b of names) declare(nextFrame, b.name, b.node, "catch");
      }
    } else if (type === "ForStatement" || type === "ForOfStatement" || type === "ForInStatement") {
      nextFrame = childFrame(node, frame);
      const head = type === "ForStatement" ? node.init : node.left;
      if (isNode(head) && head.type === "VariableDeclaration" && Array.isArray(head.declarations)) {
        for (const d of head.declarations) {
          if (!isNode(d)) continue;
          const names: BindingName[] = [];
          bindingNamesOf(d.id, names);
          for (const b of names) declare(nextFrame, b.name, b.node, "loop");
        }
      }
    }

    if (type === "Program" && Array.isArray(node.body)) {
      collectDeclarations(node.body, root);
    }

    const outerStmt = topStmt;
    const outerDepth = namespaceDepth;
    if (parentType === "Program") topStmt = node;
    if (type === "TSModuleDeclaration") namespaceDepth++;
    for (const child of childrenOf(node)) {
      visit(child.node, nextFrame, type, child.key);
    }
    topStmt = outerStmt;
    namespaceDepth = outerDepth;
  }

  visit(rootNode, root, "", "");

  // —— 旧普查面的回放计划（只定形态与顺序，登记在 pass 3）——
  /** 旧口径的「本地类」：顶层 `class C` 语句，或绑定到类表达式的顶层标识符。 */
  const localClassByName = new Map<string, ClassDef>();
  const classDefOf = (node: AnyNode | undefined): ClassDef | undefined =>
    isNode(node) ? classDefByNode.get(node) : undefined;
  for (const raw of programBody) {
    if (raw.type === "ClassDeclaration") {
      const def = classDefOf(raw);
      const nm = nameOf(raw.id);
      if (def && nm) localClassByName.set(nm, def);
    } else if (raw.type === "VariableDeclaration" ||
        ((raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration") &&
          isNode(raw.declaration) && raw.declaration.type === "VariableDeclaration")) {
      const vd = raw.type === "VariableDeclaration" ? raw : raw.declaration!;
      for (const d of (vd.declarations ?? []) as AnyNode[]) {
        if (!isNode(d) || !isNode(d.id) || d.id.type !== "Identifier" || !isNode(d.init) ||
          d.init.type !== "ClassExpression") continue;
        const nm = nameOf(d.id);
        const def = classDefOf(d.init);
        if (nm && def && !localClassByName.has(nm)) localClassByName.set(nm, def);
      }
    }
  }
  const localClassOf = (name: string | undefined): ClassDef | undefined =>
    name ? localClassByName.get(name) : undefined;
  const declOf = (stmt: AnyNode): AnyNode | undefined =>
    stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration"
      ? (isNode(stmt.declaration) ? stmt.declaration : undefined)
      : undefined;
  /**
   * 类方法触发器（与旧函数普查面同序）：T1 按语句序（`export const C = class` /
   * `export const svc = new Svc()` / `export class C`），T2 `export { C }` 说明符，
   * T3 `export default C`。同名类只在首次触发时登记方法；`nameListed` 与触发
   * 去重无关——旧类入口面按各自的导出形态独立登记类名。
   */
  const censusSteps: CensusStep[] = [];
  const triggered = new Set<string>();
  const triggerClass = (def: ClassDef | undefined, nameListed: boolean): void => {
    if (!def) return;
    if (nameListed) def.nameListed = true;
    if (triggered.has(def.cname)) return;
    triggered.add(def.cname);
    def.methodsListed = true;
    censusSteps.push({ kind: "class", def });
  };
  for (const stmt of programBody) {
    const decl = declOf(stmt);
    if (!decl) continue;
    if (stmt.type === "ExportDefaultDeclaration" && decl.type === "FunctionDeclaration" &&
      !isNode(decl.id)) {
      // export default function (…)：匿名函数声明的普查名是 default
      censusSteps.push({ kind: "default-function", node: decl, stmt });
    }
    if (decl.type === "ClassDeclaration" && isNode(decl.id)) {
      triggerClass(classDefOf(decl), true);
    } else if (decl.type === "VariableDeclaration" && stmt.type === "ExportNamedDeclaration") {
      for (const d of (decl.declarations ?? []) as AnyNode[]) {
        const init = isNode(d) && isNode(d.id) && d.id.type === "Identifier" && isNode(d.init)
          ? d.init
          : undefined;
        if (!init) continue;
        if (init.type === "ClassExpression") triggerClass(classDefOf(init), true);
        else if (init.type === "NewExpression") {
          const callee = isNode(init.callee) ? init.callee : undefined;
          triggerClass(
            callee?.type === "Identifier" ? localClassOf(nameOf(callee)) : undefined, false,
          );
        } else if (init.type === "ObjectExpression") {
          censusSteps.push({ kind: "object", obj: init, esm: true, stmt });
        }
      }
    }
  }
  for (const stmt of programBody) {
    const decl = declOf(stmt);
    if (stmt.type === "ExportNamedDeclaration" && !decl) {
      for (const s of (stmt.specifiers ?? []) as AnyNode[]) {
        if (!isNode(s) || s.type !== "ExportSpecifier" || !isNode(s.local)) continue;
        const def = localClassOf(nameOf(s.local));
        triggerClass(def, def?.node.type === "ClassDeclaration");
      }
    } else if (stmt.type === "ExportDefaultDeclaration" && decl?.type === "Identifier") {
      const def = localClassOf(nameOf(decl));
      triggerClass(def, def?.node.type === "ClassDeclaration");
    }
  }
  for (const stmt of programBody) {
    if (stmt.type !== "ExpressionStatement" || !isNode(stmt.expression)) continue;
    const expr = stmt.expression;
    if (expr.type !== "AssignmentExpression") continue;
    const left = isNode(expr.left) ? expr.left : undefined;
    const right = isNode(expr.right) ? expr.right : undefined;
    if (!right || !isModuleExportsNode(left)) continue;
    if (right.type === "ObjectExpression") {
      censusSteps.push({ kind: "object", obj: right, esm: false, stmt });
    } else if ((right.type === "ClassExpression" || right.type === "ClassDeclaration") &&
      isNode(right.id)) {
      // 旧类入口面：具名 `module.exports = class C {…}` 另登记默认导出槽名 default
      censusSteps.push({ kind: "cjs-default-class", node: right, stmt });
    }
  }

  // Pass 2：只有被导出（或 default 形态）的类/对象成员才进公共入口表。
  const exportedIds = new Set(exportSlots.values());
  for (const def of classDefs) {
    if (def.inNamespace) continue;
    if (!(def.direct || exportedIds.has(def.symbolId) || def.cname === "default")) continue;
    addEntry(def.cname, def.nameListed ? "class" : "class-value", def.node, def.stmt);
    for (const k of def.keys) {
      addEntry(`${def.cname}.${k.key}`, classMethodFormOf(def, k.node), k.node, def.stmt);
    }
  }
  /** 旧普查面的模块级绑定名（BUG-358 判据）；只在有随声明导出的对象时计算。 */
  let censusModuleBindings: Set<string> | undefined;
  for (const def of objectDefs) {
    if (def.inNamespace) continue;
    if (!(def.direct || exportedIds.has(def.symbolId))) continue;
    for (const m of def.members) {
      let form: EntryForm = "object-member";
      if (censusObjectKeyOf(m.node) === undefined) form = "template-key";
      else if (def.kind === "default" || def.kind === "local") form = "object-member-indirect";
      else if (def.kind === "declaration") {
        censusModuleBindings ??= moduleBindingsOf(programBody);
        if (censusModuleBindings.has(m.key)) form = "object-member-collision";
      }
      addEntry(m.key, form, m.node, def.stmt);
    }
  }

  // Pass 3：旧普查面的补位（计划见 censusSteps；登记序与旧普查面一致）。
  for (const step of censusSteps) {
    if (step.kind === "class") {
      for (const m of censusMethodsOf(step.def)) {
        addEntry(`${step.def.cname}.${m.key}`, "class-method", m.node, step.def.stmt);
      }
    } else if (step.kind === "object") {
      for (const m of objectKeyMembers(step.obj, censusObjectKeyOf)) {
        // BUG-358：只在 ESM 随声明导出的分支生效（CJS `module.exports = {…}` 不排除）
        censusModuleBindings ??= moduleBindingsOf(programBody);
        if (step.esm && censusModuleBindings.has(m.key)) continue;
        addEntry(m.key, "object-member", m.node, step.stmt);
      }
    } else if (step.kind === "default-function") {
      addEntry("default", "default-function", step.node, step.stmt);
    } else {
      addEntry("default", "class", step.node, step.stmt);
    }
  }

  const entries = entryInfos.map((e) => e.name);

  /** 类方法入口键的形态：旧普查面登记 ⇔ 类在触发器名单里，且键是它认的键形态。 */
  function classMethodFormOf(def: ClassDef, member: AnyNode): EntryForm {
    if (memberKeyNameOf(member, literalConsts) === undefined) return "template-key";
    const isMethod = member.type === "ClassMethod" || member.type === "MethodDefinition";
    return isMethod && def.methodsListed ? "class-method" : "class-value-method";
  }

  /**
   * 模块级**绑定名**（BUG-358 判据，旧普查面口径）：导入的本地名、函数 / 类 /
   * 枚举声明名、单标识符声明的变量名。
   */
  function moduleBindingsOf(body: readonly AnyNode[]): Set<string> {
    const out = new Set<string>();
    for (const stmt of body) {
      if (stmt.type === "ImportDeclaration") {
        for (const spec of (stmt.specifiers ?? []) as AnyNode[]) {
          const local = isNode(spec) && isNode(spec.local) ? nameOf(spec.local) : undefined;
          if (local) out.add(local);
        }
        continue;
      }
      const decl = declOf(stmt) ?? stmt;
      const id = isNode(decl.id) ? nameOf(decl.id) : undefined;
      if ((decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration" ||
          decl.type === "TSEnumDeclaration") && id) {
        out.add(id);
      } else if (decl.type === "VariableDeclaration") {
        for (const d of (decl.declarations ?? []) as AnyNode[]) {
          const did = isNode(d) && isNode(d.id) ? d.id : undefined;
          if (did?.type === "Identifier") {
            const nm = nameOf(did);
            if (nm) out.add(nm);
          }
        }
      }
    }
    return out;
  }

  /**
   * 旧函数普查面登记的类方法键（按其顺序）：own 方法（含 BUG-385 计算键、
   * TSDeclareMethod）→ 沿 superClass 链的继承方法（Bug 64，子类 own 覆盖同名）
   * → 同名静态 / 实例方法只留实例（Bug 437）。
   */
  function censusMethodsOf(def: ClassDef): MemberRef[] {
    interface Method extends MemberRef {
      isStatic: boolean;
    }
    const read = (cls: AnyNode, out: Method[]): void => {
      const classBody = isNode(cls.body) && Array.isArray(cls.body.body) ? cls.body.body : [];
      for (const m of classBody) {
        if (!isNode(m)) continue;
        if (m.type !== "MethodDefinition" && m.type !== "ClassMethod" &&
          m.type !== "TSDeclareMethod") continue;
        if (m.kind && m.kind !== "method") continue;
        const key = memberKeyNameOf(m, literalConsts);
        if (key) out.push({ key, node: m, isStatic: m.static === true });
      }
    };
    const methods: Method[] = [];
    read(def.node, methods);
    const ownKeys = new Set(methods.map((m) => m.key));
    const seen = new Set<string>([def.cname]);
    let base = localClassOf(superClassNameOf(def.node));
    while (base && !seen.has(base.cname)) {
      seen.add(base.cname);
      const inherited: Method[] = [];
      read(base.node, inherited);
      for (const m of inherited) {
        if (ownKeys.has(m.key)) continue;
        ownKeys.add(m.key);
        methods.push(m);
      }
      base = localClassOf(superClassNameOf(base.node));
    }
    const instanceKeys = new Set<string>();
    for (const m of methods) if (!m.isStatic) instanceKeys.add(m.key);
    return methods.filter((m) => !(m.isStatic && instanceKeys.has(m.key)));
  }

  function collectExportSlotInfos(): void {
    const add = (
      slot: string | undefined,
      local: string,
      kind: ExportSlotKind,
      reexport?: { source: string; imported: string },
      exportedNode?: AnyNode,
    ): void => {
      if (!slot || exportSlotInfos.has(slot)) return;
      exportSlotInfos.set(slot, {
        slot, local, kind,
        ...(reexport ? { source: reexport.source, imported: reexport.imported } : {}),
        ...(exportedNode ? { exportedNode: exportedNode as unknown as Node } : {}),
      });
    };
    const sourceText = (n: AnyNode | undefined): string | undefined =>
      n && typeof n.value === "string" ? n.value : undefined;
    const textName = (n: AnyNode | undefined): string | undefined => {
      if (!n) return undefined;
      if (typeof n.name === "string") return n.name;
      if (typeof n.value === "string" || typeof n.value === "number") return String(n.value);
      return undefined;
    };
    const patternNames = (id: AnyNode | undefined): string[] => {
      if (!id) return [];
      const names: BindingName[] = [];
      bindingNamesOf(id, names);
      return names.map((b) => b.name);
    };
    const cjsKey = (left: AnyNode | undefined): string | undefined => {
      const slot = cjsSlotOf(left);
      if (!slot || slot === "module.exports") return undefined;
      return slot.startsWith("exports.") ? slot.slice("exports.".length) : undefined;
    };
    const body = programBody;
    for (const stmt of body) {
      if (!isNode(stmt)) continue;
      if (stmt.type === "ExportAllDeclaration") {
        const ns = textName(isNode(stmt.exported) ? stmt.exported : undefined);
        const source = sourceText(isNode(stmt.source) ? stmt.source : undefined);
        add(ns, "", "reexport", source ? { source, imported: "*" } : undefined);
        continue;
      }
      if (stmt.type === "ExportNamedDeclaration") {
        const from = isNode(stmt.source) ? stmt.source : undefined;
        const specs = Array.isArray(stmt.specifiers) ? stmt.specifiers : [];
        if (from) {
          const source = sourceText(from);
          for (const spec of specs) {
            if (!isNode(spec)) continue;
            if (spec.type === "ExportNamespaceSpecifier") {
              add(
                textName(isNode(spec.exported) ? spec.exported : undefined),
                "",
                "reexport",
                source ? { source, imported: "*" } : undefined,
              );
            } else if (spec.type === "ExportSpecifier") {
              const imported = textName(isNode(spec.local) ? spec.local : undefined);
              add(
                textName(isNode(spec.exported) ? spec.exported : undefined),
                "",
                "reexport",
                source && imported ? { source, imported } : undefined,
              );
            }
          }
          continue;
        }
        const decl = isNode(stmt.declaration) ? stmt.declaration : undefined;
        if (decl) {
          if (
            decl.type === "FunctionDeclaration" ||
            decl.type === "ClassDeclaration" ||
            decl.type === "TSEnumDeclaration" ||
            decl.type === "TSDeclareFunction"
          ) {
            const id = textName(isNode(decl.id) ? decl.id : undefined);
            if (id) add(id, id, "value");
          } else if (decl.type === "VariableDeclaration" && Array.isArray(decl.declarations)) {
            for (const d of decl.declarations) {
              if (!isNode(d)) continue;
              for (const n of patternNames(isNode(d.id) ? d.id : undefined)) add(n, n, "value");
            }
          } else if (decl.type === "TSModuleDeclaration") {
            const id = textName(isNode(decl.id) ? decl.id : undefined);
            if (id) add(id, id, "namespace");
          }
          continue;
        }
        for (const spec of specs) {
          if (!isNode(spec)) continue;
          if (spec.type === "ExportNamespaceSpecifier") {
            add(textName(isNode(spec.exported) ? spec.exported : undefined), "", "namespace");
          } else if (spec.type === "ExportSpecifier") {
            const local = textName(isNode(spec.local) ? spec.local : undefined);
            const exported = textName(isNode(spec.exported) ? spec.exported : undefined);
            if (exported && local) {
              const typeOnly =
                stmt.exportKind === "type" || (spec as { exportKind?: string }).exportKind === "type";
              add(
                exported,
                local,
                typeOnly ? "type" : "value",
                undefined,
                isNode(spec.exported) ? spec.exported : undefined,
              );
            }
          }
        }
        continue;
      }
      if (stmt.type === "ExportDefaultDeclaration") {
        const decl = isNode(stmt.declaration) ? stmt.declaration : undefined;
        if (!decl) {
          add("default", "", "default");
          continue;
        }
        if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
          add("default", textName(isNode(decl.id) ? decl.id : undefined) ?? "", "default");
        } else if (
          decl.type === "ArrowFunctionExpression" ||
          decl.type === "FunctionExpression"
        ) {
          add("default", "", "default");
        } else if (decl.type === "Identifier") {
          add("default", textName(decl) ?? "", "default");
        } else if (
          decl.type !== "TSInterfaceDeclaration" &&
          decl.type !== "TSTypeAliasDeclaration"
        ) {
          add("default", "_default", "default");
        }
        continue;
      }
      if (stmt.type === "ExpressionStatement") {
        const expr = isNode(stmt.expression) ? stmt.expression : undefined;
        if (!expr || expr.type !== "AssignmentExpression" || expr.operator !== "=") continue;
        const left = isNode(expr.left) ? expr.left : undefined;
        const right = isNode(expr.right) ? expr.right : undefined;
        if (!left || !right) continue;
        const prop = cjsKey(left);
        if (prop && prop !== "default") {
          add(prop, prop, "cjs");
          continue;
        }
        if (!isModuleExportsNode(left)) continue;
        if (right.type === "ObjectExpression") {
          const props = Array.isArray(right.properties) ? right.properties : [];
          for (const p of props) {
            if (!isNode(p)) continue;
            const key = staticKeyOf(p.key, p.computed === true);
            if (!key || key === "default") continue;
            add(key, key, "cjs");
          }
          continue;
        }
        if (right.type === "Identifier") {
          const n = textName(right);
          if (n) add(n, n, "cjs");
          continue;
        }
        add("default", "", "cjs");
      }
    }
  }

  collectExportSlotInfos();

  return {
    symbols, refs, refByOffset, exportSlots, exportSlotInfos, imports, declarations, entries,
    entryInfos, members, memberNodes, classNodeIds, classBodyNodes, namespaceBodyNodes, spans, calls,
  };
}
