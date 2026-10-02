/**
 * body-read 字段类型推断（草稿 / quickfix 自动填类型）。
 *
 * 证据只来自函数体对形参成员的用法（`node.type === "x" → string()`），
 * **不进 check**——与 DraftEvidence body 档同口径。无用法证据 → any()，
 * 不得发明空 shape 或武断 string()。
 *
 * 收集的是**完整成员路径**（`node.loc.start.line` → ["loc","start","line"]）：
 * 被继续解引用的中间环生成为嵌套 shape（`loc: shape({ start: … })`），
 * 只有叶子环才携带用法推断类型。中间环写 any() 会让"读它的属性"继续
 * counted 为 may-throw——动作自废（见 #76）。
 */
import { parse } from "@nudojs/parser";
import type { Node } from "@babel/types";

export type BodyReadField = {
  field: string;
  /** constraint-builder DSL：string() / number() / boolean() / any()；
   *  中间环（字段被继续解引用）为占位 "shape({ … })"，真实文本由
   *  shapeDslFromFields 经 fields 递归生成 */
  type: string;
  /** 推断依据（调试/草稿注释） */
  via: string;
  /** 继续解引用的子字段（该字段值是对象）；叶子无此键。
   *  中间环不得写 any()——any 值上的成员读取仍记 may-throw（L2 不清） */
  fields?: BodyReadField[];
};

export type BodyReadTypes = Map<string, Map<string, BodyReadField[]>>;

type UseHint = { type: string; via: string };

const STRING_METHODS = new Set([
  "toLowerCase", "toUpperCase", "trim", "trimStart", "trimEnd",
  "slice", "substring", "substr", "charAt", "charCodeAt", "codePointAt",
  "includes", "startsWith", "endsWith", "split", "replace", "replaceAll",
  "repeat", "padStart", "padEnd", "normalize", "concat", "match", "matchAll",
  "search", "at", "indexOf", "lastIndexOf",
]);
const NUMBER_METHODS = new Set([
  "toFixed", "toPrecision", "toExponential", "valueOf",
]);
const ARRAY_METHODS = new Set([
  "map", "filter", "reduce", "forEach", "find", "findIndex", "some", "every",
  "push", "pop", "shift", "unshift", "sort", "reverse", "join", "flat",
  "flatMap", "includes", "indexOf", "slice", "splice", "concat",
]);

function keyOf(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Identifier") return (node as { name: string }).name;
  if (node.type === "StringLiteral") return (node as { value: string }).value;
  return undefined;
}

function litKind(node: Node | undefined): "string" | "number" | "boolean" | undefined {
  if (!node) return undefined;
  if (node.type === "StringLiteral") return "string";
  if (node.type === "NumericLiteral") return "number";
  if (node.type === "BooleanLiteral") return "boolean";
  return undefined;
}

