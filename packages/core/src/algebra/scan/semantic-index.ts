/**
 * SemanticIndex —— ADR 0001 阶段 0 骨架（core/algebra/scan）。
 *
 * 一次 binding 产出的**纯数据**索引：以身份（`SymbolId`）取代字符串名字作为
 * 跨面引用的唯一键。本文件不参与求值、`leqAbs`、`formatShape`，也不是值 IR
 * ——Abs 仍是唯一类型表示（CLAUDE.md:9 / kernel-merge.md）。
 *
 * 阶段 0 范围（ADR §10 决议 5）：仅 ESM / CJS 主路径的导出槽与入口形态；
 * namespace、`.ts` 参数属性、完整块级作用域链留阶段 1。
 * **零行为变更（阶段 0）**：彼时仅由影子对拍测试消费；阶段 1 起经
 * `@nudojs/core/internal` 供 `check` / service 只读，但两个开关默认关闭，
 * 关闭时不会构建索引（见 `entry-face-shadow.ts`）。
 *
 * 与 ADR 的两处实施细化（见 ADR §13 实施记录）：
 * - 缓存用 WeakMap<File, SemanticIndex> 而非修改 parseSource 的 LRU —— 同样
 *   保证「索引与 AST 同生命周期」，且阶段 0 保持纯新增文件、可独立 revert。
 * - 解构模式收集与 `scope-collect.ts::collectPatternNames` 同形实现，未直接
 *   import，避免 algebra/scan → exec/transpile 的反向依赖与该模块的加载副作用。
 */
import type { File } from "@babel/types";

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

