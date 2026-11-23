/**
 * 类声明面的纯源码工具：类型形参 / 超类实参 / index signature / 重载合并。
 *
 * `scanClassSurface` 仍留在 generator（依赖较多分析面证据）；这里先收口不依赖
 * Abs 的声明片段读取与规范化。
 */
import type {
  DtsClassAccessorSurface,
  DtsClassFieldSurface,
  DtsClassMemberSurface,
  DtsClassMethodSurface,
  DtsCtorSignatureSurface,
} from "./dts-ir.ts";
import { tsAnnotationTypeText } from "../ts-annotation.ts";
import { typeParamNamesInClause } from "./dts-text.ts";
import {
  literalConstKeysOf,
  surfaceComputedKeyName,
} from "./dts-surface-keys.ts";
import {
  classFieldType,
  classFieldTypeOfInit,
  defaultParamTypeTextOf,
  defaultParamTypeTexts,
  surfaceMemberFn,
  surfaceParamNames,
} from "./dts-surface-value.ts";
import {
  nodeAnnotationText,
  safeFieldTypeAnnotation,
  surfaceName,
  surfaceQualifiedName,
  surfaceSlice,
  surfaceSymbolKeyName,
  type SurfaceNode,
} from "./dts-surface-utils.ts";

/** 类型形参声明节点 → 子句原文（`<T, U = string>`）；无 source / 节点 ⇒ undefined。 */
export function typeParamClauseText(
  node: SurfaceNode | undefined,
  source: string | undefined,
): string | undefined {
  if (!source || !node) return undefined;
  const text = surfaceSlice(source, node);
  return text && /^</.test(text) ? text : undefined;
}

/** 超类类型实参实例化节点 → 各实参的源码原文（`extends Base<string>` ⇒ `["string"]`）。 */
export function superTypeArgsText(
  node: SurfaceNode | undefined,
  source: string | undefined,
): string[] {
  if (!source || !node) return [];
  const params = node.params as SurfaceNode[] | undefined;
  if (!Array.isArray(params)) return [];
  return params
    .map((p) => surfaceSlice(source, p))
    .filter((t): t is string => t !== undefined && t.length > 0);
}

/** Bug 88：类体 `TSIndexSignature` → ambient 声明文本（`[key: string]: …;`）。 */
export function indexSignatureText(
  mem: SurfaceNode,
  source: string | undefined,
): string | undefined {
  if (!source) return undefined;
  const raw = surfaceSlice(source, mem);
  if (!raw) return undefined;
  const cleaned = tsAnnotationTypeText(raw.replace(/;\s*$/, ""));
  return cleaned ? `${cleaned};` : undefined;
}

/**
 * BUG-175：把同名**无体声明**合并到实现条目上（`overloads`），无实现时
 * 合并到首条声明上（抽象 / ambient 重载集）——保持源码顺序、去掉重复条目。
 *
 * 合并后发射侧只发 `overloads`（= 源码声明集），**不发实现签名**：实现的
 * 形参注解通常是 `any`，混进重载集就是额外 catch-all 重载（消费方传入 tsc
 * 会拒绝的实参也编译通过）。
 */
export function coalesceClassMethodOverloads(list: DtsClassMethodSurface[]): void {
  const groups = new Map<string, DtsClassMethodSurface[]>();
  for (const e of list) {
    const g = groups.get(e.name);
    if (g) g.push(e);
    else groups.set(e.name, [e]);
  }
  const drop = new Set<DtsClassMethodSurface>();
  for (const [, group] of groups) {
    const decls = group.filter((e) => e.declarationOnly === true);
    if (decls.length === 0) continue;
    const impl = group.find((e) => e.declarationOnly !== true);
    const keep = impl ?? decls[0]!;
    const signatures = impl === undefined && decls.length === 1 ? [] : decls;
    if (signatures.length > 0) {
      keep.overloads = signatures.map((e) => ({
        name: e.name,
        params: e.params,
        ...(e.paramTypes !== undefined ? { paramTypes: e.paramTypes } : {}),
        ...(e.accessibility !== undefined ? { accessibility: e.accessibility } : {}),
        ...(e.isAbstract === true ? { isAbstract: true } : {}),
        ...(e.returnType !== undefined ? { returnType: e.returnType } : {}),
        ...(e.typeParams !== undefined ? { typeParams: e.typeParams } : {}),
        ...(e.optional === true ? { optional: true } : {}),
        ...(e.symbolKey === true ? { symbolKey: true } : {}),
      }));
    }
    for (const e of group) if (e !== keep) drop.add(e);
  }
  if (drop.size === 0) return;
  let w = 0;
  for (let r = 0; r < list.length; r++) {
    const e = list[r]!;
    if (!drop.has(e)) list[w++] = e;
  }
  list.length = w;
}

