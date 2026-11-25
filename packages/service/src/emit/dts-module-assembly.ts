/**
 * 模块声明组装：函数投影 + 类 / 值 / namespace / 再导出 → 一份 .d.ts。
 *
 * 从 dts-generator 抽出。Abs widen / 对象注解叠加 / brand 字段渲染由调用方
 * 注入，避免组装层反向依赖 generator 的投影上下文。
 */
import type { Abs } from "@nudojs/core";
import { abs as makeAbs, lookupObjAccessor } from "@nudojs/core";
import { isJsBindingIdent } from "@nudojs/core/internal";
import type { FunctionAnalysis } from "../analyzer.ts";
import { isRuntimeGlobalCtorName } from "./schema-generator.ts";
import { absToTSTypeIr, withDtsContext } from "./dts-context.ts";
import { exportNameRepr } from "./export-binding.ts";
import { dtsClassDeclaration } from "./dts-class-emit.ts";
import { dtsValueDeclarations } from "./dts-value-emit.ts";
import { dtsExportNamesOf } from "./dts-module-emit.ts";
import { brandScopeOf } from "./dts-brand-scope.ts";
import { BRAND_TYPE_ALIASES, BUILTIN_GENERIC_BRANDS } from "./dts-type.ts";
import {
  inheritedMemberViews,
  inheritedStaticNamesOf,
  superClauseText,
} from "./dts-surface-class.ts";
import {
  TS_TYPE_TOKENS,
  annotationTypeRefs,
  isTypeNameResolvable,
} from "./dts-annotation-text.ts";
import { safeValueAnnotation } from "./dts-surface-utils.ts";
import { dtsIdentifier, isArrayTypeText } from "./dts-text.ts";
import { isHiddenInternalSlot } from "./internal-slot.ts";
import { slotAbsOf, widenModuleValueAbs, widenParamAbs } from "./dts-widen.ts";
import { tsAnnotationShape } from "../ts-annotation.ts";
import type {
  DtsClassFieldSurface,
  DtsModuleSurface,
  DtsObjectFnAnnotation,
} from "./dts-ir.ts";
import type {
  DtsContractFace,
  DtsFunctionProjection,
  DtsModuleExtras,
  DtsModuleProjection,
} from "./dts-generator.ts";