/** 用法 → 类型提示。parent 是包含 `param.field` 的表达式。 */
function hintFromUse(
  parent: Record<string, unknown> | undefined,
  key: "left" | "right" | "object" | "callee" | "argument" | "test" | "init",
): UseHint | undefined {
  if (!parent) return undefined;
  const t = parent.type as string | undefined;

  // param.field === "x" / !== / ==  — 与字面量比较
  if (t === "BinaryExpression") {
    const op = parent.operator as string;
    const other =
      key === "left" ? (parent.right as Node | undefined) : (parent.left as Node | undefined);
    const lk = litKind(other);
    if (op === "===" || op === "==" || op === "!==" || op === "!=") {
      if (lk === "string") return { type: "string()", via: "compare string lit" };
      if (lk === "number") return { type: "number()", via: "compare number lit" };
      if (lk === "boolean") return { type: "boolean()", via: "compare boolean lit" };
    }
    if (op === "+" ) {
      if (lk === "number") return { type: "number()", via: "add number" };
      if (lk === "string") return { type: "string()", via: "concat string" };
      return { type: "any()", via: "add (unknown coerce)" };
    }
    if (op === "-" || op === "*" || op === "/" || op === "%" || op === "**") {
      return { type: "number()", via: `arith ${op}` };
    }
    if (op === "<" || op === ">" || op === "<=" || op === ">=") {
      return { type: "number()", via: `rel ${op}` };
    }
    return undefined;
  }

  // !param.field / param.field ? … : …
  if (t === "UnaryExpression" && parent.operator === "!") {
    return { type: "boolean()", via: "truthiness" };
  }

  // param.field.toLowerCase() / .map() / .toFixed()
  if (t === "MemberExpression" || t === "OptionalMemberExpression") {
    const prop = keyOf(parent.property as Node | undefined);
    if (prop && STRING_METHODS.has(prop) && prop !== "includes" && prop !== "indexOf" && prop !== "slice" && prop !== "concat" && prop !== "at") {
      return { type: "string()", via: `.${prop}()` };
    }
    if (prop && NUMBER_METHODS.has(prop)) {
      return { type: "number()", via: `.${prop}()` };
    }
    if (prop === "length") {
      // string 与 array 都有 .length —— 不武断收成 string()
      return { type: "union(string(), array(any()))", via: ".length" };
    }
    if (prop === "size") {
      // Set/Map/TypedArray —— 无进一步证据不收成 string()
      return { type: "any()", via: ".size (Set/Map)" };
    }
    if (prop && ARRAY_METHODS.has(prop)) {
      return { type: "array(any())", via: `.${prop}()` };
    }
    return undefined;
  }

  // String(param.field) / Number(...) / Boolean(...) / Array.isArray(...)
  if (t === "CallExpression" || t === "OptionalCallExpression") {
    const callee = parent.callee as Node | undefined;
    const cname = callee?.type === "Identifier" ? (callee as { name: string }).name : undefined;
    if (cname === "String") return { type: "string()", via: "String()" };
    if (cname === "Number") return { type: "number()", via: "Number()" };
    if (cname === "Boolean") return { type: "boolean()", via: "Boolean()" };
    // Array.isArray 是 MemberExpression callee，不是 Identifier
    if (
      callee?.type === "MemberExpression" &&
      (callee as { object?: Node }).object?.type === "Identifier" &&
      ((callee as { object: { name: string } }).object.name === "Array") &&
      (callee as { property?: Node }).property?.type === "Identifier" &&
      ((callee as { property: { name: string } }).property.name === "isArray")
    ) {
      return { type: "array(any())", via: "Array.isArray" };
    }
    return undefined;
  }

  // typeof param.field === "string"
  if (t === "UnaryExpression" && parent.operator === "typeof") {
    return undefined; // 外层 Binary 会看 typeof 结果
  }

  return undefined;
}

/** typeof x === "string" 的补强 */
function hintFromTypeof(
  typeofNode: Record<string, unknown> | undefined,
  cmp: Record<string, unknown> | undefined,
): UseHint | undefined {
  if (!typeofNode || !cmp) return undefined;
  if (typeofNode.type !== "UnaryExpression" || typeofNode.operator !== "typeof") return undefined;
  if (cmp.type !== "BinaryExpression") return undefined;
  const op = cmp.operator as string;
  if (op !== "===" && op !== "==" && op !== "!==" && op !== "!=") return undefined;
  const other =
    cmp.left === typeofNode ? (cmp.right as Node | undefined) : (cmp.left as Node | undefined);
  const lk = litKind(other);
  if (lk !== "string") return undefined;
  const name = (other as { value?: string } | undefined)?.value;
  const map: Record<string, string> = {
    string: "string()",
    number: "number()",
    boolean: "boolean()",
    object: "any()",
    function: "any()",
    undefined: "any()",
    bigint: "any()",
    symbol: "any()",
  };
  const type = name ? map[name] : undefined;
  if (!type) return undefined;
  return { type, via: `typeof === "${name}"` };
}

/**
 * 收集每个函数形参成员读取 + 用法推断类型。
 * `fnName → paramName → fields[]`
 */
