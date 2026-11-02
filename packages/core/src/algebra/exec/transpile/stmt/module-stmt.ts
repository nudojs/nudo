/**
 * 模块语句发射（stmt 按域拆分之一）：import / export 声明的 ESM 与 host
 * target 两面。ESM 面保留标准 import/export 语句（run.ts 后处理改写为
 * __nudoBindImport / __nudoExport）；host 面不残留 export 语句，全部落成
 * __nudoExport* / __nudoBind* 调用。语句级不变量总账见 ./statement.ts
 * 头注释；主分派（transpileStatement）也在 ./statement.ts。
 */
import type { ExportNamedDeclaration, ImportDeclaration, Statement } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { indent, collectPatternNames } from "../helpers.ts";
import { transpileStatement } from "./statement.ts";

export function emitExportNamedDeclaration(
  stmt: ExportNamedDeclaration,
  depth: number,
  opts: TranspileOptions,
): string {
  if (opts.target === "host") return emitHostExportNamedDeclaration(stmt, depth, opts);
  const pad = indent(depth);
  const decl = stmt.declaration;
  if (!decl) {
    // 保留合法 ESM 形态：run.ts 后处理改写为 __nudoExport（modules 表
    // 注入绑定）；真实 .mjs import 消费者直接吃标准 ESM 语义。
    if (depth !== 0) return `${pad}/* nested export specifiers skipped */`;
    // ExportNamespaceSpecifier：`export * as ns from "spec"`（Babel 8 无 local）
    const nsSpecs = stmt.specifiers.filter((s) => s.type === "ExportNamespaceSpecifier");
    if (nsSpecs.length > 0) {
      if (!stmt.source) return `${pad}/* export * as without source skipped */`;
      return nsSpecs
        .map((s) => {
          // string 导出名（export * as "a-b" from）重发射必须保引号
          const exported =
            s.exported.type === "Identifier"
              ? s.exported.name
              : JSON.stringify(s.exported.value);
          return `${pad}export * as ${exported} from ${JSON.stringify(stmt.source!.value)};`;
        })
        .join("\n");
    }
    const specs = stmt.specifiers
      .filter(
        (s): s is typeof s & {
          local: { type?: string; name?: string; value?: string };
          exported: { type?: string; name?: string; value?: string };
        } => "local" in s,
      )
      .map((s) => {
        // DESIGN-003：别名导出段 `export { _nudo_1 as class }` /
        // string 导出名 `export { _nudo_1 as "a-b" }` 重发射——保留字
        // 导出名合法（IdentifierName），string 名必须保引号
        const local =
          s.local.type === "Identifier" ? s.local.name : JSON.stringify(s.local.value);
        const exported =
          s.exported.type === "Identifier"
            ? s.exported.name
            : JSON.stringify(s.exported.value);
        return local === exported ? local : `${local} as ${exported}`;
      })
      .join(", ");
    if (stmt.source) {
      return `${pad}export { ${specs} } from ${JSON.stringify(stmt.source.value)};`;
    }
    return `${pad}export { ${specs} };`;
  }
  const inner = transpileStatement(decl as Statement, depth, {
    ...opts,
    // Bug 21：export var 保持声明面（host ESM export 收集依赖声明语句；
    // 名字从模块级提升集扣除），init 内嵌套函数体由边界重算不受此标志
    ...(decl.type === "VariableDeclaration" && decl.kind === "var"
      ? { keepVarDecl: true }
      : {}),
  });
  // 顶层 export const/let/class：保留 export 面（run.ts 收集进 exports，
  // 供 directive case 经 callTranspiledExport 求值；模块图依赖此表）
  if (depth === 0 && (decl.type === "VariableDeclaration" || decl.type === "ClassDeclaration") && !pad) {
    // Bug 156：解构声明的 export 落点必须是**真实绑定**——`export { a, b };`
    // （而非内部临时名 `_d0`：临时名被当导出名 ⇒ 真实导出名丢失 ⇒ 跨模块
    // import 全灭）。运行时把 `export { … }` 改写成 __nudoExportLazy ✓
    // （live binding，与源级 `export { a }` 同口径）。
    if (decl.type === "VariableDeclaration") {
      // 仅**解构**声明走这条路（普通标识符声明仍是 `export const x = …`，
      // 导出名回收正则认这一形态）。
      const patNames = new Set<string>();
      for (const d of decl.declarations) {
        if (d.id.type === "Identifier") continue;
        collectPatternNames(d.id, patNames);
      }
      if (patNames.size > 0) {
        return `${inner}\n${pad}export { ${[...patNames].join(", ")} };`;
      }
    }
    return `export ${inner}`;
  }
  return inner;
}

