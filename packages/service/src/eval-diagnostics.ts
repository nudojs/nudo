/**
 * 求值引擎静态诊断（AST，不执行）：
 * - unreachable：同块 return/throw 之后的语句
 * - builtin-unknown：未声明的全局调用（非 import / 局部 / $runtime）
 *
 * 不变量：只对**真正的自由标识符引用**报 builtin-unknown。命名位置
 * （非计算 key/property、声明 id、import 绑定 local、import/export 别名位
 * imported/exported、标签 label）都不是引用——它们指向别的名字或声明名字，
 * 报出来即为误报。
 */

import {
  parseSource,
  namespaceNameOf,
  hostBuiltinCtorName,
  evalBuiltinNew,
  evalGlobalFn,
  isErrorCtorName,
} from "@nudojs/core";
import type { File, Node, Statement, Identifier } from "@babel/types";

export type EvalLoc = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

export type EvalUnreachable = { range: EvalLoc };
export type EvalBuiltinUnknown = { name: string; range: EvalLoc };

export type EvalDiagnostics = {
  unreachable: EvalUnreachable[];
  builtinUnknown: EvalBuiltinUnknown[];
};

function locOf(node: Node): EvalLoc | null {
  if (!node.loc) return null;
  return {
    start: { line: node.loc.start.line, column: node.loc.start.column },
    end: { line: node.loc.end.line, column: node.loc.end.column },
  };
}

function isExit(stmt: Statement): boolean {
  return stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement";
}

function walkUnreachable(node: Node, out: EvalUnreachable[]): void {
  const n = node as {
    type: string;
    body?: unknown;
    consequent?: Node;
    alternate?: Node | null | undefined;
    block?: Node;
    handler?: { body?: Node } | null;
    finalizer?: Node | null;
    [k: string]: unknown;
  };

  const checkBlock = (block: unknown) => {
    if (!block) return;
    const body =
      (block as { body?: Statement[] }).body ??
      (Array.isArray(block) ? (block as Statement[]) : null);
    if (!Array.isArray(body)) return;
    for (let i = 0; i < body.length; i++) {
      walkUnreachable(body[i]!, out);
      if (isExit(body[i]!)) {
        for (let j = i + 1; j < body.length; j++) {
          const r = locOf(body[j]!);
          if (r) out.push({ range: r });
        }
        break;
      }
    }
  };

  switch (n.type) {
    case "Program":
    case "BlockStatement":
      checkBlock(n.body);
      break;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      if (n.body) walkUnreachable(n.body as Node, out);
      break;
    case "IfStatement":
      if (n.consequent) walkUnreachable(n.consequent, out);
      if (n.alternate) walkUnreachable(n.alternate, out);
      break;
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
      if (n.body) walkUnreachable(n.body as Node, out);
      break;
    case "TryStatement":
      if (n.block) walkUnreachable(n.block as Node, out);
      if (n.handler?.body) walkUnreachable(n.handler.body, out);
      if (n.finalizer) walkUnreachable(n.finalizer as Node, out);
      break;
    case "SwitchStatement":
      for (const c of (n as { cases?: Array<{ consequent?: Statement[] }> }).cases ?? []) {
        checkBlock(c.consequent);
      }
      break;
    case "ExportNamedDeclaration":
    case "ExportDefaultDeclaration": {
      const decl = (n as { declaration?: Node }).declaration;
      if (decl) walkUnreachable(decl, out);
      break;
    }
    default:
      break;
  }
}