export function collectParamBodyReadTypes(source: string): BodyReadTypes {
  const out: BodyReadTypes = new Map();
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source);
  } catch {
    return out;
  }

  const visitFn = (fnName: string, fnNode: Node, paramNames: Set<string>): void => {
    if (paramNames.size === 0) return;
    /** param → JSON 路径键 → { 路径, hints[] } */
    const byParam = new Map<
      string,
      Map<string, { path: string[]; hints: UseHint[] }>
    >();
    const add = (
      pname: string,
      path: string[],
      hint: UseHint | undefined,
    ): void => {
      if (path.length === 0) return;
      let m = byParam.get(pname);
      if (!m) byParam.set(pname, (m = new Map()));
      const k = JSON.stringify(path);
      let e = m.get(k);
      if (!e) m.set(k, (e = { path, hints: [] }));
      if (hint) e.hints.push(hint);
    };

    /**
     * 从最外层成员表达式向下收集静态键路径，链底须为标识符。
     * `node.a.b`（最外层）→ { path: ["a","b"], param: "node" }。
     * 计算成员（`node.a[b]`）或链底非标识符（`foo().bar`）→ undefined。
     */
    const downChainPath = (
      mem: Record<string, unknown>,
    ): { path: string[]; param: string } | undefined => {
      const keys: string[] = [];
      let cur: Record<string, unknown> | undefined = mem;
      let param: string | undefined;
      while (cur) {
        if (
          (cur.type !== "MemberExpression" &&
            cur.type !== "OptionalMemberExpression") ||
          cur.computed === true
        ) {
          return undefined;
        }
        const key = keyOf(cur.property as Node | undefined);
        if (key === undefined) return undefined;
        keys.unshift(key);
        const obj = cur.object as Node | undefined;
        if (!obj) return undefined;
        if (obj.type === "Identifier") {
          param = obj.name;
          break;
        }
        cur = obj as unknown as Record<string, unknown>;
      }
      if (param === undefined) return undefined;
      return { path: keys, param };
    };

    /** 合成「下一环成员访问」父节点：hintFromUse 只读 type/property */
    const synthMemberParent = (prop: string): Record<string, unknown> =>
      ({ type: "MemberExpression", property: { type: "Identifier", name: prop } });

    const walk = (
      node: unknown,
      shadowed: Set<string>,
      parent?: Record<string, unknown>,
      parentKey?: string,
    ): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (
        (n.type === "VariableDeclarator" || n.type === "FunctionDeclaration") &&
        (n.id as Node | undefined)?.type === "Identifier"
      ) {
        const id = (n.id as { name: string }).name;
        if (paramNames.has(id)) shadowed = new Set(shadowed).add(id);
      }

      // typeof param.a.b === "string"（链：整条路径取同一 typeof 证据）
      if (n.type === "UnaryExpression" && n.operator === "typeof") {
        const arg = n.argument as Node | undefined;
        const mem = arg as Record<string, unknown> | undefined;
        if (mem && (mem.type === "MemberExpression" || mem.type === "OptionalMemberExpression")) {
          const chain = downChainPath(mem);
          if (
            chain &&
            paramNames.has(chain.param) &&
            !shadowed.has(chain.param)
          ) {
            // parent is UnaryExpression; grandparent is BinaryExpression
            const gp = parent;
            add(chain.param, chain.path, hintFromTypeof(n, gp));
          }
        }
      }

      if (n.type === "MemberExpression" || n.type === "OptionalMemberExpression") {
        // 链内环节（父节点是以本节点为 object 的非计算成员访问）跳过——
        // 由链最外层统一收集整条路径（每条链只记一次）
        const innerLink =
          !!parent &&
          (parent.type === "MemberExpression" ||
            parent.type === "OptionalMemberExpression") &&
          parentKey === "object" &&
          (parent as Record<string, unknown>).computed !== true;
        if (innerLink) return;

        // 最外层：向下收集静态键路径，链底须为（未遮蔽的）形参
        const chain = downChainPath(n);
        if (chain && paramNames.has(chain.param) && !shadowed.has(chain.param)) {
          // 逐环判定叶子：下一环的访问若能给出类型证据（方法调用 /
          // .length / …），该环即叶子（链不延伸）；否则为中间环，
          // 生成为嵌套 shape（中间环写 any() 会让 L2 残留——#76）
          const rev = chain.path;
          let leafLen = rev.length;
          let leafHint: UseHint | undefined;
          for (let i = 0; i < rev.length; i++) {
            const nextProp = i + 1 < rev.length ? rev[i + 1]! : undefined;
            const h =
              nextProp !== undefined
                ? hintFromUse(synthMemberParent(nextProp), "object")
                : hintFromUse(parent, (parentKey as "left") ?? "object");
            if (h) {
              leafLen = i + 1;
              leafHint = h;
              break;
            }
          }
          add(chain.param, rev.slice(0, leafLen), leafHint);
        }
      }

      for (const k of Object.keys(n)) {
        if (k === "loc" || k === "start" || k === "end") continue;
        const child = n[k];
        if (Array.isArray(child)) {
          for (const item of child) walk(item, shadowed, n, k);
        } else if (child && typeof child === "object") {
          walk(child, shadowed, n, k);
        }
      }
    };
    walk(fnNode, new Set());

    if (byParam.size === 0) return;
    const fieldsOf = new Map<string, BodyReadField[]>();
    for (const [pname, pathMap] of byParam) {
      // 路径 → trie：有子环的字段是中间环（值为对象 → 嵌套 shape），
      // 叶子环携带用法推断类型
      const root: TrieNode = { hints: [], children: new Map() };
      for (const { path, hints } of pathMap.values()) {
        let node = root;
        for (const seg of path) {
          let child = node.children.get(seg);
          if (!child) {
            node.children.set(seg, (child = { hints: [], children: new Map() }));
          }
          node = child;
        }
        node.hints.push(...hints);
      }
      fieldsOf.set(pname, emitFields(root));
    }
    out.set(fnName, fieldsOf);
  };

  const paramSet = (fnNode: Node): Set<string> => {
    const names = new Set<string>();
    const params = (fnNode as { params?: Node[] }).params ?? [];
    for (const p of params) {
      if (!p) continue;
      if (p.type === "Identifier") names.add(p.name);
      else if (p.type === "AssignmentPattern" && (p.left as Node)?.type === "Identifier") {
        names.add((p.left as { name: string }).name);
      } else if (p.type === "RestElement" && (p.argument as Node)?.type === "Identifier") {
        names.add((p.argument as { name: string }).name);
      } else if (p.type === "ObjectPattern") {
        for (const prop of (p as { properties?: Node[] }).properties ?? []) {
          if (prop.type === "ObjectProperty") {
            const v = prop.value as Node;
            if (v.type === "Identifier") names.add(v.name);
            else if (v.type === "AssignmentPattern" && (v.left as Node)?.type === "Identifier") {
              names.add((v.left as { name: string }).name);
            }
          }
        }
      }
    }
    return names;
  };

  const visitClassMethods = (className: string, classNode: Node): void => {
    const body = (classNode as { body?: { body?: Node[] } }).body?.body ?? [];
    for (const m of body) {
      const mem = m as {
        type?: string;
        kind?: string;
        static?: boolean;
        key?: { type?: string; name?: string };
        value?: Node;
      };
      const isMethod =
        mem.type === "MethodDefinition" ||
        mem.type === "ClassMethod" ||
        mem.type === "TSDeclareMethod";
      if (!isMethod || mem.static) continue;
      if (mem.kind && mem.kind !== "method") continue;
      const keyName = mem.key?.type === "Identifier" ? mem.key.name : undefined;
      if (!keyName) continue;
      const methodNode =
        mem.type === "MethodDefinition" ? (mem.value as Node | undefined) : (mem as unknown as Node);
      if (!methodNode) continue;
      visitFn(`${className}.${keyName}`, methodNode, paramSet(methodNode));
    }
  };

  const considerDecl = (decl: Node | null | undefined, exported: boolean): void => {
    if (!decl) return;
    if (decl.type === "FunctionDeclaration" && (decl as { id?: Node }).id) {
      const id = decl.id as { name: string };
      visitFn(id.name, decl, paramSet(decl));
      return;
    }
    if (decl.type === "ClassDeclaration" && (decl as { id?: { name?: string } }).id?.name) {
      visitClassMethods((decl.id as { name: string }).name, decl);
      return;
    }
    if (decl.type === "VariableDeclaration") {
      for (const d of (decl as { declarations?: Array<{ id?: Node; init?: Node }> }).declarations ?? []) {
        const id = d.id;
        const init = d.init;
        if (
          exported &&
          id?.type === "Identifier" &&
          init &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        ) {
          visitFn((id as { name: string }).name, init, paramSet(init));
        }
      }
    }
  };

  const program = (ast as { program?: { body?: Node[] } }).program;
  const bodyStmts = program?.body ?? [];
  for (const stmt of bodyStmts) {
    if (stmt.type === "ExportNamedDeclaration") {
      considerDecl((stmt as { declaration?: Node }).declaration, true);
    } else if (stmt.type === "ExportDefaultDeclaration") {
      considerDecl((stmt as { declaration?: Node }).declaration, true);
    } else if (stmt.type === "ClassDeclaration") {
      const id = (stmt as { id?: { name?: string } }).id;
      if (id?.name) visitClassMethods(id.name, stmt);
    } else if (stmt.type === "FunctionDeclaration") {
      considerDecl(stmt, false);
    }
  }
  return out;
}

