/**
 * body-read 字段类型推断（草稿 / quickfix 自动填类型）。
 *
 * 证据只来自函数体对形参成员的用法（`node.type === "x"` → string()），
 * **不进 check**——与 DraftEvidence body 档同口径。无用法证据 → any()，
 * 不得发明空 shape 或武断 string()。
 */
import { parse } from "@nudojs/parser";
import type { Node } from "@babel/types";

export type BodyReadField = {
  field: string;
  /** constraint-builder DSL：string() / number() / boolean() / any() */
  type: string;
  /** 推断依据（调试/草稿注释） */
  via: string;
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
    if (prop === "length" || prop === "size") {
      return { type: "string()", via: ".length" };
    }
    if (prop && ARRAY_METHODS.has(prop)) {
      return { type: "array(any())", via: `.${prop}()` };
    }
    if (prop === "push" || prop === "pop" || prop === "shift" || prop === "unshift") {
      return { type: "array(any())", via: `.${prop}()` };
    }
    return undefined;
  }

  // String(param.field) / Number(...) / Boolean(...)
  if (t === "CallExpression" || t === "OptionalCallExpression") {
    const callee = parent.callee as Node | undefined;
    const cname = callee?.type === "Identifier" ? (callee as { name: string }).name : undefined;
    if (cname === "String") return { type: "string()", via: "String()" };
    if (cname === "Number") return { type: "number()", via: "Number()" };
    if (cname === "Boolean") return { type: "boolean()", via: "Boolean()" };
    if (cname === "Array.isArray") return { type: "array(any())", via: "Array.isArray" };
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
    /** param → field → hints[] */
    const byParam = new Map<string, Map<string, UseHint[]>>();
    const add = (pname: string, field: string, hint: UseHint | undefined): void => {
      if (!byParam.has(pname)) byParam.set(pname, new Map());
      const fields = byParam.get(pname)!;
      if (!fields.has(field)) fields.set(field, []);
      if (hint) fields.get(field)!.push(hint);
    };

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

      // typeof param.field === "string"
      if (n.type === "UnaryExpression" && n.operator === "typeof") {
        const arg = n.argument as Node | undefined;
        const mem = arg as Record<string, unknown> | undefined;
        if (mem && (mem.type === "MemberExpression" || mem.type === "OptionalMemberExpression")) {
          const obj = mem.object as Node | undefined;
          const prop = mem.property as Node | undefined;
          if (
            obj?.type === "Identifier" &&
            paramNames.has((obj as { name: string }).name) &&
            !shadowed.has((obj as { name: string }).name) &&
            prop &&
            mem.computed !== true
          ) {
            const key = keyOf(prop);
            const pname = (obj as { name: string }).name;
            if (key !== undefined) {
              // parent is UnaryExpression; grandparent is BinaryExpression
              const gp = parent;
              add(pname, key, hintFromTypeof(n, gp));
            }
          }
        }
      }

      if (n.type === "MemberExpression" || n.type === "OptionalMemberExpression") {
        const obj = n.object as Node | undefined;
        const prop = n.property as Node | undefined;
        const computed = n.computed === true;
        if (
          obj?.type === "Identifier" &&
          paramNames.has((obj as { name: string }).name) &&
          !shadowed.has((obj as { name: string }).name) &&
          prop &&
          !computed
        ) {
          const key = keyOf(prop);
          const pname = (obj as { name: string }).name;
          if (key !== undefined) {
            const hint = hintFromUse(parent, (parentKey as "left") ?? "object");
            add(pname, key, hint);
          }
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
    for (const [pname, fieldMap] of byParam) {
      const list: BodyReadField[] = [];
      for (const [field, hints] of fieldMap) {
        list.push({ field, ...mergeHints(hints) });
      }
      list.sort((a, b) => (a.field < b.field ? -1 : 1));
      fieldsOf.set(pname, list);
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

function mergeHints(hints: UseHint[]): { type: string; via: string } {
  if (hints.length === 0) return { type: "any()", via: "read (no type evidence)" };
  const types = [...new Set(hints.map((h) => h.type))];
  if (types.length === 1) {
    return { type: types[0]!, via: hints[0]!.via };
  }
  // any 派生让位给具体类型
  const concrete = types.filter((t) => t !== "any()");
  if (concrete.length === 1) {
    const h = hints.find((x) => x.type === concrete[0])!;
    return { type: concrete[0]!, via: h.via };
  }
  if (concrete.length > 1) {
    return {
      type: `union(${concrete.join(", ")})`,
      via: hints.map((h) => h.via).join(" + "),
    };
  }
  return { type: "any()", via: hints[0]!.via };
}

/** 某函数某形参的 body-read 字段类型（供 draft / quickfix） */
export function bodyReadFieldsFor(
  map: BodyReadTypes,
  fnName: string,
  paramName: string,
): BodyReadField[] | undefined {
  return map.get(fnName)?.get(paramName);
}

/** `shape({ type: string(), name: string() })` 文本 */
export function shapeDslFromFields(fields: BodyReadField[]): string {
  if (fields.length === 0) return "shape({})";
  const parts = fields.map((f) => `${f.field}: ${f.type}`);
  return `shape({ ${parts.join(", ")} })`;
}
