/**
 * 函数/类表达式族发射（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - 可构造性 facet：箭头/async/generator ctor=false，普通函数表达式 true；
 * - __this 必须 let（this.s = v 的赋值包装重绑 __this，Bug 16）；
 * - 非箭头体直接引用 arguments → __nudoArgs 槽绑定；箭头词法继承外层
 *   argsBinding（无绑定 → Identifier 臂 $unknown）；
 * - rest 形参经 $restBind（开放数组哨兵直通，不塌缩固定元组）；
 * - 函数体经 stmt/fn-body.ts transpileFnBodyStmts（var 提升边界扣除参数
 *   模式名）；表达式体提升为块体以容纳 prologue/rebind；
 * - Bug 174：默认参数表达式在**本函数作用域**求值 ⇒ 其中的 `this` 读**本
 *   函数**的 __this 槽（fnParamsHaveThis 扫形参面；声明面共用同一判定）；
 * - Bug 188：表达式体的写回（rebinds）排在**表达式取值之后**——先捕获表达
 *   式值（__mutRet）→ 再写回 → 返回捕获值（与语句级 emitRet 同口径）；
 * - 参数模式名集 paramNamesOfFn 是 stmt.ts paramNamesOf 的 expr 侧副本
 *   （对象方法简写也用，./object.ts 从本模块导入）。
 * - Bug 325：$fnVal opts.kind 打**函数种类**戳（async × generator 四象限：
 *   "function" / "async" / "generator" / "async-generator"）——读取面
 *   （builtins/object-proto.ts 的 typeTagOf）据此给
 *   Object.prototype.toString 的标签面（AsyncFunction / GeneratorFunction /
 *   AsyncGeneratorFunction）；kind 另被 member.ts 的 prototype 面读
 *   （generator 与 async-generator 都有原生 prototype）。块体与表达式体两条
 *   路径共用同一戳。
 */
import type {
  Expression,
  Node,
  Statement,
  ClassExpression,
  ArrowFunctionExpression,
  FunctionExpression,
} from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { withImplicitReturn } from "../stmt-predicates.ts";
import {
  fnBodyHasThis,
  fnBodyHasOwnArguments,
  fnBodyIsEffectFree,
  fnBodyIsClosed,
  indent,
  paramDisplayNames,
  paramOptionalFlags,
  nativeParamArity,
  collectPatternNames,
  safeTmpName,
  userIdentInfo,
} from "../helpers.ts";
import { emitArrMutatorRebinds, emitParamBinding, emitParamBindingFromArgs } from "../emit.ts";
import { emitTranspileExpression as transpileExpression } from "../transpile-dispatch.ts";
import { transpileFnBodyStmts } from "../stmt/fn-body.ts";
import { classSpecOf } from "../class-emit.ts";
/** 参数模式名集（var 提升边界扣除）——stmt.ts paramNamesOf 的 expr 侧副本 */
export function paramNamesOfFn(params: Node[]): ReadonlySet<string> {
  const acc = new Set<string>();
  for (const p of params) collectPatternNames(p, acc);
  return acc;
}

/**
 * Bug 174：形参（**默认值表达式**）里是否引用 `this`。
 *
 * 原生语义：默认参数表达式在**函数自身作用域**求值 ⇒ 其中的 `this` 是
 * **被调函数自己的** this（严格模式：undefined / 调用接收者），**不是**外层
 * 作用域的 this。`fnBodyHasThis` 只扫 `fn.body` ⇒ 形参默认值里的 `this`
 * 不可见 ⇒ 默认表达式沿用外层 `thisParam`（外层方法体里甚至拿到**外层
 * 对象**——自信错值 + 漏抛 TypeError）。
 *
 * 下降口径与 `fnBodyHasThis` 一致：嵌套**真函数**（FunctionDeclaration /
 * FunctionExpression）有自己的 this 边界，不下降；箭头函数词法继承外层
 * this，下降（箭头默认值里的 `this` 就是本函数的 this）。
 *
 * 声明面（stmt/statement.ts 的 FunctionDeclaration 分支）与表达式面共用
 * 本函数——两面的默认参数都在**本函数**作用域求值。
 */
