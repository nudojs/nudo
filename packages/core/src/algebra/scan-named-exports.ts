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
 * 文件内 memo（键 = 源码文本）。
 *
 * 本模块的扫描入口走 `parseSource(source, { errorRecovery: true })`——那条路
 * **不进** parse-source 的 AST LRU（errorRecovery / keepTs 是有意绕过缓存的
 * 兜底路径）⇒ 同一份源码在「逐候选 / 逐函数 / 逐产物面」的调用里会被反复
 * 整文件 reparse + strip。实测：单文件分析（commander/lib/command.js）里
 * 5 151 次调用 ⇒ 451 MB 重复解析、stripTypes 单项 36.6s（基线 ~0.4s）。
 *
 * 扫描是**纯函数**（source → 名字表）：同一 source 永远同一结果 ⇒ 可以安全
 * memo。返回副本：调用方拿到的 Set 互不共享（公共 API 面保持值语义，
 * 调用方改自己的 Set 不会污染缓存）。
 *
 * LRU 上限与 parse-source 的 AST 缓存同量级（16）：键是源码文本（与 AST
 * 缓存同源），16 × 1MB 源码 ≈ 16MB 上界。
 */
const LOCAL_EXPORTS_CACHE_MAX = 16;
const localExportsCache = new Map<string, ReadonlySet<string>>();

function memoizedLocalExports(source: string, compute: () => Set<string>): Set<string> {
  const hit = localExportsCache.get(source);
  if (hit !== undefined) {
    // LRU bump
    localExportsCache.delete(source);
    localExportsCache.set(source, hit);
    return new Set(hit);
  }
  const out = compute();
  if (localExportsCache.size >= LOCAL_EXPORTS_CACHE_MAX) {
    const oldest = localExportsCache.keys().next().value;
    if (oldest !== undefined) localExportsCache.delete(oldest);
  }
  localExportsCache.set(source, out);
  return new Set(out);
}

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
 *
 * 结果按源码文本 memo（见 `memoizedLocalExports`）——本函数在逐候选循环里
 * 被反复调用，没有 memo 时每次都是整文件 reparse + strip。
 */
export function localNamedExports(source: string): Set<string> {
  return memoizedLocalExports(source, () => computeLocalNamedExports(source));
}