/** 文件内声明的名字（函数/类/变量/参数/import） */
function collectDeclared(file: File): Set<string> {
  const names = new Set<string>();
  const addId = (id: Node | null | undefined) => {
    if (!id) return;
    if (id.type === "Identifier") names.add((id as Identifier).name);
    if (id.type === "ObjectPattern") {
      for (const p of (id as { properties: Array<Node & { value?: Node }> }).properties) {
        // 对象 rest（{...rest}）直接作为 property 出现，绑定在 argument
        addId(p.type === "RestElement" ? (p as { argument?: Node }).argument : p.value);
      }
    }
    if (id.type === "ArrayPattern") {
      for (const el of (id as { elements: Array<Node | null> }).elements) addId(el);
    }
    // 默认值（b = 1）绑定在 left；rest（[...r]）绑定在 argument
    if (id.type === "AssignmentPattern") addId((id as { left?: Node }).left);
    if (id.type === "RestElement") addId((id as { argument?: Node }).argument);
  };
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const o = node as { type?: string; [k: string]: unknown };
    switch (o.type) {
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ClassDeclaration":
      case "ClassExpression":
        // 具名函数/类表达式的名字是自身作用域内的绑定
        addId((o as { id?: Node }).id);
        break;
      case "VariableDeclarator":
        addId((o as { id?: Node }).id);
        break;
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
        addId((o as { local?: Node }).local);
        break;
      case "CatchClause":
        // C2.2：catch (e) 形参是局部绑定，不得报 builtin-unknown
        addId((o as { param?: Node }).param);
        break;
      default:
        break;
    }
    // params
    if (o.params && Array.isArray(o.params)) {
      for (const p of o.params) addId(p as Node);
    }
    for (const key of Object.keys(o)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const v = o[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
    }
  };
  visit(file);
  return names;
}

/**
 * 已知可接受的全局（不报 builtin-unknown）——**按 core 真实建模能力推导**
 * （族 29 Bug 865），不再是手写白名单。
 *
 * 症状：es env 未声明的一批 ES 规范全局（BigInt / TypedArray 族 /
 * ArrayBuffer / DataView / AggregateError / Function / escape …）被报
 * 「Built-in API "X" is not covered by Nudo's type inference」，而**同一份
 * 报告**里引擎恰恰把它们推成了**精确值**（`() => 1n` / `() => 4` / `() => "m"`）
 * ——报告自相矛盾。根因：判定依据是一张**手写**白名单，而不是引擎真实的
 * 建模能力。
 *
 * 判定依据（全部用 @nudojs/core 的**既有**公开导出；core 公共 API 冻结面
 * 不得新增导出 ⇒ 这里只**使用**既有导出拼出集合）：
 * - `namespaceNameOf(host) === name` → core 的**命名空间身份路由表**
 *   （NAMESPACE_GLOBALS：Math/JSON/…/TypedArray 全家/ArrayBuffer/…）
 * - `hostBuiltinCtorName(host) === name` → core 的**内建构造器身份表**
 * - `evalBuiltinNew(name, args)` 有派发 → core 的**构造面**（含「恒抛域错误」
 *   的建模，如 `new BigInt()` / `Map()` 原生 TypeError）
 * - `evalGlobalFn(name, args)` 有派发 → core 的**全局函数面**（GLOBAL_FNS：
 *   parseInt/URI 族/escape 族/…）
 * - `isErrorCtorName(name)` → Error 家族
 *
 * 「有派发」= 返回 Abs（**且不是 `unknown` 兜底**——core 对 `eval` 刻意
 * 折 unknown，那不是**精确建模**，仍应报「未被覆盖」）或抛 NudoThrow
 * （域错误也是建模）。
 *
 * 候选集 = 宿主真实全局名（`Object.getOwnPropertyNames(globalThis)`）——
 * 即「运行时确实存在的全局」；**覆盖判定完全由 core 的派发表推导**，
 * 手写部分只剩 5 个 core 不建模但恒在的无害名字（console / globalThis /
 * undefined / NaN / Infinity）。
 */
const NON_MODELED_BUT_ALWAYS_PRESENT = ["console", "globalThis"] as const;

/** 转译期已硬编码折叠的宿主内建（HOST_INTRINSIC_NAMES）——恒在且已被建模 */
const HOST_INTRINSIC_GLOBALS = ["undefined", "NaN", "Infinity"] as const;

/**
 * 【族 29 主 agent 收口】原 S5 分片为保住三条既有 service 钉而留的
 * `WeakRef` 手写例外**已删除**。
 *
 * 理由：那三条钉（`catch-param-declared.test.ts` / `diagnostics.test.ts` /
 * `eval-arg-provenance.test.ts`）编码的是**旧手写白名单**的判定，而 core
 * 其实已精确建模 WeakRef（`evalBuiltinNew` 的 `case "WeakRef"` →
 * `makeWeakRefAbs`，CanBeHeldWeakly 校验）⇒ 按「覆盖判定完全由 core 的
 * 派发表推导」的口径，WeakRef 属**已覆盖**，不该报「未被覆盖」。
 *
 * 留着手写例外 = 把要消灭的「手写白名单」换个地方继续写，与 Bug 865 的
 * 根因（判定依据是手写名单而不是引擎真实建模能力）同型。
 *
 * 处理：那三条钉的**样例全局**换成真正未被建模的宿主全局 `Atomics`
 * （core 无 Atomics 建模面；它在 `globalThis` 里且是数据属性 ⇒ 不触发
 * 访问器副作用），钉的**意图**（未建模全局要报 builtin-unknown、且不与
 * unknown-global 双报）完全保留。
 */