export function projectModuleDtsInner(
  surface: DtsModuleSurface | undefined,
  entries: ReadonlyArray<{
    fn: FunctionAnalysis;
    projection: DtsFunctionProjection;
    contract?: DtsContractFace;
  }>,
  extras: DtsModuleExtras | undefined,
): DtsModuleProjection {
  const values = extras?.values;
  const lines: string[] = [];
  const params: Array<{ name: string; type: string }> = [];
  /**
   * BUG-231：`export const cb: Fn = (a, b) => …` 的**声明器注解**。
   *
   * 分析面把箭头 / 函数表达式登记成函数（`scan-top-functions.ts`）⇒ 发射侧
   * 走 `declare function cb(...)`：`const` 形态、声明器上的类型注解、别名里的
   * 可选形参全部丢失（消费方 TS2554 假红 / `unknown` 形参假绿）。tsc
   * `--declaration` 对同一写法发 `export declare const cb: Fn;`。
   *
   * 判据：该本地名既有分析面函数条目，又有**可解析的**声明器注解 ⇒ 抑制
   * 函数声明，改由值声明通道发 `declare const cb: Fn`。注解不可解析 ⇒ 保持
   * 既有函数发射（否则产物里那个名字 TS2304）。
   */
  const annotatedConstLocals = new Set<string>();
  if (surface !== undefined) {
    const entryLocals = new Set(entries.map((e) => e.fn.name));
    for (const [local, value] of surface.values) {
      if (!entryLocals.has(local)) continue;
      if (value.annotation === undefined) continue;
      if (safeValueAnnotation(value.annotation, surface).unresolved !== undefined) continue;
      annotatedConstLocals.add(local);
    }
  }
  /** 类名 → 实例方法声明（分析面） */
  const members = new Map<string, Array<{ member: string; lines: string[] }>>();
  /** brand 类名 → brand Abs（实例形状 → 字段） */
  const brands = new Map<string, Abs>();
  /** 注解原文引用到的 import 名（BUG-168：补 `import type` 用） */
  const annotationRefs = new Set<string>();

  // Bug 22 / 75：顶层 `export interface` / `export type` 与私有类型别名原文
  // 镜像进产物（namespace 成员引用私有类型时产物自身才不报 TS2304）。
  for (const t of surface?.typeDeclarations ?? []) {
    for (const l of t.split("\n")) lines.push(l);
  }
  // BUG-217：类型声明的导出别名（`export { I as IA };` / `export type {…};`）
  for (const l of surface?.typeExportAliases ?? []) lines.push(l);

  for (const { fn, projection, contract } of entries) {
    // BUG-231：声明器带可解析类型注解的 `const f = <箭头/函数表达式>` 由值声明
    // 通道发 `declare const f: T`（tsc 同形）⇒ 不再发函数声明。
    if (annotatedConstLocals.has(fn.name)) continue;
    // BUG-358：同名**值绑定**（`export const handle = 1`）是权威声明；对象
    // 成员键被误登记成的函数入口不得发射（否则常量声明整条消失）。
    if (surface?.values.get(fn.name)?.nonFunctionValue === true) continue;
    if (projection.classMember) {
      const list = members.get(projection.classMember.className) ?? [];
      list.push({
        member: projection.classMember.member,
        lines: projection.classMember.lines,
      });
      members.set(projection.classMember.className, list);
    } else {
      lines.push(...projection.lines);
    }
    params.push(...projection.params);
    for (const n of projection.typeRefs ?? []) annotationRefs.add(n);
    collectBrandAbs(fn, contract, brands);
  }

  // ── 类声明（一次一类；brand 引用的类也要声明，否则 TS2304） ──
  // BUG-130：值声明注解引用的类型名同样要进「产物里可解析」的面（本地类补
  // `declare class`、导入名补 `import type`）——必须在类名收敛**之前**登记，
  // 否则值声明里的 `opts: Opts` 会在产物里成为未声明的名字（TS2304）。
  for (const v of surface?.values.values() ?? []) {
    if (v.annotation === undefined) continue;
    for (const name of annotationTypeRefs(v.annotation)) {
      if (!isTypeNameResolvable(name, surface)) continue;
      if (surface?.classes.has(name) || surface?.imports?.has(name) === true) {
        annotationRefs.add(name);
      }
    }
  }
  const classNames = new Set<string>(members.keys());
  if (surface) {
    for (const [local, cls] of surface.classes) {
      if (cls.exportName !== undefined) classNames.add(local);
    }
    for (const name of brands.keys()) {
      if (surface.classes.has(name)) classNames.add(name);
    }
    // BUG-054：`export const svc = new Svc()`（Svc 未导出）——值声明的 brand
    // 也要求在产物里可解析（否则 `svc: Svc` + 无声明 ⇒ 消费方 TS2304）。
    if (values) {
      for (const a of values.values()) {
        for (const name of brandNamesInAbs(a)) {
          if (surface.classes.has(name)) classNames.add(name);
        }
      }
    }
    // BUG-168：注解原文引用的**本地类**同样要声明（否则产物里那个名字是
    // TS2304）；这类类不是导出面成员 ⇒ 只发 `declare class`（不导出）。
    for (const name of annotationRefs) {
      if (surface.classes.has(name)) classNames.add(name);
    }
    // BUG-151：作为**超类**被引用的类同样要在产物里可解析（`extends Base`
    // 里的 Base 不声明就是 TS2304）——本地类补 `declare class`，导入类补
    // `import type`。传递闭包：基类的基类也要落地。
    const superQueue = [...classNames];
    while (superQueue.length > 0) {
      const name = superQueue.pop()!;
      const base = surface.classes.get(name)?.superClass;
      if (base === undefined) continue;
      if (surface.imports?.has(base) === true) annotationRefs.add(base);
      if (!surface.classes.has(base) || classNames.has(base)) continue;
      classNames.add(base);
      superQueue.push(base);
    }
  }
  // BUG-151：类体字段取**源码面**（构造器里的 `this.x = …` 与类属性初始化器）
  // —— 分析面 `bindings` 的 `class C` 绑定是构造器面 brand（实例形状只有
  // `name`），不是实例形状。
  /** 类名 → 该类的实例字段（brand 字段 ∪ 构造器赋值，去重） */
  const classFields = new Map<string, DtsClassFieldSurface[]>();
  const resolving = new Set<string>();
  const fieldsOf = (className: string): DtsClassFieldSurface[] => {
    const cached = classFields.get(className);
    if (cached) return cached;
    if (resolving.has(className)) return []; // 自引用（非法继承）⇒ 停止
    resolving.add(className);
    const memberNames = new Set((members.get(className) ?? []).map((m) => m.member));
    const out: DtsClassFieldSurface[] = [];
    const seen = new Set<string>();
    // 源码字段优先（BUG-007）：构造器里的 `this.x = <expr>` 与字段注解是**声明
    // 面**的事实；brand 是**某个构造点**的观测快照——`static make(){ return new
    // C() }` 这种零实参内部构造会把 `x` 钉成 `undefined`，与构造器签名自相矛盾。
    // 因而 brand 只作兜底（补源码里看不到的槽，如方法内赋值）。
    const cls = surface?.classes.get(className);
    for (const f of cls?.instanceFields ?? []) {
      if (seen.has(f.name)) continue;
      if (memberNames.has(f.name)) continue; // 与实例方法同名 ⇒ 方法是权威
      seen.add(f.name);
      out.push(f);
    }
    // brand 兜底（分析面观测到的、源码声明面没有的槽）
    for (const f of brandFieldLines(brands.get(className), memberNames)) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      out.push(f);
    }
    // 继承来的字段不再重复声明（TS2416：子类属性类型必须与基类兼容）
    const superName = cls?.superClass;
    const inherited = new Set<string>();
    if (superName) {
      for (const f of fieldsOf(superName)) inherited.add(f.name);
    }
    resolving.delete(className);
    const filtered = out.filter((f) => !inherited.has(f.name));
    classFields.set(className, filtered);
    return filtered;
  };
  for (const className of classNames) {
    const cls = surface?.classes.get(className);
    const clsMembers = members.get(className) ?? [];
    const clsFields = fieldsOf(className);
    const superText = superClauseText(className, surface);
    const inheritedStatics = inheritedStaticNamesOf(className, surface);
    const inheritedViews = inheritedMemberViews(className, surface, members);
    // BUG-360：`export const C = class { … }` 是**值**（构造器对象），不是类型
    // 名。发内部类 + `declare const C: typeof <内部类>`：`Array<C>` / `implements
    // C` 与 tsc 一样报 TS2749，而 `new C(...)` / `C.static` 仍可用。
    const exportNames = cls?.exportNames ?? (cls?.exportName !== undefined ? [cls.exportName] : []);
    if (cls?.isExpression === true && exportNames.length > 0) {
      const internal = `__nudo_expr_${dtsIdentifier(className)}`;
      lines.push(
        ...dtsClassDeclaration(
          internal,
          { ...cls, exportName: undefined, exportNames: [], isDefault: false },
          clsMembers,
          clsFields,
          superText,
          inheritedStatics,
          inheritedViews,
        ),
      );
      const primary = exportNames[0]!;
      const declared = dtsIdentifier(className);
      const extras = exportNames
        .slice(1)
        .map((n) => `export { ${declared} as ${exportNameRepr(n)} };`);
      if (primary === "default") {
        lines.push(`declare const ${declared}: typeof ${internal};`, "export default " + declared + ";", ...extras);
      } else if (primary === className) {
        lines.push(`export declare const ${declared}: typeof ${internal};`, ...extras);
      } else {
        lines.push(
          `declare const ${declared}: typeof ${internal};`,
          `export { ${declared} as ${exportNameRepr(primary)} };`,
          ...extras,
        );
      }
      continue;
    }
    lines.push(
      ...dtsClassDeclaration(
        className,
        cls,
        clsMembers,
        clsFields,
        // BUG-151：`extends <base>`——基类泛型时补 `any` 实参（TS2314：泛型基类
        // 缺类型实参会让整份产物编译不过）。
        superText,
        // BUG-070：继承来的 static 不得在子类里投影成实例方法
        inheritedStatics,
        // BUG-194 / BUG-228：继承来的实例方法（类型实参已代入 + 修饰符保真）
        inheritedViews,
      ),
    );
  }

  // ── BUG-008：`module.exports = C`（类）→ `declare class C` + `export = C` ──
  // 函数形态走 `DtsExportForm.exportEquals`；类走类声明通道（一次一类），
  // 所以在这里把该类的导出前缀摘掉并补 `export =`。`export =` 不得与其它
  // 导出共存（TS2309）——surface.exportEquals 只在单值导出时设置。
  if (surface?.exportEquals !== undefined && surface.exportEquals.local !== "") {
    const target = surface.exportEquals.local;
    const prefix = `export declare class ${dtsIdentifier(target)}`;
    let converted = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.startsWith(prefix)) {
        lines[i] = line.slice("export ".length);
        converted = true;
      }
    }
    if (converted) lines.push(`export = ${dtsIdentifier(target)};`);
    // BUG-110：函数对象上的附加成员走声明合并（`declare namespace f { … }`）。
    // 放在 `export =` 之前 / 之后都合法；这里统一在其它声明之后追加。
    const members = surface.exportEquals.members ?? [];
    if (members.length > 0) {
      lines.push(
        `declare namespace ${dtsIdentifier(target)} {`,
        ...members.map((m) => `  ${m}`),
        "}",
      );
    }
  }

  // ── 模块级值声明（BUG-190）──
  // 已作为函数 / 类声明发射的本地绑定不再发值声明（`export const f = () => …`
  // 被分析成函数；再发一条 `declare const f` 就是 TS2300 Duplicate identifier）。
  const declaredLocals = new Set<string>(entries.map((e) => e.fn.name));
  // BUG-381：对象成员函数在值通道只有形参名；成员自己的分析返回 Abs 在
  // entries 里（`fn f => number`）——传给注解叠加层，未写返回注解也能发布。
  const analyzedMemberReturns = new Map<string, Abs>();
  for (const e of entries) {
    if (e.fn.combinedAbs) analyzedMemberReturns.set(e.fn.name, e.fn.combinedAbs);
  }
  lines.push(
    ...dtsValueDeclarations(
      surface,
      values,
      declaredLocals,
      annotationRefs,
      annotatedConstLocals,
      analyzedMemberReturns,
      {
        absToType: absToTSTypeIr,
        widen: widenModuleValueAbs,
        overlayAnnotations: overlayObjectFnAnnotations,
        safeAnnotation: safeValueAnnotation,
        withContext: withDtsContext,
      },
    ),
  );

  // BUG-384：`export =` / `module.exports = <值>` 的值目标（对象 / 原始值）
  // 也必须走 `export =` 模块形态；上面只转换了类目标。
  if (
    surface?.exportEquals !== undefined &&
    surface.exportEquals.local !== "" &&
    !lines.some((l) => l.startsWith("export = "))
  ) {
    const target = surface.exportEquals.local;
    const prefix = `export declare const ${dtsIdentifier(target)}:`;
    let converted = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.startsWith(prefix)) {
        lines[i] = line.slice("export ".length);
        converted = true;
      }
    }
    if (converted) lines.push(`export = ${dtsIdentifier(target)};`);
  }

  // BUG-473：ambient `declare function f` + `export = f` —— 函数没有值声明
  // / 类声明可转换，但声明已在 typeDeclarations 镜像；补胶水行。
  if (
    surface?.exportEquals !== undefined &&
    surface.exportEquals.local !== "" &&
    !lines.some((l) => l.startsWith("export = "))
  ) {
    const target = surface.exportEquals.local;
    const declared =
      surface.functionOverloads?.has(target) === true ||
      surface.values.has(target) ||
      surface.classes.has(target) ||
      (surface.typeDeclarations ?? []).some((t) =>
        new RegExp(`\\b(?:declare\\s+)?function\\s+${target}\\b`).test(t),
      );
    if (declared) lines.push(`export = ${dtsIdentifier(target)};`);
  }

  // ── namespace 声明（BUG-191）──
  // `export namespace NS { export const x: number = 1 }` 在运行时是真实对象
  // （求值器把 NS.x 物化出来），但旧实现只发射函数/类/值声明 ⇒ 产物里没有 NS
  // ⇒ 消费端 `import { NS }` 报 TS2305。这里按源码成员形态镜像
  // （`export declare namespace NS { export const x: number; }`）。
  if (surface?.namespaces) {
    for (const [local, ns] of surface.namespaces) {
      const names = dtsExportNamesOf(surface, local);
      const exportName = names[0];
      const declaredName = dtsIdentifier(exportName === undefined ? local : exportName);
      lines.push(
        `${exportName === undefined ? "declare" : "export declare"} namespace ${declaredName} {`,
        ...ns.members.map((m) => `  ${m}`),
        "}",
      );
      // 同一绑定另有导出名（`export { NS as Other }`）⇒ 补别名导出语句
      for (const extra of names.slice(1)) {
        lines.push(`export { ${declaredName} as ${exportNameRepr(extra)} };`);
      }
    }
  }

  // ── BUG-012：再导出 **导入绑定**（`import D from "…"; export default D;`
  // / `export { D as E }`）──
  // 这类导出没有本地声明可挂：声明面按「本地名」找导出名，而本地名是导入来的
  // ⇒ 产物里 default / E 整条消失（消费方 TS2305 / TS2351），但文件头部的
  // 导出名表又声称它有 ⇒ 产物自相矛盾。
  // 修法是把它写成**再导出语句**（值语义），按导入原名做一次映射。
  if (surface) {
    const declaredLocally = new Set<string>([
      ...declaredLocals,
      ...classNames,
      ...surface.values.keys(),
      ...(surface.namespaces?.keys() ?? []),
    ]);
    for (const [exportName, local] of surface.exportBindings) {
      if (!local || declaredLocally.has(local)) continue;
      const imp = surface.imports?.get(local);
      if (!imp) continue;
      const fromName = imp.kind === "default" ? "default" : (imp.importedName ?? local);
      // BUG-309：本地 `export type { innerFn as localFn }` 仍是仅类型导出。
      const typeKw =
        surface.typeOnlyExportBindings?.get(exportName) === local ? "type " : "";
      lines.push(
        `export ${typeKw}{ ${exportNameRepr(fromName)} as ${exportNameRepr(exportName)} } from ${JSON.stringify(
          imp.specifier,
        )};`,
      );
    }
  }

  // ── Bug 233：brand 引用的类来自 import ⇒ 补 import type（否则 TS2304）──
  const importLines: string[] = [];
  // BUG-006：**镜像类型声明**（`interface` / `type` 原文）里引用的导入名同样
  // 要补 `import type`，否则产物里那句声明自己就是 TS2304（`export` 与
  // `check` 双绿、消费方编译不过）。此前只统计签名 / 注解里的引用。
  const typeDeclRefs = new Set<string>();
  for (const t of surface?.typeDeclarations ?? []) {
    for (const n of annotationTypeRefs(t)) typeDeclRefs.add(n);
  }
  // BUG-121：**类字段 / 访问器**的注解是第三条引用通道——`DtsClassFieldSurface.type`
  // 保存注解**原文**、访问器直接取 `nodeAnnotationText`，两者都原样进产物，
  // 但此前只有函数/方法投影的 `typeRefs`、镜像类型声明、超类名会进
  // `annotationRefs` ⇒ 「类字段保存注入依赖」（`opts: Opts`）这种常见写法
  // 产出的 `.d.ts` 里 `Opts` **没有对应的 `import type`** ⇒ 消费方 TS2304，
  // 而同一份文件只要类里多一个 `normalize(o: Opts)` 方法就能编译。
  //
  // 这些成员此时已经写进 `lines`（类体在 import 块之前装配）⇒ 按**产物文本**
  // 里的标识符补登记（与注解原文同源，不另开扫描通道；本地类在上面已排除，
  // 多补一条未使用的 `import type` 在 `.d.ts` 里无害，漏补则是硬错）。
  if (surface?.imports) {
    const emittedIdents = new Set(lines.join("\n").match(/[A-Za-z_$][\w$]*/g) ?? []);
    for (const name of surface.imports.keys()) {
      if (annotationRefs.has(name)) continue;
      if (emittedIdents.has(name)) annotationRefs.add(name);
    }
  }

  if (surface?.imports) {
    for (const [name, imp] of surface.imports) {
      // 只为**被引用**的名字补 import：brand 类名（Bug 233）/ 注解原文引用的
      // 类型名（BUG-168）/ 镜像类型声明里的引用（BUG-006）。
      if (!brands.has(name) && !annotationRefs.has(name) && !typeDeclRefs.has(name)) continue;
      if (surface.classes.has(name)) continue; // 本地已声明 ⇒ 走 declare class
      const src = JSON.stringify(imp.specifier);
      if (imp.kind === "equals") {
        importLines.push(`import ${name} = require(${src});`);
        continue;
      }
      if (imp.kind === "default") {
        importLines.push(`import type ${name} from ${src};`);
        continue;
      }
      // BUG-243：`import type { User as U }` 的产物必须写 `User as U`——旧实现
      // 只写本地名 `U`，而目标模块没有导出 `U` ⇒ 整份 `.d.ts` TS2305。
      const imported = imp.importedName;
      const spec =
        imported !== undefined && imported !== name ? `${imported} as ${name}` : name;
      importLines.push(`import type { ${spec} } from ${src};`);
    }
  }
  // Bug 49：namespace 限定超类（`extends NS.Base`）⇒ 补
  // `import * as NS from "…"`，否则产物里 `NS` 从未声明（`extends` 整条被丢）。
  if (surface?.namespaceImports) {
    for (const [name, specifier] of surface.namespaceImports) {
      const used =
        [...classNames].some(
          (c) => surface.classes.get(c)?.superClass?.startsWith(`${name}.`) === true,
        ) ||
        // BUG-390：`import * as ns` 的再导出（`export { ns }`）也要补导入行。
        [...surface.exportBindings.values()].some((local) => local === name);
      if (used) {
        importLines.push(`import * as ${name} from ${JSON.stringify(specifier)};`);
      }
    }
  }

  // ── Bug 233：不可解析的类名（降级为 unknown）——台账（可诊断） ──
  // 判据与 `brandTSType` 同款（内建泛型 / 模块面可解析 / TS 全局类型名 ⇒ 不降级）。
  const scope = brandScopeOf(surface);
  const unresolved = [...brands.keys()].filter(
    (name) =>
      BRAND_TYPE_ALIASES.get(name) === undefined &&
      !BUILTIN_GENERIC_BRANDS.has(name) &&
      !scope.names.has(name) &&
      !TS_TYPE_TOKENS.has(name) &&
      !isRuntimeGlobalCtorName(name),
  );
  const ledger =
    unresolved.length > 0
      ? [
          `// nudo:unresolved-class ${unresolved.join(", ")} — brand type not declared in this module (projected as unknown)`,
        ]
      : [];

  // ── 再导出面 ──
  if (surface) for (const r of surface.reexports) lines.push(r);

  const body = [...importLines, ...ledger, ...lines];
  // BUG-489：`.d.ts` 若没有任何模块标记，非导出的顶层 `declare class` /
  // `interface` / `declare namespace` 会被消费方当成模块公开导出（TS 的
  // ambient 声明在非模块脚本里是全局 / 在无 `export {}` 的边界下被 `import`
  // 解析到）。补一个显式空导出；`export =` 形态不能与其它导出共存，跳过。
  const hasExportEquals = body.some((l) => /^\s*export\s*=/.test(l));
  const hasModuleMarker = body.some((l) => /^\s*export\s*\{\s*\}\s*;?\s*$/.test(l));
  // 只有存在**未导出的顶层声明**时才需要空导出：它们在没有模块标记的
  // 边界会被 `import` 解析到（BUG-489）。全是 `export` 声明时，文件本身
  // 已是模块，补 marker 只会改变文本、无行为收益。
  const unexportedDecl =
    /^(?:declare\s+)?(?:class|function|const|let|var|enum|namespace|module|interface|type)\b/;
  const hasUnexportedTopLevel = body.some((l) => {
    const t = l.trim();
    return unexportedDecl.test(t) && !t.startsWith("export ");
  });
  return {
    lines:
      hasExportEquals || hasModuleMarker || !hasUnexportedTopLevel
        ? body
        : [...body, "export {};"],
    params,
  };
}

