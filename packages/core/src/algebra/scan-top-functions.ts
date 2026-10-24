/**
 * 顶层函数清单：function 声明 + const 箭头/函数表达式（含 export 包装）
 *  + **导出 class 的实例方法**（C4.2，命名 `Class.method`）。
 *  P1：本地 `class Foo` 经 `export { Foo }` / `export { Foo as default }` /
 *  `export default Foo` 导出时同样登记实例方法。
 *
 * ⚠ 本清单 = **函数**普查面（与 service 面 `collectTopLevelFunctions` 逐字
 * 对齐 ⇒ 改这里必须同步改 service 面）。**类导出入口**（`new C()`）是另一
 * 个面 ⇒ 见 {@link listClassEntryNames}（check 面专用，不进函数普查）。
 *
 * 从 scan.ts 拆出：纯 AST 清单，无调用图状态。
 */

import { parseSource as parse } from "./parse-source.ts";
import type { Node } from "@babel/types";

export function listTopFunctions(source: string, file?: ReturnType<typeof parse>): string[] {
  const f = file ?? parse(source);
  const names: string[] = [];
  /** 本地 ClassDeclaration（含未直接 export 的） */
  const localClasses = new Map<string, Node>();
  for (const stmt of f.program.body) {
    if (stmt.type === "ClassDeclaration") {
      const cname = (stmt as { id?: { name?: string } }).id?.name;
      if (cname) localClasses.set(cname, stmt);
    }
  }
  /** 经任意 export 形态暴露的 class 本地名 */
  const exportedClassNames = new Set<string>();
  const collectClassMethods = (cname: string, decl: Node) => {
    const body = (decl as { body?: { body?: unknown[] } }).body?.body ?? [];
    // Bug 437：静态方法与实例方法**同名**时，普查名不得相同 —— 否则按名字索引
    // 的签名表里两条记录互相顶替（形参取自一个、返回值取自另一个 ⇒ 自信的
    // 错误值）。类方法名是 `Class.method`（`generalize` 的 env.fns 也按这个键
    // 登记方法体）⇒ **不能**给静态方法另起一个名字（那样查不到方法体 ⇒
    // 凭空造出 L2 入口 may-throw 假红）。⇒ 同名时**只登记实例方法**
    // （静态方法在 `nudo check` 签名面不再重复出现；service 侧同口径）。
    const instanceKeys = new Set<string>();
    /** 源序的方法（key, isStatic）——静态与实例同名时只登记实例方法 */
    const methods: Array<{ key: string; isStatic: boolean }> = [];
    for (const m of body) {
      const mem = m as {
        type?: string;
        kind?: string;
        key?: { type?: string; name?: string };
        static?: boolean;
      };
      const isMethod =
        mem.type === "MethodDefinition" ||
        mem.type === "ClassMethod" ||
        mem.type === "TSDeclareMethod";
      if (!isMethod) continue;
      if (mem.kind && mem.kind !== "method") continue; // skip ctor/get/set
      const keyName =
        mem.key?.type === "Identifier" ? mem.key.name : undefined;
      if (!keyName) continue;
      const isStatic = mem.static === true;
      methods.push({ key: keyName, isStatic });
      if (!isStatic) instanceKeys.add(keyName);
    }
    for (const m of methods) {
      if (m.isStatic && instanceKeys.has(m.key)) continue; // 同名 ⇒ 实例方法占位
      names.push(`${cname}.${m.key}`);
    }
  };
  for (const stmt of f.program.body) {
    let decl: Node = stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
      // export default (…) => … / function (…)：本地键 default
      if (
        decl.type === "ArrowFunctionExpression" ||
        decl.type === "FunctionExpression"
      ) {
        if (!names.includes("default")) names.push("default");
      }
    }
    if (decl.type === "FunctionDeclaration" && decl.id) names.push(decl.id.name);
    if (
      decl.type === "FunctionDeclaration" &&
      !decl.id &&
      stmt.type === "ExportDefaultDeclaration"
    ) {
      if (!names.includes("default")) names.push("default");
    }
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (
          d.id.type === "Identifier" &&
          d.init &&
          (d.init.type === "ArrowFunctionExpression" ||
            d.init.type === "FunctionExpression")
        ) {
          names.push(d.id.name);
        }
      }
    }
    // C4.2：导出 class 的普通实例方法 → `Class.method`（跳过 ctor/get/set）
    if (
      decl.type === "ClassDeclaration" &&
      (decl as { id?: { name?: string } }).id?.name &&
      (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration")
    ) {
      const cname = (decl as { id: { name: string } }).id.name;
      exportedClassNames.add(cname);
      collectClassMethods(cname, decl);
    }
  }
  // P1：export { Foo } / export { Foo as default } / export default Foo
  for (const stmt of f.program.body) {
    if (stmt.type === "ExportNamedDeclaration" && !stmt.declaration) {
      const specs = (stmt as { specifiers?: unknown[] }).specifiers ?? [];
      for (const spec of specs) {
        const s = spec as {
          type?: string;
          local?: { name?: string };
          exported?: { name?: string; value?: unknown };
        };
        if (s.type !== "ExportSpecifier") continue;
        const localName = s.local?.name;
        if (!localName || exportedClassNames.has(localName)) continue;
        const exportedName = s.exported?.name ?? s.exported?.value;
        const isDefault = exportedName === "default";
        // 只在「导出到外部」时登记：export { Foo } 或 export { Foo as default }
        if (!isDefault && exportedName !== localName) {
          // export { Foo as Bar }：仍导出 class，方法键按本地名
        }
        const decl = localClasses.get(localName);
        if (!decl) continue;
        exportedClassNames.add(localName);
        collectClassMethods(localName, decl);
      }
    }
    if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      const d = stmt.declaration;
      if (d.type === "Identifier") {
        const localName = d.name;
        if (!exportedClassNames.has(localName)) {
          const decl = localClasses.get(localName);
          if (decl) {
            exportedClassNames.add(localName);
            collectClassMethods(localName, decl);
          }
        }
      }
    }
  }
  // CJS：exports.f = fn / module.exports.f = fn / module.exports = { f: fn }
  for (const stmt of f.program.body) {
    if (stmt.type !== "ExpressionStatement") continue;
    const expr = (stmt as { expression?: unknown }).expression as
      | { type?: string; left?: unknown; right?: unknown }
      | undefined;
    if (!expr || expr.type !== "AssignmentExpression") continue;
    const left = expr.left as {
      type?: string;
      object?: { type?: string; name?: string; object?: { name?: string }; property?: { name?: string } };
      property?: { type?: string; name?: string; value?: unknown };
      computed?: boolean;
    } | undefined;
    const right = expr.right;
    if (!left || left.type !== "MemberExpression" || left.computed) continue;
    const obj = left.object;
    const prop = left.property;
    const propName =
      prop?.type === "Identifier"
        ? prop.name
        : prop?.type === "StringLiteral" || prop?.type === "NumericLiteral"
          ? String(prop.value)
          : undefined;
    const isExportsIdent = !!obj && obj.type === "Identifier" && obj.name === "exports";
    const isModuleExportsMember =
      !!obj &&
      obj.type === "MemberExpression" &&
      obj.object?.name === "module" &&
      obj.property?.name === "exports";
    const isModuleExportsIdent =
      !!obj && obj.type === "Identifier" && obj.name === "module" && propName === "exports";

    const pushFnFromInit = (fallbackName: string | undefined, init: unknown): void => {
      const r = init as { type?: string; id?: { name?: string } } | undefined;
      if (!r) return;
      if (r.type !== "FunctionExpression" && r.type !== "ArrowFunctionExpression") return;
      // Bug 997：**导出槽名优先** —— 具名函数表达式的内层 id（`function inner()`）
      // 不是导出槽名；取内层 id 会让侧车契约整个不绑定（键查不到 ⇒ L1 门禁
      // 假绿）+ 签名表里导出符号消失。槽名缺失（裸 `module.exports = fn`）才回退内层 id。
      const n = fallbackName ?? r.id?.name;
      if (n && !names.includes(n)) names.push(n);
    };

    if (isModuleExportsIdent) {
      pushFnFromInit(undefined, right);
      const objLit = right as { type?: string; properties?: unknown[] } | undefined;
      if (objLit?.type === "ObjectExpression") {
        for (const p of objLit.properties ?? []) {
          const prop2 = p as {
            type?: string;
            kind?: string;
            key?: { type?: string; name?: string; value?: unknown };
            value?: unknown;
            params?: unknown[];
            body?: unknown;
            async?: boolean;
            id?: { name?: string };
          };
          if (prop2.type === "ObjectMethod" || prop2.type === "ClassMethod") {
            // Bug 996：getter / setter **不是**可调用入口（`kind` 是 get/set）⇒
            // 不进普查（否则凭空造出 `f() => unknown` + 假的 L2 entry-may-throw）。
            if (prop2.kind && prop2.kind !== "method") continue;
            const keyName =
              prop2.key?.type === "Identifier"
                ? prop2.key.name
                : prop2.key?.type === "StringLiteral" || prop2.key?.type === "NumericLiteral"
                  ? String(prop2.key.value)
                  : undefined;
            if (keyName && !names.includes(keyName)) names.push(keyName);
            continue;
          }
          if (prop2.type !== "ObjectProperty" && prop2.type !== "Property") continue;
          const keyName =
            prop2.key?.type === "Identifier"
              ? prop2.key.name
              : prop2.key?.type === "StringLiteral" || prop2.key?.type === "NumericLiteral"
                ? String(prop2.key.value)
                : undefined;
          if (keyName) pushFnFromInit(keyName, prop2.value);
        }
      }
      continue;
    }
    if ((isExportsIdent || isModuleExportsMember) && propName) {
      pushFnFromInit(propName, right);
    }
  }
  return names;
}