/**
 * 类声明面扫描（实例方法 / 静态方法 / 构造器形参 / 类型形参 / 超类）。
 *
 * `isResolvable` = 「该名字在产物里可解析」判据（本地类 / import / TS 全局名）：
 * 只有可解析的超类名才进产物（`extends Unknown` 会产出 TS2304）。
 */
export function scanClassSurface(
  decl: SurfaceNode,
  isResolvable: (name: string, valuePosition?: boolean) => boolean = () => false,
  source?: string,
): DtsClassMemberSurface {
  const body = (decl.body as { body?: SurfaceNode[] } | undefined)?.body ?? [];
  // BUG-168：源码声明的类型形参名（`class Box<T, U>`）——产物必须有类型形参槽，
  // 否则消费端 `new Box<string>(…)` 报 TS2558。
  // Babel 的形参节点是 `TSTypeParameter`（`name` 可能是标识符节点，也可能是
  // 字符串——两版 Babel 都见过）⇒ 两种形态都读。
  const typeParamNameOf = (p: SurfaceNode | undefined): string | undefined => {
    if (!p) return undefined;
    if (typeof p.name === "string") return p.name;
    return surfaceName(p.name as SurfaceNode | undefined) ?? surfaceName(p);
  };
  const typeParams = (
    (decl.typeParameters as { params?: SurfaceNode[] } | undefined)?.params ?? []
  )
    .map((p) => typeParamNameOf(p))
    .filter((n): n is string => n !== undefined);
  // Bug 74：类型形参子句原文（`<T = string>`）——含默认值 / 约束。
  const typeParamsText = typeParamClauseText(
    decl.typeParameters as SurfaceNode | undefined,
    source,
  );
  // BUG-132：类自己的类型形参（`class Box<T>`）在字段 / 构造器 / 参数属性的
  // 注解里是合法类型名——不在 `isResolvable` 的四档（本地类 / import /
  // interface·type / 内建）里，旧实现把整条注解当「未声明」丢弃 ⇒
  // `value: unknown` / `constructor(v: unknown)`，与紧邻的 `<T>` 自相矛盾。
  const typeParamScope = new Set(typeParams);
  const resolvableInClass = (name: string, valuePosition?: boolean): boolean =>
    typeParamScope.has(name) || isResolvable(name, valuePosition);
  // BUG-151 / Bug 49：超类（namespace 限定名 `NS.Base` 也要保留）。
  const superName = surfaceQualifiedName(decl.superClass as SurfaceNode | undefined);
  const superClass = superName && isResolvable(superName) ? superName : undefined;
  // Bug 73：源码里写下的超类类型实参（`extends Base<string>`）。
  const superTypeArguments = superTypeArgsText(
    decl.superTypeArguments as SurfaceNode | undefined,
    source,
  );
  // BUG-378：类的 `implements` 子句（文本级保真；接口义务必须在产物里）。
  const implementsTexts =
    source === undefined
      ? []
      : ((decl.implements as SurfaceNode[] | undefined) ?? [])
          .map((n) => surfaceSlice(source, n))
          .filter((t): t is string => t !== undefined);
  // BUG-109：超类不是标识符 / 限定名，而是表达式（`extends mixin(Base)` /
  // `extends (class { … })`）⇒ 留原文作台账，发射侧降级成开放构造基类。
  // 注意：`superName` 有值但**不可解析**（`extends Unknown`）是另一条既有
  // 降级路径（不发射 extends，避免 TS2304）⇒ 不在本条范围内。
  const superExpressionText =
    decl.superClass !== undefined && superName === undefined && source !== undefined
      ? surfaceSlice(source, decl.superClass as SurfaceNode)
      : undefined;
  const instanceMethods: DtsClassMethodSurface[] = [];
  const staticMethods: DtsClassMethodSurface[] = [];
  const staticFields: DtsClassFieldSurface[] = [];
  const accessors: DtsClassAccessorSurface[] = [];
  const indexSignatures: string[] = [];
  let hasPrivateIdentifier = false;
  let ctorParams: string[] | undefined;
  let ctorParamTypes: Array<string | undefined> | undefined;
  /** BUG-042：构造器可见性（源码修饰符；缺省 public） */
  let ctorAccessibility: "private" | "protected" | "public" | undefined;
  /** BUG-234：构造器重载声明集（无体构造器；源码序） */
  const ctorDecls: DtsCtorSignatureSurface[] = [];
  let ctorImpl: DtsCtorSignatureSurface | undefined;
  const instanceFields: DtsClassFieldSurface[] = [];
  /** BUG-033：无注解 getter（待按返回值观测补类型） */
  const pendingGetters: Array<{ index: number; fn: SurfaceNode; isStatic: boolean }> = [];
  /** 无返回注解的静态方法（待按方法体观测补类型；与 getter 同一证据标准） */
  const pendingStaticMethods: Array<{ entry: DtsClassMethodSurface; fn: SurfaceNode }> = [];
  /** 无返回注解的实例方法（待按**注解证据**静态定型；只收窄观测串） */
  const pendingAnnotationReturns: Array<{
    entry: DtsClassMethodSurface;
    fn: SurfaceNode;
    paramNames: string[];
    paramTypes: Array<string | undefined>;
  }> = [];
  const fieldNames = new Set<string>();
  const staticFieldNames = new Set<string>();

  const accessibilityOf = (
    mem: SurfaceNode,
  ): "private" | "protected" | undefined =>
    mem.accessibility === "private" || mem.accessibility === "protected"
      ? mem.accessibility
      : undefined;
  /**
   * 类成员键（BUG-216 / BUG-119）：标识符 / 静态可折的字符串计算键，以及
   * **well-known symbol** 计算键（`[Symbol.iterator]`）。
   *
   * 旧实现只认 `surfaceComputedKeyName`（字符串折叠），symbol 计算键一律
   * undefined ⇒ 采集期的 `if (!key) continue` 把整条成员丢掉。
   */
  const classMemberKeyOf = (
    mem: SurfaceNode,
  ): { name: string; symbolKey?: true } | undefined => {
    if (mem.computed === true) {
      const sym = surfaceSymbolKeyName(mem.key as SurfaceNode | undefined);
      if (sym !== undefined) return { name: sym, symbolKey: true };
      // BUG-385：`const k = "dyn"; [k]()` —— 绑定到字面量 const 的 computed
      // Identifier 有稳定名（tsc 保留 `[k]`；产物发等价的 `dyn()`）。
      const keyNode = mem.key as SurfaceNode | undefined;
      if (keyNode?.type === "Identifier" && typeof keyNode.name === "string") {
        const literal = literalConstKeysOf(source).get(keyNode.name);
        if (literal !== undefined) return { name: literal };
      }
      const folded = surfaceComputedKeyName(keyNode);
      return folded !== undefined ? { name: folded } : undefined;
    }
    const name = surfaceName(mem.key as SurfaceNode | undefined);
    return name !== undefined ? { name } : undefined;
  };
  const fieldAnnotation = (mem: SurfaceNode): string | undefined =>
    // 与形参注解走同一「可解析」判据（本地类 / interface·type / 导入名 / 内建，
    // 加上本类自己的类型形参）；具体名字面由调用方注入。
    safeFieldTypeAnnotation(nodeAnnotationText(mem, source), resolvableInClass);

  const addField = (
    name: string,
    mem: SurfaceNode,
    init: SurfaceNode | undefined,
    symbolKey?: boolean,
  ): void => {
    if (fieldNames.has(name)) return;
    fieldNames.add(name);
    instanceFields.push({
      name,
      // Bug 44：有初始化器看形状，没有则取源码类型注解（不是 `unknown`）。
      type: classFieldType(
        init,
        fieldAnnotation(mem),
        source,
        resolvableInClass,
        mem.readonly === true,
      ),
      // Bug 77 / 86：readonly 与访问修饰符保真。
      ...(mem.readonly === true ? { readonly: true } : {}),
      ...(accessibilityOf(mem) ? { accessibility: accessibilityOf(mem) } : {}),
      ...(mem.abstract === true ? { isAbstract: true } : {}),
      // BUG-044：`x?: T` 的 `?` 挂在 key 上（不在 typeAnnotation 节点里）
      ...(mem.optional === true ? { optional: true } : {}),
      ...(symbolKey === true ? { symbolKey: true } : {}),
    });
  };
  const addStaticField = (name: string, mem: SurfaceNode, symbolKey?: boolean): void => {
    if (staticFieldNames.has(name)) return;
    staticFieldNames.add(name);
    staticFields.push({
      name,
      type: classFieldType(
        mem.value as SurfaceNode | undefined,
        fieldAnnotation(mem),
        source,
        resolvableInClass,
        mem.readonly === true,
      ),
      ...(mem.readonly === true ? { readonly: true } : {}),
      ...(mem.optional === true ? { optional: true } : {}),
      ...(accessibilityOf(mem) ? { accessibility: accessibilityOf(mem) } : {}),
      ...(symbolKey === true ? { symbolKey: true } : {}),
    });
  };
  /**
   * Bug 48：TS 构造器参数属性（`constructor(public id: number, …)`）。
   * 运行时 strip pass 会插入 `this.id = id`，但 dts 读的是剥类型前的 AST ⇒
   * 必须在这里把它们显式登记成实例字段（类型来自源码注解）。
   */
  const collectParamProperty = (p: SurfaceNode): void => {
    if (p.type !== "TSParameterProperty") return;
    const accessibility = accessibilityOf(p);
    const readonly = p.readonly === true;
    let inner = p.parameter as SurfaceNode | undefined;
    let init: SurfaceNode | undefined;
    if (inner?.type === "AssignmentPattern") {
      init = inner.right as SurfaceNode | undefined;
      inner = inner.left as SurfaceNode | undefined;
    }
    const name = surfaceName(inner);
    if (!name || fieldNames.has(name)) return;
    fieldNames.add(name);
    instanceFields.push({
      name,
      type: classFieldType(
        init,
        safeFieldTypeAnnotation(nodeAnnotationText(inner, source), resolvableInClass),
        source,
        resolvableInClass,
        readonly,
      ),
      ...(readonly ? { readonly: true } : {}),
      ...(accessibility ? { accessibility } : {}),
      // BUG-229：`constructor(public z?: string)` 的 `?` 挂在形参自身
      // （AssignmentPattern 解包后是 `left.optional`）——字段面与同文件的
      // `z?: string;` 同口径，否则产物内部自相矛盾（构造器可选、字段必选）。
      ...(inner?.optional === true ? { optional: true } : {}),
    });
  };
  /** 类体里的 `this.<k> = <expr>`（含嵌套语句块） */
  const collectThisAssignments = (node: SurfaceNode | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "AssignmentExpression" || node.type === "AssignmentPattern") {
      const left = node.left as SurfaceNode | undefined;
      const obj = left?.object as SurfaceNode | undefined;
      if (left?.type === "MemberExpression" && obj?.type === "ThisExpression") {
        const key = surfaceName(left.property as SurfaceNode | undefined);
        if (key) addField(key, {}, node.right as SurfaceNode | undefined);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v && typeof v === "object") collectThisAssignments(v as SurfaceNode);
        }
        continue;
      }
      if (value && typeof value === "object") collectThisAssignments(value as SurfaceNode);
    }
  };
  // BUG-083：`static { this.x = … }`（ClassStaticBlock）写入的静态成员。
  // 旧实现只认字段/方法节点 ⇒ 静态块整条被跳过，产物缺成员（消费方 TS2339，
  // 运行期成员其实存在）。只登记 `this.<k> = <expr>` 形态（动态键不猜）。
  const collectStaticAssignments = (node: SurfaceNode | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "AssignmentExpression" || node.type === "AssignmentPattern") {
      const left = node.left as SurfaceNode | undefined;
      const obj = left?.object as SurfaceNode | undefined;
      if (left?.type === "MemberExpression" && obj?.type === "ThisExpression") {
        const key =
          left.computed === true
            ? surfaceComputedKeyName(left.property as SurfaceNode | undefined)
            : surfaceName(left.property as SurfaceNode | undefined);
        if (key) addStaticField(key, { value: node.right as SurfaceNode | undefined });
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v && typeof v === "object") collectStaticAssignments(v as SurfaceNode);
        }
        continue;
      }
      if (value && typeof value === "object") collectStaticAssignments(value as SurfaceNode);
    }
  };
  for (const raw of body) {
    const mem = raw as SurfaceNode & { kind?: string; static?: boolean; value?: SurfaceNode };
    if (mem.type === "ClassStaticBlock" || mem.type === "StaticBlock") {
      collectStaticAssignments(mem.body as SurfaceNode | undefined);
      continue;
    }
    // Bug 88：index signature 是公开索引面。
    if (mem.type === "TSIndexSignature") {
      const t = indexSignatureText(mem, source);
      if (t) indexSignatures.push(t);
      continue;
    }
    const isField =
      mem.type === "ClassProperty" ||
      mem.type === "PropertyDefinition" ||
      mem.type === "ClassAccessorProperty" ||
      mem.type === "ClassPrivateProperty";
    if (isField) {
      // Bug 87：`#` 私有字段 ⇒ 类带 `#private;` 名义标记（不作为结构成员发射）。
      if (
        mem.type === "ClassPrivateProperty" ||
        (mem.key as SurfaceNode | undefined)?.type === "PrivateName"
      ) {
        hasPrivateIdentifier = true;
        continue;
      }
      // BUG-119 / BUG-216：计算键走静态折名（`["a" + "b"]` / `["x"]`），
      // well-known symbol 键走括号形态。
      const keyInfo = classMemberKeyOf(mem);
      if (!keyInfo) continue;
      // Bug 23：static 字段也收集（旧的 `mem.static !== true` 过滤把它整条挡掉）。
      if (mem.static === true) addStaticField(keyInfo.name, mem, keyInfo.symbolKey === true);
      else addField(keyInfo.name, mem, mem.value as SurfaceNode | undefined, keyInfo.symbolKey === true);
      continue;
    }
    const isMethod =
      mem.type === "MethodDefinition" ||
      mem.type === "ClassMethod" ||
      mem.type === "TSDeclareMethod";
    if (!isMethod) continue;
    const kind = mem.kind ?? "method";
    const keyInfo = classMemberKeyOf(mem);
    if (!keyInfo) continue;
    const keyName = keyInfo.name;
    const fnNode = surfaceMemberFn(mem);
    const params = surfaceParamNames(fnNode.params as SurfaceNode[] | undefined);
    const accessibility = accessibilityOf(mem);
    const returnType = nodeAnnotationText(mem, source);
    const methodTypeParams = typeParamClauseText(
      (fnNode.typeParameters ?? mem.typeParameters) as SurfaceNode | undefined,
      source,
    );
    // BUG-175 / BUG-234：无体声明 = 重载签名（或 abstract / declare 方法），
    // 有体 = 实现。tsc `--declaration` 只发重载声明，绝不发实现签名。
    const hasBody = fnNode.body !== undefined;
    const paramTypesOf = (
      rawParams: SurfaceNode[],
      resolvable: (name: string) => boolean = resolvableInClass,
    ): Array<string | undefined> =>
      rawParams.map((p) => {
        // BUG-193：默认值初始值是形参类型证据（`m(x = 1)` ⇒ `x?: number`）。
        // 注解优先；无注解时用默认值；都没有 ⇒ undefined（发射侧回落）。
        const defaultValue = defaultParamTypeTextOf(p, source);
        let n = p;
        if (n.type === "TSParameterProperty") {
          n = (n.parameter as SurfaceNode | undefined) ?? n;
        }
        if (n.type === "AssignmentPattern") {
          n = (n.left as SurfaceNode | undefined) ?? n;
        }
        return (
          safeFieldTypeAnnotation(nodeAnnotationText(n, source), resolvable) ?? defaultValue
        );
      });
    if (kind === "constructor") {
      const rawParams = (fnNode.params as SurfaceNode[] | undefined) ?? [];
      const sig: DtsCtorSignatureSurface = {
        params,
        ...(() => {
          const types = paramTypesOf(rawParams);
          return types.some((t) => t !== undefined) ? { paramTypes: types } : {};
        })(),
        ...(accessibilityOf(mem) ? { accessibility: accessibilityOf(mem) } : {}),
      };
      if (hasBody) ctorImpl = sig;
      else ctorDecls.push(sig);
      for (const p of rawParams) collectParamProperty(p);
      collectThisAssignments(fnNode.body as SurfaceNode | undefined);
      continue;
    }
    // Bug 23：getter / setter 是公开成员（不是可调用入口，但属于类型面）。
    if (kind === "get" || kind === "set") {
      const p0 = (fnNode.params as SurfaceNode[] | undefined)?.[0];
      const t =
        (kind === "get" ? returnType : nodeAnnotationText(p0, source)) ?? "unknown";
      accessors.push({
        name: keyName,
        kind,
        type: t,
        ...(mem.static === true ? { isStatic: true } : {}),
        ...(accessibility ? { accessibility } : {}),
        ...(keyInfo.symbolKey === true ? { symbolKey: true } : {}),
      });
      // BUG-033：无注解的 getter 与同类方法 / 对象 getter 同口径——按**返回值
      // 观测**给类型，而不是一律 `unknown`（消费方 TS2322 / TS18046）。
      // 解析推迟到主循环之后：字段表要先收齐（`get value() { return this.n }`）。
      if (kind === "get" && returnType === undefined) {
        pendingGetters.push({ index: accessors.length - 1, fn: fnNode, isStatic: mem.static === true });
      }
      continue;
    }
    if (kind !== "method") continue;
    // BUG-195：**方法级**类型形参（`m<U>(x: U): U`）同样在产物里可解析——
    // 只查类级作用域会把 `U` 判成未声明 ⇒ 返回注解被丢弃、回落观测 `unknown`。
    const methodTypeParamScope = new Set(typeParamNamesInClause(methodTypeParams));
    const resolvableInMethod = (name: string): boolean =>
      methodTypeParamScope.has(name) || resolvableInClass(name);
    // 形参注解与**字段**注解同一「可解析」判据：引用产物里解析不了的类型名
    // 落进 `.d.ts` 就是 TS2304（整份产物编译不过）⇒ 该位回落 TS top。
    const paramTypes = paramTypesOf(
      (fnNode.params as SurfaceNode[] | undefined) ?? [],
      resolvableInMethod,
    );
    // BUG-193：默认值证据也挂到源码面（分析面签名的形参位据此补缺）
    const paramDefaults = defaultParamTypeTexts(
      fnNode.params as SurfaceNode[] | undefined,
      source,
    );
    const entry: DtsClassMethodSurface = {
      name: keyName,
      params,
      ...(paramTypes.some((t) => t !== undefined) ? { paramTypes } : {}),
      ...(paramDefaults !== undefined ? { paramDefaults } : {}),
      ...(accessibility ? { accessibility } : {}),
      ...(mem.abstract === true ? { isAbstract: true } : {}),
      ...(returnType ? { returnType } : {}),
      ...(methodTypeParams ? { typeParams: methodTypeParams } : {}),
      // BUG-215：`m?(): T` 的 `?` 是方法自身的声明修饰符
      ...(mem.optional === true ? { optional: true } : {}),
      ...(keyInfo.symbolKey === true ? { symbolKey: true } : {}),
    };
    if (!hasBody) {
      // 无体声明：先按「重载候选」入表；主循环后与同名实现合并（见
      // coalesceClassMethodOverloads）。无实现时它们自己就是声明面。
      entry.declarationOnly = true;
      (mem.static === true ? staticMethods : instanceMethods).push(entry);
      continue;
    }
    if (mem.static === true) {
      staticMethods.push(entry);
      if (returnType === undefined) pendingStaticMethods.push({ entry, fn: fnNode });
    } else {
      instanceMethods.push(entry);
      if (returnType === undefined) {
        pendingAnnotationReturns.push({ entry, fn: fnNode, paramNames: params, paramTypes });
      } else {
        // BUG-156（注解档）：源码**有**返回注解时，注解本身就是 `check` 签名面
        // 发布的那条类型 —— 求值面把 `this.<字段>` 播种成 any 得到的宽域
        // （`number | string`）不该盖过它。与形参位同一「可解析」判据；发射侧
        // 只收窄不放宽（`refineObservedReturn`），注解对不上观测时原样保留。
        const evidence = safeFieldTypeAnnotation(returnType, resolvableInMethod);
        if (evidence !== undefined) entry.annotationReturnType = evidence;
      }
    }
  }
  // BUG-175：同名无体声明 → 实现条目的 `overloads`（只发声明，不发实现）；
  // 无实现的重载集/抽象声明则合并到首条上（保持源码序）。
  coalesceClassMethodOverloads(instanceMethods);
  coalesceClassMethodOverloads(staticMethods);
  // BUG-033：getter 的返回值观测（无注解档）。
  // **只在 getter 体内恰有一个 `return` 时**采用——多 return 可能返回不同类型，
  // 取「第一个」会把公开类型钉得比运行时**更窄**（不可靠的说法：消费者按窄
  // 类型写代码，运行时拿到另一支）。与对象字面量 getter 的读域同一判定：
  // 拿不准就 `unknown`（不是「无类型」，是「未观测到」）。
  // 只认两种形态——字面量族（初始化器映射）与 `this.<字段>`（字段类型已知）；
  // 其余表达式一律保留 `unknown`（不猜），避免把 getter 变成第二个推断引擎。
  for (const g of pendingGetters) {
    const observed = getterObservedType(g.fn, g.isStatic);
    const prev = accessors[g.index];
    if (observed !== undefined && prev !== undefined) {
      accessors[g.index] = { ...prev, type: observed };
    }
  }
  // 静态方法的**方法体观测**（无注解档）：同名 static / instance 在分析面只有
  // 一条签名（core 普查按 `C.m` 去重），形参不匹配时不能复用实例位返回类型；
  // 此时按静态方法自己的单条 `return` 给可观测类型（与 getter 同判据）。
  for (const m of pendingStaticMethods) {
    const observed = getterObservedType(m.fn, true);
    if (observed !== undefined) m.entry.observedReturnType = observed;
  }
  // BUG-156：无返回注解的实例方法按**源码注解证据**静态定型。
  //
  // 求值面对「声明字段 + 构造器写入」的实例字段播种 `any`（构造器实参是观测
  // 占位）⇒ `return this.n + 1` 折成 `number | string`；而字段注解 `n: number`
  // 就写在同一份产物里，同次 `check` / `tsc --declaration` 都是 `number`。
  // 这里只做**声明面**能确定的一件事：按源码注解（字段 / 形参）与字面量给
  // 单个 `return` 表达式定型（算术 / 模板 / 比较而已，不做调用推断）。
  // 发射侧**只收窄不放宽**（见 `refineObservedReturn`）。
  for (const m of pendingAnnotationReturns) {
    const inferred = annotationReturnTypeOf(m.fn, m.paramNames, m.paramTypes, false);
    if (inferred !== undefined) m.entry.annotationReturnType = inferred;
  }
  // BUG-234：单构造器通道（ctorParams）取「实现优先，否则首条声明」——重载集
  // 存在时发射侧走 ctorOverloads，ctorParams 只服务既有读面。
  const ctorChosen = ctorImpl ?? ctorDecls[0];
  if (ctorChosen !== undefined) {
    ctorParams = ctorChosen.params;
    ctorAccessibility = ctorChosen.accessibility ?? ctorAccessibility;
    ctorParamTypes = ctorChosen.paramTypes;
  }
  /**
   * 单条 `return` 表达式的**注解证据**类型：字面量 / `this.<字段>` / 带注解
   * 形参，以及它们之间的算术与比较。拿不准（调用、下标、任意属性链…）⇒
   * undefined（不猜）。
   */
  function annotationReturnTypeOf(
    fnNode: SurfaceNode,
    paramNames: string[],
    paramTypes: Array<string | undefined>,
    isStatic: boolean,
  ): string | undefined {
    const returns: SurfaceNode[] = [];
    collectReturns(fnNode.body as SurfaceNode | undefined, returns);
    if (returns.length !== 1) return undefined;
    return annotatedExprType(returns[0]!.argument as SurfaceNode | undefined, {
      paramNames,
      paramTypes,
      isStatic,
    });
  }
  /** 纯注解/字面量表达式 → 基元类型文本（不做求值、不做调用推断）。 */
  function annotatedExprType(
    node: SurfaceNode | undefined,
    scope: { paramNames: string[]; paramTypes: Array<string | undefined>; isStatic: boolean },
  ): string | undefined {
    if (!node) return undefined;
    switch (node.type) {
      case "ParenthesizedExpression":
      case "TSNonNullExpression":
      case "TSSatisfiesExpression":
        return annotatedExprType(node.expression as SurfaceNode | undefined, scope);
      case "NumericLiteral":
        return "number";
      case "StringLiteral":
      case "TemplateLiteral":
        return "string";
      case "BooleanLiteral":
        return "boolean";
      case "NullLiteral":
        return "null";
      case "Identifier": {
        const name = surfaceName(node);
        if (!name) return undefined;
        const at = scope.paramNames.indexOf(name);
        return at < 0 ? undefined : primOfText(scope.paramTypes[at]);
      }
      case "MemberExpression": {
        const obj = node.object as SurfaceNode | undefined;
        const key = surfaceName(node.property as SurfaceNode | undefined);
        if (obj?.type !== "ThisExpression" || !key || node.computed === true) return undefined;
        const table = scope.isStatic ? staticFields : instanceFields;
        return primOfText(table.find((f) => f.name === key)?.type);
      }
      case "UnaryExpression": {
        const op = String(node.operator ?? "");
        if (op === "typeof") return "string";
        if (op === "void") return "undefined";
        if (op === "!") return "boolean";
        const arg = annotatedExprType(node.argument as SurfaceNode | undefined, scope);
        return arg === "number" && (op === "-" || op === "+" || op === "~") ? "number" : undefined;
      }
      case "BinaryExpression": {
        const op = String(node.operator ?? "");
        const left = annotatedExprType(node.left as SurfaceNode | undefined, scope);
        const right = annotatedExprType(node.right as SurfaceNode | undefined, scope);
        if (
          op === "==" || op === "!=" || op === "===" || op === "!==" ||
          op === "<" || op === ">" || op === "<=" || op === ">=" ||
          op === "in" || op === "instanceof"
        ) {
          return "boolean";
        }
        // `+` 有一侧是 string ⇒ TS 的 string；否则两个 number / bigint。
        if (op === "+") {
          if (left === "string" || right === "string") return "string";
          if (left === "number" && right === "number") return "number";
          if (left === "bigint" && right === "bigint") return "bigint";
          return undefined;
        }
        if (
          op === "-" || op === "*" || op === "/" || op === "%" || op === "**" ||
          op === "&" || op === "|" || op === "^" || op === "<<" || op === ">>" || op === ">>>"
        ) {
          if (left === "number" && right === "number") return "number";
          if (left === "bigint" && right === "bigint") return "bigint";
        }
        return undefined;
      }
      default:
        return undefined;
    }
  }
  /** 注解文本 → 基元类型名（对象 / 联合 / 泛型 ⇒ undefined：算术面无法确定） */
  function primOfText(t: string | undefined): string | undefined {
    return t === "number" || t === "string" || t === "boolean" || t === "bigint"
      ? t
      : undefined;
  }
  function getterObservedType(fnNode: SurfaceNode, isStatic: boolean): string | undefined {
    const returns: SurfaceNode[] = [];
    collectReturns(fnNode.body as SurfaceNode | undefined, returns);
    // 0 条 = 无 return（或只从嵌套函数返回）；≥2 条 = 多分支 ⇒ 都不猜
    if (returns.length !== 1) return undefined;
    const ret = returns[0]!.argument as SurfaceNode | undefined;
    if (ret === undefined) return undefined;
    if (ret.type === "MemberExpression") {
      const obj = ret.object as SurfaceNode | undefined;
      const key = surfaceName(ret.property as SurfaceNode | undefined);
      if (obj?.type !== "ThisExpression" || !key || ret.computed === true) return undefined;
      const table = isStatic ? staticFields : instanceFields;
      return table.find((f) => f.name === key)?.type;
    }
    const t = classFieldTypeOfInit(ret, source, resolvableInClass);
    return t === "unknown" ? undefined : t;
  }
  /** getter 体内的 `return`（不跨函数边界；收到第二条即可停） */
  function collectReturns(node: SurfaceNode | undefined, out: SurfaceNode[]): void {
    if (!node || typeof node !== "object" || out.length > 1) return;
    if (
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionDeclaration" ||
      node.type === "ClassMethod" ||
      node.type === "MethodDefinition" ||
      // 对象字面量里的方法 / 访问器同样是函数边界：`{ f() { return 1 } }`
      // 的 `return` 不是外层 getter / static 方法的返回值。
      node.type === "ObjectMethod" ||
      node.type === "ClassPrivateMethod"
    ) {
      return;
    }
    if (node.type === "ReturnStatement") {
      out.push(node);
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          if (!v || typeof v !== "object") continue;
          collectReturns(v as SurfaceNode, out);
        }
        continue;
      }
      if (value && typeof value === "object") collectReturns(value as SurfaceNode, out);
    }
  }

  return {
    instanceMethods,
    staticMethods,
    // BUG-234：构造器重载声明集（有实现 ⇒ 只发声明集，与 tsc 同口径）
    ...(ctorDecls.length > 0 ? { ctorOverloads: ctorDecls } : {}),
    ...(ctorParams !== undefined ? { ctorParams } : {}),
    ...(ctorParamTypes !== undefined ? { ctorParamTypes } : {}),
    ...(ctorAccessibility !== undefined ? { ctorAccessibility } : {}),
    ...(typeParams.length > 0 ? { typeParams } : {}),
    ...(typeParamsText !== undefined ? { typeParamsText } : {}),
    ...(superClass !== undefined ? { superClass } : {}),
    ...(superTypeArguments.length > 0 ? { superTypeArguments } : {}),
    ...(superExpressionText !== undefined ? { superExpressionText } : {}),
    ...(implementsTexts.length > 0 ? { implements: implementsTexts } : {}),
    ...(instanceFields.length > 0 ? { instanceFields } : {}),
    ...(staticFields.length > 0 ? { staticFields } : {}),
    ...(accessors.length > 0 ? { accessors } : {}),
    ...(indexSignatures.length > 0 ? { indexSignatures } : {}),
    ...(decl.abstract === true ? { isAbstract: true } : {}),
    ...(hasPrivateIdentifier ? { hasPrivateIdentifier: true } : {}),
  };
}