/**
 * 类声明的超类子句（BUG-151）：` extends A`；基类是泛型 ⇒ 补 `unknown`
 * 实参（TS2314：泛型基类缺类型实参会让整份产物编译不过；`unknown` 是 TS
 * 的 top，2026-11-06 归一后产物里不再出现语义为「无约束」的 `any`）。
 */
/**
 * 沿 `extends` 链收集**继承来的**静态成员名（BUG-070）。
 *
 * 只收**本模块**里能查到的基类（分析面沿 `superClass` 登记继承方法时同样只
 * 走本地类）；基类自己 override 的方法按 ES 语义以最近一层为准——这里取并集
 * 即可，因为「子类 own 实例方法同名」会在调用方（`staticOnly`）里把该名字剔掉。
 */


/**
 * BUG-194：类型参数字面替换（`get(): T` + `{T → number}` ⇒ `get(): number`）。
 *
 * 只替换**类型位置**的整词出现：限定名后半段（`A.T`）与对象类型的属性键
 * （`{ T: number }`）不动。基类 own 方法的声明行是在基类作用域里算出来的，
 * 落到子类必须按 `extends Base<…>` 的实参代入。
 */


/** 成员在某个类的源码面里的访问修饰符（实例 / 静态方法；查不到 ⇒ undefined）。 */


