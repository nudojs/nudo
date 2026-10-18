/**
 * 类发射：classSpecOf（成员规格行）/ transpileClass / 访问器 setter thunk。
 * 从 stmt.ts 按域拆出（语句发射留在 stmt.ts）。
 *
 * Invariants:
 * - 类体语句经 transpileFnBodyStmts/emitFnBlockBody 委派 stmt.ts（单一语句
 *   发射事实源）；classSpecOf 产出的 specLines 由 transpile/registerEvalClass
 *   通道消费（求值侧 declare.ts 的 classImpl 挂载）。
 * - ctor 体隐式 return 语义：implicitReturn 只对 ctor 放行（裸 return 折
 *   undefined → TypeError 的原生派生类约束）。
 */
import type { Statement, Expression, Node } from "@babel/types";
import type { TranspileOptions } from "./types.ts";
import {
  isExpression,
  fnBodyHasOwnArguments,
  indent,
  collectForkBindingNames,
  paramDisplayNames,
  nativeParamArity,
} from "./helpers.ts";
import {
  emitParamBindingFromArgs,
} from "./emit.ts";
import { emitTranspileExpression } from "./transpile-dispatch.ts";
import { transpileFnBodyStmts, emitFnBlockBody, paramNamesOf } from "./stmt.ts";

export function emitSetterAccessorThunk(
  vname: string,
  bodySrc: string,
  aliasNames: readonly string[],
  depth: number,
  /** N3：setter 形参默认值/解构绑定行（__nudoArgs 槽，见类/对象 setter 发射位） */
  paramPrologue: string[] = [],
): string {
  const pad = indent(depth);
  const lines: string[] = [`(__this, ${vname}) => {`];
  lines.push(...paramPrologue);
  aliasNames.forEach((n, i) => lines.push(`${pad}const __nab${i} = ${n};`));
  lines.push(`${pad}(() => {`, bodySrc, `${pad}})();`);
  if (aliasNames.length === 1) {
    lines.push(`${pad}if (__nab0 === __this && ${aliasNames[0]} !== __nab0) return ${aliasNames[0]};`);
  } else if (aliasNames.length > 1) {
    lines.push(`${pad}let __nabs;`);
    aliasNames.forEach((n, i) =>
      lines.push(`${pad}if (__nab${i} === __this && ${n} !== __nab${i}) __nabs = __nabs ? $join(__nabs, ${n}) : ${n};`),
    );
    lines.push(`${pad}if (__nabs !== undefined) return __nabs;`);
  }
  lines.push(`${pad}return __this;`, `${indent(depth - 1)}}`);
  return lines.join("\n");
}

/**
 * 类体成员 → $class spec 片段（类声明与类表达式共用，Bug 80）。
 * 返回 spec 行（不含 `let C = $class(...)` 包装）与静态块后置语句
 * （Bug 77：static 块须在类绑定完成后执行——块体内类名可见）。
 */