let modeledGlobalsCache: Set<string> | undefined;

/** core 精确建模的全局集合（懒算 + 缓存）。 */
function coreModeledGlobals(): ReadonlySet<string> {
  if (modeledGlobalsCache) return modeledGlobalsCache;
  const out = new Set<string>([
    ...NON_MODELED_BUT_ALWAYS_PRESENT,
    ...HOST_INTRINSIC_GLOBALS,
  ]);
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    // 访问器（accessor）全局**跳过**：读它的 getter 可能有副作用 —— node 22+
    // 的 `localStorage` / `sessionStorage` getter 会往 stderr 打一条
    // ExperimentalWarning ⇒ 污染 CLI 的 stderr（`nudo check` 的 miss/hit
    // 字节一致性钉会红）。core 已建模的全局（NAMESPACE_GLOBALS / 内建构造器
    // 身份表）**全是数据属性**，跳过访问器不丢覆盖。
    const desc = Object.getOwnPropertyDescriptor(globalThis, name);
    if (desc && !("value" in desc)) continue;
    let host: unknown;
    try {
      host = (globalThis as Record<string, unknown>)[name];
    } catch {
      continue; // 宿主 getter 抛（极少）⇒ 判不出，按未覆盖
    }
    // 1) 命名空间身份路由表（NAMESPACE_GLOBALS）
    try {
      if (namespaceNameOf(host) === name) {
        out.add(name);
        continue;
      }
    } catch {
      /* 判不出 ⇒ 落下面几路 */
    }
    // 2) 内建构造器身份表（hostBuiltinCtorName）
    try {
      if (hostBuiltinCtorName(host) === name) {
        out.add(name);
        continue;
      }
    } catch {
      /* 同上 */
    }
    // 3) 构造面派发（evalBuiltinNew）——抛 = 域错误建模（原生恒抛）
    try {
      if (evalBuiltinNew(name, []) !== undefined) {
        out.add(name);
        continue;
      }
    } catch {
      out.add(name);
      continue;
    }
    // 4) 全局函数面派发（evalGlobalFn）——unknown 兜底不算精确建模
    try {
      const r = evalGlobalFn(name, []);
      if (r !== undefined && r.shape.k !== "unknown") {
        out.add(name);
        continue;
      }
    } catch {
      out.add(name);
      continue;
    }
    // 5) Error 家族
    if (isErrorCtorName(name)) out.add(name);
  }
  modeledGlobalsCache = out;
  return out;
}

const KNOWN_GLOBALS: ReadonlySet<string> = coreModeledGlobals();

/** require spec 可常量折叠成字符串（transpile 已接管，不报 builtin-unknown） */
function isStaticStringExpr(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as { type?: string; expressions?: unknown[]; left?: unknown; right?: unknown; operator?: string };
  if (n.type === "StringLiteral" || n.type === "NumericLiteral") return true;
  if (n.type === "TemplateLiteral") {
    return (n.expressions ?? []).every((e) => isStaticStringExpr(e));
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    return isStaticStringExpr(n.left) && isStaticStringExpr(n.right);
  }
  return false;
}

function isFreeUnknown(
  name: string,
  declared: Set<string>,
  seen: Set<string>,
  known: Set<string>,
): boolean {
  return (
    !declared.has(name) &&
    !known.has(name) &&
    !name.startsWith("$") &&
    !seen.has(name)
  );
}