export interface SemanticIndex {
  readonly symbols: ReadonlyMap<SymbolId, SymbolInfo>;
  /** NodeId = `${scopeUid}@${start}`；每个 Identifier 引用 → 绑定身份。 */
  readonly refs: ReadonlyMap<NodeId, SymbolId>;
  /** 便利查询：源码 offset → 绑定身份（与 refs 同源，不是第二份事实）。 */
  readonly refByOffset: ReadonlyMap<number, SymbolId>;
  readonly exportSlots: ReadonlyMap<ExportSlot, SymbolId>;
  readonly entries: readonly EntryId[];
  readonly members: ReadonlyMap<SymbolId, MemberTable>;
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

interface ClassDef {
  cname: string;
  symbolId: SymbolId;
  keys: string[];
  direct: boolean;
}

interface ObjectDef {
  symbolId: SymbolId;
  keys: string[];
  direct: boolean;
}

function buildIndex(file: File): SemanticIndex {
  const symbols = new Map<SymbolId, SymbolInfo>();
  const refs = new Map<NodeId, SymbolId>();
  const refByOffset = new Map<number, SymbolId>();
  const exportSlots = new Map<ExportSlot, SymbolId>();
  const members = new Map<SymbolId, MemberTable>();
  const spans: LexicalSpan[] = [];
  const calls: CallSiteInfo[] = [];
  const entries: EntryId[] = [];
  const classDefs: ClassDef[] = [];
  const objectDefs: ObjectDef[] = [];
  const declNodes = new WeakSet<object>();
  const seenDefs = new Set<string>();
  const root: Frame = { uid: "m", parent: undefined, bindings: new Map() };

  const rootNode = file as unknown as AnyNode;
  const comments = (file as unknown as { comments?: unknown[] }).comments;
  if (Array.isArray(comments)) {
    for (const c of comments) {
      if (isNode(c)) spans.push({ start: startOf(c), end: endOf(c), kind: "comment" });
    }
  }

  function addEntry(n: string | undefined): void {
    if (n && !entries.includes(n)) entries.push(n);
  }

  function declare(frame: Frame, name: string, node: AnyNode, kind: SymbolKind): SymbolId {
    const id = symbolIdOf(frame.uid, startOf(node), name);
    declNodes.add(node);
    if (!symbols.has(id)) {
      symbols.set(id, { id, name, kind, scopeUid: frame.uid, declarationStart: startOf(node) });
    }
    if (!frame.bindings.has(name)) frame.bindings.set(name, id);
    return id;
  }

  function synthetic(frame: Frame, name: string, node: AnyNode, kind: SymbolKind): SymbolId {
    const id = symbolIdOf(frame.uid, startOf(node), name);
    if (!symbols.has(id)) {
      symbols.set(id, { id, name, kind, scopeUid: frame.uid, declarationStart: startOf(node) });
    }
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
        for (const s of n.specifiers) {
          if (!isNode(s) || !isNode(s.local)) continue;
          const nm = nameOf(s.local);
          if (nm) declare(frame, nm, s.local, "import");
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

  function memberTableOf(decl: AnyNode): MemberTable & { keys: string[] } {
    const table = {
      ownFields: [] as string[],
      protoMethods: [] as string[],
      staticMembers: [] as string[],
      accessors: [] as string[],
      keys: [] as string[],
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
    decl: AnyNode, ownerId: SymbolId, cname: string, direct: boolean,
  ): void {
    const dedup = `${ownerId}#${cname}`;
    if (seenDefs.has(dedup)) return;
    seenDefs.add(dedup);
    const table = memberTableOf(decl);
    members.set(ownerId, {
      ownFields: table.ownFields, protoMethods: table.protoMethods,
      staticMembers: table.staticMembers, accessors: table.accessors,
    });
    classDefs.push({ cname, symbolId: ownerId, keys: table.keys, direct });
  }

  function objectPropertyKeys(obj: AnyNode): string[] {
    const out: string[] = [];
    if (!Array.isArray(obj.properties)) return out;
    for (const p of obj.properties) {
      if (!isNode(p)) continue;
      // BUG-996 同口径：getter / setter 是访问器，不是可调用入口。
      // `isFunctionValue(p)` 对 ObjectMethod 恒为 true，只看 type 会把
      // `get f() {}` / `set f(v) {}` 登记成入口 ⇒ check 造出假的
      // `nudo:entry-may-throw` / `nudo:opaque-result`（与 service 侧
      // `analyzer-ast.ts` 的 `prop.kind !== "method"` 判据一致）。
      const kind = typeof p.kind === "string" ? p.kind : "method";
      if (kind === "get" || kind === "set") continue;
      const keyName = staticKeyOf(p.key, p.computed === true);
      if (!keyName) continue;
      if (isFunctionValue(p) || isFunctionValue(p.value)) out.push(keyName);
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
    if (topLevel && type === "FunctionDeclaration" && isNode(node.id)) {
      const nm = nameOf(node.id);
      if (nm) addEntry(nm);
    }

    if (topLevel && type === "AssignmentExpression") {
      const left = isNode(node.left) ? node.left : undefined;
      const right = isNode(node.right) ? node.right : undefined;
      const slot = cjsSlotOf(left);
      if (slot && right) {
        const id = localOrSynthetic(frame, right, slot);
        exportSlots.set(slot, id);
        const cname = slot === "module.exports"
          ? (isNode(right.id) ? nameOf(right.id) ?? "default" : "default")
          : slot.slice("exports.".length);
        if (right.type === "ObjectExpression") {
          objectDefs.push({ symbolId: id, keys: objectPropertyKeys(right), direct: true });
        } else if (right.type === "ClassExpression" || right.type === "ClassDeclaration") {
          collectClassDef(right, id, cname, true);
        } else if (isFunctionValue(right)) {
          addEntry(cname === "default" ? "default" : cname);
        } else if (right.type === "Identifier" && slot.startsWith("exports.")) {
          // BUG-002：`exports.greet = boom` 的公共入口名是**槽名** greet，
          // 不是本地函数名 boom。右值是标识符时不登记 ⇒ 该导出在门禁
          // 候选里完全缺席（槽映射解析得到也无人执法）。
          addEntry(cname);
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
          if (decl.type === "FunctionDeclaration" || isFunctionValue((decl as AnyNode).init)) {
            addEntry(b.name);
          }
          if (decl.type === "ClassDeclaration") {
            addEntry(b.name);
            collectClassDef(decl, id, b.name, true);
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
          objectDefs.push({ symbolId: id, keys: objectPropertyKeys(d), direct: true });
        } else if (d.type === "ClassExpression" || d.type === "ClassDeclaration") {
          const nm = isNode(d.id) ? nameOf(d.id) ?? "default" : "default";
          collectClassDef(d, id, nm, true);
        } else if (isFunctionValue(d)) {
          addEntry("default");
        }
      }
    }

    if (topLevel && type === "VariableDeclarator") {
      const idNode = isNode(node.id) ? node.id : undefined;
      const init = isNode(node.init) ? node.init : undefined;
      const names: BindingName[] = [];
      bindingNamesOf(node.id, names);
      for (const b of names) {
        const symId = resolveName(frame, b.name) ?? declare(frame, b.name, b.node, "const");
        if (init && isFunctionValue(init)) addEntry(b.name);
        if (init && (init.type === "ClassExpression" || init.type === "ClassDeclaration")) {
          collectClassDef(init, symId, b.name, false);
        }
        if (init && init.type === "ObjectExpression" && idNode?.type === "Identifier") {
          objectDefs.push({ symbolId: symId, keys: objectPropertyKeys(init), direct: false });
        }
      }
      if (idNode && idNode.type !== "Identifier" && init) {
        for (const n of destructureFunctionNames(idNode, init)) addEntry(n);
      }
    }

    if (topLevel && (type === "ClassDeclaration" || type === "ClassExpression")) {
      if (parentType !== "VariableDeclarator" && parentType !== "AssignmentExpression" &&
        parentType !== "ExportDefaultDeclaration" && parentType !== "ExportNamedDeclaration") {
        const nm = isNode(node.id) ? nameOf(node.id) : undefined;
        if (nm) {
          const id = resolveName(frame, nm) ?? synthetic(frame, nm, node, "class");
          collectClassDef(node, id, nm, false);
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

    for (const child of childrenOf(node)) {
      visit(child.node, nextFrame, type, child.key);
    }
  }

  visit(rootNode, root, "", "");

  // Pass 2：只有被导出（或 default 形态）的类/对象成员才进公共入口表。
  const exportedIds = new Set(exportSlots.values());
  for (const def of classDefs) {
    if (!(def.direct || exportedIds.has(def.symbolId) || def.cname === "default")) continue;
    addEntry(def.cname);
    for (const k of def.keys) addEntry(`${def.cname}.${k}`);
  }
  for (const def of objectDefs) {
    if (!(def.direct || exportedIds.has(def.symbolId))) continue;
    for (const k of def.keys) addEntry(k);
  }

  return {
    symbols, refs, refByOffset, exportSlots, entries, members, spans, calls,
  };
}
