/**
 * AST 辅助：函数收集 / 形参 / 定位 / 节点 Abs 表。
 * 自 analyzer.ts 机械拆出；语义未改。
 */
import type { Node, Statement, ClassDeclaration } from "@babel/types";
import traverse from "@babel/traverse";
import {
  type Abs,
  type Environment,
  type FormalParam,
  formalParamsFromNodes,
  formalParamDisplayNames,
  unknown as absUnknown,
  abs as makeAbsVal,
  numLit,
  strLit,
  boolLit,
} from "@nudojs/core";
import {
  programBody,
  getDeclarations,
  getDeclaratorInit,
  getFirstDeclaratorId,
  getExpressionStatementExpression,
  unwrapExport,
  asIdentifier,
  asAssignmentExpression,
  classIdName,
  fnOrClassIdLoc,
  isModuleExportsMember,
  memberPropertyKey,
  classMemberKeyName,
  classInstanceMethods,
  getClassMembers,
  methodFunctionNode,
  exportSpecifierLocalName,
  exportSpecifierExportedName,
  unwrapDefaultExport,
} from "@nudojs/parser";
import type { BindingInfo, SourceLocation } from "./analyzer-types.ts";

export function locFromNode(node: Node): SourceLocation {
  return {
    start: { line: node.loc?.start.line ?? 1, column: node.loc?.start.column ?? 0 },
    end: { line: node.loc?.end.line ?? 1, column: node.loc?.end.column ?? 0 },
  };
}

/**
 * 形参表面（formal param surface）。
 *
 * Bug 479：`.ts` 源的形参带**声明类型文本**（`FormalParam.tsType`，来自剥除
 * pass 的旁路 `nudoTypeText`）⇒ 推断面（entry@ 实参）与产物面（dts 参数位）
 * 据此读回用户在源码里写下的类型。无注解（.js 源 / 未标注）⇒ 无 `tsType`
 * ⇒ 两个面都走既有路径（any / case-widen），行为不变。
 */
export function extractFormals(node: Node, source?: string): FormalParam[] {
  const fn = node.type === "ExportDefaultDeclaration" ? node.declaration : node;
  let params: unknown[] | undefined;
  if (
    fn.type === "FunctionDeclaration" ||
    fn.type === "FunctionExpression" ||
    fn.type === "ArrowFunctionExpression" ||
    fn.type === "ClassMethod" ||
    fn.type === "ObjectMethod" ||
    fn.type === "TSDeclareMethod"
  ) {
    params = (fn as { params?: unknown[] }).params;
  } else if (fn.type === "VariableDeclaration") {
    const init = getDeclaratorInit(getDeclarations(fn)[0]);
    if (init && (init.type === "FunctionExpression" || init.type === "ArrowFunctionExpression")) {
      params = init.params;
    }
  }
  // BUG-169：把源码文本透传给 core —— TS 可选形参 `b?: T` 的 `?` 在
  // strip-types 阶段被删，只能从源码文本判定（`tsOptionalParams`）。
  const formals = formalParamsFromNodes(params as never, source);
  // Bug 479（core 侧缺口的服务侧兜底）：Babel 8 把 **rest 形参**的类型注解
  // 挂在 RestElement 节点上（`...rest: number[]` ⇒ RestElement.nudoTypeText）。
  // core `param-surface.ts` 现已优先读节点侧旁路（内层标识符为老口径兜底），
  // 本兜底在 core 修好后**自动退化为 no-op**；保留以防 core 侧回退。
  // 其余形参形态（id / default / pattern）core 已取到。
  for (let i = 0; i < formals.length; i++) {
    const f = formals[i]!;
    if (f.kind !== "rest" || f.tsType !== undefined) continue;
    const t = (params?.[i] as { nudoTypeText?: string } | undefined)?.nudoTypeText;
    if (typeof t === "string" && t.length > 0) f.tsType = t;
  }
  // Bug 397（core 侧缺口的服务侧兜底）：TS 的 `this: T` 是**接收者标注**，不是
  // 运行时形参 —— Babel 的 TS 插件把它解析成普通 `Identifier("this")`（不是
  // TSParameterProperty）⇒ 与真形参在 AST 层无法区分。
  //
  // core `param-surface.ts` 现已在 Identifier 分支跳过名字为 `this` 的形参，
  // 本兜底在 core 修好后**自动退化为 no-op**；保留以防 core 侧回退。
  //
  // 为什么要兜：形参表多一槽 ⇒ **四个产物面同时错位** ——
  //  dts 多一个形参 ⇒ 消费方吃 TS2554 假红；
  //  zod 多一个字面量槽 "this" ⇒ 对每一个真实调用值报假红；
  //  standard 多一个幽灵导出 `<fn>_this`；
  //  case 的实参整体错位一格（`(1)` 被绑到 `this` 上 ⇒ 真实形参拿不到值）。
  //
  // 过滤后必须**重排 index**（index 是形参表内的位置 ⇒ 实参位靠它对齐）。
  const withoutThis = formals.filter((f) => !(f.kind === "id" && f.name === "this"));
  if (withoutThis.length === formals.length) return formals;
  return withoutThis.map((f, i) => (f.index === i ? f : { ...f, index: i }));
}

