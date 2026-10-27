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
 *  - TSEnumDeclaration **合成运行时对象**（Bug 913）：TS enum 有运行时语义
 *    （tsc 编译为带反向映射的对象），整段删除会让成员引用退化成**未绑定全局**
 *    读取 ⇒ 门禁 error 级假红 + 四个产物面落 never ⇒ 现在按 tsc 的 emit 形态
 *    合成 `var E = (function (E) { … })({})`（反向映射 / 自动递增 / 字符串枚举
 *    / const enum 逐形态对齐 tsc，见 synthesizeEnum）。**declare enum** 仍是
 *    纯类型 ⇒ 整条删除。
 *  - type-only import/export：importKind/exportKind === "type" 的声明删除；
 *    值 import 里混入的 type specifier（import { type A, b }）按 specifier 剔除，
 *    全部为 type 时整个声明删除
 *  - **值位置的类型专用导入**（Bug 445）：`import { Foo } from "./t.js"` 且 `Foo`
 *    只在**类型位置**被用到（形参注解 / 类型别名 / 接口体 / `typeof` 类型查询）
 *    ⇒ tsc 的 import elision 会把它**消掉**；不消掉的话，被 import 的模块被剥成
 *    空模块 ⇒ 产物 ESM 链接期 SyntaxError。判据是**语法级**的「值位置引用收集」
 *    （collectValueReferences），**保守**：拿不准的一律当值引用 ⇒ import 保留。
 *  - TS-only 的模块出口语句删除（Bug 446）：TSExportAssignment（`export = X`）/
 *    TSNamespaceExportDeclaration（`export as namespace X`）⇒ 原样打印不是合法 JS。
 *  - 类成员：TSIndexSignature / TSDeclareMethod（含 abstract 方法）/ declare·abstract
 *    的 ClassProperty 删除；implements / superTypeParameters 字段删除；
 *    **类成员节点族**上的 `definite`（`x!`）与 `optional`（`y?` / `m?()`）删除
 *    （Bug 447）—— 这两个字段在 JS 里不存在，留在产物里 ⇒ `node --check` 失败。
 *  - TS 的 `this` 形参（`function f(this: T, a)`）从**形参数组**里删除
 *    （Bug 448）—— `this` 不是合法形参名，留在产物里 ⇒ 产物不可加载。
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
 * TSImportEqualsDeclaration（import x = require(...)）——均在 .ts 推断目标场景
 * 之外。
 *
 * 构造器参数属性（`constructor(private x)`）**已处理**（Bug 672 降级 + Bug 1071
 * 排序）：语义 =「字段 `x` + 构造器里 `this.x = x`」⇒ 产物补上那半句赋值；
 * **派生类**的赋值必须落在 `super(...)` **之后**（原生：`super()` 之前访问
 * `this` ⇒ ReferenceError；tsc emit 同口径：`super(); this.x = x;`）。
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
 *
 * report 的字段（**全部可选**；未发生的事实不写 ⇒ 调用方按 `=== true` 判定）：
 * - enumRemoved：TS enum 声明被**整条删除**（仅 `declare enum` —— 环境声明
 *   没有运行时语义）。**运行时 enum 现在是被「合成」而不是被删除** ⇒ 用
 *   enumSynthesized 判定（Bug 913）。
 * - enumSynthesized：TS enum 被**合成成运行时对象**（Bug 913）。
 * - namespaceKept：非 declare 的 namespace 被保留（运行时语义）。
 * - exportAssignmentRemoved：`export = X` / `export as namespace X` 被剥除
 *   （Bug 446）。
 * - thisParamRemoved：TS 的 `this` 形参被从形参数组里删除（Bug 448）。
 * - typeOnlyImportRemoved：**本地**（相对路径）import 的绑定只在类型位置被
 *   用到（值位置零引用）⇒ 被消掉（与 tsc 的 import elision 同口径）（Bug 445）。
 * - typeOnlyImportKept：值位置的导入**被保留**（绑定有值位置引用，或引用
 *   形态判不准 ⇒ 保守保留）⇒ 产物面应当提示人工确认（Bug 445）。
 * - directivesBefore / directivesAfter / directivesDropped：**剥除前后**的
 *   `@nudo:` 指令条数比对（Bug 968 的兜底自检）——不等 ⇒ 有指令随被删语句
 *   一起消失。
 * - ctorParamPropsSuperMissing：**派生类**的构造器参数属性降级时，构造器体
 *   **顶层**找不到 `super(...)` 调用 ⇒ 赋值只能落回构造器体开头（原生语义：
 *   `super()` 之前访问 `this` ⇒ ReferenceError；源本身即非法 TS）⇒ 产物面
 *   应当提示人工确认（Bug 1071）。
 */
type StripOptions = {
  report?: {
    enumRemoved?: boolean;
    enumSynthesized?: boolean;
    /**
     * enum 的**计算成员**里的成员引用被改写成了 `E["KEY"]`（Bug 234）。
     *
     * 旧实现把初始化表达式**原样**抄进 IIFE ⇒ `B = A * 10` 里的 `A` 是
     * **未绑定全局** ⇒ 产物运行期 ReferenceError。tsc 的 emit 会把成员引用
     * 改写成 `E["A"]`（或折叠成常量）⇒ 现在同口径。
     */
    enumComputedMemberRewritten?: boolean;
    namespaceKept?: boolean;
    /** `import x = require(...)`（TS-only 导入语法）被**保留** ⇒ 产物不是合法 JS */
    importEqualsKept?: boolean;
    exportAssignmentRemoved?: boolean;
    thisParamRemoved?: boolean;
    typeOnlyImportRemoved?: boolean;
    typeOnlyImportKept?: boolean;
    directivesBefore?: number;
    directivesAfter?: number;
    directivesDropped?: boolean;
    ctorParamPropsSuperMissing?: boolean;
  };
  resolveSpecifier?: (spec: string) => string | undefined;
};

