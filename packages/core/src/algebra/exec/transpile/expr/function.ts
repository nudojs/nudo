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
 * - 参数模式名集 paramNamesOfFn 是 stmt.ts paramNamesOf 的 expr 侧副本
 *   （对象方法简写也用，./object.ts 从本模块导入）。
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
  nativeParamArity,
  collectPatternNames,
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
      if (members.length === 0) return "$classExpr()";
      const depth = 1;
      const { name, specLines, staticInitLines } = classSpecOf(
        ce as unknown as Parameters<typeof classSpecOf>[0],
        depth,
        opts,
      );
      // Bug 9：类 spec 发**纯表达式**（结尾不带 `;`）——子表达式位置
      // （return 值/数组元素/实参/new 被调者/…）由父级任意包裹；语句终止符
      // 由消费方补（命名/静态块分支 IIFE 内 `let NAME = …;`、声明位
      // transpileClass 自带 `});`）。此前抄声明形带 `;` → `return($class(…}););`
      // new Function SyntaxError，整模块加载失败。
      const specSrc = [`$class(${JSON.stringify(name)}, {`, ...specLines, `${indent(depth)}})`].join("\n");
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
      const hasThis = !isArrow && fnBodyHasThis(fn);
      // 非箭头且体直接引用 arguments：建独立 tuple 槽。箭头不建槽（沿外层
      // argsBinding；无绑定 → $unknown()，见 Identifier 分支）。
      const hasArgs = !isArrow && fnBodyHasOwnArguments(fn);
      // 参数默认值在函数作用域求值：非箭头且引用自有 arguments
      // （fnBodyHasOwnArguments 已含参数面）→ 默认表达式读 __nudoArgs 槽
      //（useArgsSlot 路径由 emitParamBindingFromArgs 处理，此处覆盖
      // hasArgs&&hasThis 真函数包装路径）；箭头默认值词法继承外层绑定
      const paramOpts: TranspileOptions = !isArrow && hasArgs
        ? { ...opts, argsBinding: "__nudoArgs" }
        : opts;
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
      // Bug 69：原生 fn.length（首个默认值/rest 前形参数）——宿主 impl 是
      // 解糖产物（`_p{i}` 占位全成真参），长度不可信，transpile 侧记真值
      const fnLen = nativeParamArity(fn.params);
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
        const inner = fn.generator ? `return $gen(() => {\n${raw}\n});` : raw;
        // Bug 93：generator 标记透传 $fnVal opts.kind → impl——member.ts 的
        // fn 分支据此区分「不可构造但有 prototype」（generator 实例原型）
        // 与「无 prototype」（箭头/async/方法）。声明路径走宿主函数分支
        //（isHostGeneratorFn 源形判定），此处是表达式面。
        const genKindSrc = fn.generator ? `, kind: "generator"` : "";
        if (hasThis) {
          const wrap = fn.async && !fn.generator
            ? `function (${argsParamParts.join(", ")}) { return $async(() => {\n${inner}\n}); }`
            : `function (${argsParamParts.join(", ")}) {\n${inner}\n}`;
          // Bug 7：hasArgs 时体内已归一缺参——钩子补齐会膨胀 arguments.length
          return `$fnVal(${nameList}, ${wrap}, { ctor: ${fnCtor}${hasArgs ? ", padArgs: false" : ""}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed}${genKindSrc} })`;
        }
        if (fn.async && !fn.generator) {
          return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => $async(() => {\n${inner}\n}), { ctor: ${fnCtor}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed}${genKindSrc} })`;
        }
        return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => {\n${inner}\n}, { ctor: ${fnCtor}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed}${genKindSrc} })`;
      }
      const bodySrc = transpileExpression(fn.body as Expression, fnBodyOpts);
      if (allPrologue.length > 0 || hasThis) {
        // 表达式体 + 模式参数/this 注入：提升为块体以容纳 prologue
        const rebinds = emitArrMutatorRebinds(fn.body as Expression, fnBodyOpts, "  ");
        const inner = [
          ...allPrologue,
          ...rebinds.map((l) => `  ${l}`),
          `  return ${fn.async ? `$async(() => ${bodySrc})` : bodySrc};`,
        ].join("\n");
        if (hasThis) {
          const wrap = `function (${argsParamParts.join(", ")}) {\n${inner}\n}`;
          // Bug 7：hasArgs 时体内已归一缺参——钩子补齐会膨胀 arguments.length
          return `$fnVal(${nameList}, ${wrap}, { ctor: ${fnCtor}${hasArgs ? ", padArgs: false" : ""}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed} })`;
        }
        return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => {\n${inner}\n}, { ctor: ${fnCtor}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed} })`;
      }
      // 表达式体：块体包裹跑语句级 rebind pass——`()=>n++` / `()=>a.push(1)`
      // 的写回此前静默丢失（表达式上下文无语句级扫描）
      const rebinds = emitArrMutatorRebinds(fn.body as Expression, fnBodyOpts, "  ");
      if (rebinds.length > 0) {
        const inner = [
          ...rebinds.map((l) => `  ${l}`),
          `  return ${fn.async ? `$async(() => ${bodySrc})` : bodySrc};`,
        ].join("\n");
        return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => {\n${inner}\n}, { ctor: ${fnCtor}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed} })`;
      }
      if (fn.async) {
        return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => $async(() => ${bodySrc}), { ctor: ${fnCtor}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed} })`;
      }
      return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => ${bodySrc}, { ctor: ${fnCtor}, length: ${fnLen}, effectFree: ${effectFree}, closed: ${closed} })`;
      })();
      if (!nfeName) return fnValSrc;
      // IIFE 绑定 NFE 自身名：调用期 g 已是 fn Abs（体内引用按词法捕获）；
      // 宿主 let 只赋一次，不改可观测语义（原生是不可变绑定）。
      return `(() => { let ${nfeName}; ${nfeName} = ${fnValSrc}; return ${nfeName}; })()`;
    }
  }
}