export function emitImportDeclaration(
  stmt: ImportDeclaration,
  depth: number,
  opts: TranspileOptions,
): string {
  if (opts.target === "host") return emitHostImportDeclaration(stmt, depth, opts);
  const pad = indent(depth);
  // 保留 import；run.ts 会改写为 __nudoBindImport
  const src = JSON.stringify(stmt.source.value);
  const named: string[] = [];
  let defaultName: string | null = null;
  let nsName: string | null = null;
  for (const s of stmt.specifiers) {
    if (s.type === "ImportSpecifier") {
      // Bug 177：任意模块导出名（ES2022 `import { "a-b" as x }`）——
      // imported 在字符串字面量形态下是 **StringLiteral 节点对象**，
      // `String(node)` 走 Object.prototype.toString ⇒ "[object Object]"
      // ⇒ 渲染出**非法 JS** ⇒ 整模块求值失败 ⇒ 值静默变 unknown
      // （假绿）。string 名必须保引号（与 export 侧同口径）。
      const imported =
        s.imported.type === "Identifier"
          ? s.imported.name
          : JSON.stringify((s.imported as unknown as { value: string }).value);
      named.push(imported === s.local.name ? imported : `${imported} as ${s.local.name}`);
    } else if (s.type === "ImportDefaultSpecifier") {
      defaultName = s.local.name;
    } else if (s.type === "ImportNamespaceSpecifier") {
      nsName = s.local.name;
    }
  }
  // Bug 153：默认 + 命名空间的**混合形态** `import d, * as ns from "…"`——
  // 摊平成 `{ default as d, * as ns }` 既不是合法 ESM，运行时改写也匹配
  // 不到命名空间分支（`*` 不紧跟 `{`）⇒ 具名分支把 `*` 当成被导入的
  // 名字 ⇒ __nudoBindImport(spec, "*") ⇒ 命名空间绑定折 unknown。
  // 改发**标准 ESM 形态**（run.ts 有对应的改写分支）。
  //
  // 命名空间**独占**形态 `import * as ns from "…"` 同理：`{ * as ns }` 不是
  // 合法 ESM（node: SyntaxError）⇒ 整模块求值失败 ⇒ 导出退化 unknown
  // （假 opaque-result）。发标准形态。
  if (nsName) {
    return defaultName
      ? `${pad}import ${defaultName}, * as ${nsName} from ${src};`
      : `${pad}import * as ${nsName} from ${src};`;
  }
  const specs = [
    ...named,
    ...(defaultName ? [`default as ${defaultName}`] : []),
  ];
  if (specs.length === 0) {
    return `${pad}import ${src};`;
  }
  return `${pad}import { ${specs.join(", ")} } from ${src};`;
}

/** ModuleExportName（Identifier | StringLiteral）→ 运行时字符串名。 */
function moduleExportNameOf(name: {
  type?: string;
  name?: string;
  value?: string;
}): string {
  return name.type === "Identifier" ? (name.name ?? "") : (name.value ?? "");
}

/**
 * host target import：import 绑定 → `__nudoBindImport` / `__nudoBindNamespace`
 * 直接绑定；mock 名改读 `__nudoEnv[<local>]` 且不登记 live refresh。
 *
 * live refresh：全部非 mock 绑定的刷新赋值在**首个产生绑定**的 import 语句后
 * 一次性注册（闭包在模块装载后才被刷新器调用，因此可引用文本上更晚声明的
 * 绑定）。
 */