/**
 * 导出的**类**（本地名）清单 —— `new C()` 入口面（Bug 1096）。
 *
 * `export class C {}` 的**类值本身**是一个导出符号：`new C(x)` 是**真实
 * 入口** ⇒ 构造器**无条件抛**是 check 闸门必须看得见的事实。此前类导出不在
 * 入口表 ⇒ 构造器必抛在 check 面（与 `nudo test` 见证面）**双面不可见** ⇒
 * CI 闸门假绿（Bug 1096）。
 *
 * 导出形态与 {@link listTopFunctions} 的类方法口径**同源**（同一批形态）：
 * - `export class C {}` / `export default class C {}` ⇒ `C`；
 * - `export { C }` / `export { C as default }` / `export { C as X }` ⇒ `C`
 *   （**本地名**口径：与 `localNamedExports` 一致 ⇒ L2 的 isEntry 判得到）；
 * - `export default C`（本地类）⇒ `C`。
 *
 * ⚠ **不进**函数普查面（`listTopFunctions`）：普查面是**函数**表，且与 service
 * 面 `collectTopLevelFunctions` 逐字对齐（改它必须同步改 service 面 ⇒ 越界）。
 * 类导出入口是 check 面（L2 入口门禁）专用的**另一个面** ⇒ 由 check 面把本
 * 清单并进入口表。
 */