/**
 * 剥除 pass 的**内部**上下文（模块私有；不导出 ⇒ 不触及公共 API 冻结面）。
 *
 * valueRefs：**值位置**被引用的标识符名集合（Bug 445 的 import elision 判据）。
 * 剥除**前**算一次（原始 AST），整趟 pass 共用 ⇒ `isTypeOnlyStatement` 与
 * `transformNode` 的两处 import 判定**同口径**。
 */
type StripContext = {
  valueRefs: Set<string>;
  /** 类型位置被引用的标识符名（值位置零引用、但类型位置有引用 ⇒ 类型专用） */
  typeRefs: Set<string>;
  /** 「判不准」的值引用（`export { X }` 本地再导出：X 可能是值也可能是类型） */
  ambiguousRefs: Set<string>;
};

/** 类型位置的字段（值位置引用收集时整棵子树跳过） */
const TYPE_ONLY_FIELDS = new Set([
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "superTypeParameters",
  "superTypeArguments",
  "implements",
  "predicate",
]);

/** 注释键（指令挂在这些键上；打印器只打印挂在节点上的注释） */
const COMMENT_KEYS = ["leadingComments", "trailingComments", "innerComments"] as const;

/**
 * **值位置**引用收集（Bug 445 的 import elision 判据）。
 *
 * 「值位置」= 该标识符在**运行时**被读/写的位置（表达式、实参、赋值目标、
 * `export { X }` 再导出、JSX 组件名、类 heritage 的 superClass…）。
 * 「类型位置」= 类型注解 / 类型别名 / 接口体 / `typeof` 类型查询 —— TS 在
 * 这些位置**不产生运行时引用** ⇒ tsc 的 import elision 会把只在那里被用到
 * 的 import **消掉**（实测：tsc 对 `import { Foo } from "./t.js"` + 只有
 * `f(x: Foo)` 的文件，emit 里 import 整条消失）。
 *
 * 判据刻意**保守**：
 * - 只跳过**确定**是类型位置的子树 ⇒ 漏跳（把类型用法当值用法）只是**保留**
 *   多余的 import（产物仍可加载）；
 * - 任何**拿不准**的位置（未知节点形态、未知字段）一律当**值引用** ⇒
 *   import 被保留（宁可产物多一条 import，也不要产物丢一个运行时绑定）。
 */
