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

import { parseSource as parse } from "../parse-source.ts";
import type { Node } from "@babel/types";

/**
 * 类 / 对象成员键名（Bug 105）：Identifier（非计算）/ 字符串字面量 /
 * 数字字面量 / **静态计算字面键**（`["mk"]`）都返回稳定名；动态计算键
 * （`[k]()`，computed + Identifier）没有稳定名 ⇒ undefined。
 *
 * `listTopFunctions` 的类方法普查此前只认 `Identifier` ⇒ 把字符串 / 计算 /
 * 数字键方法整类丢弃（无签名、无 L2、侧车契约照收却零执法）。与
 * `scan-named-exports.ts` 的 `identName` / service 的 `classMemberKeyName`
 * 口径对齐（后者返回 `key.name ?? key.value`，含字符串 / 数字）。
 */
function memberKeyOf(node: unknown): string | undefined {
  const m = node as
    | {
        key?: { type?: string; name?: string; value?: unknown } | undefined;
        computed?: boolean;
      }
    | undefined;
  const k = m?.key;
  if (!k) return undefined;
  if (k.type === "Identifier") {
    return m?.computed === true || typeof k.name !== "string" ? undefined : k.name;
  }
  const v = k.value;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/** 类体成员是否是可登记的方法（跳过 ctor / getter / setter / 类字段） */
function isClassMethodNode(mem: { type?: string; kind?: string }): boolean {
  if (
    mem.type !== "MethodDefinition" &&
    mem.type !== "ClassMethod" &&
    mem.type !== "TSDeclareMethod"
  ) {
    return false;
  }
  return !mem.kind || mem.kind === "method";
}

/** 本地类名形态的超类名（`extends Base`）；namespace 限定 / 表达式 ⇒ undefined */
function superClassNameOf(d: unknown): string | undefined {
  const sc = (d as { superClass?: { type?: string; name?: string } } | undefined)?.superClass;
  return sc?.type === "Identifier" && typeof sc.name === "string" ? sc.name : undefined;
}

export function listTopFunctions(source: string, file?: ReturnType<typeof parse>): string[] {
  const f = file ?? parse(source);
  const names: string[] = [];
  /** 本地类（ClassDeclaration + `export const C = class {}` 的类表达式） */
  const localClasses = new Map<string, Node>();
  for (const stmt of f.program.body) {
    if (stmt.type === "ClassDeclaration") {
      const cname = (stmt as { id?: { name?: string } }).id?.name;
      if (cname) localClasses.set(cname, stmt);
      continue;
    }
    // Bug 61：`export const C = class { … }` 的类表达式——求值是完整类值，
    // 但建表只扫 ClassDeclaration ⇒ 类表达式永远不在 localClasses 里。
    const vd =
      stmt.type === "ExportNamedDeclaration" && stmt.declaration?.type === "VariableDeclaration"
        ? stmt.declaration
        : undefined;
    if (vd?.type === "VariableDeclaration") {
      for (const d of vd.declarations) {
        if (d.id.type === "Identifier" && d.init?.type === "ClassExpression") {
          if (!localClasses.has(d.id.name)) localClasses.set(d.id.name, d.init as Node);
        }
      }
    }
  }
  /** 经任意 export 形态暴露的 class 本地名 */
  const exportedClassNames = new Set<string>();
  const collectClassMethods = (cname: string, decl: Node) => {
    /** 读一个类（声明 / 表达式）的 own 方法 */
    const readMethods = (
      d: Node,
      out: Array<{ key: string; isStatic: boolean }>,
    ): void => {
      const body = (d as { body?: { body?: unknown[] } }).body?.body ?? [];
      for (const m of body) {
        const mem = m as {
          type?: string;
          kind?: string;
          key?: { type?: string; name?: string; value?: unknown };
          computed?: boolean;
          static?: boolean;
        };
        if (!isClassMethodNode(mem)) continue; // skip ctor/get/set/field
        // Bug 105：字符串 / 静态计算 / 数字键方法与 Identifier 键同口径
        const keyName = memberKeyOf(mem);
        if (!keyName) continue;
        out.push({ key: keyName, isStatic: mem.static === true });
      }
    };
    // Bug 437：静态方法与实例方法**同名**时，普查名不得相同 —— 否则按名字索引
    // 的签名表里两条记录互相顶替（形参取自一个、返回值取自另一个 ⇒ 自信的
    // 错误值）。类方法名是 `Class.method`（`generalize` 的 env.fns 也按这个键
    // 登记方法体）⇒ **不能**给静态方法另起一个名字（那样查不到方法体 ⇒
    // 凭空造出 L2 入口 may-throw 假红）。⇒ 同名时**只登记实例方法**
    // （静态方法在 `nudo check` 签名面不再重复出现；service 侧同口径）。
    const methods: Array<{ key: string; isStatic: boolean }> = [];
    readMethods(decl, methods);
    // Bug 64：未导出的内部基类——`export class Derived extends Base` 的公共面
    // 包含继承来的原型方法（`new Derived().m()` 可直接调用），Base 是否 export
    // 不应改变 Derived 的公共成员集合。沿 superClass 链把基类 own 方法映射到
    // 导出子类名下（子类 own 方法覆盖同名继承方法）。
    const ownKeys = new Set(methods.map((m) => m.key));
    const seen = new Set<string>([cname]);
    let sup = superClassNameOf(decl);
    while (sup && !seen.has(sup)) {
      seen.add(sup);
      const base = localClasses.get(sup);
      if (!base) break;
      const inherited: Array<{ key: string; isStatic: boolean }> = [];
      readMethods(base, inherited);
      for (const m of inherited) {
        if (ownKeys.has(m.key)) continue; // 子类 own 方法是权威
        ownKeys.add(m.key);
        methods.push(m);
      }
      sup = superClassNameOf(base);
    }
    const instanceKeys = new Set<string>();
    for (const m of methods) if (!m.isStatic) instanceKeys.add(m.key);
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
      const isExported = stmt.type === "ExportNamedDeclaration";
      for (const d of decl.declarations) {
        if (d.id.type !== "Identifier" || !d.init) continue;
        const initType = d.init.type;
        if (initType === "ArrowFunctionExpression" || initType === "FunctionExpression") {
          names.push(d.id.name);
          continue;
        }
        // Bug 61：`export const C = class { … }` 的类表达式——类方法与
        // ClassDeclaration 同口径进函数普查（`C.m`）；类入口 `C` 由
        // listClassEntryNames 单独登记。
        if (initType === "ClassExpression" && isExported) {
          exportedClassNames.add(d.id.name);
          collectClassMethods(d.id.name, d.init as Node);
          continue;
        }
        // Bug 90：ESM `export const api = { m(){} }` 的对象字面量方法——与 CJS
        // `module.exports = { m(){} }` 同口径（成员键 = 导出槽名 ⇒ 进函数普查）。
        // 只对 export 包装的声明收集（未导出对象不是模块边界入口 ⇒ 不假红）。
        if (initType === "ObjectExpression" && isExported) {
          for (const p of ((d.init as { properties?: unknown[] }).properties ?? [])) {
            const prop2 = p as {
              type?: string;
              kind?: string;
              value?: { type?: string };
            };
            if (prop2.type === "ObjectMethod" || prop2.type === "ClassMethod") {
              // getter / setter 不是可调用入口
              if (prop2.kind && prop2.kind !== "method") continue;
            } else if (prop2.type === "ObjectProperty" || prop2.type === "Property") {
              const v = prop2.value?.type;
              if (v !== "FunctionExpression" && v !== "ArrowFunctionExpression") continue;
            } else continue;
            const keyName = memberKeyOf(p);
            if (keyName && !names.includes(keyName)) names.push(keyName);
          }
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
    if (!left || left.type !== "MemberExpression") continue;
    const obj = left.object;
    const prop = left.property;
    // Bug 6：`exports["getName"] = fn` 的 computed 键是**静态字符串字面量**
    // ⇒ 有稳定名；动态计算键 `exports[k]`（computed + Identifier）无稳定名
    // ⇒ 跳过（否则会把变量 k 当成导出槽 ⇒ 假红）。
    if (left.computed) {
      const pt = prop?.type;
      if (pt !== "StringLiteral" && pt !== "NumericLiteral" && pt !== "Literal") continue;
    }
    const propName =
      prop?.type === "Identifier"
        ? prop.name
        : prop?.type === "StringLiteral" || prop?.type === "NumericLiteral" || prop?.type === "Literal"
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
      // Bug 6：`module.exports = <fn>` 是 CJS 的默认导出（ESM default 类比）。
      // - **匿名**函数表达式没有绑定名 ⇒ 普查名取导出槽 "default"（f1）；
      // - **具名**函数表达式（`function getName(){}`）保留内层 id：指令面
      //   （directive-scan，Bug 428）的 scope 名是内层 id，普查面必须对齐，
      //   否则 `@nudo:contract` / `@nudo:throws` / `@nudo:case` 全部蒸发。
      //   本地名 → default 槽的一跳交给 contract/export-slot.ts（同口径
      //   于 `export { f as default }` 的别名映射），让签名 / L2 照样取到
      //   真实函数值，不再塌 unknown + nudo:opaque-result。
      const init = right as { type?: string; id?: { name?: string } } | undefined;
      const isNamedFn =
        (init?.type === "FunctionExpression" || init?.type === "ArrowFunctionExpression") &&
        !!init.id?.name;
      pushFnFromInit(isNamedFn ? undefined : "default", right);
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
        | { type?: string; id?: { name?: string }; name?: string }
        | null
        | undefined;
      if (!d) continue;
      if (d.type === "ClassDeclaration") {
        push(d.id?.name);
        continue;
      }
      // Bug 61：`export const C = class { … }` 的类表达式——导出值是一个完整
      // 类值，`new C()` 是真实入口 ⇒ 构造器必抛必须进 L2（此前 dts 落 unknown，
      // check 报 0 fn / OK）。
      if (d.type === "VariableDeclaration" && stmt.type === "ExportNamedDeclaration") {
        for (const raw of ((d as { declarations?: unknown[] }).declarations ?? [])) {
          const dd = raw as {
            id?: { type?: string; name?: string };
            init?: { type?: string };
          };
          if (dd.id?.type === "Identifier" && dd.init?.type === "ClassExpression") {
            push(dd.id.name);
          }
        }
        continue;
      }
      // export default C（本地类）
      // ⚠ Bug 1119：Babel 的 `Identifier` 节点字段是 **`name`**（`id` 是
      // `Identifier` 上的 `id` 字段，**不存在**）⇒ 旧式读 `d.id?.name` 恒为
      // undefined ⇒ `export default C` 的类**入口**（`new C()`）漏出入口表 ⇒
      // 构造器必抛在 L2 `nudo:entry-may-throw` 闸门**看不见** ⇒ 假绿。
      if (stmt.type === "ExportDefaultDeclaration" && d.type === "Identifier") {
        const localName = d.name;
        if (localName && localClasses.has(localName)) push(localName);
      }
      continue;
    }
    // Bug 6：CJS `module.exports = class C { … }` 的默认导出类——`new C()` 是
    // 真实入口，构造器无条件抛是 L2 必须看见的事实。此前类入口面**没有 CJS
    // 分支** ⇒ f3.cjs 连「无条件抛」都看不见。
    if (stmt.type === "ExpressionStatement") {
      const expr = (stmt as { expression?: unknown }).expression as
        | {
            type?: string;
            left?: {
              type?: string;
              computed?: boolean;
              object?: { type?: string; name?: string };
              property?: { type?: string; name?: string };
            };
            right?: { type?: string };
          }
        | undefined;
      if (!expr || expr.type !== "AssignmentExpression") continue;
      const left = expr.left;
      const right = expr.right;
      if (!left || left.type !== "MemberExpression" || left.computed) continue;
      const isModuleExports =
        left.object?.type === "Identifier" &&
        left.object?.name === "module" &&
        left.property?.type === "Identifier" &&
        left.property?.name === "exports";
      if (
        isModuleExports &&
        (right?.type === "ClassExpression" || right?.type === "ClassDeclaration")
      ) {
        push("default");
      }
      continue;
    }
  }
  return out;
}