/**
 * BUG-194 / BUG-228：**继承来的实例方法**的声明视图。
 *
 * 分析面把基类 own 方法按子类名登记（Bug 64：未导出基类的方法也是子类公共
 * 面的一部分），dts 会把它当子类 own 成员发射——但（a）基类的类型实参从未
 * 代入（`Box<number>.get(): T` 变 `unknown` ⇒ 产物自身 TS2416）；（b）
 * `private` / `protected` 一律丢失（TS2415 / 消费方假绿）。这里沿 `extends`
 * 链取**声明类**的签名行，累积代入类型实参，并带回源码面修饰符。
 *
 * `lines === undefined` 表示该成员**不得重发**（private：TS 要求同一个私有
 * 声明，子类重发即 TS2415）。
 */




/**
 * 对象字面量成员函数的源码注解叠加（BUG-157）：**只补缺**——形参位没有
 * Abs 证据时才填；返回位只在观测没有返回类型时填。
 *
 * 求值面的 fn Abs 只有形参名（成员未调用 ⇒ 无外延证据），注解是唯一声明面
 * 证据；调用点观测到的返回类型优先（观测是事实）。
 */

function brandNamesInAbs(a: Abs | undefined, out: Set<string> = new Set()): Set<string> {
  const seen = new Set<Abs>();
  const visit = (x: Abs | undefined): void => {
    if (!x || seen.has(x)) return;
    seen.add(x);
    const s = x.shape;
    switch (s.k) {
      case "brand":
        if (isJsBindingIdent(s.name) || /^[A-Z][A-Za-z0-9_$]*$/.test(s.name)) out.add(s.name);
        visit(s.shape);
        return;
      case "obj":
        for (const slot of Object.values(s.slots)) visit(slot.value);
        return;
      case "arr":
        visit(s.element);
        return;
      case "tuple":
        for (const e of s.elements) visit(e);
        if (s.rest) visit(s.rest);
        return;
      case "fn":
        for (const pt of s.paramTypes ?? []) visit(pt);
        if (s.returnType) visit(s.returnType);
        for (const slot of Object.values(s.slots ?? {})) visit(slot.value);
        return;
      case "sum":
        for (const m of s.members) visit(m);
        return;
      case "eff":
        visit(s.inner);
        return;
      default:
        return;
    }
  };
  visit(a);
  return out;
}