function collectValueReferences(root: unknown): {
  valueRefs: Set<string>;
  typeRefs: Set<string>;
  ambiguousRefs: Set<string>;
} {
  const valueRefs = new Set<string>();
  const typeRefs = new Set<string>();
  const ambiguousRefs = new Set<string>();

  /**
   * 类型位置的引用收集（广度式）：把类型子树里的**所有**标识符记进 typeRefs。
   *
   * 广度式是**故意**的：这里多记一个名字只会让某条 import **不被消掉**
   * （保守方向）⇒ 不会误删运行时有用的 import。
   */
  const collectTypeRefs = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const el of node) collectTypeRefs(el);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const rec = node as Record<string, unknown>;
    const type = rec.type;
    if (typeof type !== "string") return;
    if (type === "Identifier" || type === "JSXIdentifier") {
      if (typeof rec.name === "string") typeRefs.add(rec.name);
      return;
    }
    for (const key of Object.keys(rec)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      const child = rec[key];
      if (child === null || typeof child !== "object") continue;
      collectTypeRefs(child);
    }
  };

  /**
   * 节点自身的**类型位置字段**（形参注解 / 返回类型 / 泛型实参 …）⇒
   * 记进 typeRefs（它们是「只在类型位置被用到」的证据），但**不是**值引用。
   */
  const collectOwnTypeRefs = (rec: Record<string, unknown>): void => {
    for (const key of TYPE_ONLY_FIELDS) {
      const typed = rec[key];
      if (typed === null || typeof typed !== "object") continue;
      collectTypeRefs(typed);
    }
  };

  const visitPattern = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const el of node) visitPattern(el);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const rec = node as Record<string, unknown>;
    switch (rec.type) {
      case "ObjectPattern": {
        const props = rec.properties;
        if (Array.isArray(props)) {
          for (const p of props) {
            const prop = p as Record<string, unknown>;
            if (prop.type === "RestElement") {
              visitParam(prop.argument);
              continue;
            }
            if (prop.computed === true) visit(prop.key);
            visitParam(prop.value);
          }
        }
        return;
      }
      case "ArrayPattern": {
        const elems = rec.elements;
        if (Array.isArray(elems)) for (const e of elems) visitPattern(e);
        return;
      }
      case "AssignmentPattern":
        visit(rec.right);
        visitParam(rec.left);
        return;
      case "RestElement":
        visitParam(rec.argument);
        return;
      default:
        visit(node);
    }
  };

  const visitParam = (p: unknown): void => {
    if (Array.isArray(p)) {
      for (const el of p) visitParam(el);
      return;
    }
    if (typeof p !== "object" || p === null) return;
    const rec = p as Record<string, unknown>;
    collectOwnTypeRefs(rec);
    switch (rec.type) {
      case "Identifier":
        return; // 绑定名，不是引用
      case "AssignmentPattern":
        visit(rec.right); // 默认值是值引用
        visitParam(rec.left);
        return;
      case "ObjectPattern":
      case "ArrayPattern":
        visitPattern(rec);
        return;
      case "RestElement":
        visitParam(rec.argument);
        return;
      case "TSParameterProperty":
        visitParam(rec.parameter);
        return;
      default:
        visit(rec); // 未知形态 ⇒ 保守：整体收集
    }
  };

  const visitParams = (params: unknown): void => {
    if (!Array.isArray(params)) return;
    for (const p of params) visitParam(p);
  };

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const el of node) visit(el);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const rec = node as Record<string, unknown>;
    const type = rec.type;
    if (typeof type !== "string") return;
    collectOwnTypeRefs(rec);
    switch (type) {
      // ---- 类型位置：整棵子树跳过（TS 在这些位置不产生运行时引用）----
      // ⚠ 跳过的同时把子树里的标识符记进 typeRefs（广度式）⇒ 能区分
      // 「只在类型位置被用到」与「根本没被用到」两种形态（见
      // isTypeOnlyImportSpecifier：后者**保留** import ⇒ 保守）。
      case "TSTypeAliasDeclaration":
      case "TSTypeParameterDeclaration":
      case "TSTypeParameterInstantiation":
      case "TSInterfaceDeclaration": // 接口整体被擦除 ⇒ heritage 也不产生运行时引用
      case "TSInterfaceBody":
      case "TSPropertySignature":
      case "TSMethodSignature":
      case "TSIndexSignature":
      case "TSCallSignatureDeclaration":
      case "TSConstructSignatureDeclaration":
      case "TSTypeAnnotation":
      case "TSTypeQuery": // `typeof X` 是类型查询 ⇒ tsc 也会 elide 掉该 import
      case "TSTypeReference":
      case "TSQualifiedName":
      case "TSTypeOperator":
      case "TSArrayType":
      case "TSTupleType":
      case "TSOptionalType":
      case "TSRestType":
      case "TSUnionType":
      case "TSIntersectionType":
      case "TSConditionalType":
      case "TSInferType":
      case "TSMappedType":
      case "TSIndexedAccessType":
      case "TSParenthesizedType":
      case "TSLiteralType":
      case "TSTemplateLiteralType":
      case "TSImportType":
      case "TSFunctionType":
      case "TSConstructorType":
      case "TSTypePredicate":
      case "TSNamedTupleMember":
        collectTypeRefs(node);
        return;
      // ---- 标识符：值引用 ----
      case "Identifier":
      case "JSXIdentifier":
        if (typeof rec.name === "string") valueRefs.add(rec.name);
        return;
      // ---- 非引用位置 ----
      case "PrivateName":
      case "MetaProperty":
      case "ImportSpecifier": // local 是绑定
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
      case "ImportAttribute":
      case "ExportSpecifier": // 由 ExportNamedDeclaration 决定
        return;
      // ---- 绑定位置：名字是绑定，不是引用 ----
      case "VariableDeclarator":
        visit(rec.init);
        return;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        visitParams(rec.params);
        visit(rec.body);
        return;
      case "ClassDeclaration":
      case "ClassExpression":
        visit(rec.superClass); // extends 的基类是**值**引用
        visit(rec.body);
        return;
      case "ClassMethod":
      case "ClassPrivateMethod":
      case "ObjectMethod":
        if (rec.computed === true) visit(rec.key);
        visitParams(rec.params);
        visit(rec.body);
        return;
      case "ClassProperty":
      case "ClassPrivateProperty":
      case "ClassAccessorProperty":
        if (rec.computed === true) visit(rec.key);
        visit(rec.value);
        return;
      case "ObjectProperty":
        if (rec.computed === true) visit(rec.key);
        else if (rec.shorthand === true) visit(rec.key); // 简写 { X } ⇒ X 是引用
        visit(rec.value);
        return;
      case "MemberExpression":
      case "OptionalMemberExpression":
        visit(rec.object);
        if (rec.computed === true) visit(rec.property); // a.b 的 b 不是引用
        return;
      case "CatchClause":
        visit(rec.body);
        return;
      case "LabeledStatement":
      case "BreakStatement":
      case "ContinueStatement":
        visit(rec.body);
        return;
      case "RestElement":
        visitParam(rec.argument);
        return;
      case "AssignmentPattern":
        visit(rec.right);
        visitParam(rec.left);
        return;
      case "ObjectPattern":
      case "ArrayPattern":
        visitPattern(rec);
        return;
      case "TSParameterProperty":
        visitParam(rec.parameter);
        return;
      // ---- export：本地再导出是「值引用」但**判不准**（X 可能是类型）----
      case "ExportNamedDeclaration": {
        if (rec.source) {
          // export { X } from "m" ⇒ X 是**源模块**的绑定，不是本地引用
          visit(rec.declaration);
          return;
        }
        const specs = rec.specifiers;
        if (Array.isArray(specs)) {
          for (const s of specs) {
            const spec = s as Record<string, unknown>;
            if (spec.exportKind === "type") continue;
            const local = spec.local as { name?: string } | undefined;
            if (local && typeof local.name === "string") {
              valueRefs.add(local.name);
              ambiguousRefs.add(local.name);
            }
          }
        }
        visit(rec.declaration);
        return;
      }
      // ---- enum：成员名不是引用；初始化子表达式是值引用 ----
      case "TSEnumDeclaration": {
        const body = rec.body as { members?: unknown[] } | undefined;
        const members = Array.isArray(body?.members) ? body.members : [];
        for (const m of members) {
          const member = m as Record<string, unknown>;
          visit(member.initializer);
        }
        return;
      }
      // ---- namespace：运行时语义 ⇒ 体内照常收集 ----
      case "TSModuleDeclaration":
        visit(rec.body);
        return;
      default:
        break;
    }
    // 通用：遍历所有对象值字段（类型位置字段 ⇒ 记进 typeRefs，不当值引用）
    for (const key of Object.keys(rec)) {
      const child = rec[key];
      if (child === null || typeof child !== "object") continue;
      if (TYPE_ONLY_FIELDS.has(key)) {
        collectTypeRefs(child);
        continue;
      }
      visit(child);
    }
  };

  visit(root);
  return { valueRefs, typeRefs, ambiguousRefs };
}

