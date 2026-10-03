/**
 * 源文件导出面 AST 扫描：localNamedExports（本地导出名表，侧车自动绑定
 * 边界）/ exportedNameOfLocal（DESIGN-003 本地名→导出名查询）/
 * generatedExportNames（侧车生成段识别）。
 * 自 interface.ts 机械拆出（纯解析层，只依赖 parse-source）；语义未改。
 * interface.ts 头部 re-export 维持其既有导出面（index.ts / internal.ts 不变形）。
 */

import { parseSource } from "./parse-source.ts";

// ---------------------------------------------------------------------------
// 本地导出表 / 导出名查询 / 生成段识别（原 interface.ts「侧车路径 / 本地
// 导出表 / 生成段识别」段的 AST 扫描部分）
// ---------------------------------------------------------------------------

/**
 * 源文件本地导出名表（侧车自动绑定边界）：
 * - ESM：`export function/const/let/var/class` 与本地 `export { x }` /
 *   `export { local as exported }`（按**导出名**绑定）；
 * - `export default function add` / `const add = …; export default add`：
 *   按**本地名** `add` 绑定（侧车可 `export const add = fn(…)`）；
 *   同时登记 `"default"`，供侧车 `export default fn(…)` 对齐；
 * - CJS（C4.3）：`module.exports = { a, b }`、`module.exports.a = …`、
 *   `exports.a = …`、`module.exports = localFn`（登记 localFn 名）。
 * 排除 re-export（`export {x} from` / `export *`）。
 */