function collectBrandAbs(
  fn: FunctionAnalysis,
  contract: DtsContractFace | undefined,
  out: Map<string, Abs>,
): void {
  const seen = new Set<Abs>();
  const visit = (a: Abs | undefined): void => {
    if (!a || seen.has(a)) return;
    seen.add(a);
    const s = a.shape;
    switch (s.k) {
      case "brand":
        if (isJsBindingIdent(s.name) || /^[A-Z][A-Za-z0-9_$]*$/.test(s.name)) {
          if (!out.has(s.name)) out.set(s.name, a);
        }
        visit(s.shape);
        return;
      case "obj":
        for (const slot of Object.values(s.slots)) visit(slot.value);
        return;
      case "arr":
        visit(s.element);
        return;
      case "tuple":
        for (const e of s.elements) visit(e);
        if (s.rest) visit(s.rest);
        return;
      case "fn":
        for (const p of s.paramTypes ?? []) visit(p);
        if (s.returnType) visit(s.returnType);
        for (const slot of Object.values(s.slots ?? {})) visit(slot.value);
        return;
      case "sum":
        for (const m of s.members) visit(m);
        return;
      case "eff":
        visit(s.inner);
        return;
      default:
        return;
    }
  };
  for (const c of fn.cases) {
    visit(c.abs);
    for (const a of c.argAbs ?? []) visit(a);
  }
  visit(fn.combinedAbs);
  if (contract) {
    for (const p of contract.params) visit(p.abs);
    visit(contract.return);
  }
}