export function classSpecOf(
  stmt: {
    id?: { name: string } | null;
    body: { body: unknown[] };
    superClass?: unknown;
  },
  depth: number,
  opts: TranspileOptions,
): { name: string; specLines: string[]; staticInitLines: string[] } {
  const name = stmt.id?.name ?? "AnonymousClass";
  // Bug 11：保留 superClass 节点——Identifier 走活引用（TDZ 语义），
  // 其余表达式（字面量/{}/箭头/…）发 transpile 源码，定义期求值。
  const superClassNode = stmt.superClass as { type: string; name?: string } | null | undefined;
  const methods = stmt.body.body as Array<{
    type: string;
    key?: unknown;
    params?: unknown[];
    body?: { type: string; body?: unknown[] };
    kind?: string;
    async?: boolean;
    generator?: boolean;
    static?: boolean;
    computed?: boolean;
    value?: unknown;
  }>;

  const ctorParts: string[] = [];
  const methodParts: string[] = [];
  const staticMethodParts: string[] = [];
  const staticFieldParts: string[] = [];
  /** Bug 59：实例字段 thunk（每次构造以新实例为 this 按源序求值） */
  const instanceFieldParts: string[] = [];
  /** Bug 60：计算键 synth 名 → 键表达式源（定义期求值，$class 折叠真名） */
  const computedKeyParts: string[] = [];
  /** Bug 77：静态块 thunk（类绑定后执行；this = 类值） */
  const staticInitParts: string[] = [];
  /** 方法形参展示名（未调用方法槽 shape.params） */
  const methodParamEntries: Array<[string, string[]]> = [];
  const staticMethodParamEntries: Array<[string, string[]]> = [];
  /** P2b：构造器元数（.length 自有属性）——隐式构造器（基类/派生）恒 0 */
  let ctorLength = 0;
  const accessorDefs = new Map<string, { get?: string; set?: string }>();
  const staticAccessorDefs = new Map<string, { get?: string; set?: string }>();
  let ckSeq = 0;
  // Bug 14：父类构造器源前移计算——静态方法体内 super 的接收者
  // （staticSuperSrc 注入方法体 opts，Super 节点发此源落通用 $get/$invoke）
  const superSrc = superClassNode
    ? superClassNode.type === "Identifier"
      ? superClassNode.name!
      : emitTranspileExpression(superClassNode as unknown as Expression, opts)
    : null;

  /**
   * 成员键提取（Bug 60/Bug 78/Bug 84）：
   * - 非计算键：PrivateName → "#x" 混淆键（公有名不含 "#"，无碰撞；Bug 78）
   *   + private 标记（Bug 84：落地槽打 Slot.internal，introspection 面剔除；
   *   公共字符串键 "#x"（含计算键 ["#x"]）不带标记）；
   *   Identifier/String/Numeric → 原名（Numeric 原生 ToPropertyKey 成串）；
   * - 计算键（含 `[k]()` 的 Identifier 形状——babel 把 computed 标在成员上）：
   *   发射求值源，$class 折叠真名，不静默挂 "method"。
   */
  const keyOf = (
    key: unknown,
    computed: boolean,
  ): { name: string; private?: boolean } | { computed: string } | null => {
    const k = key as
      | { type?: string; name?: string; value?: unknown; id?: { name?: string } }
      | undefined;
    if (!k?.type) return null;
    if (!computed && k.type === "PrivateName") {
      const n = k.id?.name ?? k.name;
      return n ? { name: `#${n}`, private: true } : null;
    }
    if (!computed && k.type === "Identifier" && k.name) return { name: k.name };
    if (k.type === "StringLiteral" || k.type === "NumericLiteral") {
      return { name: String(k.value) };
    }
    // Bug 114：句法形 `Symbol.X` 计算键直接投影静态名 "@@X"——与读侧
    // transpile/expr/member.ts 的 Symbol 常量键投影同口径（读侧早已无条件
    // 投影，Symbol 命名空间按不可遮蔽处理）。定义期不再走宿主求值：fn 值
    // 键（[Symbol.for]——$get ns 分支折 absFunction）litValue 失败会被
    // $class drops，字段/方法/访问器三形态统一在此落真名。
    const asMember = k as unknown as {
      type?: string;
      computed?: boolean;
      object?: { type?: string; name?: string } | null;
      property?: { type?: string; name?: string } | null;
    };
    if (
      asMember.type === "MemberExpression" &&
      asMember.computed !== true &&
      asMember.object?.type === "Identifier" &&
      asMember.object.name === "Symbol" &&
      asMember.property?.type === "Identifier" &&
      asMember.property.name
    ) {
      return { name: `@@${asMember.property.name}` };
    }
    if (isExpression(k as Node)) {
      return { computed: emitTranspileExpression(k as Expression, opts) };
    }
    return null;
  };

  /** thunk（单表达式）多行安全包装 */
  const thunkOf = (src: string, d: number): string =>
    [`(__this) => {`, `${indent(d + 1)}return ${src};`, `${indent(d)}}`].join("\n");

  const paramsOf = (m: { params?: unknown[] }): string[] =>
    (m.params ?? []).map((p) => {
      const id = p as { type?: string; name?: string };
      return id?.type === "Identifier" && id.name ? id.name : "_";
    });

  // P4b：类体词法绑定是**不可变**绑定（ClassDefinitionEvaluation 对自有名
  // CreateImmutableBinding——体内/静态块/字段初始化器里 `C = v` 原生
  // TypeError）。经 constNames 复用 const 赋值通道（$throwConstAssign）。
  // 只作用于类体成员 opts；外层绑定保持可再绑（ClassDeclaration
  // IsConstantDeclaration = false，`class C {}; C = 5` 原生合法 no-throw）。
  // 静态字段 thunk 发射的 `let C = __this`（N4）保持 let：`C.q = v` 成员写
  // 经 memberPathOf 根重绑是裸 JS 赋值，不走 constNames，不受影响。
  // 匿名类无自有名绑定——不引入。
  const selfConstNames = stmt.id?.name
    ? opts.constNames
      ? new Set([...opts.constNames, stmt.id.name])
      : new Set([stmt.id.name])
    : opts.constNames;
  const methodOptsBase: TranspileOptions = {
    ...opts,
    inLoop: 0,
    inTry: 0,
    // 方法体是新函数边界：return 不携带外层 if 臂退出信号
    conditionalFlow: 0,
    inFunction: true,
    thisParam: "__this",
    className: name,
    constNames: selfConstNames,
    // Bug 52：方法体是新生成器边界——外层 try 不覆盖体内 yield
    yieldTryCtx: 0,
  };

  for (const m of methods) {
    // Bug 77：静态块——类定义期执行（不静默丢弃）
    if (m.type === "StaticBlock") {
      // this = 类值：thisParam 直接指类名绑定（静态块内 this.t = v 的
      // 不可变更新须重绑类绑定——经 memberPathOf 根可重绑路径落回）
      const blkOpts: TranspileOptions = { ...methodOptsBase, thisParam: name };
      // StaticBlock.body 直接是语句数组（无 BlockStatement 包装）
      const blkBody = Array.isArray(m.body)
        ? (m.body as Statement[])
        : ((m.body as { body?: Statement[] })?.body ?? []);
      const stmts = transpileFnBodyStmts(blkBody, depth + 3, blkOpts, { skip: new Set() });
      staticInitParts.push(
        `${indent(depth + 2)}(__this) => {`,
        stmts,
        `${indent(depth + 2)}},`,
      );
      continue;
    }
    // 字段（公有/私有 × 静态/实例）
    if (m.type === "ClassProperty" || m.type === "ClassPrivateProperty") {
      const keyR = keyOf(m.key, m.computed === true);
      if (m.static) {
        // R5：静态字段——thunk 以类值为 this 定义期求值（原生
        // ClassFieldDefinitionEvaluation 的 receiver 是类值，this.x 读写
        // /箭头捕获随之恢复；$class 建类值后逐槽调用，源序保持）
        const fieldOpts: TranspileOptions = {
          ...methodOptsBase,
          // Bug 119：静态字段初始化器内 super 的 home object 是类自身——
          // super.<静态> 读父类构造器面。与静态方法/静态访问器 opts 同口径
          // 注入 staticSuperSrc（此前缺省落 $getSuper 实例原型链，super.x
          // 折 exact undefined、算术折 NaN）。实例字段（下方分支）不得
          // 注入——实例 super 合法读原型链，$getSuper 已正确处理
          ...(superSrc !== null ? { staticSuperSrc: superSrc } : {}),
        };
        const vsrc = m.value
          ? emitTranspileExpression(m.value as Expression, fieldOpts)
          : "$lit(void 0)";
        // N4：静态字段 thunk 求值于 $class 内——`let C = $class(…)` 尚未
        // 赋值，类名自由引用命中宿主 TDZ ReferenceError（原生
        // ClassDefinitionEvaluation 先初始化类体自有词法绑定再跑静态字段
        // 初始化器，`this === C` 折 true / `C.n` 前序同胞字段可读）。自有
        // 名类在 thunk 顶部引入同名 let 绑定（值 = 类值 __this）复刻该词法
        // 绑定：内层参数/具名函数遮蔽、闭包捕获、内嵌类引用外层类名沿生成
        // 代码词法链免费对齐。用 let 不用 const——`C.q = v` 成员写经
        // memberPathOf 根重绑（C = $set(C,…)）是裸 JS 赋值不得假 TypeError
        // （原生允许）。P4b：`C = v` 名字重绑的 TypeError 由 fieldOpts 的
        // constNames（methodOptsBase 注入类体不可变自有名）在 transpile 层
        // 折 $throwConstAssign——宿主 let 只服务内部根重绑，用户层直写不再
        // 静默通过。匿名类表达式（无自有名）不引入
        // 绑定：外层名引用保持自由，TDZ 面与原生一致。计算键不在类体绑定
        // 作用域内（原生求值于绑定初始化前，引用类名原生亦 TDZ）——保持
        // 裸表达式。静态块/静态方法体求值于类绑定赋值后，无需处理。
        const selfName = stmt.id?.name;
        const initSrc = selfName
          ? [
              `(__this) => {`,
              `${indent(depth + 3)}let ${selfName} = __this;`,
              `${indent(depth + 3)}return ${vsrc};`,
              `${indent(depth + 2)}}`,
            ].join("\n")
          : thunkOf(vsrc, depth + 2);
        if (keyR && "name" in keyR) {
          staticFieldParts.push(`${indent(depth + 2)}${JSON.stringify(keyR.name)}: ${initSrc},`);
        } else if (keyR && "computed" in keyR) {
          const synth = `__ck${ckSeq++}`;
          staticFieldParts.push(`${indent(depth + 2)}${JSON.stringify(synth)}: ${initSrc},`);
          computedKeyParts.push(`${indent(depth + 2)}${JSON.stringify(synth)}: ${keyR.computed},`);
        }
        // 无名键（解析异常）：无表达式可发射，跳过
        continue;
      }
      // Bug 59：实例字段——每次构造以新实例为 this 按源序求值（此前误编为
      // 静态：定义期跑一次、错误 this、永不落实例）
      const fieldOpts: TranspileOptions = { ...methodOptsBase };
      const vsrc = m.value
        ? emitTranspileExpression(m.value as Expression, fieldOpts)
        : "$lit(void 0)";
      const initSrc = thunkOf(vsrc, depth + 2);
      if (keyR && "name" in keyR) {
        // Bug 84：私有字段透传 private 标记（槽落地打 Slot.internal）
        instanceFieldParts.push(
          `${indent(depth + 2)}{ name: ${JSON.stringify(keyR.name)}, init: ${initSrc}${keyR.private === true ? ", private: true" : ""} },`,
        );
      } else if (keyR && "computed" in keyR) {
        // 原生计算键逐实例求值（ClassFieldDefinitionEvaluation 在构造期）
        instanceFieldParts.push(
          `${indent(depth + 2)}{ key: ${thunkOf(keyR.computed, depth + 2)}, init: ${initSrc} },`,
        );
      }
      continue;
    }
    // Bug 78：私有方法与公有方法同机制（键混淆为 "#m"）
    if (m.type !== "ClassMethod" && m.type !== "ObjectMethod" && m.type !== "ClassPrivateMethod") {
      continue;
    }
    const keyR = keyOf(m.key, m.computed === true);
    const mname =
      keyR && "name" in keyR
        ? keyR.name
        : keyR && "computed" in keyR
          ? `__ck${ckSeq++}`
          : undefined;
    if (mname === undefined) continue;
    const computedKeySrc = keyR && "computed" in keyR ? keyR.computed : undefined;
    const params = paramsOf(m);
    const paramList = params.filter((p) => p !== "_").join(", ");
    // get/set 访问器：实例进 spec.accessors，静态进 spec.staticAccessors
    if (m.kind === "get" || m.kind === "set") {
      const accVarParams = paramNamesOf((m.params ?? []) as Node[]);
      // className：访问器是类方法体——super.p 走类链派发（$getSuper），
      // 不是对象原型链（Bug 14 连带）
      const accBodyOpts: TranspileOptions = {
        ...opts,
        inLoop: 0,
        inTry: 0,
        // 访问器体是新函数边界：return 不携带外层 if 臂退出信号
        conditionalFlow: 0,
        inFunction: true,
        thisParam: "__this",
        className: name,
        // P4b：访问器体同在类体不可变自有名绑定作用域内（methodOptsBase 同口径）
        constNames: selfConstNames,
        // Bug 14：静态访问器体 super 接收者 = 父类构造器
        ...(m.static && superSrc !== null ? { staticSuperSrc: superSrc } : {}),
      };
      const accBody = m.body as Node | undefined;
      const target = m.static ? staticAccessorDefs : accessorDefs;
      const def = target.get(mname) ?? {};
      if (m.kind === "get") {
        const accBodyStmts = emitFnBlockBody(accBody, depth + 3, accBodyOpts, { varParams: accVarParams });
        def.get = `(__this) => {\n${accBodyStmts}\n${indent(depth + 3)}}`;
      } else {
        const setParams = (m.params ?? []) as Node[];
        const firstP = setParams[0] as { type?: string; name?: string } | undefined;
        const vname = firstP?.type === "Identifier" && firstP.name ? firstP.name : "__v";
        // setter thunk：内层箭头丢弃体返回值（恒返回 __this）+ 别名写接收者回收
        // （详见 emitSetterAccessorThunk；F3：裸 return 折 undefined → TypeError，
        // 别名写 + 早退 if 提升被赋值点重绑冲掉 → undefined）
        const setBody = emitFnBlockBody(accBody, depth + 4, accBodyOpts, {
          implicitReturn: false,
          varParams: accVarParams,
        });
        const aliasNames = collectForkBindingNames(accBody).filter((n) => !accVarParams.has(n));
        // N3：setter 形参带默认值/解构——经 __nudoArgs 槽统一绑定（与
        // emitParamBindingFromArgs 同机制）：原生 `o.s = undefined` 触发默认值
        //（此前默认值静默丢弃折 undefined），解构 setter 参此前成自由标识符
        //（折 never）。赋进值以 [__v] 元组入槽，默认表达式以访问器边界
        // opts（thisParam __this）求值。
        let setPrologue: string[] = [];
        if (firstP && firstP.type !== "Identifier") {
          const bound = emitParamBindingFromArgs(setParams, indent(depth + 4), accBodyOpts, "__nudoArgs");
          setPrologue = [`${indent(depth + 4)}let __nudoArgs = $arguments([__v]);`, ...bound.prologue];
        }
        def.set = emitSetterAccessorThunk(vname, setBody, aliasNames, depth + 3, setPrologue);
      }
      target.set(mname, def);
      if (computedKeySrc) {
        computedKeyParts.push(`${indent(depth + 2)}${JSON.stringify(mname)}: ${computedKeySrc},`);
      }
      continue;
    }
    // ctor 有显式 `return __this`（下方追加）——不得加隐式 return 抢行
    const isCtor = m.kind === "constructor" || mname === "constructor";
    const mHasArgs = fnBodyHasOwnArguments({
      body: m.body as Node,
      params: m.params as Node[] | undefined,
    });
    // N3：非简单形参（默认值/解构/rest）与读 arguments 的方法同走
    // `...__margs` + emitParamBindingFromArgs 统一绑定——paramsOf 只认
    // Identifier，默认参/解构/rest 形参此前被静默丢弃（宿主签名无名、
    // prologue 无绑定 → 体引用成自由标识符折 never，或默认值不求值折
    // undefined）。默认表达式经方法边界 opts 求值：__this（实例 receiver
    // / R5 静态类值）在作用域内，与原生默认参以调用点 this 求值一致。
    const mParamsNodes = (m.params ?? []) as Node[];
    const bindFromArgs =
      mHasArgs || mParamsNodes.some((p) => (p as { type?: string } | undefined)?.type !== "Identifier");
    const methodOpts: TranspileOptions = {
      ...methodOptsBase,
      argsBinding: bindFromArgs ? "__nudoArgs" : undefined,
    };
    // 静态方法体边界（R5/Bug 14）：默认表达式里的 super.x 也要按
    // staticSuperSrc 派发——绑定与体共用同一 opts
    const staticOpts: TranspileOptions = {
      ...methodOptsBase,
      argsBinding: bindFromArgs ? "__nudoArgs" : undefined,
      ...(superSrc !== null ? { staticSuperSrc: superSrc } : {}),
    };
    const bindOpts = m.static ? staticOpts : methodOpts;
    let bodyStmts = emitFnBlockBody(
      m.body as Node | undefined,
      depth + 3,
      bindOpts,
      { implicitReturn: !isCtor, varParams: paramNamesOf(mParamsNodes) },
    );
    if (bindFromArgs) {
      const bound = emitParamBindingFromArgs(
        mParamsNodes,
        indent(depth + 4),
        bindOpts,
        "__nudoArgs",
      );
      bodyStmts = [
        `${indent(depth + 4)}let __nudoArgs = $arguments(__margs);`,
        ...bound.prologue,
        bodyStmts,
      ].join("\n");
    } else if (paramList) {
      // Bug 7：方法边界缺参归一（与函数声明同口径）——paramList 形态的
      // 宿主绑定形参省略时收 undefAbs；`...__margs` 形态（读 arguments）
      // 经 $arguments/$idx 已折 lit(undefined)，且 arguments.length 不得
      // 被补齐膨胀，走上一分支。
      bodyStmts = [
        ...paramList
          .split(", ")
          .filter(Boolean)
          .map((p) => `${indent(depth + 4)}${p} = $absVal(${p});`),
        bodyStmts,
      ].join("\n");
    }
    // Bug 58：generator 方法体不在调用期执行——包 $gen（吞调用期 throws，
    // yield 收集保持既有 eager 口径）
    if (m.generator) {
      bodyStmts = [
        `${indent(depth + 4)}return $gen(() => {`,
        bodyStmts,
        `${indent(depth + 4)}});`,
      ].join("\n");
    }
    if (m.static) {
      staticMethodParts.push(
        // R5：__this 首参 = 类值（接收者）——与实例方法 __this 载体同构
        `${indent(depth + 3)}${JSON.stringify(mname)}: (__this, ${bindFromArgs ? "...__margs" : paramList}) => {`,
        bodyStmts,
        `${indent(depth + 3)}},`,
      );
      staticMethodParamEntries.push([mname, paramDisplayNames(m.params)]);
      if (computedKeySrc) {
        computedKeyParts.push(`${indent(depth + 2)}${JSON.stringify(mname)}: ${computedKeySrc},`);
      }
      continue;
    }
    if (isCtor) {
      // P2b：.length = 首个默认值/rest 形参前的形参数（Bug 69 同口径）
      ctorLength = nativeParamArity(m.params);
      ctorParts.push(
        `${indent(depth + 2)}ctor: (__this, ${bindFromArgs ? "...__margs" : paramList}) => {`,
        bodyStmts,
        `${indent(depth + 3)}return __this;`,
        `${indent(depth + 2)}},`,
      );
    } else if (m.async) {
      methodParts.push(
        `${indent(depth + 3)}${JSON.stringify(mname)}: (__this, ${bindFromArgs ? "...__margs" : paramList}) => {`,
        `${indent(depth + 4)}return $async(() => {`,
        bodyStmts,
        `${indent(depth + 4)}});`,
        `${indent(depth + 3)}},`,
      );
      methodParamEntries.push([mname, paramDisplayNames(m.params)]);
    } else {
      methodParts.push(
        `${indent(depth + 3)}${JSON.stringify(mname)}: (__this, ${bindFromArgs ? "...__margs" : paramList}) => {`,
        bodyStmts,
        `${indent(depth + 3)}},`,
      );
      methodParamEntries.push([mname, paramDisplayNames(m.params)]);
    }
    if (computedKeySrc) {
      computedKeyParts.push(`${indent(depth + 2)}${JSON.stringify(mname)}: ${computedKeySrc},`);
    }
  }

  const specLines: string[] = [];
  // P2b：始终发射（隐式构造器 0）——手写 spec（mock 等）不发射 → unknown
  specLines.push(`${indent(depth + 2)}ctorLength: ${ctorLength},`);
  if (superClassNode) {
    // 活引用而非名字字符串：class B extends A {} 在 A 声明前求值时
    // 触发 let TDZ ReferenceError（原生语义）；宿主全局（extends Map）按名解析。
    // 非 Identifier 表达式发 transpile 源——原生在类**定义期**求值 extends
    // 表达式（ClassDefinitionEvaluation），求值顺序保持。hasExtends 标记
    // 区分 `extends undefined`（babel Identifier → 活引用 raw undefined）与
    // 无 extends 子句（Bug 11）。
    specLines.push(`${indent(depth + 2)}hasExtends: true,`);
    specLines.push(`${indent(depth + 2)}extends: ${superSrc},`);
  }
  if (staticFieldParts.length) {
    specLines.push(`${indent(depth + 2)}statics: {`, ...staticFieldParts, `${indent(depth + 2)}},`);
  }
  if (computedKeyParts.length) {
    specLines.push(
      `${indent(depth + 2)}computedKeys: {`,
      ...computedKeyParts,
      `${indent(depth + 2)}},`,
    );
  }
  if (staticMethodParts.length) {
    specLines.push(
      `${indent(depth + 2)}staticMethods: {`,
      ...staticMethodParts,
      `${indent(depth + 2)}},`,
    );
  }
  if (staticMethodParamEntries.length) {
    specLines.push(`${indent(depth + 2)}staticMethodParams: {`);
    for (const [k, names] of staticMethodParamEntries) {
      specLines.push(`${indent(depth + 3)}${JSON.stringify(k)}: [${names.map((n) => JSON.stringify(n)).join(", ")}],`);
    }
    specLines.push(`${indent(depth + 2)}},`);
  }
  if (ctorParts.length) {
    specLines.push(...ctorParts);
  }
  if (methodParts.length) {
    specLines.push(`${indent(depth + 2)}methods: {`, ...methodParts, `${indent(depth + 2)}},`);
  }
  if (methodParamEntries.length) {
    specLines.push(`${indent(depth + 2)}methodParams: {`);
    for (const [k, names] of methodParamEntries) {
      specLines.push(`${indent(depth + 3)}${JSON.stringify(k)}: [${names.map((n) => JSON.stringify(n)).join(", ")}],`);
    }
    specLines.push(`${indent(depth + 2)}},`);
  }
  if (instanceFieldParts.length) {
    specLines.push(
      `${indent(depth + 2)}instanceFields: [`,
      ...instanceFieldParts,
      `${indent(depth + 2)}],`,
    );
  }
  if (accessorDefs.size > 0) {
    const accParts: string[] = [];
    for (const [k, def] of accessorDefs) {
      const members: string[] = [];
      if (def.get) members.push(`${indent(depth + 4)}get: ${def.get},`);
      if (def.set) members.push(`${indent(depth + 4)}set: ${def.set},`);
      accParts.push(`${indent(depth + 3)}${JSON.stringify(k)}: {`, ...members, `${indent(depth + 3)}},`);
    }
    specLines.push(
      `${indent(depth + 2)}accessors: {`,
      ...accParts,
      `${indent(depth + 2)}},`,
    );
  }
  if (staticAccessorDefs.size > 0) {
    const accParts: string[] = [];
    for (const [k, def] of staticAccessorDefs) {
      const members: string[] = [];
      if (def.get) members.push(`${indent(depth + 4)}get: ${def.get},`);
      if (def.set) members.push(`${indent(depth + 4)}set: ${def.set},`);
      accParts.push(`${indent(depth + 3)}${JSON.stringify(k)}: {`, ...members, `${indent(depth + 3)}},`);
    }
    specLines.push(
      `${indent(depth + 2)}staticAccessors: {`,
      ...accParts,
      `${indent(depth + 2)}},`,
    );
  }
  const staticInitLines = staticInitParts.length
    ? [
        `${indent(depth)}$staticInit(${name}, [`,
        ...staticInitParts,
        `${indent(depth)}]);`,
      ]
    : [];
  return { name, specLines, staticInitLines };
}

/** class C extends P { ctor, methods } → $class(...) */
export function transpileClass(
  stmt: {
    id?: { name: string } | null;
    body: { body: unknown[] };
    superClass?: { type: string; name?: string } | null;
  },
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  const { name, specLines, staticInitLines } = classSpecOf(stmt, depth, opts);
  // let：静态成员写 A.x = v 经 $set 不可变更新后需重绑类绑定
  const out = [
    `${pad}let ${name} = $class(${JSON.stringify(name)}, {`,
    ...specLines,
    `${pad}});`,
  ];
  // Bug 77：静态块在类绑定完成后执行（块体内类名词法可见，与原生一致）
  if (staticInitLines.length) out.push(...staticInitLines);
  return out.join("\n");
}