function emitHostImportDeclaration(
  stmt: ImportDeclaration,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  if (depth !== 0) return `${pad}/* nested import skipped */`;
  const spec = JSON.stringify(stmt.source.value);
  // 无绑定副作用 import → 仅触发模块求值
  if (stmt.specifiers.length === 0) {
    return `${pad}void __nudoBindNamespace(${spec});`;
  }
  const lines: string[] = [];
  let liveBinds = 0;
  const bind = (local: string, init: string): void => {
    if (opts.mockNames?.has(local) === true) {
      lines.push(`${pad}let ${local} = __nudoEnv[${JSON.stringify(local)}];`);
      return;
    }
    liveBinds++;
    lines.push(`${pad}let ${local} = ${init};`);
  };
  for (const s of stmt.specifiers) {
    switch (s.type) {
      case "ImportDefaultSpecifier":
        bind(s.local.name, `__nudoBindImport(${spec}, "default")`);
        break;
      case "ImportNamespaceSpecifier":
        bind(s.local.name, `__nudoBindNamespace(${spec})`);
        break;
      case "ImportSpecifier":
        bind(
          s.local.name,
          `__nudoBindImport(${spec}, ${JSON.stringify(moduleExportNameOf(s.imported))})`,
        );
        break;
    }
  }
  const refresh = opts.hostImportRefresh;
  if (liveBinds > 0 && refresh !== undefined && !refresh.done) {
    refresh.done = true;
    lines.push(
      `${pad}__nudoRegisterImportRefresh(__nudoRefreshKeep = () => { ${refresh.binds.join(" ")} });`,
    );
  }
  return lines.join("\n");
}

/** export 声明携带的真实绑定名（函数/类 id；变量声明的解构模式展开）。 */
function exportedDeclBindingNames(decl: Statement): string[] {
  if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
    return decl.id ? [decl.id.name] : [];
  }
  if (decl.type === "VariableDeclaration") {
    const names = new Set<string>();
    for (const d of decl.declarations) collectPatternNames(d.id, names);
    return [...names];
  }
  return [];
}

/**
 * host target export：不残留 `export` 语句，全部落成 `__nudoExport*` 调用。
 *
 * - 声明导出（`export function|class|const|let|var`）：本地声明（无前缀）+
 *   `__nudoExportLazy(<名>, () => <绑定>)`（ESM live binding 口径）；
 * - 本地 specifier（`export { a as b }`）：`__nudoExportLazy("b", () => a)`；
 * - re-export（`export { a as b } from "s"`）：lazy getter 读
 *   `__nudoBindImport("s", "a")`（依赖内部变异对导入方可见）；
 * - `export * as ns from "s"`：lazy namespace；
 * - `export * from "s"`：`__nudoExportStar("s")`（保留 export * 的显式面
 *   优先级语义，由宿主实现）。
 */
function emitHostExportNamedDeclaration(
  stmt: ExportNamedDeclaration,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  if (depth !== 0) return `${pad}/* nested export skipped */`;
  const decl = stmt.declaration;
  if (!decl) {
    const spec = stmt.source ? JSON.stringify(stmt.source.value) : null;
    const lines: string[] = [];
    for (const s of stmt.specifiers) {
      if (s.type === "ExportNamespaceSpecifier") {
        if (spec === null) continue;
        lines.push(
          `${pad}__nudoExportLazy(${JSON.stringify(moduleExportNameOf(s.exported))}, () => __nudoBindNamespace(${spec}));`,
        );
        continue;
      }
      if (s.type !== "ExportSpecifier") continue;
      const exported = JSON.stringify(moduleExportNameOf(s.exported));
      if (spec !== null) {
        lines.push(
          `${pad}__nudoExportLazy(${exported}, () => __nudoBindImport(${spec}, ${JSON.stringify(moduleExportNameOf(s.local))}));`,
        );
      } else {
        lines.push(
          `${pad}__nudoExportLazy(${exported}, () => ${moduleExportNameOf(s.local)});`,
        );
      }
    }
    return lines.join("\n");
  }
  const inner = transpileStatement(decl as Statement, depth, {
    ...opts,
    // Bug 21：export var 保持声明面（与 esm target 同口径——名字从模块级
    // 提升集扣除，声明留在原语句，供导出绑定读取）
    ...(decl.type === "VariableDeclaration" && decl.kind === "var"
      ? { keepVarDecl: true }
      : {}),
  });
  const lines = [inner];
  for (const name of exportedDeclBindingNames(decl as Statement)) {
    lines.push(`${pad}__nudoExportLazy(${JSON.stringify(name)}, () => ${name});`);
  }
  return lines.filter((l) => l !== "").join("\n");
}

