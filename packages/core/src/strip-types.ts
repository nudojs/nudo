import type { Node } from "@babel/types";

/**
 * TS 剥除 pass（Babel typescript 插件 AST → 纯 JS AST）。
 *
 * 为什么放在 parser 层而不是 evaluator 里逐节点 unwrap：
 * parse() 的产物被所有下游消费——CLI resolveModule/generate、service
 * analyzer/case-emitter、LSP server/agent-tools、evaluator 的整条求值链。
 * 在 evaluator 层做 unwrap 只能修一条链，其余消费方（buildModuleGraph 的
 * import 提取、directive 提取、semanticTokens 等）仍会撞上 TS-only 节点。
 * parse() 统一剥除后所有消费方零改动即可分析 .ts 文件。
 *
 * 对纯 JS 源码本 pass 是结构性 no-op（TS-only 节点/字段根本不会出现），
 * 向后兼容；节点均原地改写，loc/start/end 与兄弟节点顺序保持不变
 * （@nudo:case 注释按 comment loc 对齐，删语句只从语句数组中剔除）。
 *
 * 剥除规则：
 *  - 表达式解包：TSAsExpression（含 as const）/ TSSatisfiesExpression /
 *    TSTypeAssertion（<T>x）/ TSNonNullExpression（x!）/ TSInstantiationExpression
 *    （裸泛型引用 const f = foo<number>）→ 直接取 .expression
 *  - 类型声明删除：TSInterfaceDeclaration / TSTypeAliasDeclaration /
 *    TSDeclareFunction / declare 修饰的 TSModuleDeclaration、VariableDeclaration、
 *    ClassDeclaration，以及包装它们的 ExportNamedDeclaration / ExportDefaultDeclaration
 *  - TSEnumDeclaration 直接删除。风险：TS enum 有运行时语义（编译为带反向映射的
 *    对象），删除后源码中 enum 成员引用会退化为 unknown-global 诊断；nudo 的
 *    求值器没有 enum 求值语义，保真合成对象超出本次范围
 *  - type-only import/export：importKind/exportKind === "type" 的声明删除；
 *    值 import 里混入的 type specifier（import { type A, b }）按 specifier 剔除，
 *    全部为 type 时整个声明删除
 *  - 类成员：TSIndexSignature / TSDeclareMethod（含 abstract 方法）/ declare·abstract
 *    的 ClassProperty 删除；implements / superTypeParameters 字段删除
 *  - 求值器不读的类型字段：typeParameters / typeArguments（声明与调用点
 *    TSTypeParameterInstantiation，即 foo<string>(1)；Babel 8 调用点字段名为
 *    typeArguments）、typeAnnotation、returnType（含 TSTypePredicate）、
 *    参数 Identifier/ObjectPattern/ArrayPattern/RestElement 上的 optional 一律 delete
 *
 * 类型注解文本旁路（Bug 479）：
 *  - 剥除 pass 原本**直接 delete** `typeAnnotation` / `returnType`——分析面
 *    （service / core check）拿到的 AST 上没有任何类型信息，`.ts` 源的形参
 *    注解永远进不了推断（形参一律 any ⇒ `nudo:entry-may-throw` 假红）。
 *  - 现在把注解的**源码文本**（"string" / "Array<number>"）留在节点上：
 *    形参 → `nudoTypeText`，返回类型 → `nudoReturnTypeText`。
 *  - 旁路字段是**不可枚举属性**（Object.defineProperty）：`Object.keys(node)`
 *    看不见它 ⇒ ① AST 结构等价断言（parser 的 directives.test.ts：「剥除后的
 *    TS 源 AST ≡ 等价 JS 源 AST」）不受影响；② 遍历器（transpile 的
 *    `Object.keys(node)` 下钻）不会下钻进 TS 节点 ⇒ 分析管线语义零变化；
 *    ③ 直接属性访问（`node.nudoTypeText`）仍可取到 ⇒ 分析面能读回声明类型。
 *  - 文本而非 kind：可承载 `Array<string>` 等复合类型；dts 面可直接回填
 *    源里的注解。
 *
 * 已知不处理（会以 unknown 求值，不崩溃）：非 declare 的 namespace（运行时语义）、
 * TSImportEqualsDeclaration（import x = require(...)）、构造器参数属性
 * （constructor(private x)）——均在 .ts 推断目标场景之外。
 */