/**
 * import 说明符是否指向**本地**模块（相对路径）——nudo 会把本地 `.ts` 剥成 `.js`。
 *
 * Bug 445 的失效形态**只发生在本地模块**上：被 import 的本地 `.ts` 被剥成
 * **空模块** ⇒ 它的类型专用导出在产物里消失 ⇒ ESM 链接期 SyntaxError。
 * **包**说明符指向的模块不由 nudo 剥除 ⇒ 它的运行时导出是否存在是包自己的事
 * ⇒ 保守**不动**（免得改变分析面对包导入的看法）。
 */
function isLocalModuleSource(source: { value?: unknown } | undefined): boolean {
  const v = source?.value;
  return typeof v === "string" && (v.startsWith("./") || v.startsWith("../"));
}

/**
 * import specifier 是否「类型专用」（Bug 445）。
 *
 * - 显式 `import { type A }` / `import type { A }` ⇒ 显式类型专用（既有行为）。
 * - **本地**（相对路径）import：绑定名在**值位置零引用**、但在**类型位置有
 *   引用** ⇒ 只在类型位置被使用 ⇒ 与 tsc 的 import elision 同口径地消掉。
 *
 * ⚠ **保守**：① 包说明符的 import 一律**保留**（nudo 不剥除包 ⇒ 消掉它可能
 * 丢掉运行时有用的绑定）；② 绑定**根本没被引用**的 import **保留**（tsc 会消掉
 * 它，但那属于「产物更干净」而不是「产物可用」）；③ `export { X }` 本地再导出
 * 判不准 ⇒ **保留**。
 *
 * ⚠ `isTypeOnlyStatement`（整条删除判定）与 `transformNode`（specifier 过滤）
 * **必须同口径** ⇒ 两处都走这一个 helper。
 */
function isTypeOnlyImportSpecifier(
  spec: { importKind?: string; local?: { name?: string } },
  ctx: StripContext,
  localModule: boolean,
): boolean {
  if (spec.importKind === "type" || spec.importKind === "typeof") return true;
  if (!localModule) return false;
  const local = spec.local?.name;
  if (typeof local !== "string" || local.length === 0) return false;
  if (ctx.valueRefs.has(local)) return false;
  return ctx.typeRefs.has(local);
}

/**
 * AST 注释里的 `@nudo:` 指令条数（Bug 968 的兜底自检）。
 *
 * 只数**挂在节点上**的注释（打印器只打印这些）⇒ 剥除前后的条数必须相等：
 * 不等 ⇒ 有指令随被删语句一起消失（源红 / 产物绿的假绿）。
 */
function countNudoDirectives(root: unknown): number {
  let count = 0;
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const el of node) visit(el);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const rec = node as Record<string, unknown>;
    for (const key of COMMENT_KEYS) {
      const comments = rec[key];
      if (!Array.isArray(comments)) continue;
      for (const c of comments) {
        if (seen.has(c)) continue;
        seen.add(c);
        const value = (c as { value?: unknown }).value;
        if (typeof value === "string" && value.includes("@nudo:")) count++;
      }
    }
    for (const key of Object.keys(rec)) {
      if ((COMMENT_KEYS as readonly string[]).includes(key)) continue;
      const child = rec[key];
      if (child === null || typeof child !== "object") continue;
      visit(child);
    }
  };
  visit(root);
  return count;
}

/** 把被删节点的注释**转挂**到幸存节点（Bug 968） */
function carryComments(target: unknown, comments: unknown[], slot: "leading" | "trailing"): void {
  if (!target || typeof target !== "object") return;
  const rec = target as Record<string, unknown>;
  const key = slot === "leading" ? "leadingComments" : "trailingComments";
  const existing = Array.isArray(rec[key]) ? (rec[key] as unknown[]) : [];
  rec[key] = slot === "leading" ? [...comments, ...existing] : [...existing, ...comments];
}

/** TS 的 `this` 形参：Babel 把它表示成「一个名叫 this 的 Identifier」 */
function isThisParam(p: unknown): boolean {
  if (!p || typeof p !== "object") return false;
  const rec = p as Record<string, unknown>;
  return rec.type === "Identifier" && rec.name === "this";
}

/** 数值字面量节点 */
function numLit(value: number): Record<string, unknown> {
  return { type: "NumericLiteral", value };
}

/** 字符串字面量节点 */
function strLit(value: unknown): Record<string, unknown> {
  return { type: "StringLiteral", value: typeof value === "string" ? value : String(value ?? "") };
}

/** `E["KEY"]`（计算成员访问） */
function enumMemberAccess(enumName: string, key: string): Record<string, unknown> {
  return {
    type: "MemberExpression",
    object: { type: "Identifier", name: enumName },
    property: { type: "StringLiteral", value: key },
    computed: true,
  };
}

/**
 * enum **成员引用**改写（Bug 234）。
 *
 * 计算成员（`B = A * 10`）的初始化表达式里，`A` 是**这个 enum 的成员引用**
 * ——tsc 的 emit 把它改写成 `E["A"]`（必要时再折叠常量）。旧实现把表达式
 * **原样**抄进 IIFE ⇒ 产物里 `A` 是**未绑定全局** ⇒ 运行期 ReferenceError。
 *
 * 改写口径：
 * - 只改写**裸标识符**（值位置）——`A` ⇒ `E["A"]`；
 * - **非引用位置**不动：非计算的对象键（`{ A: 1 }`）、非计算的属性名
 *   （`obj.A`）、`label:`（`break A`）——它们不是「读一个绑定」；
 * - 计算位置（`{ [A]: 1 }` / `obj[A]`）是引用位置 ⇒ 照常改写。
 */