export function listClassEntryNames(
  source: string,
  file?: ReturnType<typeof parse>,
): string[] {
  const f = file ?? parse(source);
  const out: string[] = [];
  const push = (n: string | undefined): void => {
    if (n && !out.includes(n)) out.push(n);
  };
  /** 本地 ClassDeclaration（含未直接 export 的） */
  const localClasses = new Map<string, Node>();
  for (const stmt of f.program.body) {
    if (stmt.type === "ClassDeclaration") {
      const cname = (stmt as { id?: { name?: string } }).id?.name;
      if (cname) localClasses.set(cname, stmt);
    }
  }
  for (const stmt of f.program.body) {
    // export { C } / export { C as default } / export { C as X }（说明符语句）
    if (stmt.type === "ExportNamedDeclaration" && !stmt.declaration) {
      for (const spec of stmt.specifiers ?? []) {
        const s = spec as { type?: string; local?: { name?: string } };
        if (s.type !== "ExportSpecifier") continue;
        const localName = s.local?.name;
        if (!localName) continue;
        if (!localClasses.has(localName)) continue;
        push(localName);
      }
      continue;
    }
    // export class C {} / export default class C {} / export default C
    if (
      stmt.type === "ExportNamedDeclaration" ||
      stmt.type === "ExportDefaultDeclaration"
    ) {
      const d = stmt.declaration as
        | { type?: string; id?: { name?: string } }
        | null
        | undefined;
      if (!d) continue;
      if (d.type === "ClassDeclaration") {
        push(d.id?.name);
        continue;
      }
      // export default C（本地类）
      if (stmt.type === "ExportDefaultDeclaration" && d.type === "Identifier") {
        const localName = d.id?.name;
        if (localName && localClasses.has(localName)) push(localName);
      }
      continue;
    }
  }
  return out;
}