export function fnParamsHaveThis(params: Node[] | undefined | null): boolean {
  if (!params || params.length === 0) return false;
  const seen = new Set<Node>();
  const walk = (n: Node): boolean => {
    if (n.type === "ThisExpression") return true;
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression") return false;
    if (seen.has(n)) return false;
    seen.add(n);
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments") continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && "type" in (item as object)) {
            if (walk(item as Node)) return true;
          }
        }
      } else if (v && typeof v === "object" && "type" in (v as object)) {
        if (walk(v as Node)) return true;
      }
    }
    return false;
  };
  for (const p of params) if (walk(p)) return true;
  return false;
}

/**
 * 函数/类表达式族：$fnVal 一等函数（可构造性/arguments/this/rest facet）、命名函数
 * 表达式（NFE）IIFE、非空类体 $class（与类声明同机制）。
 */
export function transpileFunctionExpr(
  expr:
    | ClassExpression
    | ArrowFunctionExpression
    | FunctionExpression,
  opts: TranspileOptions = {},
): string {
  switch (expr.type) {
    case "ClassExpression": {
      // Bug 80：非空类体走与类声明同一 $class 机制（此前恒 $classExpr() →
      // 一切构造/方法调用折 unknown）。空类体保持 fn 形状（pinned 行为）。
      const ce = expr as unknown as {
        id?: { name: string } | null;
        superClass?: unknown;
        body?: { body?: unknown[] };
      };
      const members = ce.body?.body ?? [];
      // Bug 154：空体快路径不得吞掉 `extends` 子句——`extends` 由 classSpecOf
      // 从 superClass 读出，快路径绕过了它 ⇒ 原型链与类注册全丢
      // （`new B() instanceof A` 折 false；`extends null` 的 TypeError 不抛）。
      // 有父类时走与非空体同一条 classSpecOf 路径（对照：声明形态本就正确）。
      //
      // Bug 133：空体快路径同样取 **NamedEvaluation 名**（`const K = class {}`
      // → "K"）——无名类不传名（原生名为空串）。
      if (members.length === 0 && !ce.superClass) {
        const emptyName = ce.id?.name ?? opts.classNameHint;
        return emptyName === undefined ? "$classExpr()" : `$classExpr(${JSON.stringify(emptyName)})`;
      }
      const depth = 1;
      const { name, displayName, specLines, staticInitLines } = classSpecOf(
        ce as unknown as Parameters<typeof classSpecOf>[0],
        depth,
        // Bug 133：NamedEvaluation 名只作用于**本类表达式**——类体（extends
        // 子句 / 计算键 / 静态块 / 方法体）里的嵌套类表达式不得继承该名
        // （原生内层仍是无名类）。
        { ...opts, classNameHint: undefined },
        opts.classNameHint,
      );
      // Bug 9：类 spec 发**纯表达式**（结尾不带 `;`）——子表达式位置
      // （return 值/数组元素/实参/new 被调者/…）由父级任意包裹；语句终止符
      // 由消费方补（命名/静态块分支 IIFE 内 `let NAME = …;`、声明位
      // transpileClass 自带 `});`）。此前抄声明形带 `;` → `return($class(…}););`
      // new Function SyntaxError，整模块加载失败。
      //
      // Bug 133：第三实参 = 对外可见的 **name**（无名类为空串——原生无名类
      // 名为 ""；内部类名仍是合成名，供发射/类注册用）。
      const specSrc = [
        `$class(${JSON.stringify(name)}, {`,
        ...specLines,
        `${indent(depth)}}, ${JSON.stringify(displayName)})`,
      ].join("\n");
      if (ce.id || staticInitLines.length) {
        // 命名类表达式：内部名只作用于类体（词法屏蔽外层同名绑定）；
        // 静态块须在类值绑定后执行（Bug 77）——IIFE 内 let 绑定让方法体/
        // 静态块按词法解析到类自身（batch13 口径）
        const inner = [
          `let ${name} = ${specSrc};`,
          ...(staticInitLines.length ? [staticInitLines.join("\n")] : []),
          `return ${name};`,
        ].join("\n");
        return `(() => {\n${inner}\n})()`;
      }
      return specSrc;
    }
    case "ArrowFunctionExpression":
    case "FunctionExpression": {
      const fn = expr as {
        params: Node[];
        body: Node;
        async?: boolean;
        generator?: boolean;
        id?: { name: string } | null;
      };
      const isArrow = expr.type === "ArrowFunctionExpression";
      // Bug 13：命名函数表达式（NFE）——自身名是函数体内的不可变绑定
      // （FunctionExpressionEvaluation 建 immutable binding）。发射 IIFE：
      // `let g; g = $fnVal(...); return g;`——体内对 g 的引用按词法捕获
      // 调用期已绑定的 fn Abs（typeof g / 递归 / g === f 均恢复原生语义）。
      const nfeName = !isArrow && fn.id?.name ? fn.id.name : null;
      const fnValSrc = (() => {
      // Bug 9 可构造性：箭头/async/generator 函数不可 new（原生 TypeError）；
      // 普通函数表达式可 new。facet 进 fn shape，$new 按此判定。
      const fnCtor = isArrow || !!fn.async || !!fn.generator ? false : true;
      // 函数声明/表达式有独立 this；箭头词法继承外层。仅非箭头且 body 含 this
      // 时注入宿主 this（$rawThis），并用 function 包装替代箭头（宿主 this 动态）
      // Bug 174：默认参数表达式在**本函数作用域**求值 ⇒ 其中的 `this` 是
      // **本函数自己的** this（严格模式：undefined / 调用接收者），不是外层
      // 作用域的 this。fnBodyHasThis 只扫 body ⇒ 形参默认值里的 this 不可见
      // ⇒ 默认表达式沿用外层 thisParam（外层方法体里拿到**外层对象**——
      // 自信错值 + 漏抛 TypeError）。故形参面一并扫描（fnParamsHaveThis）。
      const hasThis = !isArrow && (fnBodyHasThis(fn) || fnParamsHaveThis(fn.params));
      // 非箭头且体直接引用 arguments：建独立 tuple 槽。箭头不建槽（沿外层
      // argsBinding；无绑定 → $unknown()，见 Identifier 分支）。
      const hasArgs = !isArrow && fnBodyHasOwnArguments(fn);
      // 参数默认值在函数作用域求值：非箭头且引用自有 arguments
      // （fnBodyHasOwnArguments 已含参数面）→ 默认表达式读 __nudoArgs 槽
      //（useArgsSlot 路径由 emitParamBindingFromArgs 处理，此处覆盖
      // hasArgs&&hasThis 真函数包装路径）；箭头默认值词法继承外层绑定
      // Bug 174：本函数有自己的 this 时，默认表达式的 this 读**本函数**的
      // __this 槽（不读外层 thisParam）——__this 由 thisPrologue 在默认
      // 值求值**之前**建立（见 allPrologue 顺序）。
      const paramOpts: TranspileOptions = {
        ...opts,
        ...(!isArrow && hasArgs ? { argsBinding: "__nudoArgs" } : {}),
        ...(hasThis ? { thisParam: "__this" } : {}),
      };
      // M4：无副作用面 facet（保守静态判定；sort 等按调用次数敏感的内建
      // 只对 effectFree 回调真执行——副作用回调多执行不可回滚）
      const effectFree = fnBodyIsEffectFree(fn);
      // R3：封闭 facet（不读外层可变态）——promise then/catch 的同步执行门
      const closed = fnBodyIsClosed(fn);
      const { sig, rest, prologue } = emitParamBinding(fn.params, indent(1), paramOpts);
      // 函数边界：return 不是循环提前返回；非箭头清掉外层 argsBinding
      // P4b：参数遮蔽扣除（箭头**表达式体**不经 transpileFnBodyStmts 的
      // varScope 扣除路径——序列表达式 `(K) => (K = 5, x)` 里的标识符赋值
      // 也须看到遮蔽后的 constNames；块体路径在 transpileFnBodyStmts 里
      // 再扣一次，同名幂等）。默认值表达式走 paramOpts（未扣）——默认式
      // 里写外层 const 原生照抛。
      const fnParamShadows = paramNamesOfFn(fn.params);
      const fnBodyConstNames =
        opts.constNames && fnParamShadows.size > 0
          ? new Set([...opts.constNames].filter((n) => !fnParamShadows.has(n)))
          : opts.constNames;
      const fnBodyOpts: TranspileOptions = {
        ...opts,
        inLoop: 0,
        // 函数体是新边界：return 是本函数的返回，不是外层 if 臂的退出信号
        conditionalFlow: 0,
        inFunction: true,
        ...(fnBodyConstNames !== opts.constNames ? { constNames: fnBodyConstNames } : {}),
        ...(hasThis ? { thisParam: "__this" } : {}),
        ...(isArrow ? {} : { argsBinding: hasArgs ? "__nudoArgs" : undefined }),
        // Bug 52：函数体是新生成器边界——外层 try 不覆盖体内 yield
        yieldTryCtx: 0,
      };
      // FunctionExpression 无宿主 this 时编成箭头（无真实 arguments）——需要
      // arguments 时改收 `(...__allArgs)`，从 $arguments 槽绑定形参（strict 独立）。
      const useArgsSlot = hasArgs && !hasThis;
      // rest 形参：JS rest 收集的是 Abs[]（裸 JS 数组），必须包 $arr 才是 Abs
      // （DEC-006 K1b：rest.length 直接 $len 炸）。useArgsSlot 路径已由
      // emitParamBindingFromArgs 的 $arrRest 处理。Bug 44：经 $restBind——
      // 签名符号执行的开放数组哨兵直通（不塌缩固定 1 元组）
      const restRaw = rest && !useArgsSlot ? `__rest_raw` : rest;
      const restPrologue = rest && !useArgsSlot && restRaw
        ? [`  const ${rest} = $restBind(${restRaw}, 0);`]
        : [];
      const paramParts = restRaw ? [...sig, `...${restRaw}`] : sig;
      // 一等 fn Abs：参数名进 shape（bridge/dts 可展示）——用展示名（含 rest/默认参），
      // 不是宿主绑定 sig（默认参是 `_p{i}` 占位，rest 不在 sig 里）。
      // 异步 body 包 $async 保持 eff(promise) 语义（裸 JS async 会泄漏 Promise）。
      const nameList = `[${paramDisplayNames(fn.params).map((p) => JSON.stringify(p)).join(", ")}]`;
      // Bug 399：逐位「可省略」标记（默认形参 / `?` / rest）——必选元数不再靠
      // 名字后缀猜（默认形参在形参表面是**光秃秃的名字** ⇒ 被计成必选 ⇒
      // `nudo:assign-mismatch` 假红；JS 语义下 `(x = 1) => x` 可零参调用）。
      // 与 `nameList` 同源同长度（同一个 `formalParamsFromNodes`）⇒ 下标对齐。
      const optionalSrc = `, optionalParams: [${paramOptionalFlags(fn.params).join(", ")}]`;
      // Bug 69：原生 fn.length（首个默认值/rest 前形参数）——宿主 impl 是
      // 解糖产物（`_p{i}` 占位全成真参），长度不可信，transpile 侧记真值
      const fnLen = nativeParamArity(fn.params);
      // Bug 325：**函数种类**戳（async × generator 四象限）——原生
      // Object.prototype.toString 的标签面据此区分（async →
      // "[object AsyncFunction]"、generator → "[object GeneratorFunction]"、
      // async generator → "[object AsyncGeneratorFunction]"、普通/箭头 →
      // "[object Function]"）。此前只有 generator 打戳（且仅块体路径）⇒
      // 三种特殊形态全折 "[object Function]"（wrong-exact——社区判别
      // `Object.prototype.toString.call(x).slice(8,-1) === "AsyncFunction"`
      // 恒假）。块体与表达式体两条路径共用本戳（表达式体只有 async 一维）。
      // kind 另被 member.ts 的 prototype 面读（generator 与 async-generator
      // 都有原生 prototype）⇒ 新值域须同步扩展。
      const kindSrc = fn.generator
        ? fn.async === true
          ? `, fnKind: "async-generator"`
          : `, fnKind: "generator"`
        : fn.async === true
          ? `, fnKind: "async"`
          : `, fnKind: "function"`;
      // Bug 16：__this 必须 let——`this.s = v` 的赋值包装发射
      // `__this = $set(__this, …)` 重绑（构造调用 this 是对象时执行到），
      // const 重绑宿主 TypeError
      const thisPrologue = hasThis ? [`let __this = $rawThis(this);`] : [];
      let argsSlotPrologue: string[] = [];
      let argsParamParts = paramParts;
      if (useArgsSlot) {
        const bound = emitParamBindingFromArgs(fn.params, "  ", fnBodyOpts, "__nudoArgs");
        argsSlotPrologue = [`  let __nudoArgs = $arguments(__allArgs);`, ...bound.prologue];
        argsParamParts = ["...__allArgs"];
      } else if (hasArgs && hasThis) {
        // 真实 function 包装：宿主 arguments 直接投影
        argsSlotPrologue = [`  let __nudoArgs = $arguments(arguments);`];
      }
      const allPrologue = useArgsSlot
        ? [...argsSlotPrologue, ...thisPrologue]
        : [
            // Bug 7：hasThis && hasArgs 的真实 function 包装读宿主 arguments
            //（$arguments(arguments)）——apply 钩子补齐会膨胀 arguments.length
            //（padArgs:false），缺参归一移到体内（省略槽位无 sloppy 别名，
            // arguments 保持原生长度）
            ...(hasArgs ? sig.map((p) => `  ${p} = $absVal(${p});`) : []),
            // rest 绑定先于 prologue：模式 rest 参的 destructure 行引用
            // `_rest{i}`，后置 = TDZ ReferenceError（差分 FALSE-THROW）
            ...restPrologue,
            // __nudoArgs/__this 槽先于默认值/解构 prologue：默认表达式可读
            // 自有 arguments（`a = arguments.length`）与 this——后置 = TDZ
            ...thisPrologue,
            ...argsSlotPrologue,
            ...prologue,
          ];
      if (fn.body.type === "BlockStatement") {
        const raw = withImplicitReturn(
          fn.body,
          [...allPrologue, transpileFnBodyStmts((fn.body as { body: Statement[] }).body, 1, fnBodyOpts, {
            // Bug 21：函数体 var 提升边界——参数模式名已绑定，不得提升
            skip: paramNamesOfFn(fn.params),
          })].join("\n"),
          1,
        );
        // Bug 58：generator 函数表达式体不在调用期执行——包 $gen（吞调用期
        // throws；yield 收集保持既有 eager 口径，与声明路径 stmt.ts 同编）
        // Bug 141：async generator（async function*）——$gen 第二实参 = async
        // 位（next/return/throw 返 promise、装 @@asyncIterator 与
        // @@toStringTag "AsyncGenerator"）；不进 $async 包装（原生 async
        // generator 返回 AsyncGenerator 本身，非 promise）。
        const inner = fn.generator
          ? `return $gen(() => {\n${raw}\n}${fn.async === true ? ", true" : ""});`
          : raw;
        // Bug 93：generator 标记透传 $fnVal opts.kind → impl——member.ts 的
        // fn 分支据此区分「不可构造但有 prototype」（generator 实例原型）
        // 与「无 prototype」（箭头/async/方法）。声明路径走宿主函数分支
        //（isHostGeneratorFn 源形判定），此处是表达式面。
        if (hasThis) {
          const wrap = fn.async && !fn.generator
            ? `function (${argsParamParts.join(", ")}) { return $async(() => {\n${inner}\n}); }`
            : `function (${argsParamParts.join(", ")}) {\n${inner}\n}`;
          // Bug 7：hasArgs 时体内已归一缺参——钩子补齐会膨胀 arguments.length
          return `$fnVal(${nameList}, ${wrap}, { ctor: ${fnCtor}${hasArgs ? ", padArgs: false" : ""}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed}${kindSrc}${optionalSrc} })`;
        }
        if (fn.async && !fn.generator) {
          return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => $async(() => {\n${inner}\n}), { ctor: ${fnCtor}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed}${kindSrc}${optionalSrc} })`;
        }
        return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => {\n${inner}\n}, { ctor: ${fnCtor}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed}${kindSrc}${optionalSrc} })`;
      }
      const bodySrc = transpileExpression(fn.body as Expression, fnBodyOpts);
      // Bug 188：表达式体的**写回**（rebinds）不得排在表达式求值之前。
      // 原生后缀 `o.n++` 的表达式值是**写前值**（写回在取值之后）；写回是
      // 转译侧补正，不得先于宿主表达式的取值/副作用。与语句级 emitRet
      // （stmt/statement.ts）同口径：先捕获表达式值 → 再发写回 → 最后返回
      // 捕获值。捕获临时名避让用户标识符（用户自己有 `__mutRet` 时改名，
      // 否则 `let __mutRet = __mutRet` ⇒ TDZ ReferenceError）。
      const rebinds = emitArrMutatorRebinds(fn.body as Expression, fnBodyOpts, "  ");
      const mutTmp = safeTmpName("__mutRet", userIdentInfo(opts.source));
      /** 表达式体的返回序列（无写回时直返表达式） */
      const retSeq = (pad: string): string[] => {
        if (rebinds.length === 0) {
          return [`${pad}return ${fn.async ? `$async(() => ${bodySrc})` : bodySrc};`];
        }
        if (fn.async) {
          // async：捕获与写回都在 $async thunk **内**——写回是体的副作用，
          // 不得逸出 thunk（体内 throw 须落 promise 拒绝通道）
          return [
            `${pad}return $async(() => {`,
            `${pad}  let ${mutTmp} = ${bodySrc};`,
            ...rebinds.map((l) => `${pad}  ${l}`),
            `${pad}  return ${mutTmp};`,
            `${pad}});`,
          ];
        }
        return [
          `${pad}let ${mutTmp} = ${bodySrc};`,
          ...rebinds.map((l) => `${pad}${l}`),
          `${pad}return ${mutTmp};`,
        ];
      };
      if (allPrologue.length > 0 || hasThis) {
        // 表达式体 + 模式参数/this 注入：提升为块体以容纳 prologue
        const inner = [...allPrologue, ...retSeq("  ")].join("\n");
        if (hasThis) {
          const wrap = `function (${argsParamParts.join(", ")}) {\n${inner}\n}`;
          // Bug 7：hasArgs 时体内已归一缺参——钩子补齐会膨胀 arguments.length
          return `$fnVal(${nameList}, ${wrap}, { ctor: ${fnCtor}${hasArgs ? ", padArgs: false" : ""}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed}${kindSrc}${optionalSrc} })`;
        }
        return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => {\n${inner}\n}, { ctor: ${fnCtor}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed}${kindSrc}${optionalSrc} })`;
      }
      // 表达式体：块体包裹跑语句级 rebind pass——`()=>n++` / `()=>a.push(1)`
      // 的写回此前静默丢失（表达式上下文无语句级扫描）
      if (rebinds.length > 0) {
        const inner = retSeq("  ").join("\n");
        return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => {\n${inner}\n}, { ctor: ${fnCtor}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed}${kindSrc}${optionalSrc} })`;
      }
      if (fn.async) {
        return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => $async(() => ${bodySrc}), { ctor: ${fnCtor}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed}${kindSrc}${optionalSrc} })`;
      }
      return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => ${bodySrc}, { ctor: ${fnCtor}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed}${kindSrc}${optionalSrc} })`;
      })();
      if (!nfeName) return fnValSrc;
      // IIFE 绑定 NFE 自身名：调用期 g 已是 fn Abs（体内引用按词法捕获）；
      // 宿主 let 只赋一次，不改可观测语义（原生是不可变绑定）。
      return `(() => { let ${nfeName}; ${nfeName} = ${fnValSrc}; return ${nfeName}; })()`;
    }
  }
}