function rewriteEnumMemberRefs(
  value: unknown,
  enumName: string,
  memberKeys: ReadonlySet<string>,
  isRef: boolean = true,
  seen: Set<object> = new Set(),
): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) rewriteEnumMemberRefs(item, enumName, memberKeys, isRef, seen);
    return;
  }
  const node = value as Record<string, unknown>;
  const type = typeof node.type === "string" ? node.type : "";
  if (type === "Identifier") {
    if (!isRef) return;
    const name = typeof node.name === "string" ? node.name : "";
    if (name === "" || !memberKeys.has(name)) return;
    delete node.name;
    Object.assign(node, enumMemberAccess(enumName, name));
    return;
  }
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (child === null || typeof child !== "object") continue;
    // 子位置是不是「引用位置」
    let childIsRef = isRef;
    if (key === "label") {
      childIsRef = false; // break A / continue A —— 标签不是绑定
    } else if (key === "property" && (type === "MemberExpression" || type === "OptionalMemberExpression")) {
      childIsRef = isRef && node.computed === true; // obj.A 的 A 不是引用
    } else if (key === "key") {
      childIsRef = isRef && node.computed === true; // { A: 1 } 的 A 不是引用
    }
    rewriteEnumMemberRefs(child, enumName, memberKeys, childIsRef, seen);
  }
}

/**
 * 计算成员的值的**静态形态**（Bug 234）——字符串值 ⇒ tsc **不**建反向映射
 * （`E["B"] = "ab"`，而不是 `E[E["B"] = "ab"] = "B"`）。
 *
 * 只在**静态可判定**时给结论（拿不准 ⇒ 按数值处理 ⇒ 建反向映射）：
 * - 字面量字符串 ⇒ 字符串；
 * - `+` 连接的任一侧是字符串 ⇒ 字符串（JS 语义）；
 * - 裸标识符且指向一个**字符串成员** ⇒ 字符串。
 */
function computedMemberIsString(
  init: Record<string, unknown> | undefined,
  memberKinds: ReadonlyMap<string, "string" | "number">,
): boolean {
  if (!init) return false;
  if (init.type === "StringLiteral") return true;
  if (init.type === "Identifier") {
    const name = typeof init.name === "string" ? init.name : "";
    return name !== "" && memberKinds.get(name) === "string";
  }
  if (init.type === "BinaryExpression" && init.operator === "+") {
    return (
      computedMemberIsString(init.left as Record<string, unknown>, memberKinds) ||
      computedMemberIsString(init.right as Record<string, unknown>, memberKinds)
    );
  }
  return false;
}

/**
 * enum 成员的赋值语句。
 *
 * - **数值成员**（tsc 建反向映射）：`E[E["KEY"] = <value>] = "KEY"`
 * - **字符串成员**（tsc **不**建反向映射）：`E["KEY"] = <value>`
 */
function enumMemberAssign(
  enumName: string,
  key: string,
  value: Record<string, unknown>,
  numeric: boolean,
): Record<string, unknown> {
  if (!numeric) {
    return {
      type: "ExpressionStatement",
      expression: {
        type: "AssignmentExpression",
        operator: "=",
        left: enumMemberAccess(enumName, key),
        right: value,
      },
    };
  }
  return {
    type: "ExpressionStatement",
    expression: {
      type: "AssignmentExpression",
      operator: "=",
      left: {
        type: "MemberExpression",
        object: { type: "Identifier", name: enumName },
        property: {
          type: "AssignmentExpression",
          operator: "=",
          left: enumMemberAccess(enumName, key),
          right: value,
        },
        computed: true,
      },
      right: strLit(key),
    },
  };
}

/**
 * TS enum → 运行时对象（Bug 913）。
 *
 * 形态**逐个对齐 tsc 的 emit**（target ES2022 / module esnext）：
 *
 * | 源 | tsc emit | 本实现 |
 * |---|---|---|
 * | `enum E { A = 1, B }` | `E[E["A"] = 1] = "A"; E[E["B"] = 2] = "B";` | 同（反向映射 + 自动递增） |
 * | `enum S { A = "a" }` | `S["A"] = "a";` | 同（**字符串成员无反向映射**） |
 * | `enum M { A = 1, B = "b" }` | `E[E["A"] = 1] = "A"; E["B"] = "b";` | 同 |
 * | `const enum CE { A = 1 }` | 默认**擦除 + 内联**；`--preserveConstEnums` 才留对象 | 对齐 `--preserveConstEnums`（跨文件内联需要类型信息，strip 拿不到 ⇒ 保留运行时对象） |
 *
 * 产物形态：`var E = (function (E) { …; return E; })({})`
 * —— 与 tsc 的 `var E; (function (E) { … })(E || (E = {}));` **可观察等价**
 * （同一个对象、同一套映射、同一个键序）。
 *
 * ⚠ `declare enum` 是**环境声明**（无运行时语义）⇒ 仍整条删除。
 */