/** 数组槽位删除哨兵：语句/成员/specifier 只出现在数组上下文中 */
const REMOVE: unique symbol = Symbol("nudo.strip.remove");

/** 不含 AST 子节点的键：位置/注释/打印器元数据 */
const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "range",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "tokens",
  "extra",
]);

/**
 * 剥除选项（**可选**能力；分析面不传 ⇒ 行为与旧版逐字一致）。
 *
 * - report：剥除**事实**回报（只写不改）。migrate strip 的 notes 据此判定
 *   「提示与事实是否一致」——注释 / 字符串里的 "enum " / "namespace "
 *   不是声明，裸正则会误报（Bug 596）。
 * - resolveSpecifier：相对说明符改写（migrate strip 的**产物**面）。
 *   给「相对 spec」返回「产物 spec」，返回 undefined 表示不改写；
 *   包说明符（"pkg" / "@scope/pkg"）永不进入该回调。
 */
type StripOptions = {
  report?: { enumRemoved?: boolean; namespaceKept?: boolean };
  resolveSpecifier?: (spec: string) => string | undefined;
};

/** 实参/形参模式等数组中的空洞（ArrayPattern 的 elision）保持原样 */
function transformValue(
  value: unknown,
  source: string | undefined,
  opts?: StripOptions,
): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const out: unknown[] = [];
    for (const el of value) {
      if (el === null || el === undefined) {
        out.push(el);
        continue;
      }
      const r = transformValue(el, source, opts);
      if (r === REMOVE) {
        changed = true;
      } else {
        if (r !== el) changed = true;
        out.push(r);
      }
    }
    return changed ? out : value;
  }
  if (typeof value !== "object" || value === null) return value;
  if (typeof (value as { type?: unknown }).type !== "string") return value;
  return transformNode(value as Node & Record<string, unknown>, source, opts);
}

function isTsDeclareLike(node: Node): boolean {
  return (node as { declare?: unknown }).declare === true;
}

/** 类型声明本身是否 TS-only（供 export 包装语句判断整体删除） */
function isTypeOnlyDeclaration(decl: Node): boolean {
  switch (decl.type) {
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSEnumDeclaration":
    case "TSDeclareFunction":
      return true;
    case "VariableDeclaration":
    case "ClassDeclaration":
      return isTsDeclareLike(decl);
    default:
      return false;
  }
}

/**
 * 语句/类成员/specifier 级删除判定（只会在数组上下文中出现，
 * 返回 REMOVE 时父数组剔除该元素）。
 */
function isTypeOnlyStatement(node: Node): boolean {
  const anyNode = node as Node & { importKind?: string; exportKind?: string; specifiers?: unknown[] };
  switch (node.type) {
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSEnumDeclaration":
    case "TSDeclareFunction":
      return true;
    case "TSModuleDeclaration":
      // declare module / declare namespace 纯类型；非 declare 的 namespace 有运行时语义，保留
      return isTsDeclareLike(node);
    case "VariableDeclaration":
    case "ClassDeclaration":
      return isTsDeclareLike(node);
    case "ImportDeclaration":
      if (anyNode.importKind === "type") return true;
      // import { type A, type B } from "m" —— 全 type specifier 则整个 import 无值语义
      {
        const specs = anyNode.specifiers as { importKind?: string }[] | undefined;
        if (specs && specs.length > 0 && specs.every((s) => s.importKind === "type" || s.importKind === "typeof")) {
          return true;
        }
      }
      return false;
    case "ExportNamedDeclaration": {
      if (anyNode.exportKind === "type") return true;
      const decl = (node as { declaration: Node | null }).declaration;
      if (decl && isTypeOnlyDeclaration(decl)) return true;
      // export { type A } / export { type A } from "m"
      {
        const specs = anyNode.specifiers as { exportKind?: string }[] | null;
        if (!decl && specs && specs.length > 0 && specs.every((s) => s.exportKind === "type")) return true;
      }
      return false;
    }
    case "ExportAllDeclaration":
      return anyNode.exportKind === "type";
    case "ExportDefaultDeclaration":
      return isTypeOnlyDeclaration((node as { declaration: Node }).declaration);
    // ---- 类成员 ----
    case "TSIndexSignature":
    case "TSDeclareMethod": // declare / abstract 方法，无运行时实现
      return true;
    case "ClassProperty":
    case "ClassPrivateProperty":
      return isTsDeclareLike(node) || (node as { abstract?: unknown }).abstract === true;
    default:
      return false;
  }
}

