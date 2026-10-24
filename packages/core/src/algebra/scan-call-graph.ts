/**
 * 调用图收集（别名 / 对象属性 / require / 动态 import / 无条件转发）。
 *
 * 从 scan.ts 拆出的纯 AST 解析层：不共享 scanLiteralCalls 的执法状态，
 * 只产出 CallResolve / Forward 表供扫描侧消费。
 */

import { parseSource as parse } from "./parse-source.ts";
import { foldRequireSpecArg } from "./exec/transpile.ts";
import { resolveDepPath } from "./load-deps-fp.ts";
import { guardLoadModule } from "./load-guard.ts";
import { localNamedExports } from "./scan-named-exports.ts";

// ---------------------------------------------------------------------------
// 调用图收集（别名 / 对象属性 / require / 动态 import / 无条件转发）
// ---------------------------------------------------------------------------

/** 外部模块函数：源码 + 导出名 + 定义文件虚拟路径（interface 侧车解析基；不可得 → 省略） */
export type ExternalFnRef = { source: string; fnName: string; fromFile?: string };

/**
 * 词法**作用域帧**（Bug 1106 / 1107）。
 *
 * - `names`：本作用域**声明**的名字（形参 / `let` / `const` / `var` / 局部函数
 *   / for-of 绑定 / 解构绑定）⇒ 用于判「同名遮蔽」；
 * - `aliases`：别名绑定（`const f = knownFn`）⇒ 名字 → 源码函数名；
 * - `members`：成员绑定（`const c = new C()` ⇒ `c.m` → `C.m`）。
 */
export type ScopeFrame = {
  names: Set<string>;
  aliases: Map<string, string>;
  members: Map<string, string>;
  /**
   * 外部绑定（import / require / 动态 import 解构）⇒ 名字 → 外部模块函数。
   *
   * 为什么要**按作用域**记：外部绑定是**模块作用域**的（`import` / 顶层
   * `require`），但**局部**解构也会产生同名绑定（`const { fn } = await
   * import(...)`）⇒ 若只按名字判「遮蔽」，局部解构会把**它自己**的导入遮住
   * ⇒ 跨文件调用点解析不出 ⇒ 假绿。
   */
  externals: Map<string, ExternalFnRef>;
};

/** 作用域表：作用域 id → 帧（模块作用域 id = `""`） */
export type ScopeTable = {
  frames: Map<string, ScopeFrame>;
};

/**
 * 作用域链（**内层 → 外层**，末尾是模块作用域 `""`）。
 *
 * 作用域 id = 「外层链 + 本层节点的源码起点」⇒ 与 AST 对象身份无关 ⇒
 * 收集侧（`walkStatements`）与调用点侧（通用 AST 走查）算出的 id 一致。
 */
export type ScopeChain = readonly string[];

/** 扫描前收集：别名 / 对象属性 / require 导入 */
export type CallResolve = {
  /** 本地名 → 真实函数名（同文件；**模块作用域**的别名表） */
  aliasToFn: Map<string, string>;
  /** 对象名.属性名 → 真实函数名（同文件；**模块作用域**的成员表） */
  memberToFn: Map<string, string>;
  /** 本地名 → 外部模块函数（源码 + 导出名 + 定义文件路径） */
  externalFn: Map<string, ExternalFnRef>;
  /** 对象名.属性名 → 外部模块函数 */
  externalMember: Map<string, ExternalFnRef>;
  /** 作用域表（Bug 1106 / 1107）：按作用域 id 索引的绑定帧 */
  scopes: ScopeTable;
};

function newScopeFrame(): ScopeFrame {
  return { names: new Set(), aliases: new Map(), members: new Map(), externals: new Map() };
}

/** 作用域 id：外层链 + 本层节点的源码起点（`start` 缺失 ⇒ -1） */
export function scopeIdOf(chain: ScopeChain, node: object): string {
  const start = (node as { start?: unknown }).start;
  return `${chain[0] ?? ""}/${typeof start === "number" ? start : -1}`;
}

/** 进入本节点后的作用域链（本节点开作用域 ⇒ 前插；否则原链） */
export function scopeChainChild(chain: ScopeChain, node: object): ScopeChain {
  if (!opensScope(node)) return chain;
  return [scopeIdOf(chain, node), ...chain];
}

/** 函数类节点（开作用域） */
function isFunctionNode(type: string | undefined): boolean {
  return (
    type === "FunctionDeclaration" ||
    type === "FunctionExpression" ||
    type === "ArrowFunctionExpression" ||
    type === "ObjectMethod" ||
    type === "ClassMethod" ||
    type === "ClassPrivateMethod"
  );
}

/** 本节点是否引入词法作用域 */
function opensScope(node: object): boolean {
  const t = (node as { type?: string }).type;
  return (
    isFunctionNode(t) ||
    t === "BlockStatement" ||
    t === "ForStatement" ||
    t === "ForInStatement" ||
    t === "ForOfStatement" ||
    t === "CatchClause"
  );
}