function overlayObjectFnAnnotations(
  a: Abs,
  annotations: readonly DtsObjectFnAnnotation[] | undefined,
  surface: DtsModuleSurface,
  refs?: Set<string>,
  analyzedReturns?: ReadonlyMap<string, Abs>,
): Abs {
  // BUG-256：即使没有任何函数注解，也要走访问器实体化（getter-only 的
  // `readonly` 是访问器表的事实，与注解无关）。
  if (a.shape.k !== "obj") return a;
  const slots: Record<string, (typeof a.shape.slots)[string]> = { ...a.shape.slots };
  // BUG-235：本函数会造**新 Abs 身份**，而访问器侧表按对象身份键控 ⇒ 新对象
  // 再也查不到 getter，下游 `slotAbsOf` 落回 `$lit(void 0)` 占位槽，把 getter
  // 读域发布成 exact `undefined`（`{ m(a: number): string; g: undefined }`）。
  // 侧表无法整体迁移（`migrateAccessors` 不在公共面），但投影只需要读域 ⇒
  // 在造新对象前把它**实体化**进槽值。
  //
  // BUG-233 / BUG-256：getter-only（有 get 无 set）在 TS 里是**只读**属性，
  // 这里把该事实落成槽标记（下游 widen 透传、渲染发 `readonly`）——新对象
  // 没有侧表，晚一步就再也查不到。旧实现只在「有返回注解」时落标记，且第一段
  // 的改动因 `changed` 未置位被整体丢弃（`gAnnot` / `gPlain` 都发可写）。
  //
  // BUG-270：setter-only 的属性类型是 **setter 形参类型**（TS 语义），不是
  // 占位槽的 `undefined`。参数注解在 `objectFnMemberAnnotations` 里已采集。
  let changed = false;
  for (const [k, slot] of Object.entries(slots)) {
    const acc = lookupObjAccessor(a, k);
    if (acc === undefined) continue;
    if (acc.get === undefined) {
      const ann = (annotations ?? []).find((a) => a.key === k);
      const paramText = ann?.paramTypes[0];
      if (paramText !== undefined && safeValueAnnotation(paramText, surface, refs).unresolved === undefined) {
        const shape = tsAnnotationShape(paramText);
        if (shape) {
          slots[k] = { ...slot, value: makeAbs(shape, undefined, undefined, "path") };
          changed = true;
        }
      }
      continue;
    }
    const read = slotAbsOf(a, k, slot.value);
    const readonly = acc.set === undefined;
    if (read !== slot.value || (readonly && slot.readonly !== true)) {
      slots[k] = {
        ...slot,
        ...(read !== slot.value ? { value: read } : {}),
        ...(readonly ? { readonly: true } : {}),
      };
      changed = true;
    }
  }
  // BUG-475：带点路径的注解（`inner.fn`）递归到嵌套对象槽。
  const nestedGroups = new Map<string, DtsObjectFnAnnotation[]>();
  for (const ann of annotations ?? []) {
    const dot = ann.key.indexOf(".");
    if (dot <= 0) continue;
    const head = ann.key.slice(0, dot);
    const rest = ann.key.slice(dot + 1);
    const list = nestedGroups.get(head) ?? [];
    list.push({ ...ann, key: rest });
    nestedGroups.set(head, list);
  }
  for (const [head, list] of nestedGroups) {
    const slot = slots[head];
    if (!slot || slot.value.shape.k !== "obj") continue;
    const nested = overlayObjectFnAnnotations(slot.value, list, surface, refs, analyzedReturns);
    if (nested !== slot.value) {
      slots[head] = { ...slot, value: nested };
      changed = true;
    }
  }
  // BUG-381：无注解的成员也要用**分析返回**（成员自己的 fn 条目）补返回位，
  // 不能只依赖 `fnMemberAnnotations`（对象属性箭头没有 AST 成员注解条目）。
  for (const [member, ret] of analyzedReturns ?? []) {
    const slot = slots[member];
    if (!slot || slot.value.shape.k !== "fn" || slot.value.shape.returnType !== undefined) continue;
    slots[member] = {
      ...slot,
      value: { ...slot.value, shape: { ...slot.value.shape, returnType: ret } },
    };
    changed = true;
  }
  for (const ann of annotations ?? []) {
    const slot = slots[ann.key];
    if (!slot) continue;
    const fn = slot.value;
    if (fn.shape.k !== "fn") continue;
    const paramTypes = [...(fn.shape.paramTypes ?? [])];
    let fnChanged = false;
    ann.paramTypes.forEach((text, i) => {
      if (paramTypes[i] !== undefined || text === undefined) return;
      // rest 位必须是数组类型（与 `tsParamAnnotation` 同一判据）
      if (ann.rest[i] === true && !isArrayTypeText(text)) return;
      if (safeValueAnnotation(text, surface, refs).unresolved !== undefined) return;
      const shape = tsAnnotationShape(text);
      if (!shape) return;
      paramTypes[i] = makeAbs(shape, undefined, undefined, "path");
      fnChanged = true;
    });
    let returnType = fn.shape.returnType;
    // 源码返回注解是发布契约：即使观测已有 `unknown` / 窄类型也优先采用
    // （与 `tsDeclaredReturn` 的「声明可发布 ⇒ 发布声明」决议同口径）。
    if (ann.returnType !== undefined) {
      if (safeValueAnnotation(ann.returnType, surface, refs).unresolved === undefined) {
        const shape = tsAnnotationShape(ann.returnType);
        if (shape) {
          returnType = makeAbs(shape, undefined, undefined, "path");
          fnChanged = true;
        }
      }
    } else if (returnType === undefined) {
      // BUG-381：成员自己的分析已给出返回域（`fn f => number exact`）。
      const analyzed = analyzedReturns?.get(ann.key);
      if (analyzed !== undefined) {
        returnType = analyzed;
        fnChanged = true;
      }
    }
    if (!fnChanged) continue;
    slots[ann.key] = {
      ...slot,
      value: {
        ...fn,
        shape: { ...fn.shape, paramTypes, ...(returnType !== undefined ? { returnType } : {}) },
      },
    };
    changed = true;
  }
  return changed ? { ...a, shape: { ...a.shape, slots } } : a;
}

/** brand 实例形状 → 字段声明（排除方法名——方法进类体，不进字段） */

function brandFieldLines(
  brand: Abs | undefined,
  methodNames: Set<string>,
): Array<{ name: string; type: string }> {
  if (!brand) return [];
  const brandShape = brand.shape;
  if (brandShape.k !== "brand") return [];
  const instance = brandShape.shape;
  if (instance.shape.k !== "obj") return [];
  const out: Array<{ name: string; type: string }> = [];
  for (const [k, slot] of Object.entries(instance.shape.slots)) {
    if (methodNames.has(k)) continue;
    // Bug 240：私有字段（`#x`）是 internal 槽 ⇒ 不是用户可见属性 ⇒ 不进类体
    // （与 core 三面同判据）。
    if (isHiddenInternalSlot(k, slot)) continue;
    out.push({ name: k, type: absToTSTypeIr(widenParamAbs(slot.value)) });
  }
  return out;
}

/** Abs 树里的 brand（类实例类型）收集：类名 → brand Abs */
/**
 * BUG-054：Abs 里出现的 brand 类名集合（值声明的实例类型 ⇒ 产物要能解析该类）。
 */