function synthesizeEnum(
  node: Node & Record<string, unknown>,
  source: string | undefined,
  opts: StripOptions | undefined,
  ctx: StripContext,
): Node {
  const id = node.id as { type?: string; name?: string } | undefined;
  const name = id?.type === "Identifier" && typeof id.name === "string" ? id.name : "";
  const body = node.body as { members?: unknown[] } | undefined;
  const members = Array.isArray(body?.members) ? body.members : [];
  const stmts: unknown[] = [];
  let prevValue: number | undefined; // 上一个成员的数值（自动递增用）
  let prevKey: string | undefined; // 上一个成员的键（自动递增的运行期兜底用）
  // 本 enum 的**全部成员键**（计算成员的成员引用改写用 · Bug 234）
  const memberKeys = new Set<string>();
  // 成员值的**静态形态**（"string" / "number"）——计算成员要不要建反向映射
  // 取决于它的值是不是字符串（tsc 口径：字符串成员**不**建反向映射）。
  const memberKinds = new Map<string, "string" | "number">();
  for (const m of members) {
    const member = m as Record<string, unknown>;
    const mid = member.id as { type?: string; name?: string; value?: unknown } | undefined;
    const key = mid?.type === "StringLiteral" ? String(mid.value ?? "") : (mid?.name ?? "");
    if (key === "") continue;
    memberKeys.add(key);
    const init = member.initializer as Record<string, unknown> | undefined;
    if (init?.type === "StringLiteral") memberKinds.set(key, "string");
    else if (init?.type === "NumericLiteral") memberKinds.set(key, "number");
  }
  for (const m of members) {
    const member = m as Record<string, unknown>;
    const mid = member.id as { type?: string; name?: string; value?: unknown } | undefined;
    const key = mid?.type === "StringLiteral" ? String(mid.value ?? "") : (mid?.name ?? "");
    if (key === "") continue;
    const init = member.initializer as Record<string, unknown> | undefined;
    if (init === undefined) {
      // 自动递增：前一个成员值 + 1（tsc 会折叠成字面量）
      if (prevValue !== undefined) {
        const next = prevValue + 1;
        stmts.push(enumMemberAssign(name, key, numLit(next), true));
        prevValue = next;
      } else if (prevKey !== undefined) {
        // 前一个是计算成员（值运行期才知道）⇒ 运行期求值
        stmts.push(
          enumMemberAssign(
            name,
            key,
            {
              type: "BinaryExpression",
              operator: "+",
              left: enumMemberAccess(name, prevKey),
              right: numLit(1),
            },
            true,
          ),
        );
        prevValue = undefined;
      } else {
        stmts.push(enumMemberAssign(name, key, numLit(0), true));
        prevValue = 0;
      }
      prevKey = key;
      continue;
    }
    if (init.type === "StringLiteral") {
      // 字符串成员：tsc **不**建反向映射
      stmts.push(enumMemberAssign(name, key, strLit(init.value), false));
      prevValue = undefined;
      prevKey = key;
      continue;
    }
    if (init.type === "NumericLiteral") {
      const v = typeof init.value === "number" ? init.value : 0;
      stmts.push(enumMemberAssign(name, key, numLit(v), true));
      prevValue = v;
      prevKey = key;
      continue;
    }
    // 计算成员：初始化表达式里的**成员引用**必须改写成 `E["KEY"]`
    // （Bug 234）——裸标识符在产物里是**未绑定全局** ⇒ 运行期 ReferenceError。
    // tsc 的 emit 同口径（`B = A * 10` ⇒ `E[E["B"] = E["A"] * 10]`）。
    const expr = transformValue(init, source, opts, ctx) as Record<string, unknown>;
    rewriteEnumMemberRefs(expr, name, memberKeys);
    if (opts?.report) opts.report.enumComputedMemberRewritten = true;
    // 字符串值的计算成员**不**建反向映射（tsc 口径）——静态可判定时同口径。
    const isStringValue = computedMemberIsString(init, memberKinds);
    stmts.push(enumMemberAssign(name, key, expr, !isStringValue));
    prevValue = undefined;
    prevKey = key;
  }
  const iife: Record<string, unknown> = {
    type: "CallExpression",
    callee: {
      type: "FunctionExpression",
      id: null,
      params: [{ type: "Identifier", name }],
      body: {
        type: "BlockStatement",
        directives: [],
        body: [
          ...stmts,
          { type: "ReturnStatement", argument: { type: "Identifier", name } },
        ],
      },
      generator: false,
      async: false,
    },
    arguments: [{ type: "ObjectExpression", properties: [] }],
    optional: false,
  };
  const decl: Record<string, unknown> = {
    type: "VariableDeclaration",
    kind: "var",
    declarations: [
      {
        type: "VariableDeclarator",
        id: { type: "Identifier", name },
        init: iife,
      },
    ],
  };
  // 位置信息沿用原节点（打印器的 retainLines 需要）
  if (typeof node.start === "number") decl.start = node.start;
  if (typeof node.end === "number") decl.end = node.end;
  if (node.loc) decl.loc = node.loc;
  // 注释转挂（Bug 968）：enum 声明上的文件级指令必须活下来
  for (const key of COMMENT_KEYS) {
    const comments = node[key];
    if (Array.isArray(comments) && comments.length > 0) decl[key] = comments;
  }
  return decl as unknown as Node;
}


/** 实参/形参模式等数组中的空洞（ArrayPattern 的 elision）保持原样 */
function transformValue(
  value: unknown,
  source: string | undefined,
  opts: StripOptions | undefined,
  ctx: StripContext,
): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const out: unknown[] = [];
    // Bug 968：被删语句上的注释（文件级 `/// @nudo:…` 指令）随语句一起消失
    // ⇒ 剔除 REMOVE 元素时把它的 leadingComments **转挂**给下一个幸存节点。
    let pending: unknown[] = [];
    for (const el of value) {
      if (el === null || el === undefined) {
        out.push(el);
        continue;
      }
      const r = transformValue(el, source, opts, ctx);
      if (r === REMOVE) {
        changed = true;
        const lead = (el as { leadingComments?: unknown[] }).leadingComments;
        if (Array.isArray(lead) && lead.length > 0) pending = pending.concat(lead);
      } else {
        if (r !== el) changed = true;
        if (pending.length > 0) {
          carryComments(r, pending, "leading");
          pending = [];
        }
        out.push(r);
      }
    }
    if (pending.length > 0 && out.length > 0) {
      // 被删的元素在**末尾**且没有后继 ⇒ 注释挂到最后一个幸存节点的尾部
      // （否则指令会静默消失 ⇒ 源红 / 产物绿的假绿）。
      carryComments(out[out.length - 1], pending, "trailing");
    }
    return changed ? out : value;
  }
  if (typeof value !== "object" || value === null) return value;
  if (typeof (value as { type?: unknown }).type !== "string") return value;
  return transformNode(value as Node & Record<string, unknown>, source, opts, ctx);
}

function isTsDeclareLike(node: Node): boolean {
  return (node as { declare?: unknown }).declare === true;
}