function computeLocalNamedExports(source: string): Set<string> {
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
  const addClassMethodKeys = (
    out: Set<string>,
    decl: NodeLike | undefined,
    nameOverride?: string,
  ) => {
    if (!decl || decl.type !== "ClassDeclaration") return;
    // Bug 1156：匿名 `export default class {}` 没有本地名 ⇒ 成员键前缀用导出
    // 槽名 "default"（与 generalize / 指令 scope / 类绑定同口径）。
    const idName = identName(decl.id as NodeLike | undefined) ?? nameOverride;
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
  /**
   * BUG-191：namespace 的**运行时成员**键（`NS.x` / `NS.f` / 嵌套 `NS.Inner`）——
   * 与 `Class.method` 同为「成员契约键」口径。
   *
   * 只登记**有运行时值**的成员（const/let/var/function/class/enum/namespace）；
   * interface / type 别名是纯类型声明，运行时不占键（与 TS 语义一致：
   * `Object.keys(NS)` 看不到它们）。
   *
   * 为什么要登记：namespace 在求值器里是**真实对象**（strip-types 保留非
   * declare 的 namespace ⇒ 引擎能求出 `NS = { x: 1 }`），而导出面此前只认
   * 函数/类/变量 ⇒ 引擎内两套导出口径互相矛盾。
   */
  const addNamespaceMemberKeys = (
    out: Set<string>,
    decl: NodeLike,
    prefix: string,
  ): void => {
    const block = decl.body as NodeLike | undefined;
    // `namespace A.B {}`：Babel 把尾段挂在嵌套 TSModuleDeclaration 上
    if (block && block.type === "TSModuleDeclaration") {
      const innerName = identName(block.id as NodeLike | undefined);
      if (innerName) {
        out.add(`${prefix}.${innerName}`);
        addNamespaceMemberKeys(out, block, `${prefix}.${innerName}`);
      }
      return;
    }
    for (const stmt of ((block?.body as NodeLike[] | undefined) ?? [])) {
      // 只有 `export` 过的成员对外可见（未导出成员只是 namespace 内部绑定）
      if (stmt.type !== "ExportNamedDeclaration") continue;
      const inner = stmt.declaration as NodeLike | null | undefined;
      if (!inner) continue;
      if (inner.type === "VariableDeclaration") {
        for (const dcl of ((inner.declarations as NodeLike[] | undefined) ?? [])) {
          const n = identName(dcl.id as NodeLike | undefined);
          if (n) out.add(`${prefix}.${n}`);
        }
        continue;
      }
      const n = identName(inner.id as NodeLike | undefined);
      if (!n) continue;
      if (inner.type === "TSModuleDeclaration") {
        out.add(`${prefix}.${n}`);
        addNamespaceMemberKeys(out, inner, `${prefix}.${n}`);
        continue;
      }
      if (
        inner.type === "FunctionDeclaration" ||
        inner.type === "ClassDeclaration" ||
        inner.type === "TSEnumDeclaration"
      ) {
        out.add(`${prefix}.${n}`);
      }
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
      } else if (d.type === "TSModuleDeclaration") {
        // BUG-191：`export namespace NS { … }`（Babel：ExportNamedDeclaration
        // 包 TSModuleDeclaration）。旧实现只认函数/类/变量三类声明 ⇒ namespace
        // 落到 `continue` 被**静默丢弃** ⇒ NS 在 check 入口表 / dts / 侧车
        // 绑定三面全盲（消费端 `import { NS }` 报 TS2305），而求值器确实物化了
        // NS（strip-types 保留非 declare 的 namespace）⇒ 引擎内两套导出面矛盾。
        const idName = identName(d.id as NodeLike | undefined);
        if (idName) {
          out.add(idName);
          addNamespaceMemberKeys(out, d, idName);
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
        } else if (d.type === "ClassDeclaration") {
          // Bug 1156：匿名 `export default class {}` ⇒ 成员契约键 `default.m`
          // （源导出面必须含它，侧车自动绑定才会为匿名默认类的方法加载）。
          addClassMethodKeys(out, d, "default");
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
 * 侧车源码的生成段导出名：export 之前（跳过紧邻的 import 链与**被 export
 * 引用**的 const 链）的注释行是 nudo 自己的 `@generated` 标记 → 该名为
 * generated。组合式下行段（§5.3）形态为 `import` + `@generated 头` + prelude +
 * export；callsite 段则是头紧贴 export。隔了其他代码行 / 无标记 / re-export
 * 列表均不算。
 *
 * 标记判定是**精确**的（Bug 440）：注释首个记号必须是 `@generated` 且点名 nudo
 * ——散文里**提到** `@generated` 不算（那是用户引用 nudo 的提示语）。
 * 段边界也**收紧**（Bug 432）：紧邻的 const 只有**被该 export 引用**时才属
 * 段内，用户自己的 const 夹在中间 ⇒ 上一段的标记不落进本段。
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
 * nudo 自己的**生成段标记行**：注释的**首个记号**是 `@generated`，且标注文本
 * 点名 nudo（`@generated by nudo — do not edit; regenerate with …`）。
 *
 * Bug 440：旧判定是裸子串 `/@generated/` ⇒ 侧车里任何**散文提及**
 * （`// 手写契约：这里提到了 @generated 这个词`、块注释里的
 * `this is NOT a @generated block`）都算生成标记 ⇒ 手写段的 L1 义务整体消失
 * + emit 侧整段覆盖手写契约（Bug 443）。用户**引用**nudo 的提示语 ≠ nudo 写的段头。
 */
function isGeneratedMarkerLine(line: string): boolean {
  const t = line.trim();
  let rest: string;
  if (t.startsWith("//")) rest = t.slice(2);
  else if (t.startsWith("/*")) rest = t.slice(2);
  else if (t.startsWith("*")) rest = t.slice(1);
  else return false;
  rest = rest.trim();
  if (!/^@generated\b/.test(rest)) return false;
  // nudo 自己的段头一律点名 nudo
  return /\bby\s+nudo\b/.test(rest);
}

type AstNode = { type?: string; name?: string; computed?: boolean; [k: string]: unknown };

const SKIPPED_NODE_KEYS = new Set([
  "type",
  "name",
  "start",
  "end",
  "loc",
  "range",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "errors",
]);

/** 节点子树里出现的标识符名（非计算属性键只是键名，不算「引用」） */
function collectIdentNames(node: unknown, out: Set<string>): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectIdentNames(n, out);
    return;
  }
  const obj = node as AstNode;
  if (obj.type === "Identifier" && typeof obj.name === "string") out.add(obj.name);
  const t = obj.type;
  const skipKey =
    obj.computed === false &&
    (t === "ObjectProperty" ||
      t === "ObjectMethod" ||
      t === "ClassMethod" ||
      t === "ClassProperty" ||
      t === "ClassPrivateProperty" ||
      t === "ClassAccessorProperty" ||
      t === "MemberExpression");
  for (const key of Object.keys(obj)) {
    if (SKIPPED_NODE_KEYS.has(key)) continue;
    if (skipKey && key === "key") continue;
    if (skipKey && key === "property") continue;
    collectIdentNames(obj[key], out);
  }
}

/**
 * export 所属**生成段**的「段内链」：export 自身 + 紧邻的 import +
 * **被 export 引用**的 const（组合式 §5.3 的 prelude const、多步 prelude 的
 * 中间量、DESIGN-003 的别名绑定 const）。
 *
 * Bug 432：旧启发式把**任何**紧邻 const 都算段内 ⇒ 用户自己的 `const`
 * 夹在上一段的 `@generated` 头与本段 export 之间时，上一段的头落进本段的
 * region ⇒ **手写段被判成生成段** ⇒ 「手写优先」保护被绕过。
 * 判据收紧为「const 的绑定被 export 引用」（引用集合按链**传递闭包**扩展：
 * 多步 prelude 的中间量只被后一步引用）。
 */
function sectionChainIndices(
  stmts: ReturnType<typeof parseSource>["program"]["body"],
  exportIdx: number,
): Set<number> {
  const chain = new Set<number>([exportIdx]);
  const referenced = new Set<string>();
  collectIdentNames(stmts[exportIdx], referenced);
  for (let j = exportIdx - 1; j >= 0; j--) {
    const prev = stmts[j]!;
    if (prev.type === "ImportDeclaration") {
      chain.add(j);
      continue;
    }
    if (prev.type === "VariableDeclaration") {
      const declared: string[] = [];
      for (const d of prev.declarations) {
        if (d.id.type === "Identifier") declared.push(d.id.name);
      }
      if (!declared.some((n) => referenced.has(n))) break;
      for (const d of prev.declarations) collectIdentNames(d.init, referenced);
      chain.add(j);
      continue;
    }
    break;
  }
  return chain;
}

/**
 * export 之前的区域（段内链**之前**的最后一条语句之后 → export start）内是否
 * 有 nudo 自己的 `@generated` 标记行。覆盖：头紧贴 export，以及头与 export
 * 之间夹 import/prelude。
 *
 * 区域起点取「上一条语句所在**行**的行首」（不是语句的字节尾）⇒ 代码行**尾随**
 * 的注释（`const helper = 1; // @generated by nudo`）留在代码行上，不冒充独立
 * 标记行（标记必须是整行注释）。
 */
function regionHasGeneratedMarker(
  stmts: ReturnType<typeof parseSource>["program"]["body"],
  exportIdx: number,
  src: string,
): boolean {
  const exportStart = stmts[exportIdx]!.start;
  if (exportStart == null) return false;
  const chain = sectionChainIndices(stmts, exportIdx);
  let first = exportIdx;
  for (const idx of chain) if (idx < first) first = idx;
  const prevEnd = first > 0 ? (stmts[first - 1]?.end ?? 0) : 0;
  const regionStart = prevEnd > 0 ? src.lastIndexOf("\n", prevEnd - 1) + 1 : 0;
  return src.slice(regionStart, exportStart).split("\n").some(isGeneratedMarkerLine);
}