function walkBuiltinUnknown(
  node: Node,
  declared: Set<string>,
  out: EvalBuiltinUnknown[],
  seen: Set<string>,
  known: Set<string>,
  namePosition = false,
): void {
  const n = node as {
    type?: string;
    callee?: Node;
    name?: string;
    computed?: boolean;
    [k: string]: unknown;
  };
  const flag = (idNode: Node, name: string) => {
    if (!isFreeUnknown(name, declared, seen, known)) return;
    const range = locOf(idNode) ?? locOf(node);
    if (range) {
      out.push({ name, range });
      seen.add(name);
    }
  };

  if (n.type === "MetaProperty") {
    // import.meta / new.target：meta/property 是关键字位置（Identifier 形状），
    // 不是标识符引用——new.target 不得报 builtin-unknown "new"（Bug 79）
    return;
  }
  if (n.type === "CallExpression") {
    const callee = n.callee as
      | { type?: string; name?: string; object?: { type?: string; name?: string }; property?: { type?: string; name?: string } }
      | undefined;
    const args = (n as { arguments?: unknown[] }).arguments ?? [];
    if (callee?.type === "Identifier" && callee.name === "require") {
      // 静态 spec 由 transpile → __nudoRequire 接管；真动态才报
      if (!isStaticStringExpr(args[0])) flag(n.callee!, "require");
    } else if (
      callee?.type === "MemberExpression" &&
      callee.object?.type === "Identifier" &&
      callee.object.name === "require"
    ) {
      // require.resolve(...)：静态 spec 不报；动态报在 require 名下
      if (callee.property?.name === "resolve" && !isStaticStringExpr(args[0])) {
        flag(callee.object as unknown as Node, "require");
      }
    } else if (callee?.type === "Identifier") {
      flag(n.callee!, callee.name!);
    }
  } else if (
    n.type === "Identifier" &&
    typeof n.name === "string" &&
    n.name !== "require" &&
    !namePosition
  ) {
    // 裸标识符引用（如 return WeakRef）；require 由 CallExpression 分支专管。
    // 命名位置（非计算的 key/property、import local、声明 id）不是引用。
    flag(node as Node, n.name);
  }

  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    // 非计算的 key/property 是命名位置；计算 key（{[foo]: 1}、o[foo]、
    // class {[m]() {}}）会被求值 → 其中的标识符是活引用。
    // local（import 绑定）/ id（声明位置）始终是命名位置。
    // imported/exported（import / export 的**别名位**）与 label（标签名）同样
    // 是命名位置——它们声明或指向**别的**名字，不是对全局自由标识符的引用：
    //   - `import { alpha as beta }` 的 alpha 是**源模块**的导出名；
    //   - `export { y as renamed }` 的 renamed 是**导出名**（本身不是模块作用域
    //     绑定——原生下体内引用 renamed 是 ReferenceError，仍会作为真自由全局被报，
    //     只是锚点应落在**真正的引用位**而非名字位）；
    //   - `outer:` / `break outer` 的 outer 是**标签**（独立命名空间）。
    const childIsName =
      ((key === "key" || key === "property") && n.computed !== true) ||
      key === "local" ||
      key === "imported" ||
      key === "exported" ||
      key === "label" ||
      key === "id";
    const v = n[key];
    if (Array.isArray(v)) {
      v.forEach((x) => {
        if (x && typeof x === "object" && "type" in (x as object)) {
          walkBuiltinUnknown(x as Node, declared, out, seen, known, childIsName);
        }
      });
    } else if (v && typeof v === "object" && "type" in (v as object)) {
      walkBuiltinUnknown(v as Node, declared, out, seen, known, childIsName);
    }
  }
}

/**
 * 静态收集 求值引擎诊断。
 * extraKnown：@nudo:mock / @nudo:env 已覆盖的全局名（eval 注入后不再是裸原生
 * 调用，不得误报 builtin-unknown——收集器只吃 AST，看不到指令）。
 */
export function collectEvalDiagnostics(
  source: string,
  extraKnown?: Iterable<string>,
): EvalDiagnostics {
  let file: File;
  try {
    file = parseSource(source);
  } catch {
    return { unreachable: [], builtinUnknown: [] };
  }
  const unreachable: EvalUnreachable[] = [];
  // File → program
  const root = (file as unknown as { type: string; program?: Node }).program ?? file;
  walkUnreachable(root as Node, unreachable);

  const declared = collectDeclared(file);
  const known = new Set(KNOWN_GLOBALS);
  if (extraKnown) {
    for (const n of extraKnown) known.add(n);
  }
  const builtinUnknown: EvalBuiltinUnknown[] = [];
  walkBuiltinUnknown(file, declared, builtinUnknown, new Set(), known);

  return { unreachable, builtinUnknown };
}