/** 类型声明本身是否 TS-only（供 export 包装语句判断整体删除） */
function isTypeOnlyDeclaration(decl: Node): boolean {
  switch (decl.type) {
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSDeclareFunction":
      return true;
    case "TSEnumDeclaration":
      // Bug 913：运行时 enum 被**合成**成对象（不是删除）⇒ 只有 `declare enum`
      // （环境声明，无运行时语义）才是类型专用。
      return isTsDeclareLike(decl);
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
function isTypeOnlyStatement(node: Node, ctx: StripContext): boolean {
  const anyNode = node as Node & {
    importKind?: string;
    exportKind?: string;
    specifiers?: unknown[];
    source?: { value?: unknown };
  };
  switch (node.type) {
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSDeclareFunction":
      return true;
    case "TSEnumDeclaration":
      // Bug 913：运行时 enum 被**合成**成对象（见 synthesizeEnum）⇒ 只有
      // `declare enum`（环境声明）才整条删除。
      return isTsDeclareLike(node);
    case "TSExportAssignment": // `export = X` —— TS-only 出口语句（Bug 446）
    case "TSNamespaceExportDeclaration": // `export as namespace X`（Bug 446）
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
      // Bug 445：值位置的「类型专用导入」——绑定在**值位置零引用** ⇒ 只在类型
      // 位置被使用 ⇒ 与 tsc 的 import elision 同口径地消掉（否则产物会 import
      // 一个被剥成空模块的**本地**模块 ⇒ ESM 链接期 SyntaxError）。
      // ⚠ 与 transformNode 的 specifier 过滤**同口径**（同一个 helper）。
      {
        const specs = anyNode.specifiers as { importKind?: string; local?: { name?: string } }[] | undefined;
        const localModule = isLocalModuleSource(anyNode.source as { value?: unknown } | undefined);
        if (specs && specs.length > 0 && localModule && specs.every((s) => isTypeOnlyImportSpecifier(s, ctx, localModule))) {
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
  //
  // Bug 447：同一块再删两个 TS-only 字段：
  // - `definite`（`x!: number` 的确定赋值断言）——Babel 的 ClassProperty.definite
  // - 类成员节点上的 `optional`（`y?: string` 的可选属性 / `m?(): void {}` 的可选方法）
  // ⚠ 按**类成员节点族**判定（与本块同款），而不是逐个枚举节点类型 ——
  // 否则每加一个类成员形态就会再漏一次。
  // ⚠ 表达式节点自己的 `optional`（`a?.b` 的 OptionalMemberExpression）**不是**
  // TS 语法 ⇒ 上面的 `optional` 白名单（Identifier / ObjectPattern /
  // ArrayPattern / RestElement）保持原样，不动。
  if (typeof node.type === "string" && node.type.startsWith("Class")) {
    delete node.accessibility;
    delete node.readonly;
    delete node.abstract;
    delete node.override;
    delete node.declare;
    delete node.definite;
    delete node.optional;
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
 *
 * **赋值位置（Bug 1071）**：派生类（`extends`）的构造器里，`this` 在
 * `super()` 之前**不可访问**（原生：ReferenceError: Must call super
 * constructor…）⇒ 赋值必须落在 `super(...)` **之后**（tsc emit 同口径：
 * `super(); this.x = x;`）。基类（无 `extends`）⇒ 仍在构造器体开头。
 */
function lowerConstructorParameterProperties(
  cls: Node & Record<string, unknown>,
  opts: StripOptions | undefined,
): void {
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

  // 构造器体插入 `this.x = x;`
  const ctorBody = ctor.body as { body?: unknown[] } | undefined;
  if (!ctorBody || !Array.isArray(ctorBody.body)) {
    ctor.body = { type: "BlockStatement", body: [], directives: [] };
  }
  const stmts = (ctor.body as { body?: unknown[] }).body as unknown[];
  const assignments = names.map((name) => ({
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
  }));
  // 派生类 ⇒ 赋值落 `super(...)` **之后**（super 之前访问 this ⇒ ReferenceError）
  const superIdx = cls.superClass ? superCallIndex(stmts) : -1;
  if (superIdx >= 0) {
    stmts.splice(superIdx + 1, 0, ...assignments);
    return;
  }
  // 派生类但构造器体**顶层**没有 `super(...)` 调用 ⇒ 赋值无处可落（原生语义：
  // 派生类构造器必须调 super()，否则访问 this 即 ReferenceError；TS 侧也是
  // 非法源（TS2377））⇒ 保守**不改相对顺序**（仍落体首，保留源自身的失败形态），
  // 不凭空合成 `super()`（父构造器的实参不可知 ⇒ 合成会引入新的错值）⇒ 回报
  // 事实，让产物面提示人工确认。
  if (cls.superClass && opts?.report) opts.report.ctorParamPropsSuperMissing = true;
  stmts.unshift(...assignments);
}

/**
 * 构造器体**顶层**语句里的 `super(...)` 调用下标（没有 ⇒ -1）。
 *
 * 判据：Babel 的 `super()` = ExpressionStatement → CallExpression →
 * `callee.type === "Super"`。只看**顶层**（`super()` 必须在构造器体顶层：
 * TS 规则「含参数属性/字段初始化时 super() 必须是第一条语句」⇒ 嵌在分支里
 * 的 super() 本身就是非法源）。
 */
function superCallIndex(stmts: unknown[]): number {
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i] as
      | { type?: string; expression?: { type?: string; callee?: { type?: string } } }
      | undefined;
    if (stmt?.type !== "ExpressionStatement") continue;
    const expr = stmt.expression;
    if (expr?.type !== "CallExpression") continue;
    if (expr.callee?.type !== "Super") continue;
    return i;
  }
  return -1;
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
  opts: StripOptions | undefined,
  ctx: StripContext,
): Node | typeof REMOVE {
  // Bug 913：TS enum → **合成**运行时对象（**在**删除判定之前：运行时 enum
  // 不再被整条删除；`declare enum` 仍是环境声明 ⇒ 走下面的删除判定）。
  if (node.type === "TSEnumDeclaration" && !isTsDeclareLike(node)) {
    if (opts?.report) opts.report.enumSynthesized = true;
    return synthesizeEnum(node, source, opts, ctx);
  }
  // 剥除事实回报（先于删除判定：enum 节点本函数就要删掉它）
  if (opts?.report) {
    if (node.type === "TSEnumDeclaration") {
      // declare enum：环境声明 ⇒ 整条删除
      opts.report.enumRemoved = true;
    } else if (node.type === "ExportNamedDeclaration") {
      // export enum E {} —— 枚举挂在 export 的 declaration 上（整条语句被删，
      // 枚举节点本身不会被访问到）⇒ 这里补一次事实回报
      const decl = (node as { declaration?: { type?: string; declare?: unknown } }).declaration;
      if (decl?.type === "TSEnumDeclaration") {
        if (decl.declare === true) opts.report.enumRemoved = true;
        else opts.report.enumSynthesized = true;
      }
    } else if (node.type === "TSModuleDeclaration" && !isTsDeclareLike(node)) {
      // 非 declare 的 namespace 有运行时语义 ⇒ 保留 ⇒ 「可能打印不干净」提示成立
      opts.report.namespaceKept = true;
    } else if (node.type === "TSImportEqualsDeclaration") {
      // `import x = require(...)` —— TS-only 导入语法 ⇒ 剥除器**保留**它
      // ⇒ 产物不是合法 JavaScript（Node 解析不了）⇒ 命令层据此拒绝写盘
      // （Bug 050）。
      opts.report.importEqualsKept = true;
    } else if (node.type === "TSExportAssignment" || node.type === "TSNamespaceExportDeclaration") {
      // Bug 446：TS-only 的模块出口语句被剥除
      opts.report.exportAssignmentRemoved = true;
    }
  }
  if (isTypeOnlyStatement(node, ctx)) return REMOVE;

  deleteTypeSyntaxFields(node, source);

  // TS 的 `this` 形参（Bug 448）：`this` 不是合法形参名（strict / sloppy 都不
  // 允许）⇒ 必须从**形参数组**里删掉（只删 typeAnnotation 会留下 `function
  // f(this, a)` ⇒ 产物 Node 加载不了）。
  const params = node.params;
  if (Array.isArray(params)) {
    const kept = params.filter((p) => !isThisParam(p));
    if (kept.length !== params.length) {
      node.params = kept;
      if (opts?.report) opts.report.thisParamRemoved = true;
    }
  }

  // 构造器参数属性降级（Bug 672）——必须**在**递归之前：插入的赋值语句与
  // 剥掉包装的形参随后一并走类型注解剥除（Bug 1071：派生类的赋值落
  // `super(...)` 之后）。
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    lowerConstructorParameterProperties(node, opts);
  }

  // 相对说明符改写（产物面；分析面不传 opts ⇒ 不动）
  if (opts?.resolveSpecifier) rewriteRelativeSpecifier(node, opts.resolveSpecifier);

  // 值 import/export 里混入的 type-only specifier 逐个剔除
  // ⚠ Bug 445：与 isTypeOnlyStatement 的整条删除判定**同口径**（同一个
  // helper）⇒ 不会出现「语句没删但 specifier 删了」的半吊子产物。
  if (node.type === "ImportDeclaration") {
    const specs = node.specifiers as unknown as { importKind?: string; local?: { name?: string } }[];
    const localModule = isLocalModuleSource(node.source as { value?: unknown } | undefined);
    node.specifiers = specs.filter((s) => !isTypeOnlyImportSpecifier(s, ctx, localModule)) as typeof node.specifiers;
    if (opts?.report && localModule) {
      // 事实回报：整条被消掉（零值引用）/ 保守保留（判不准的绑定）
      if (specs.length > 0 && node.specifiers.length === 0) {
        opts.report.typeOnlyImportRemoved = true;
      } else {
        for (const s of specs) {
          const local = s.local?.name;
          if (typeof local === "string" && ctx.ambiguousRefs.has(local)) {
            // `export { X }` 本地再导出：X 可能是值也可能是类型 ⇒ 判不准 ⇒
            // 保守保留（产物面应提示人工确认）。
            opts.report.typeOnlyImportKept = true;
            break;
          }
        }
      }
    }
  } else if (node.type === "ExportNamedDeclaration") {
    if (node.specifiers) {
      node.specifiers = node.specifiers.filter((s) => (s as { exportKind?: string }).exportKind !== "type");
    }
  }

  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (child === null || typeof child !== "object") continue;
    const r = transformValue(child, source, opts, ctx);
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
  // Bug 445：值位置引用收集（**剥除前**算一次 ⇒ 整趟 pass 共用 ⇒
  // isTypeOnlyStatement 与 transformNode 的两处 import 判定同口径）。
  const { valueRefs, typeRefs, ambiguousRefs } = collectValueReferences(ast);
  const ctx: StripContext = { valueRefs, typeRefs, ambiguousRefs };
  // Bug 968：剥除**前后**的 `@nudo:` 指令条数比对（兜底自检）。
  // 只在调用方要 report 时才算——分析面不传 opts ⇒ 这趟全 AST 遍历本来是
  // 纯 dead work（实测占 TS 源 parse 的 ~15%）。
  const directivesBefore = opts?.report ? countNudoDirectives(ast) : 0;
  transformValue(ast, source, opts, ctx);
  if (opts?.report) {
    const directivesAfter = countNudoDirectives(ast);
    opts.report.directivesBefore = directivesBefore;
    opts.report.directivesAfter = directivesAfter;
    if (directivesAfter !== directivesBefore) opts.report.directivesDropped = true;
  }
  return ast;
}