/** 路径 trie 节点：hints 为叶子环用法证据，children 为继续解引用 */
type TrieNode = { hints: UseHint[]; children: Map<string, TrieNode> };

/** trie → 排序字段表；有子环的字段是中间环（嵌套 shape，占位 type） */
function emitFields(trie: TrieNode): BodyReadField[] {
  const list: BodyReadField[] = [];
  for (const [name, child] of [...trie.children.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    if (child.children.size > 0) {
      list.push({
        field: name,
        type: "shape({ … })",
        via: "dereferenced member read (nested shape)",
        fields: emitFields(child),
      });
    } else {
      list.push({ field: name, ...mergeHints(child.hints) });
    }
  }
  return list;
}

function mergeHints(hints: UseHint[]): { type: string; via: string } {
  if (hints.length === 0) return { type: "any()", via: "read (no type evidence)" };
  const types = [...new Set(hints.map((h) => h.type))];
  if (types.length === 1) {
    return { type: types[0]!, via: hints[0]!.via };
  }
  // any 派生让位给具体类型
  const concrete = types.filter((t) => t !== "any()");
  if (concrete.length === 0) return { type: "any()", via: hints[0]!.via };
  if (concrete.length === 1) {
    const h = hints.find((x) => x.type === concrete[0])!;
    return { type: concrete[0]!, via: h.via };
  }
  // 非 union 的具体证据强于 union 模糊证据（Array.isArray 的 array 压过 .length 的 string|array）
  const specific = concrete.filter((t) => !t.startsWith("union("));
  if (specific.length === 1) {
    const h = hints.find((x) => x.type === specific[0])!;
    return { type: specific[0]!, via: h.via };
  }
  if (specific.length > 1) {
    return {
      type: `union(${specific.join(", ")})`,
      via: hints
        .filter((h) => specific.includes(h.type))
        .map((h) => h.via)
        .join(" + "),
    };
  }
  // 全是 union：展平去重，避免嵌套 union
  const flat = new Set<string>();
  for (const t of concrete) {
    if (t.startsWith("union(") && t.endsWith(")")) {
      for (const part of t.slice(6, -1).split(",")) flat.add(part.trim());
    } else {
      flat.add(t);
    }
  }
  const parts = [...flat];
  return {
    type: parts.length === 1 ? parts[0]! : `union(${parts.join(", ")})`,
    via: hints.map((h) => h.via).join(" + "),
  };
}

/** 某函数某形参的 body-read 字段类型（供 draft / quickfix） */
export function bodyReadFieldsFor(
  map: BodyReadTypes,
  fnName: string,
  paramName: string,
): BodyReadField[] | undefined {
  return map.get(fnName)?.get(paramName);
}

/**
 * `shape({ type: string(), loc: shape({ start: … }) })` 文本。
 * 中间环（有子字段）递归生成嵌套 shape——中间环是 any() 会让
 * 其上的成员读取继续记 may-throw（#76）。
 */
export function shapeDslFromFields(fields: BodyReadField[]): string {
  if (fields.length === 0) return "shape({})";
  const parts = fields.map((f) =>
    f.fields && f.fields.length > 0
      ? `${f.field}: ${shapeDslFromFields(f.fields)}`
      : `${f.field}: ${f.type}`,
  );
  return `shape({ ${parts.join(", ")} })`;
}