/**
 * 注解节点 → 源码文本（Babel 8：TSTypeAnnotation 内层是类型节点本身，
 * 其 start/end 正好覆盖类型文本——"a: string" 的内层区间是 "string"）。
 */
function tsTypeText(
  source: string | undefined,
  inner: { start?: number | null; end?: number | null } | undefined,
): string | undefined {
  if (!source || !inner) return undefined;
  const s = inner.start;
  const e = inner.end;
  if (typeof s !== "number" || typeof e !== "number" || e <= s || e > source.length) {
    return undefined;
  }
  const text = source.slice(s, e).trim();
  return text.length > 0 ? text : undefined;
}

/**
 * 旁路字段写入：**不可枚举**属性。
 *
 * 不可枚举 ⇒ `Object.keys(node)` / `for…in` / 结构等价断言都看不见它
 * （AST 形状对既有消费方**零变化**），但 `node.nudoTypeText` 直接访问可得。
 */
function setTypeText(node: Node & Record<string, unknown>, key: string, text: string): void {
  Object.defineProperty(node, key, {
    value: text,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

/** 求值器不读的类型字段：原地 delete（类型文本留旁路，见文件头） */
function deleteTypeSyntaxFields(
  node: Node & Record<string, unknown>,
  source: string | undefined,
): void {
  const tp = node.typeParameters as { type?: string } | undefined;
  if (tp && typeof tp.type === "string" && tp.type.startsWith("TSTypeParameter")) {
    // 声明处（TSTypeParameterDeclaration）与调用处（TSTypeParameterInstantiation，
    // 即 foo<string>(1) / new Foo<string>()）一并删除
    delete node.typeParameters;
  }
  // Babel 8：CallExpression / NewExpression 的类型实参字段名为 typeArguments
  const taArgs = node.typeArguments as { type?: string } | undefined;
  if (taArgs && typeof taArgs.type === "string" && taArgs.type.startsWith("TSTypeParameter")) {
    delete node.typeArguments;
  }
  const ta = node.typeAnnotation as
    | { type?: string; typeAnnotation?: { start?: number | null; end?: number | null } }
    | undefined;
  if (ta && ta.type === "TSTypeAnnotation") {
    // Bug 479：类型注解文本留旁路（形参/变量/类成员的声明类型）
    const text = tsTypeText(source, ta.typeAnnotation);
    if (text !== undefined) setTypeText(node, "nudoTypeText", text);
    delete node.typeAnnotation;
  }
  const rt = node.returnType as
    | {
        type?: string;
        typeAnnotation?: { start?: number | null; end?: number | null };
        start?: number | null;
        end?: number | null;
      }
    | undefined;
  if (rt && (rt.type === "TSTypeAnnotation" || rt.type === "TSTypePredicate")) {
    // Bug 479：返回类型文本留旁路（TSTypePredicate 用自身区间）
    const text =
      rt.type === "TSTypeAnnotation"
        ? tsTypeText(source, rt.typeAnnotation)
        : tsTypeText(source, rt);
    if (text !== undefined) setTypeText(node, "nudoReturnTypeText", text);
    delete node.returnType;
  }
  // `a?: T` 的可选标记。只在这些模式节点上删：OptionalMemberExpression 等
  // 表达式节点自己的 optional 语义（a?.b）不属于 TS 语法，不能动
  if (
    node.optional === true &&
    (node.type === "Identifier" || node.type === "ObjectPattern" || node.type === "ArrayPattern" || node.type === "RestElement")
  ) {
    delete node.optional;
  }
  // 类的 implements 子句与继承泛型实参
  if ("implements" in node) delete node.implements;
  if ("superTypeParameters" in node) delete node.superTypeParameters;
  // Babel 8 可能把继承泛型写在 typeArguments 上
  if ("superTypeArguments" in node) delete node.superTypeArguments;
  // 类成员修饰符（`private` / `public` / `protected` / `readonly` / `abstract` /
  // `override` / `declare`）——TS-only 语法 ⇒ 产物面必须剥掉，否则 Node 解析不了
  // （Bug 672：`migrate strip` 写出的 `.js` 仍是 TS ⇒ `node --check` 失败）。
  // 只在类成员节点上删：这些字段名在别的节点上没有 TS 语义。
  if (typeof node.type === "string" && node.type.startsWith("Class")) {
    delete node.accessibility;
    delete node.readonly;
    delete node.abstract;
    delete node.override;
    delete node.declare;
  }
}

/**
 * 构造器参数属性降级（Bug 672）。
 *
 * `constructor(private opening: number)` 的语义 =「字段 `opening` + 构造器里
 * `this.opening = opening`」。TS 语法在 JS 里不存在 ⇒ 产物必须自己补上那半句
 * 赋值（字段声明不必显式写：JS 的 `this.x = …` 就是动态字段，语义等价）。
 *
 * 两种 AST 形态都认：
 * - Babel 7：`TSParameterProperty` 包装节点（修饰符在包装节点上）；
 * - Babel 8 / 部分解析器：修饰符直接挂在普通参数节点上。
 */
function lowerConstructorParameterProperties(cls: Node & Record<string, unknown>): void {
  const body = cls.body as { body?: unknown[] } | undefined;
  const members = body?.body;
  if (!Array.isArray(members)) return;
  const ctor = members.find((m) => {
    const rec = m as { type?: string; kind?: string } | undefined;
    return rec?.type === "ClassMethod" && rec.kind === "constructor";
  }) as (Node & Record<string, unknown>) | undefined;
  if (!ctor) return;
  const params = ctor.params as unknown[] | undefined;
  if (!Array.isArray(params)) return;

  const names: string[] = [];
  const kept: unknown[] = [];
  for (const p of params) {
    const param = p as (Node & Record<string, unknown>) | undefined;
    if (!param || typeof param !== "object") {
      kept.push(p);
      continue;
    }
    if (param.type === "TSParameterProperty") {
      delete param.accessibility;
      delete param.readonly;
      delete param.override;
      const inner = param.parameter as (Node & Record<string, unknown>) | undefined;
      if (inner && inner.type === "Identifier" && typeof inner.name === "string") {
        names.push(inner.name);
        kept.push(inner);
        continue;
      }
      // 解构模式：TS 不允许参数属性 ⇒ 保守原样保留（不生成赋值）
      kept.push(param);
      continue;
    }
    const isParamProp =
      typeof param.accessibility === "string" ||
      param.readonly === true ||
      param.override === true;
    if (isParamProp) {
      delete param.accessibility;
      delete param.readonly;
      delete param.override;
      if (param.type === "Identifier" && typeof param.name === "string") names.push(param.name);
    }
    kept.push(p);
  }
  if (names.length === 0) return;
  ctor.params = kept;

  // 构造器体开头插入 `this.x = x;`
  const ctorBody = ctor.body as { body?: unknown[] } | undefined;
  if (!ctorBody || !Array.isArray(ctorBody.body)) {
    ctor.body = { type: "BlockStatement", body: [], directives: [] };
  }
  const stmts = (ctor.body as { body?: unknown[] }).body as unknown[];
  stmts.unshift(
    ...names.map((name) => ({
      type: "ExpressionStatement",
      expression: {
        type: "AssignmentExpression",
        operator: "=",
        left: {
          type: "MemberExpression",
          object: { type: "ThisExpression" },
          property: { type: "Identifier", name },
          computed: false,
          optional: false,
        },
        right: { type: "Identifier", name },
      },
    })),
  );
}

/** 表达式级解包：类型断言/满足断言/非空断言/裸泛型引用 → 内层表达式 */
function unwrapExpression(node: Node & Record<string, unknown>): Node | null {
  switch (node.type) {
    case "TSAsExpression": // 含 as const
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
    case "TSNonNullExpression":
    case "TSInstantiationExpression":
      return node.expression as Node;
    default:
      return null;
  }
}

/**
 * 相对说明符改写（仅 migrate strip 的**产物**面启用）。
 *
 * 只改 `import` / `export … from` 的**字符串字面量**说明符；包说明符、
 * 动态 import 的表达式、`import x = require(...)` 一律不动。
 */
function rewriteRelativeSpecifier(
  node: Node & Record<string, unknown>,
  resolve: (spec: string) => string | undefined,
): void {
  const src = node.source as { type?: string; value?: unknown } | undefined;
  if (!src || src.type !== "StringLiteral" || typeof src.value !== "string") return;
  const spec = src.value;
  if (!spec.startsWith("./") && !spec.startsWith("../")) return;
  const next = resolve(spec);
  if (typeof next === "string" && next.length > 0 && next !== spec) {
    src.value = next;
  }
}

function transformNode(
  node: Node & Record<string, unknown>,
  source: string | undefined,
  opts?: StripOptions,
): Node | typeof REMOVE {
  // 剥除事实回报（先于删除判定：enum 节点本函数就要删掉它）
  if (opts?.report) {
    if (node.type === "TSEnumDeclaration") {
      opts.report.enumRemoved = true;
    } else if (node.type === "ExportNamedDeclaration") {
      // export enum E {} —— 枚举挂在 export 的 declaration 上（整条语句被删，
      // 枚举节点本身不会被访问到）⇒ 这里补一次事实回报
      const decl = (node as { declaration?: { type?: string } }).declaration;
      if (decl?.type === "TSEnumDeclaration") opts.report.enumRemoved = true;
    } else if (node.type === "TSModuleDeclaration" && !isTsDeclareLike(node)) {
      // 非 declare 的 namespace 有运行时语义 ⇒ 保留 ⇒ 「可能打印不干净」提示成立
      opts.report.namespaceKept = true;
    }
  }
  if (isTypeOnlyStatement(node)) return REMOVE;

  deleteTypeSyntaxFields(node, source);

  // 构造器参数属性降级（Bug 672）——必须**在**递归之前：插入的赋值语句与
  // 剥掉包装的形参随后一并走类型注解剥除。
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    lowerConstructorParameterProperties(node);
  }

  // 相对说明符改写（产物面；分析面不传 opts ⇒ 不动）
  if (opts?.resolveSpecifier) rewriteRelativeSpecifier(node, opts.resolveSpecifier);

  // 值 import/export 里混入的 type-only specifier 逐个剔除
  if (node.type === "ImportDeclaration") {
    node.specifiers = node.specifiers.filter(
      (s) => !((s as { importKind?: string }).importKind === "type" || (s as { importKind?: string }).importKind === "typeof"),
    );
  } else if (node.type === "ExportNamedDeclaration") {
    if (node.specifiers) {
      node.specifiers = node.specifiers.filter((s) => (s as { exportKind?: string }).exportKind !== "type");
    }
  }

  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (child === null || typeof child !== "object") continue;
    const r = transformValue(child, source, opts);
    if (r === REMOVE) {
      // 单槽位理论上不会收到 REMOVE（删除项均为数组上下文），防御性清槽
      delete node[key];
    } else {
      node[key] = r;
    }
  }

  return unwrapExpression(node) ?? node;
}

/**
 * 原地剥除 AST 中的 TS-only 语法节点/字段，返回同一棵 AST（便于链式使用）。
 * 不改写任何 loc/start/end；语句删除只影响所在数组，不重排兄弟节点。
 *
 * @param source 源码文本（可选）。给了就把**类型注解的源码文本**留在节点上
 *   （`nudoTypeText` / `nudoReturnTypeText`，见文件头）——分析面据此读回
 *   `.ts` 源的声明类型；不给（migrate 的 keepTs 路径等）则纯剥除。
 * @param opts 可选能力（见 StripOptions）：剥除事实回报 + 相对说明符改写。
 *   分析面**不传** ⇒ 行为与旧版逐字一致。
 */
export function stripTypes<T extends Node>(ast: T, source?: string, opts?: StripOptions): T {
  transformValue(ast, source, opts);
  return ast;
}