export function extractParamNames(node: Node): string[] {
  return formalParamDisplayNames(extractFormals(node));
}

export function resolveFunctionNode(node: Node): Node {
  if (node.type === "ExportNamedDeclaration" && node.declaration) return resolveFunctionNode(node.declaration);
  if (node.type === "ExportDefaultDeclaration") return resolveFunctionNode(node.declaration);
  if (node.type === "VariableDeclaration") {
    const init = getDeclaratorInit(getDeclarations(node)[0]);
    if (init && (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")) return init;
  }
  return node;
}

/** 函数声明名的标识符定位（无 id 的箭头函数回退声明节点）——诊断高亮
 *  应落函数名 token，而非 function 关键字 / 参数表起点 */
export function fnNameLoc(node: Node, fallback: SourceLocation): SourceLocation {
  const { declaration: d } = unwrapExport(node);
  if (d.type === "VariableDeclaration") {
    const id = getFirstDeclaratorId(d);
    if (id?.loc) return id.loc;
  }
  const idLoc = fnOrClassIdLoc(d);
  if (idLoc) return idLoc;
  return fallback;
}

export function isFnExprValue(node: Node | null | undefined): node is Node {
  return !!node && (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression");
}

export function namedFnExprId(node: Node): string | null {
  return node.type === "FunctionExpression" && node.id ? node.id.name : null;
}

/**
 * Object member key as a slot name (`{ f: fn }` → "f"; `{ 1: fn }` → "1").
 * Identifier / StringLiteral / NumericLiteral keys only — computed keys have
 * no stable name (same口径 as core listTopFunctions' CJS branch).
 */
export function objectMemberKeyName(member: Node | null | undefined): string | null {
  const key = classMemberKeyName(member);
  return key === undefined ? null : String(key);
}

/** `module.exports` — the only assignment target carrying no stable name of its own. */
export function isModuleExportsTarget(node: Node): boolean {
  return node.type === "MemberExpression" && !node.computed && isModuleExportsMember(node);
}

export { memberPropertyKey };

/** Rightmost value of a chained assignment (`a = b = fn` → fn). */
export function deepestAssignValue(expr: Node): Node | null {
  let cur: Node | null | undefined = expr;
  while (cur) {
    const assign = asAssignmentExpression(cur);
    if (!assign) break;
    cur = assign.right;
  }
  return cur ?? null;
}

/**
 * First stable name on an assignment chain, left to right: an identifier
 * binding, or a member property that is not `module.exports` itself. Returns
 * null for chains ending in a bare `module.exports = fn` or in computed
 * members (`exports[k] = fn`) — callers fall back to "default".
 */
export function assignmentChainName(expr: Node): string | null {
  let cur: Node | null | undefined = expr;
  while (cur) {
    const assign = asAssignmentExpression(cur);
    if (!assign) break;
    const target = assign.left as Node;
    if (target.type === "Identifier") return target.name;
    if (target.type === "MemberExpression") {
      if (isModuleExportsTarget(target)) {
        cur = assign.right;
        continue;
      }
      return memberPropertyKey(target);
    }
    return null;
  }
  return null;
}

/**
 * Top-level functions eligible for case synthesis. Besides FunctionDeclarations
 * this collects CJS-style function bindings:
 *
 *   const f = function () {};                           // declarator init
 *   export const f = function () {};                    // exported declarator
 *   exports.applyToDefaults = function (a, b) {};       // namespace property
 *   module.exports = internals.clone = function () {};  // chained export
 *   module.exports = { applyToDefaults: function () {} }; // CJS object literal
 *
 * Naming: identifier bindings win (call sites dispatch on them, and the
 * evaluator's call records key on the callee identifier); for CJS member
 * assignments the **export slot name wins over a named function expression's
 * own id** (Bug 997 — the inner id is not the export slot: taking it left the
 * sidecar contract unbound and the export symbol out of the signature table);
 * a bare `module.exports = fn` becomes "default" (ESM default-export analogue).
 * Collected non-declaration entries carry `noDeclaration` — see FunctionAnalysis.
 *
 * `assignedName` carries the **alternate name** when it differs from the census
 * name (named `export default function f` → slot "default"; a CJS member
 * assignment with a named function expression → the inner function id): the
 * entry evaluation falls back to it when the census name itself is not
 * resolvable.
 *
 * Member / class-method calls are recorded as `Class.method` / bare `method`
 * (see `$invoke` noteEvalCallRecord) and synthesize `call@` the same way.
 */
export function collectTopLevelFunctions(
  ast: Node,
): { name: string; node: Node; stmt: Node; noDeclaration: boolean; assignedName?: string }[] {
  const results: { name: string; node: Node; stmt: Node; noDeclaration: boolean; assignedName?: string }[] = [];
  if (ast.type !== "File") return results;
  const body = programBody(ast);

  // C4.2：class 导出面与 core localNamedExports 同口径——
  // export class / class+export list / export default Class/Identifier
  const classDecls = new Map<string, { node: ClassDeclaration; stmt: Node }>();
  const exportedClassNames = new Set<string>();
  const collectClassMethods = (cname: string, decl: ClassDeclaration, stmt: Node): void => {
    // Bug 437：静态方法与实例方法**同名**时普查名不得相同（core
    // `scan-top-functions.ts` 的 `collectClassMethods` 同口径）—— 否则按名字
    // 索引的表里两条记录互相顶替（形参取自一个、返回值取自另一个 ⇒ 自信的
    // 错误值），且 dts 类体里出现重复成员声明。类方法名是 `Class.method`
    // （方法体也按这个键登记）⇒ 不能给静态方法另起一个名字 ⇒ 同名时
    // **只登记实例方法**。
    const instanceKeys = new Set<string>();
    for (const { name: keyName, node: methodNode } of classInstanceMethods(decl)) {
      instanceKeys.add(keyName);
      results.push({
        name: `${cname}.${keyName}`,
        node: methodNode,
        stmt,
        noDeclaration: true,
      });
    }
    // ★ 族 28 接线（Bug 856）：**静态方法**与实例方法同为入口可见
    // （core `scan-top-functions.ts` 的 `collectClassMethods` 就是同口径：
    //  静态 + 实例都收）。此前 service 侧只收实例方法（parser 的
    //  `classInstanceMethods` 刻意跳过 static —— 那是 parser 的**契约**，
    //  不是缺陷）⇒ `nudo test` / `nudo health` / `nudo contract` 的函数
    // 普查**看不见**静态方法（`nudo check` 的签名面却看得见 ⇒ 两面矛盾）。
    // ⇒ 复用 parser **已导出**的 `getClassMembers` / `classMemberKeyName` /
    //   `methodFunctionNode`（**parser 导出面零新增** ✓）。
    for (const member of getClassMembers(decl)) {
      const m = member as { static?: boolean; kind?: string; type?: string };
      if (m.static !== true) continue;
      // 白名单式：只收**方法**节点。Babel 的类字段是 `ClassProperty`，它
      // **没有** `kind` 字段（只有 ClassMethod / MethodDefinition 才有
      // `kind: "method"|"get"|"set"`）⇒ 旧的 `m.kind !== undefined && …`
      // 过滤会**放行静态字段** ⇒ 字段被当成方法收进函数表（Bug 139：dts 面
      // 把 `K.s` 投影成实例方法 `s(): unknown`、check 面看不见、运行时不符）。
      if (
        m.type !== "ClassMethod" &&
        m.type !== "MethodDefinition" &&
        m.type !== "TSDeclareMethod"
      ) {
        continue; // 类字段 / 构造器 / 访问器都跳过（访问器另行处理）
      }
      const keyName = classMemberKeyName(member);
      const methodNode = methodFunctionNode(member);
      if (typeof keyName !== "string" || !methodNode) continue;
      if (instanceKeys.has(keyName)) continue; // 同名 ⇒ 实例方法占位（见上）
      results.push({
        name: `${cname}.${keyName}`,
        node: methodNode,
        stmt,
        noDeclaration: true,
      });
    }
  };

  for (const stmt of body) {
    const className = classIdName(stmt);
    if (stmt.type === "ClassDeclaration" && className) {
      classDecls.set(className, { node: stmt, stmt });
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      const d = stmt.declaration;
      const exportedClassName = classIdName(d);
      if (d?.type === "ClassDeclaration" && exportedClassName) {
        classDecls.set(exportedClassName, { node: d, stmt });
        exportedClassNames.add(exportedClassName);
        continue;
      }
      if (!d && stmt.specifiers) {
        for (const spec of stmt.specifiers) {
          if (spec.type !== "ExportSpecifier") continue;
          const local = exportSpecifierLocalName(spec);
          const exported = exportSpecifierExportedName(spec);
          if (!local) continue;
          // export { Local as Public } / export { Foo }：按本地声明名收集
          if (classDecls.has(local) || body.some((s) => classIdName(s) === local)) {
            exportedClassNames.add(local);
          }
          if (exported === "default") exportedClassNames.add(local);
        }
        continue;
      }
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration;
      const defaultClassName = classIdName(d);
      if (d?.type === "ClassDeclaration" && defaultClassName) {
        classDecls.set(defaultClassName, { node: d, stmt });
        exportedClassNames.add(defaultClassName);
      } else if (d?.type === "ClassDeclaration") {
        // **匿名** `export default class { … }`（Bug 152）：没有本地名，导出槽名
        // 就是 "default" ⇒ 按槽名登记（否则两个分支都落空 ⇒ 该类的成员
        // 在函数普查里完全消失：`nudo export` 早退、消费端 TS2307）。
        classDecls.set("default", { node: d, stmt });
        exportedClassNames.add("default");
      } else {
        const idName = asIdentifier(d as Node)?.name;
        if (idName) exportedClassNames.add(idName);
      }
      continue;
    }
  }

  for (const stmt of body) {
    const decl = resolveFunctionNode(stmt);
    if (decl.type === "FunctionDeclaration" && decl.id) {
      // 具名 default 导出（export default function f）：普查名 = 本地名
      // （与 core listTopFunctions 同口径），但模块的导出槽是 "default"
      // （本地名不是导出名）——记下槽名，entry@ 求值在按名未命中时回退。
      const assignedName = stmt.type === "ExportDefaultDeclaration" ? "default" : undefined;
      results.push({
        name: decl.id.name,
        node: decl,
        stmt,
        noDeclaration: false,
        ...(assignedName ? { assignedName } : {}),
      });
      continue;
    }
    // C4.2/D6：导出 class 实例方法 → `Class.method`（dts 无稳定声明形态，noDeclaration）
    if (decl.type === "ClassDeclaration" && decl.id?.name) {
      continue; // 已在导出扫描后统一收集
    }
    if (stmt.type === "ExportNamedDeclaration") {
      const declared = stmt.declaration;
      // export const/let/var f = fn —— 与 core listTopFunctions 的
      // VariableDeclaration 分支同口径（core 对 export 包装同样收：
      // decl = stmt.declaration 后走同一条 declarator 收集）。
      // 普查名 = 变量名（= 导出槽名），entry@ 求值按导出表命中。
      if (declared?.type === "VariableDeclaration") {
        for (const declarator of getDeclarations(declared)) {
          const id = asIdentifier(declarator.id as Node);
          if (id && isFnExprValue(declarator.init)) {
            results.push({ name: id.name, node: declarator.init, stmt, noDeclaration: true });
          }
        }
        continue;
      }
      const d = resolveFunctionNode(stmt);
      if (d.type === "FunctionDeclaration" && d.id) {
        results.push({ name: d.id.name, node: d, stmt, noDeclaration: false });
      }
      if (d.type === "ClassDeclaration" && d.id?.name) {
        // 交给下方 exportedClassNames 循环
      }
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const d: Node = stmt.declaration;
      // 具名 default 导出在上面（resolveFunctionNode → FunctionDeclaration）
      // 已收；这里只剩匿名 default 形态（普查名 = 导出槽 "default"）。
      if (d.type === "FunctionDeclaration") {
        results.push({ name: "default", node: d, stmt, noDeclaration: true });
      } else if (isFnExprValue(d)) {
        results.push({ name: "default", node: d, stmt, noDeclaration: true });
      }
      continue;
    }
    if (stmt.type === "VariableDeclaration") {
      for (const declarator of getDeclarations(stmt)) {
        const id = asIdentifier(declarator.id as Node);
        if (id && isFnExprValue(declarator.init)) {
          results.push({ name: id.name, node: declarator.init, stmt, noDeclaration: true });
        }
      }
      continue;
    }
    const expr = getExpressionStatementExpression(stmt);
    if (expr?.type === "AssignmentExpression") {
      const fn = deepestAssignValue(expr);
      if (isFnExprValue(fn)) {
        // Bug 997：**导出槽名优先** —— 具名函数表达式的内层 id（`function inner()`）
        // 不是导出槽名；取内层 id 会让侧车契约整个不绑定（键查不到 ⇒ L1 门禁
        // 假绿）+ 签名表里导出符号消失。槽名缺失（裸 `module.exports = fn`）才
        // 回退内层 id。
        const chain = assignmentChainName(expr);
        const fnId = namedFnExprId(fn);
        const name = chain ?? fnId ?? "default";
        // 回退名：内层函数 id（槽名求值不中时按它自己再试一次）
        const assignedName = fnId && fnId !== name ? fnId : undefined;
        results.push({ name, node: fn, stmt, noDeclaration: true, ...(assignedName ? { assignedName } : {}) });
      } else if (isModuleExportsTarget(expr.left as Node)) {
        // module.exports = { f: fn } —— 与 core listTopFunctions 的 CJS 分支同口径：
        // 逐个 ObjectProperty / ObjectMethod 取成员函数（key 名 = 导出槽名）。
        const objLit = expr.right as Node;
        if (objLit?.type === "ObjectExpression") {
          for (const prop of objLit.properties) {
            if (prop.type === "ObjectMethod") {
              // 只收普通方法：getter / setter 不是可调用入口
              if (prop.kind !== "method") continue;
              const keyName = objectMemberKeyName(prop);
              if (!keyName) continue;
              results.push({
                name: keyName,
                node: prop,
                stmt,
                noDeclaration: true,
                assignedName: keyName,
              });
              continue;
            }
            if (prop.type !== "ObjectProperty") continue;
            const value = prop.value as Node;
            if (!isFnExprValue(value)) continue;
            const keyName = objectMemberKeyName(prop);
            // Bug 997：**导出槽名优先**（core: fallbackName ?? r.id?.name）——
            // 命名函数表达式的自有 id 不夺走导出槽的身份
            const fnId = namedFnExprId(value);
            const name = keyName ?? fnId;
            if (!name) continue;
            const assignedName = fnId && fnId !== name ? fnId : undefined;
            results.push({
              name,
              node: value,
              stmt,
              noDeclaration: true,
              ...(assignedName ? { assignedName } : {}),
            });
          }
        }
      }
    }
  }

  for (const cname of exportedClassNames) {
    const hit = classDecls.get(cname);
    if (!hit) continue;
    collectClassMethods(cname, hit.node, hit.stmt);
  }
  return results;
}

/** The function value of the file's single `module.exports = <function>`
 * top-level assignment, when there is exactly one. Assigning module.exports
 * replaces the whole exports object, so such a file exports exactly that one
 * function and usage-site records may reach it under any re-export name —
 * matching by targetModule alone is then unambiguous. Returns null for
 * multi-export shapes (no such assignment, several, or `module.exports =
 * {...}`), where a name/alias match is still required so sibling functions
 * don't get misattributed. */
export function findSingleModuleExportsFunction(ast: Node): Node | null {
  if (ast.type !== "File") return null;
  let found: Node | null = null;
  for (const stmt of programBody(ast)) {
    const expr = getExpressionStatementExpression(stmt);
    if (expr?.type !== "AssignmentExpression") continue;
    const fn = deepestAssignValue(expr);
    if (!isFnExprValue(fn)) continue;
    let targetsModuleExports = false;
    let cur: Node | null | undefined = expr;
    while (cur) {
      const assign = asAssignmentExpression(cur);
      if (!assign) break;
      if (isModuleExportsTarget(assign.left as Node)) {
        targetsModuleExports = true;
        break;
      }
      cur = assign.right;
    }
    if (!targetsModuleExports) continue;
    if (found) return null; // a second `module.exports = fn` → ambiguous
    found = fn;
  }
  return found;
}

/**
 * CJS 对象字面量导出的**可调用成员键**（`module.exports = { h(){} }` → `{"h"}`）。
 *
 * BUG-045：这类成员既不是模块作用域绑定，也不是顶层导出槽 —— 按名取必然落空
 * （求值面 ⇒ `unknown` ⇒ dts/schema/guard 三方言一起退化，guard 变 `return true`）。
 * 普查（{@link collectTopLevelFunctions} 的 CJS 分支）与 core 的导出槽解析
 * （`algebra/export-slot.ts` 的 `cjsMemberSlotsOf`）都以**成员键**为导出槽口径
 * ⇒ 求值面必须按同一张表派发成员调用，三面才同源。
 *
 * 口径与普查逐项一致：只收对象方法（`kind === "method"`——getter/setter 读出的
 * 是值不是可调用入口）与**函数值**属性；键名只认稳定键（计算键无槽名）。
 */
export function cjsObjectExportMemberNames(ast: Node): Set<string> {
  const out = new Set<string>();
  if (ast.type !== "File") return out;
  for (const stmt of programBody(ast)) {
    const expr = getExpressionStatementExpression(stmt);
    if (expr?.type !== "AssignmentExpression") continue;
    if (!isModuleExportsTarget(expr.left as Node)) continue;
    const objLit = expr.right as Node | null | undefined;
    if (objLit?.type !== "ObjectExpression") continue;
    for (const prop of objLit.properties) {
      if (prop.type === "ObjectMethod") {
        if (prop.kind !== "method") continue;
        const key = objectMemberKeyName(prop);
        if (key) out.add(key);
        continue;
      }
      if (prop.type !== "ObjectProperty") continue;
      if (!isFnExprValue(prop.value as Node)) continue;
      const name = objectMemberKeyName(prop) ?? namedFnExprId(prop.value as Node);
      if (name) out.add(name);
    }
  }
  return out;
}

export function collectBindings(
  ast: Node,
  env: Environment,
  bindings: Map<string, BindingInfo>,
  absBinds?: Map<string, Abs>,
): void {
  if (ast.type !== "File") return;
  const setBinding = (name: string, loc: SourceLocation): void => {
    const absVal = absBinds?.get(name) ?? absUnknown;
    bindings.set(name, {
      abs: absVal,
      loc,
    });
  };
  const walk = (body: Statement[]): void => {
    for (const stmt of body) {
      if (stmt.type === "FunctionDeclaration" && stmt.id) {
        setBinding(stmt.id.name, locFromNode(stmt));
      }
      if (stmt.type === "VariableDeclaration") {
        for (const decl of stmt.declarations) {
          if (decl.id.type === "Identifier") {
            setBinding(decl.id.name, locFromNode(decl));
          }
        }
      }
      if (stmt.type === "ClassDeclaration" && stmt.id) {
        setBinding(stmt.id.name, locFromNode(stmt));
      }
      if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
        walk([stmt.declaration]);
      }
    }
  };
  walk(programBody(ast));
}

export function nullLitAbs(): Abs {
  return makeAbsVal({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
}

export function buildNodeTypeMap(
  ast: Node,
  env: Environment,
  nodeAbsMap: Map<Node, Abs>,
): void {
  const traverseFn = unwrapDefaultExport(traverse);
  try {
    traverseFn(ast, {
      enter(path) {
        const node = path.node;
        try {
          const setAbs = (a: Abs): void => {
            nodeAbsMap.set(node, a);
          };
          if (
            node.type === "Identifier" &&
            node.name !== "undefined" &&
            path.parentPath?.node.type !== "FunctionDeclaration" &&
            path.parentPath?.node.type !== "VariableDeclarator"
          ) {
            if (env.has(node.name)) {
              setAbs(env.lookup(node.name));
            }
          }
          if (node.type === "NumericLiteral") {
            setAbs(numLit(node.value));
          }
          if (node.type === "StringLiteral") {
            setAbs(strLit(node.value));
          }
          if (node.type === "BooleanLiteral") {
            setAbs(boolLit(node.value));
          }
          if (node.type === "NullLiteral") {
            setAbs(nullLitAbs());
          }
        } catch {
          // skip nodes that fail
        }
      },
    });
  } catch {
    // traverse may fail on partial ASTs
  }
}