export function localNamedExports(source: string): Set<string> {
  const out = new Set<string>();
  let ast: ReturnType<typeof parseSource>;
  try {
    ast = parseSource(source, { errorRecovery: true });
  } catch {
    return out; // 解析失败：无本地导出信息，不阻断（refine 行走 regex 路径）
  }
  // 先收 import 绑定名：export { x } 若 x 来自 import，则是 re-export 不绑源码
  const importedLocalNames = new Set<string>();
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    for (const spec of stmt.specifiers) {
      if (spec.type === "ImportNamespaceSpecifier" || spec.type === "ImportDefaultSpecifier") {
        importedLocalNames.add(spec.local.name);
      } else if (spec.type === "ImportSpecifier") {
        importedLocalNames.add(spec.local.name);
      }
    }
  }

  type NodeLike = Record<string, unknown> & { type?: string };
  const identName = (n: NodeLike | undefined): string | undefined => {
    if (!n) return undefined;
    if (n.type === "Identifier" && typeof n.name === "string") return n.name;
    // string 导出名（`export { x as "a-b" }`）：Babel 是 StringLiteral（不是
    // estree 的 Literal）——DESIGN-003 身份=导出名必须认得串名
    if (
      (n.type === "StringLiteral" || n.type === "Literal") &&
      typeof n.value === "string"
    ) {
      return n.value;
    }
    return undefined;
  };
  /** P1：本地 ClassDeclaration 表（export { Foo } / export default Foo 解析用） */
  const localClasses = new Map<string, NodeLike>();
  for (const stmt of ast.program.body) {
    const s = stmt as NodeLike;
    if (s.type !== "ClassDeclaration") continue;
    const idName = identName(s.id as NodeLike | undefined);
    if (idName) localClasses.set(idName, s);
  }
  const addClassMethodKeys = (out: Set<string>, decl: NodeLike | undefined) => {
    if (!decl || decl.type !== "ClassDeclaration") return;
    const idName = identName(decl.id as NodeLike | undefined);
    if (!idName) return;
    const body = (decl.body as { body?: NodeLike[] } | undefined)?.body ?? [];
    for (const m of body) {
      const mem = m as NodeLike & {
        kind?: string;
        static?: boolean;
        key?: NodeLike;
      };
      const isMethod =
        mem.type === "MethodDefinition" ||
        mem.type === "ClassMethod" ||
        mem.type === "TSDeclareMethod";
      if (!isMethod) continue;
      if (mem.kind && mem.kind !== "method") continue;
      // static 与实例方法同为消费者可见入口键（design §3.2）
      const keyName = identName(mem.key as NodeLike);
      if (keyName) out.add(`${idName}.${keyName}`);
    }
  };
  /** `module.exports` 或 `exports` → true */
  const isExportsTarget = (n: NodeLike | undefined): boolean => {
    if (!n) return false;
    if (n.type === "Identifier") return n.name === "exports";
    if (n.type === "MemberExpression") {
      return identName(n.object as NodeLike) === "module" && n.property !== undefined
        ? identName(n.property as NodeLike) === "exports"
        : false;
    }
    return false;
  };
  /** `exports.a` / `module.exports.a` → "a" */
  const cjsPropName = (left: NodeLike | undefined): string | undefined => {
    if (!left || left.type !== "MemberExpression") return undefined;
    if (left.computed === true) return undefined;
    const obj = left.object as NodeLike | undefined;
    if (!isExportsTarget(obj)) return undefined;
    return identName(left.property as NodeLike);
  };

  for (const stmt of ast.program.body) {
    const s = stmt as NodeLike;

    // --- ESM named ---
    if (s.type === "ExportNamedDeclaration") {
      if (s.source) {
        // `export * as ns from "…"`：导出名 ns 进集合（re-export 不绑源码，
        // 但 namespace 槽是本模块导出面）
        const specs = (s.specifiers as NodeLike[] | undefined) ?? [];
        for (const spec of specs) {
          if (spec.type !== "ExportNamespaceSpecifier") continue;
          const name = identName(spec.exported as NodeLike);
          if (name) out.add(name);
        }
        continue; // export {…} from "…"（re-export）
      }
      const d = s.declaration as NodeLike | null | undefined;
      if (!d) {
        const specs = (s.specifiers as NodeLike[] | undefined) ?? [];
        for (const spec of specs) {
          if (spec.type === "ExportNamespaceSpecifier") {
            const name = identName(spec.exported as NodeLike);
            if (name) out.add(name);
            continue;
          }
          if (spec.type !== "ExportSpecifier") continue;
          const name = identName(spec.exported as NodeLike);
          if (!name) continue;
          const localName = identName(spec.local as NodeLike);
          // C4.4：`export { local as default }` 同时登记 default 与本地名
          // （check/scan/LSP 按本地声明名消费；侧车键可以是 default）
          if (name === "default") {
            out.add("default");
            if (localName && !importedLocalNames.has(localName)) out.add(localName);
            // P1：本地 class 经 export list 导出 → 也登记 Class.method
            if (localName && !importedLocalNames.has(localName)) {
              addClassMethodKeys(out, localClasses.get(localName));
            }
            continue;
          }
          if (localName && importedLocalNames.has(localName)) continue;
          // export { Local as Public }：导出名 + 本地名都进集合
          // （L2 isEntry 按本地声明名匹配；侧车可用导出名绑定）
          out.add(name);
          if (localName) {
            out.add(localName);
            addClassMethodKeys(out, localClasses.get(localName));
          }
        }
        continue;
      }
      if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") {
        const idName = identName(d.id as NodeLike | undefined);
        if (idName) out.add(idName);
        // C4.2：导出 class 的实例方法 → `Class.method` 契约键
        if (d.type === "ClassDeclaration" && idName) {
          addClassMethodKeys(out, d);
        }
      } else if (d.type === "VariableDeclaration") {
        const decls = (d.declarations as NodeLike[] | undefined) ?? [];
        for (const decl of decls) {
          const idName = identName(decl.id as NodeLike | undefined);
          if (idName) out.add(idName);
        }
      }
      continue;
    }

    // --- export default（C4.4）---
    if (s.type === "ExportDefaultDeclaration") {
      out.add("default");
      const d = s.declaration as NodeLike | null | undefined;
      if (d) {
        if ((d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") && d.id) {
          const idName = identName(d.id as NodeLike);
          if (idName) out.add(idName);
          if (d.type === "ClassDeclaration" && idName) {
            addClassMethodKeys(out, d);
          }
        } else if (
          d.type === "ArrowFunctionExpression" ||
          d.type === "FunctionExpression"
        ) {
          // export default (…) => …：本地名即 "default"（已在上方登记）
        } else if (d.type === "Identifier") {
          const n = identName(d);
          if (n && !importedLocalNames.has(n)) {
            out.add(n);
            addClassMethodKeys(out, localClasses.get(n));
          }
        }
      }
      continue;
    }

    // --- CJS（C4.3）---
    if (s.type === "ExpressionStatement") {
      const expr = s.expression as NodeLike | undefined;
      if (!expr || expr.type !== "AssignmentExpression" || expr.operator !== "=") continue;
      const left = expr.left as NodeLike | undefined;
      const right = expr.right as NodeLike | undefined;
      if (!left || !right) continue;

      // exports.a = … / module.exports.a = …
      const prop = cjsPropName(left);
      if (prop && prop !== "default") out.add(prop);

      // module.exports = { … } / exports = { … }
      if (isExportsTarget(left)) {
        if (right.type === "ObjectExpression") {
          const props = (right.properties as NodeLike[] | undefined) ?? [];
          for (const p of props) {
            // Babel 8 对象方法是 ObjectMethod，不是 ObjectProperty
            if (
              p.type !== "ObjectProperty" &&
              p.type !== "Property" &&
              p.type !== "ObjectMethod"
            ) {
              continue;
            }
            const keyName = identName(p.key as NodeLike);
            if (keyName && keyName !== "default") out.add(keyName);
            else if (p.type !== "ObjectMethod") {
              const valName = identName(p.value as NodeLike);
              if (valName) out.add(valName);
            }
          }
        } else if (right.type === "Identifier") {
          const n = identName(right);
          if (n && !importedLocalNames.has(n)) out.add(n);
        }
      }
    }
  }
  return out;
}