/**
 * 声明节点的**绑定名**（摊平模式 / 默认值 / rest / 解构）。
 *
 * Bug 1106 的五类遮蔽来源都走这里：形参、局部 `const`、嵌套函数、
 * for-of 绑定、解构绑定。
 */
function declaredNames(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  switch (n.type) {
    case "Identifier":
      if (typeof n.name === "string") out.add(n.name);
      return;
    case "AssignmentPattern":
      declaredNames(n.left, out);
      return;
    case "RestElement":
      declaredNames(n.argument, out);
      return;
    case "ObjectPattern":
      for (const p of (n.properties as Array<Record<string, unknown>> | undefined) ?? []) {
        if (p.type === "RestElement") {
          declaredNames(p.argument, out);
          continue;
        }
        declaredNames(p.value, out);
      }
      return;
    case "ArrayPattern":
      for (const el of (n.elements as Array<Record<string, unknown> | null> | undefined) ?? []) {
        if (!el) continue;
        declaredNames(el, out);
      }
      return;
    default:
      return;
  }
}

/** 语句级声明名（`let` / `const` / `class` / 局部 `function`） */
function blockDeclNames(stmt: Record<string, unknown>, out: Set<string>): void {
  const t = stmt.type;
  if (t === "VariableDeclaration") {
    for (const d of (stmt.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
      declaredNames(d.id, out);
    }
    return;
  }
  if (t === "FunctionDeclaration") {
    const id = stmt.id as { name?: string } | undefined;
    if (id?.name) out.add(id.name);
    return;
  }
  if (t === "ClassDeclaration") {
    const id = stmt.id as { name?: string } | undefined;
    if (id?.name) out.add(id.name);
    return;
  }
}

/**
 * 函数体里的 `var` 声明名（**函数作用域**：跨嵌套块可见，但不进嵌套函数）。
 */
function collectVarNames(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (isFunctionNode(obj.type as string | undefined)) return; // 嵌套函数有自己的作用域
  if (obj.type === "VariableDeclaration") {
    const kind = obj.kind as string | undefined;
    if (kind === "var") {
      for (const d of (obj.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
        declaredNames(d.id, out);
      }
    }
  }
  for (const key of Object.keys(obj)) {
    if (key === "loc" || key === "start" || key === "end" || key === "leadingComments") continue;
    const val = obj[key];
    if (Array.isArray(val)) val.forEach((x) => collectVarNames(x, out));
    else if (val && typeof val === "object") collectVarNames(val, out);
  }
}

/**
 * 节点引入的**作用域帧**（绑定名）。
 *
 * - 函数类节点：形参 + 函数体内的 `var`（函数作用域）；
 * - 块语句：`let` / `const` / `class` / 局部 `function`（块作用域）；
 * - `for` 头 / `catch` 参数：循环 / catch 作用域。
 */
function scopeFrameOf(node: Record<string, unknown>): ScopeFrame | undefined {
  const frame = newScopeFrame();
  const t = node.type as string | undefined;
  if (isFunctionNode(t)) {
    for (const p of (node.params as unknown[] | undefined) ?? []) {
      declaredNames(p, frame.names);
    }
    collectVarNames(node.body, frame.names);
    return frame;
  }
  if (t === "BlockStatement") {
    for (const stmt of (node.body as Array<Record<string, unknown>> | undefined) ?? []) {
      blockDeclNames(stmt, frame.names);
    }
    return frame;
  }
  if (t === "ForStatement" || t === "ForInStatement" || t === "ForOfStatement") {
    const left = node.left as Record<string, unknown> | undefined;
    if (left) {
      if (left.type === "VariableDeclaration") {
        for (const d of (left.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
          declaredNames(d.id, frame.names);
        }
      } else {
        declaredNames(left, frame.names);
      }
    }
    return frame;
  }
  if (t === "CatchClause") {
    declaredNames(node.param, frame.names);
    return frame;
  }
  return undefined;
}

/**
 * 作用域链上「裸名」的解析（Bug 1106）。
 *
 * 词法作用域：内层 → 外层。
 * - 命中**别名**（`const f = knownFn`）⇒ 该别名指向的源码函数名；
 * - 命中**同名声明**（形参 / 局部 `const` / 局部函数 / for-of 绑定 / 解构
 *   绑定）⇒ **遮蔽** ⇒ 不是顶层声明的那个函数 ⇒ 不解析（fail-closed：不猜）；
 * - 链上都没命中 ⇒ 回落模块作用域（外部导入 / 顶层别名 / 顶层函数）。
 */
export function resolveScopedName(
  resolve: CallResolve,
  chain: ScopeChain,
  name: string,
):
  | { kind: "alias"; fn: string }
  | { kind: "external"; ref: ExternalFnRef }
  | { kind: "shadowed" }
  | undefined {
  for (const sid of chain) {
    const f = resolve.scopes.frames.get(sid);
    if (!f) continue;
    const ext = f.externals.get(name);
    if (ext !== undefined) return { kind: "external", ref: ext };
    const a = f.aliases.get(name);
    if (a !== undefined) return { kind: "alias", fn: a };
    if (f.names.has(name)) return { kind: "shadowed" };
  }
  return undefined;
}

/**
 * 作用域链上「成员调用 `obj.prop`」的解析（Bug 1107）。
 *
 * 沿作用域链找 `obj` 的绑定：
 * - 本作用域有 `obj.prop` 的成员绑定 ⇒ 用它；
 * - 本作用域**声明**了 `obj`（但没有 `obj.prop` 的成员绑定）⇒ **遮蔽**
 *   ⇒ 不回落外层（外层的 `obj` 不是这里的 `obj`）；
 * - 都没命中 ⇒ 继续外层。
 *
 * 键**按作用域**分桶（不再只按变量名）⇒ 同名局部 / 参数不再互相串味。
 */
export function resolveScopedMember(
  resolve: CallResolve,
  chain: ScopeChain,
  objName: string,
  propName: string,
): string | undefined {
  const key = `${objName}.${propName}`;
  for (const sid of chain) {
    const f = resolve.scopes.frames.get(sid);
    if (!f) continue;
    const hit = f.members.get(key);
    if (hit !== undefined) return hit;
    if (f.names.has(objName)) return undefined;
  }
  return undefined;
}

function requireSpecOf(init: Record<string, unknown>): string | undefined {
  // require('./x') / require(`./x`) / require("./" + "x" + ".js")
  if (init.type === "CallExpression") {
    const callee = init.callee as { type?: string; name?: string } | undefined;
    const args = init.arguments as Array<Record<string, unknown>> | undefined;
    if (callee?.type === "Identifier" && callee.name === "require" && args?.[0]) {
      return foldRequireSpecArg(args[0]);
    }
  }
  // require('./x').fn
  if (init.type === "MemberExpression") {
    const obj = init.object as Record<string, unknown> | undefined;
    if (obj) return requireSpecOf(obj);
  }
  return undefined;
}

function requireExportName(init: Record<string, unknown>): string | undefined {
  // require('./x').fn
  if (init.type === "MemberExpression" && !init.computed) {
    const prop = init.property as { type?: string; name?: string } | undefined;
    if (prop?.type === "Identifier") return prop.name;
  }
  return undefined;
}

/**
 * default 导出的**本地声明名**（Bug 442）：
 * - `export default function calc(…)` / `export default class Calc` → "calc"
 * - `export default calc`（标识符） → "calc"
 * - `export { calc as default }` → "calc"
 * - 匿名 default 导出（`export default function (x) {}` / `export default (x) => x`）
 *   → undefined（调用方回落 "default"）
 *
 * 契约绑定面（interface.ts 的 binding）以**本地声明名**为键（`exports[fnName]`），
 * 侧车写 `export const calc = fn(…)` 时只有本地名能绑上 ⇒ 跨文件 default
 * 导入的调用点必须按本地名解析被调方，不能写死导出名 "default"。
 */
function defaultExportLocalName(modSrc: string): string | undefined {
  let file: ReturnType<typeof parse>;
  try {
    file = parse(modSrc);
  } catch {
    return undefined;
  }
  for (const stmt of file.program.body) {
    if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration as
        | { type?: string; id?: { name?: string }; name?: string }
        | null
        | undefined;
      if (!d) continue;
      if (
        (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") &&
        typeof d.id?.name === "string"
      ) {
        return d.id.name;
      }
      if (d.type === "Identifier" && typeof d.name === "string") return d.name;
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration" && !stmt.source) {
      const specs = ((stmt as { specifiers?: unknown[] }).specifiers ?? []) as Array<
        Record<string, unknown>
      >;
      for (const sp of specs) {
        if (sp.type !== "ExportSpecifier") continue;
        const exported = sp.exported as { type?: string; name?: string; value?: unknown } | undefined;
        const local = sp.local as { type?: string; name?: string } | undefined;
        const exportedName =
          exported?.type === "Identifier"
            ? exported.name
            : exported && "value" in exported
              ? String(exported.value ?? "")
              : undefined;
        if (exportedName === "default" && typeof local?.name === "string") return local.name;
      }
    }
  }
  return undefined;
}

/** `await import('./m')` / `import('./m')` → spec */
function dynamicImportSpec(node: Record<string, unknown>): string | undefined {
  let n: Record<string, unknown> | undefined = node;
  if (n?.type === "AwaitExpression") {
    n = n.argument as Record<string, unknown> | undefined;
  }
  if (!n) return undefined;
  // Babel 8：ImportExpression { source: StringLiteral }
  if (n.type === "ImportExpression") {
    const src = n.source as { type?: string; value?: unknown } | undefined;
    if (src?.type === "StringLiteral" && typeof src.value === "string") return String(src.value);
    return undefined;
  }
  // Babel 7 / legacy：CallExpression + callee.type === "Import"
  if (n.type !== "CallExpression") return undefined;
  const callee = n.callee as { type?: string } | undefined;
  if (callee?.type !== "Import") return undefined;
  const args = n.arguments as Array<{ type?: string; value?: unknown }> | undefined;
  if (args?.[0]?.type === "StringLiteral") return String(args[0].value);
  return undefined;
}

/**
 * 模块源码里找不到 fnName 时，沿 `export { fn } from './other'` / `export * from` 一跳跟进。
 * 返回定义了该函数的源码及其虚拟路径——interface 侧车绑定按最终定义文件定位。
 * 跳转 spec 必须相对**当前中间模块**目录解析（不是原始调用方）：`a.js` →
 * `sub/b.js` → `./c.js` 的目标是 `sub/c.js`，不是与 `a.js` 同目录的 `c.js`。
 */
/** 沿 re-export 链解析 fn 的定义源（导出测试 / 侧车基址用） */
export function resolveExportSource(
  modSrc: string,
  fnName: string,
  loadSpecFrom: (spec: string, fromFile: string) => string | undefined,
  depth = 0,
  baseFromFile = "",
  modFromFile = "",
): { source: string; fromFile: string } {
  const here = (): { source: string; fromFile: string } => ({
    source: modSrc,
    fromFile: modFromFile,
  });
  if (depth > 3) return here();
  let file: ReturnType<typeof parse>;
  try {
    // Bug 910：短路判据必须是「本模块**导出**了这个名字」，不是「源码里
    // 出现过这个名字」。旧判据用 listTopFunctions（含**未导出**的本地函数）
    // ⇒ 中间模块里一个未导出的同名本地函数被误判成「该导出名由本模块定义」
    // ⇒ 再导出链从不再往下跳 ⇒ 被再导出的函数的契约静默失效（假绿）。
    // ESM 规则：未导出的本地绑定对模块导出表没有任何影响（星号导出只排除
    // 本地**已导出**的名字）⇒ 判据改用导出名集合（localNamedExports）。
    if (localNamedExports(modSrc).has(fnName)) return here();
    file = parse(modSrc);
  } catch {
    // 解析失败 → fail-closed（不跟进再导出链），与旧判据同口径
    return here();
  }
  let nextSpec: string | undefined;
  /** 跳到下一模块时要找的本地名（export { foo as bar } → foo） */
  let nextFnName = fnName;
  for (const stmt of file.program.body) {
    if (stmt.type !== "ExportNamedDeclaration" && stmt.type !== "ExportAllDeclaration") continue;
    const src = (stmt as { source?: { type?: string; value?: unknown } }).source;
    if (src?.type !== "StringLiteral" || typeof src.value !== "string") continue;
    if (stmt.type === "ExportAllDeclaration") {
      nextSpec = String(src.value);
      break;
    }
    const clause = ((stmt as { specifiers?: unknown[] }).specifiers ?? []) as Array<Record<string, unknown>>;
    for (const sp of clause) {
      if (sp.type !== "ExportSpecifier") continue;
      const local = sp.local as { type?: string; name?: string; value?: unknown } | undefined;
      const exported = (sp.exported ?? sp.local) as
        | { type?: string; name?: string; value?: unknown }
        | undefined;
      // 对外可见名是 exported（`export { foo as bar }` 的 bar）；
      // 跳到源模块后要按 local 名（foo）继续找定义。
      const exportedName =
        exported?.type === "Identifier"
          ? exported.name
          : exported && "value" in exported
            ? String(exported.value ?? "")
            : undefined;
      if (exportedName === fnName) {
        nextSpec = String(src.value);
        nextFnName =
          local?.type === "Identifier" && local.name ? local.name : fnName;
        break;
      }
    }
    if (nextSpec) break;
  }
  if (!nextSpec) return here();
  // 中间模块路径是下一跳解析基；首跳用 modFromFile，再跳用上一跳解析结果
  const hopFrom = modFromFile || baseFromFile;
  const next = hopFrom ? loadSpecFrom(nextSpec, hopFrom) : undefined;
  if (!next) return here();
  const nextFromFile = hopFrom ? resolveDepPath(hopFrom, nextSpec) : "";
  return resolveExportSource(
    next,
    nextFnName,
    loadSpecFrom,
    depth + 1,
    baseFromFile,
    nextFromFile,
  );
}

/** 只递归可能含 Import/VariableDeclaration 的语句容器（resolvers/forwarders 用） */
const STMT_CONTAINER = new Set([
  "File",
  "Program",
  "BlockStatement",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "SwitchCase",
  "TryStatement",
  "CatchClause",
  "LabeledStatement",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "ClassDeclaration",
  "ClassBody",
  "ClassMethod",
  "StaticBlock",
  "ObjectMethod",
  // 赋值失效（Bug 1107）：`c = {m:x=>x}` 这类**表达式语句**必须能被走查到
  // ⇒ 表达式语句进容器（只多下探一层，不进整个表达式树）。
  "ExpressionStatement",
]);

/**
 * 语句容器 walk：只进语句容器，O(语句) 而非 O(全部节点)。
 *
 * 作用域链（Bug 1106 / 1107）：进入**开作用域**的节点时把子作用域 id 前插到
 * 链首 ⇒ 回调能拿到「当前词法作用域链」（内层 → 外层，末尾是模块作用域）。
 */
function walkStatements(
  n: unknown,
  onStmt: (obj: Record<string, unknown> & { type?: string }, chain: ScopeChain) => void,
  chain: ScopeChain = [""],
): void {
  if (!n || typeof n !== "object") return;
  const obj = n as Record<string, unknown> & { type?: string };
  if (typeof obj.type === "string") onStmt(obj, chain);
  if (!STMT_CONTAINER.has(String(obj.type))) return;
  const childChain = scopeChainChild(chain, obj);
  for (const key of Object.keys(obj)) {
    if (key === "loc" || key === "start" || key === "end" || key === "leadingComments") continue;
    const val = obj[key];
    if (Array.isArray(val)) val.forEach((x) => walkStatements(x, onStmt, childChain));
    else if (val && typeof val === "object") walkStatements(val, onStmt, childChain);
  }
}

export function collectCallResolvers(
  source: string,
  knownFns: string[],
  opts?: {
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    fromFile?: string;
    file?: ReturnType<typeof parse>;
  },
): CallResolve {
  const knownSet = new Set(knownFns);
  /**
   * 作用域表（Bug 1106 / 1107）：模块作用域（id = `""`）的别名表 / 成员表
   * **就是** `aliasToFn` / `memberToFn`（保持旧形状与旧语义：模块作用域的
   * 绑定）；内层作用域的绑定进各自的帧。
   */
  const scopes: ScopeTable = { frames: new Map() };
  const moduleFrame = newScopeFrame();
  scopes.frames.set("", moduleFrame);
  const aliasToFn = moduleFrame.aliases;
  const memberToFn = moduleFrame.members;
  const externalFn = new Map<string, ExternalFnRef>();
  const externalMember = new Map<string, ExternalFnRef>();
  const file = opts?.file ?? parse(source);
  const load = opts?.loadModule;
  const fromFile = opts?.fromFile ?? "";
  const modCache = new Map<string, string | undefined>();
  /**
   * 按 (spec, 解析基文件) 加载——re-export 跳转必须相对中间模块，不是原始调用方。
   *
   * Bug 499：依赖**不可读**（EACCES/EIO/…）时 loader 抛错——异常不得穿透
   * 到 `nudo check` 的整轮外面。此处降级为「该依赖不可用」（undefined），
   * 调用图侧据此**跳过**该依赖的外部函数绑定（该依赖的类型面不可知，
   * 按缺依赖处理；check 面另有 nudo:module-missing 诊断收口可见性）。
   */
  const loadGuarded = load ? guardLoadModule(load) : undefined;
  const loadSpecFrom = (spec: string, from: string): string | undefined => {
    if (!loadGuarded) return undefined;
    const key = from + "\0" + spec;
    if (!modCache.has(key)) modCache.set(key, loadGuarded(spec, from));
    return modCache.get(key);
  };
  /** import spec → 被引模块的虚拟路径（interface 侧车解析基；无 fromFile 时不可得） */
  const extFromFile = (spec: string): string | undefined =>
    fromFile ? resolveDepPath(fromFile, spec) : undefined;
  /** 当前走查节点所属作用域的帧（`visit` 每轮更新；`bindExternal` 用它落外部绑定） */
  let currentFrame: ScopeFrame | undefined = moduleFrame;
  const bindExternal = (local: string, modSrc: string, fnName: string, spec: string): void => {
    const r = resolveExportSource(modSrc, fnName, loadSpecFrom, 0, fromFile, extFromFile(spec) ?? "");
    const ref: ExternalFnRef = {
      source: r.source,
      fnName,
      ...(r.fromFile ? { fromFile: r.fromFile } : {}),
    };
    externalFn.set(local, ref);
    // 外部绑定也要**按作用域**记（局部解构的 import 绑定会遮蔽模块级的同名
    // 绑定 ⇒ 若不记在这里，局部解构会把自己遮住 ⇒ 跨文件调用点解析不出）。
    currentFrame?.externals.set(local, ref);
  };
  /** 首跳加载：相对当前调用方文件（与既有口径一致） */
  const loadSpec = (spec: string): string | undefined => loadSpecFrom(spec, fromFile);

  /**
   * 走查回调：带**作用域链**（内层 → 外层）。
   *
   * - 本节点开作用域 ⇒ 先把它的帧登记进作用域表（子作用域 id 前插到链首）；
   * - 变量声明 / 赋值 ⇒ 记进**当前**作用域的帧（Bug 1107：成员绑定按作用域
   *   分桶 ⇒ 同名局部 / 参数不再互相串味）。
   */
  const visit = (n: unknown, chain: ScopeChain): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };
    // 本节点开的作用域 ⇒ 登记帧（子作用域）
    const childChain = scopeChainChild(chain, obj);
    const childFrame = scopeFrameOf(obj);
    if (childFrame && childChain !== chain) scopes.frames.set(childChain[0]!, childFrame);

    // 当前作用域的帧（链首；缺失 ⇒ 建空帧）
    const frame = ((): ScopeFrame => {
      const sid = chain[0] ?? "";
      let f = scopes.frames.get(sid);
      if (!f) {
        f = newScopeFrame();
        scopes.frames.set(sid, f);
      }
      return f;
    })();
    currentFrame = frame;

    // ESM：import { fn } / import { fn as x } / import * as ns from '...'
    if (obj.type === "ImportDeclaration") {
      const spec = obj.source as { type?: string; value?: unknown } | undefined;
      if (spec?.type === "StringLiteral" && typeof spec.value === "string") {
        const modSrc = loadSpec(String(spec.value));
        if (modSrc) {
          for (const sp of (obj.specifiers as Array<Record<string, unknown>> | undefined) ?? []) {
            if (sp.type === "ImportSpecifier") {
              const imported = sp.imported as { type?: string; name?: string; value?: unknown } | undefined;
              const local = sp.local as { type?: string; name?: string } | undefined;
              const exportName =
                imported?.type === "Identifier"
                  ? imported.name
                  : imported?.type === "StringLiteral"
                    ? String(imported.value)
                    : undefined;
              if (exportName && local?.name) {
                bindExternal(local.name, modSrc, exportName, String(spec.value));
              }
            } else if (sp.type === "ImportNamespaceSpecifier") {
              const local = sp.local as { type?: string; name?: string } | undefined;
              if (local?.name) {
                const from = extFromFile(String(spec.value));
                externalMember.set(
                  `${local.name}.__module__`,
                  { source: modSrc, fnName: "", ...(from ? { fromFile: from } : {}) },
                );
              }
            } else if (sp.type === "ImportDefaultSpecifier") {
              // Bug 442：绑定名不能写死 "default"——被调方的**契约绑定名**是
              // default 导出的**本地声明名**（`export default function calc` →
              // "calc"；`export default calc` / `export { calc as default }` →
              // "calc"），侧车按该名绑定（interface.ts 的 binding 走
              // exports[fnName]）。写死 "default" 时三条绑定分支全部落空
              // ⇒ 具名侧车永远绑不上 ⇒ 跨文件 default 导入的调用点假绿。
              // 匿名 default 导出（`export default function (x) {}`）取不到
              // 本地名 ⇒ 回落 "default"（侧车须写 `export default fn(…)`）。
              const local = sp.local as { type?: string; name?: string } | undefined;
              if (local?.name) {
                bindExternal(
                  local.name,
                  modSrc,
                  defaultExportLocalName(modSrc) ?? "default",
                  String(spec.value),
                );
              }
            }
          }
        }
      }
    }

    if (obj.type === "VariableDeclaration") {
      for (const d of (obj.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
        const id = d.id as { type?: string; name?: string; properties?: Array<Record<string, unknown>> };
        const init = d.init as Record<string, unknown> | null | undefined;
        if (!id || !init) continue;

        // 动态 import：const m = await import('./x') / const { fn } = await import('./x')
        const dynSpec = dynamicImportSpec(init);
        if (dynSpec) {
          const modSrc = loadSpec(dynSpec);
          if (modSrc && id.type === "ObjectPattern") {
            for (const p of id.properties ?? []) {
              const key = p.key as { type?: string; name?: string; value?: unknown } | undefined;
              const val = p.value as { type?: string; name?: string } | undefined;
              const exported =
                key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? String(key.value) : undefined;
              const local = val?.type === "Identifier" ? val.name : exported;
              if (exported && local) bindExternal(local, modSrc, exported, dynSpec);
            }
          }
          if (modSrc && id.type === "Identifier" && id.name) {
            const from = extFromFile(dynSpec);
            externalMember.set(
              `${id.name}.__module__`,
              { source: modSrc, fnName: "", ...(from ? { fromFile: from } : {}) },
            );
          }
        }

        // require 导入
        const spec = requireSpecOf(init);
        if (spec) {
          const modSrc = loadSpec(spec);
          // const { fn } = require(...)
          if (id.type === "ObjectPattern" && modSrc) {
            for (const p of id.properties ?? []) {
              const key = p.key as { type?: string; name?: string; value?: unknown } | undefined;
              const val = p.value as { type?: string; name?: string } | undefined;
              const exported =
                key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? String(key.value) : undefined;
              const local = val?.type === "Identifier" ? val.name : exported;
              if (exported && local) {
                bindExternal(local, modSrc, exported, spec);
              }
            }
          }
          // const m = require(...) → m.fn
          if (id.type === "Identifier" && id.name && modSrc) {
            const exportName = requireExportName(init);
            if (exportName) {
              bindExternal(id.name, modSrc, exportName, spec);
            } else {
              const from = extFromFile(spec);
              externalMember.set(
                `${id.name}.__module__`,
                { source: modSrc, fnName: "", ...(from ? { fromFile: from } : {}) },
              );
            }
          }
        }

        if (id.type !== "Identifier" || !id.name) continue;
        // const f = needsPositive
        if (init.type === "Identifier" && typeof init.name === "string" && knownSet.has(init.name)) {
          // 别名绑定进**当前作用域**（Bug 1106：内层的 `const f = g` 不该影响
          // 外层同名调用点的解析）
          frame.aliases.set(id.name, init.name);
        } else if (
          // 顶层函数声明（`const f = () => {}` / `const f = function(){}`）：
          // 它**就是** knownFns 里的那个顶层函数 ⇒ 不能进 `names`（否则顶层
          // 函数会把自己遮蔽掉 ⇒ 调用点解析不出 ⇒ 契约不执法 = 假绿）。
          (chain[0] ?? "") === "" &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        ) {
          // 保持现状：由 knownFns 解析（模块作用域的顶层函数）
        } else {
          // 其它声明 ⇒ 本作用域**声明**了这个名字（遮蔽判定用）
          frame.names.add(id.name);
        }
        // const api = { needsPositive }
        if (init.type === "ObjectExpression") {
          for (const p of (init.properties as Array<Record<string, unknown>> | undefined) ?? []) {
            if (p.type !== "ObjectProperty") continue;
            const key = p.key as { type?: string; name?: string; value?: unknown };
            const value = p.value as { type?: string; name?: string } | undefined;
            if (value?.type === "Identifier" && value.name && knownSet.has(value.name)) {
              const propKey =
                key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? String(key.value) : undefined;
              if (propKey) frame.members.set(`${id.name}.${propKey}`, value.name);
            }
          }
        }
        // Bug 441：本地类实例（const c = new C()）⇒ c.m ⇒ C.m。
        // 此前 memberToFn 只收**对象字面量**成员 ⇒ `c.m(-1)` 这类成员调用
        // 解析不出被调名 ⇒ 整条调用被跳过 ⇒ 类方法的侧车契约在任何调用点
        // 都不执法（假绿）；而契约绑定面（interface.ts 的 C_m ↔ C.m）认得。
        //
        // 方法名取自 knownFns（listTopFunctions 的 `Class.method` 命名空间）：
        // 与执法面的 knownFns 闸门（checkOneCall）**同源** ⇒ 不会映到执法面
        // 认不出的名字；也不必再写一份类方法抽取（scan-top-functions.ts 的
        // collectClassMethods）⇒ 无双实现、无求值时序依赖。
        //
        // Bug 1107：绑定进**当前作用域**的帧（不再只按变量名建一张全局表）
        // ⇒ 两个函数里的同名局部（`const c = new A()` / `const c = new B()`）
        // 不再互相串味。
        if (init.type === "NewExpression") {
          const ctor = init.callee as { type?: string; name?: string } | undefined;
          if (ctor?.type === "Identifier" && typeof ctor.name === "string") {
            const prefix = `${ctor.name}.`;
            for (const known of knownSet) {
              if (!known.startsWith(prefix)) continue;
              const method = known.slice(prefix.length);
              if (!method) continue;
              frame.members.set(`${id.name}.${method}`, known);
            }
          }
        }
      }
    }

    // Bug 1107：**重新赋值**使别名 / 成员绑定失效
    // （`let c = new C(); c = {m:x=>x}; c.m(-1)` ⇒ `c` 已不是那个实例 ⇒
    // 旧的 `c.m ⇒ C.m` 绑定必须作废，否则把**别的对象**的契约套上来）。
    if (obj.type === "AssignmentExpression" && obj.operator === "=") {
      const left = obj.left as { type?: string; name?: string } | undefined;
      if (left?.type === "Identifier" && typeof left.name === "string") {
        frame.aliases.delete(left.name);
        const prefix = `${left.name}.`;
        for (const key of [...frame.members.keys()]) {
          if (key.startsWith(prefix)) frame.members.delete(key);
        }
      }
    }
  };
  // 语句容器 walk：不进表达式树，O(语句) 而非 O(全部节点)
  walkStatements(file, visit);
  return { aliasToFn, memberToFn, externalFn, externalMember, scopes };
}

/**
 * 解析 callee → 同文件名或外部模块描述。
 *
 * `chain`（可选）= **作用域链**（内层 → 外层）：给了就**尊重词法作用域**
 * —— 外层函数的 param / 局部 `const` / 局部函数 / for-of 绑定 / 解构绑定与
 * 顶层声明同名时，**不**解析成顶层声明的那个函数（Bug 1106）；成员调用
 * `obj.prop` 也按作用域找绑定（Bug 1107）。
 */
export function resolveCalleeFn(
  callee: Record<string, unknown>,
  resolve: CallResolve,
  knownFns: Set<string>,
  chain?: ScopeChain,
): string | { external: ExternalFnRef } | undefined {
  if (callee.type === "Identifier" && typeof callee.name === "string") {
    const name = callee.name;
    // Bug 1106：作用域遮蔽优先于一切模块级回落
    if (chain) {
      const scoped = resolveScopedName(resolve, chain, name);
      if (scoped?.kind === "alias") return scoped.fn;
      if (scoped?.kind === "external") return { external: scoped.ref };
      if (scoped?.kind === "shadowed") return undefined;
    }
    const ext = resolve.externalFn.get(name);
    if (ext) return { external: ext };
    const aliased = resolve.aliasToFn.get(name);
    if (aliased) return aliased;
    if (knownFns.has(name)) return name;
    return undefined;
  }
  if (callee.type === "MemberExpression") {
    const obj = callee.object as { type?: string; name?: string } | undefined;
    const prop = callee.property as { type?: string; name?: string } | undefined;
    if (
      !callee.computed &&
      obj?.type === "Identifier" &&
      obj.name &&
      prop?.type === "Identifier" &&
      prop.name
    ) {
      const key = `${obj.name}.${prop.name}`;
      const extM = resolve.externalMember.get(key);
      if (extM) return { external: extM };
      // m = require(...)；调用 m.fn
      const mod = resolve.externalMember.get(`${obj.name}.__module__`);
      if (mod?.source) {
        return {
          external: {
            source: mod.source,
            fnName: prop.name,
            ...(mod.fromFile ? { fromFile: mod.fromFile } : {}),
          },
        };
      }
      // 同文件成员：对象字面量成员（const api = { f }）与**本地类实例**
      // （const c = new C() ⇒ c.m ⇒ C.m，收集侧建好）——
      // 两者都按 `接收者.属性` 取到源码函数名（Bug 441）。
      //
      // Bug 1107：给了作用域链就**按作用域**找绑定（同名局部 / 参数不再互相
      // 串味；被遮蔽的接收者不回落外层）。
      const local = chain
        ? resolveScopedMember(resolve, chain, obj.name, prop.name)
        : resolve.memberToFn.get(key);
      if (local) return local;
    }
  }
  return undefined;
}

/**
 * 无条件转发：`function w(a,b){ return target(a,b); }`
 * 或箭头 `const w = (a) => target(a)`。
 * map[i] = wrapper 第 i 参 → target 的第几参。
 */
export type Forward = { target: string; map: number[] };

export function collectForwarders(
  source: string,
  knownFns: Set<string>,
  resolve: CallResolve,
  fileAst?: ReturnType<typeof parse>,
): Map<string, Forward> {
  const forwards = new Map<string, Forward>();
  const file = fileAst ?? parse(source);

  const tryFn = (
    name: string,
    params: Array<{ type?: string; name?: string }>,
    body: Record<string, unknown> | undefined,
    fnNode: Record<string, unknown>,
    chain: ScopeChain,
  ): void => {
    if (!name || !params.length) return;
    const paramNames = params.map((p) => (p?.type === "Identifier" ? p.name : undefined));
    if (paramNames.some((n) => !n)) return;

    // body: BlockStatement 仅一条 ReturnStatement(CallExpression)
    //      或箭头表达式体 CallExpression
    let call: Record<string, unknown> | undefined;
    if (body?.type === "BlockStatement") {
      const stmts = (body.body as Array<Record<string, unknown>> | undefined) ?? [];
      if (stmts.length !== 1 || stmts[0]!.type !== "ReturnStatement") return;
      const arg = stmts[0]!.argument as Record<string, unknown> | undefined;
      if (arg?.type !== "CallExpression") return;
      call = arg;
    } else if (body?.type === "CallExpression") {
      call = body;
    }
    if (!call) return;

    // 作用域链（Bug 1106）：转发体里的被调名要按**词法作用域**解析 ——
    // 形参 / 局部同名时不是顶层声明的那个函数。
    const bodyChain =
      body?.type === "BlockStatement"
        ? scopeChainChild(scopeChainChild(chain, fnNode), body)
        : scopeChainChild(chain, fnNode);
    const resolved = resolveCalleeFn(
      call.callee as Record<string, unknown>,
      resolve,
      knownFns,
      bodyChain,
    );
    if (!resolved || typeof resolved !== "string") return;
    if (!knownFns.has(resolved) || resolved === name) return;

    const args = (call.arguments as Array<Record<string, unknown>> | undefined) ?? [];
    if (args.length === 0) return;
    // 每个实参必须是 wrapper 自己的参数标识符
    const map: number[] = [];
    for (const a of args) {
      if (a.type !== "Identifier" || typeof a.name !== "string") return;
      const idx = paramNames.indexOf(a.name);
      if (idx < 0) return;
      map.push(idx);
    }
    forwards.set(name, { target: resolved, map });
  };

  walkStatements(file, (obj, chain) => {
    if (obj.type === "FunctionDeclaration") {
      const id = obj.id as { name?: string } | undefined;
      tryFn(
        id?.name ?? "",
        (obj.params as Array<{ type?: string; name?: string }>) ?? [],
        obj.body as Record<string, unknown>,
        obj,
        chain,
      );
    }
    if (obj.type === "VariableDeclaration") {
      for (const d of (obj.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
        const id = d.id as { type?: string; name?: string };
        const init = d.init as Record<string, unknown> | null | undefined;
        if (
          id?.type === "Identifier" &&
          id.name &&
          init &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        ) {
          tryFn(
            id.name,
            (init.params as Array<{ type?: string; name?: string }>) ?? [],
            init.body as Record<string, unknown>,
            init,
            chain,
          );
        }
      }
    }
  });
  return forwards;
}