/**
 * `export { local as exported }`（含 string 导出名 `export { x as "a-b" }`）
 * 的本地声明名 → 导出名查询（DESIGN-003：契约身份=导出名）。声明形态
 * （exported === local）与 default 形态不进表——default 走 C4.4 的
 * 本地名/default 双键绑定，身份保持本地名。解析失败 / 无别名子句 →
 * undefined。
 */
export function exportedNameOfLocal(source: string, localName: string): string | undefined {
  let ast: ReturnType<typeof parseSource>;
  try {
    ast = parseSource(source, { errorRecovery: true });
  } catch {
    return undefined;
  }
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ExportNamedDeclaration" || stmt.source) continue;
    for (const spec of stmt.specifiers) {
      if (spec.type !== "ExportSpecifier") continue;
      if (spec.local.type !== "Identifier" || spec.local.name !== localName) continue;
      const name =
        spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
      if (name === undefined || name === localName || name === "default") continue;
      return name;
    }
  }
  return undefined;
}

/**
 * 侧车源码的生成段导出名：export 之前（跳过紧邻的 import/const 链）的注释
 * 行含 `@generated` → 该名为 generated。组合式下行段（§5.3）形态为
 * `import` + `@generated 头` + prelude + export；callsite 段则是头紧贴
 * export。隔了其他代码行 / 无标记 / re-export 列表均不算。
 *
 * DESIGN-003 别名段：导出名不是合法绑定名（保留字 / 非 ident）时发射为
 * `const _nudo_1 = …; export { _nudo_1 as class };` —— 身份恒为**导出名**
 * （`class` / string 名），不是绑定别名。
 */
export function generatedExportNames(sidecarSrc: string): Set<string> {
  const out = new Set<string>();
  let ast: ReturnType<typeof parseSource>;
  try {
    ast = parseSource(sidecarSrc, { errorRecovery: true });
  } catch {
    return out;
  }
  const stmts = ast.program.body;
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i]!;
    if (stmt.type !== "ExportNamedDeclaration") continue;
    if (stmt.source) continue;
    if (stmt.start == null) continue;
    const d = stmt.declaration;
    if (!d) {
      // 别名段尾（export 子句无声明）：region 回扫跳过紧邻 import/const 链
      // 找 @generated 头；身份 = specifier 的导出名（含 string 名）
      if (regionHasGeneratedMarker(stmts, i, sidecarSrc)) {
        for (const spec of stmt.specifiers) {
          if (spec.type !== "ExportSpecifier") continue;
          const name =
            spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
          if (name !== undefined) out.add(name);
        }
      }
      continue;
    }
    const names: string[] = [];
    if (d.type === "VariableDeclaration") {
      for (const decl of d.declarations) {
        if (decl.id.type === "Identifier") names.push(decl.id.name);
      }
    } else if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") {
      if (d.id) names.push(d.id.name);
    }
    if (names.length === 0) continue;
    if (regionHasGeneratedMarker(stmts, i, sidecarSrc)) {
      for (const n of names) out.add(n);
    }
  }
  return out;
}

/**
 * export 之前的区域（上一非 import/const 语句之后 → export start）内是否有
 * `@generated` 注释行。覆盖：头紧贴 export，以及头与 export 之间夹 import/prelude。
 */
function regionHasGeneratedMarker(
  stmts: ReturnType<typeof parseSource>["program"]["body"],
  exportIdx: number,
  src: string,
): boolean {
  const exportStart = stmts[exportIdx]!.start;
  if (exportStart == null) return false;
  let regionStart = 0;
  for (let j = exportIdx - 1; j >= 0; j--) {
    const prev = stmts[j]!;
    if (prev.type === "ImportDeclaration" || prev.type === "VariableDeclaration") continue;
    regionStart = prev.end ?? 0;
    break;
  }
  return src.slice(regionStart, exportStart).split("\n").some((line) => {
    const t = line.trim();
    return (
      (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) && /@generated/.test(t)
    );
  });
}
