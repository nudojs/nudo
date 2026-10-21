/**
 * 对象/数组/展开族发射（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - {...o} 必产新对象（$spread($obj({}), …)）——别名会泄漏 frozen/sealed 不变性；
 * - 对象方法简写/方法型 FunctionExpression → $fnVal({ bindThis: true })，
 *   方法体经 stmt/fn-body.ts emitFnBlockBody（早退 if 提升不被绕过）；
 * - 非计算 __proto__: v 是 ES 原型设定不是自有键（$setProto），方法名
 *   __proto__ 则必须 $setKey 保键；
 * - symbol 键投影写打 Slot.symbolKey 标记（JSON 枚举面不可见，Bug 73）；
 * - 数组含 spread 时 hole 下标不可静态确定，$concat 归一（字符串按 code
 *   points 拆）。
 */
import type { Expression, Node, ObjectExpression, ArrayExpression } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import {
  fnBodyHasOwnArguments,
  staticKeyOf,
  symbolKeyOf,
  paramDisplayNames,
  nativeParamArity,
  methodBindNames,
  collectForkBindingNames,
  withClassNameHint,
} from "../helpers.ts";
import { emitParamBindingFromArgs } from "../emit.ts";
import { emitTranspileExpression as transpileExpression } from "../transpile-dispatch.ts";
import { emitFnBlockBody } from "../stmt/fn-body.ts";
import { emitSetterAccessorThunk } from "../class-emit.ts";
import { paramNamesOfFn } from "./function.ts";
/**
 * 对象/数组/展开族：对象字面量（方法简写/访问器/计算键/__proto__）、数组字面量
 * （hole/spread 经 $concat 归一）。
 */
export function transpileObjectExpr(
  expr:
    | ObjectExpression
    | ArrayExpression,
  opts: TranspileOptions = {},
): string {
  switch (expr.type) {
    case "ObjectExpression": {
      // 支持 { ...a, b: 1 } → $spread($spread(a, $obj({b:1})), ...)
      let acc: string | null = null;
      const props: string[] = [];
      const accRegs: Array<{ key?: string; get?: string; set?: string }> = [];
      /** 非计算 `__proto__: v` 的特殊原型设定（ES）；primitive 忽略 */
      let protoSet: string | null = null;
      const flushProps = () => {
        if (props.length === 0) return;
        const obj = `$obj({ ${props.join(", ")} })`;
        acc = acc === null ? obj : `$spread(${acc}, ${obj})`;
        props.length = 0;
      };
      for (const prop of expr.properties) {
        if (prop.type === "SpreadElement") {
          flushProps();
          const arg = transpileExpression(prop.argument as Expression, opts);
          // 首个 spread 也必须产新对象：{...o} 别名 o 会泄漏 frozen/sealed
          // 不变性（Object.isFrozen({...frozen}) 假 true）、跳过 getter 调用、
          // 且 c={...o} 后 c.x=… 误写源对象（原生新对象互不影响）。
          acc = acc === null ? `$spread($obj({}), ${arg})` : `$spread(${acc}, ${arg})`;
          continue;
        }
        // C3.2：对象方法简写 → $fnVal（方法槽进 shape；闭包捕获外层 let）。
        // P1：ObjectMethod 的 this 由 $invoke 注入 receiver（bindThis），与 class 方法同轨。
        if (prop.type === "ObjectMethod") {
          flushProps();
          // 计算键 [expr]：[Symbol.X] → "@@X" 投影（静态字符串槽，与既有口径
          // 一致）；其余计算键求值键表达式，方法/占位值经 $setKey 注册
          // （与计算属性 { [k]: v } 同口径）——staticKeyOf 只对非计算键取静态名。
          const symK = prop.computed
            ? symbolKeyOf(prop.key as unknown as Parameters<typeof symbolKeyOf>[0])
            : null;
          const computedKeySrc =
            prop.computed && symK === null ? transpileExpression(prop.key as Expression, opts) : null;
          const mkey = prop.computed
            ? symK
            : (() => {
                const k = staticKeyOf(prop.key as { type?: string; name?: string; value?: unknown });
                if (k !== null) return JSON.stringify(k);
                return symbolKeyOf(prop.key as unknown as Parameters<typeof symbolKeyOf>[0]);
              })();
          if (mkey === null && computedKeySrc === null) continue;
          // 方法名 `__proto__` 是自有数据属性（MethodDefinition 不是 proto 特殊形），
          // 不得进 $obj({ "__proto__": … })——宿主对象字面量会当 proto 设定丢键。
          const isProtoKey = mkey === '"__proto__"';
          const displayNames = paramDisplayNames(prop.params);
          const bindNames = methodBindNames(prop.params);
          // 方法体是新的函数边界：inLoop/inTry 必须归零；直接/嵌套箭头引用
          // arguments（含参数默认值）时建槽
          const mHasArgs = fnBodyHasOwnArguments({
            body: prop.body as Node,
            params: prop.params as Node[] | undefined,
          });
          // N3：非简单形参（默认值/解构/rest）与读 arguments 同走 ...__margs
          // 槽绑定——methodBindNames 只发左名（默认值表达式静默丢弃 → 缺参折
          // undefined 而非默认值；rest 收裸宿主数组 fail-closed unknown）。
          // emitParamBindingFromArgs 统一绑定，默认表达式以方法边界 opts 求值
          //（thisParam __this 在作用域内，与原生默认参以调用点 this 求值一致）
          const omBindFromArgs =
            mHasArgs ||
            (prop.params as Node[]).some((p) => (p as { type?: string } | undefined)?.type !== "Identifier");
          const methodOpts: TranspileOptions = {
            ...opts,
            inLoop: 0,
            inTry: 0,
            // 方法体是新函数边界：return 不携带外层 if 臂退出信号
            conditionalFlow: 0,
            thisParam: "__this",
            argsBinding: omBindFromArgs ? "__nudoArgs" : undefined,
            // Bug 52：方法体是新生成器边界——外层 try 不覆盖体内 yield
            yieldTryCtx: 0,
          };
          // get/set 访问器：注册进运行时侧表（$get/$set 派发；展开/assign 时调用）
          if (prop.kind === "get" || prop.kind === "set") {
            const omVarParams = paramNamesOfFn(prop.params as Node[]);
            // Bug 151：访问器是**普通函数**——原生里 `arguments` 天然存在
            // （getter 长度 0 / setter 长度 1）。此前访问器 thunk 不发
            // `__nudoArgs` 槽绑定 ⇒ 体里的 `arguments` 走 $throwFreeArguments()
            // ⇒ 定抛 ReferenceError（原生返回 0）。访问器一律给槽绑定。
            const accOpts: TranspileOptions = { ...methodOpts, argsBinding: "__nudoArgs" };
            // thunk 先行构造（get：单表达式体；set：与 stmt.ts 类访问器同口径
            // emitSetterAccessorThunk——内层箭头丢弃体返回值（恒返回 __this）
            // + 别名写接收者回收；N3：setter 形参默认值/解构经 __nudoArgs 槽绑定）
            const omFirstP = (prop.params as Node[])[0] as { type?: string } | undefined;
            const omVName =
              omFirstP?.type === "Identifier" ? (bindNames[0] ?? "__v") : "__v";
            const thunkSrc =
              prop.kind === "get"
                ? `(__this) => {\n  let __nudoArgs = $arguments([]);\n${emitFnBlockBody(prop.body, 1, accOpts, { varParams: omVarParams })}\n}`
                : emitSetterAccessorThunk(
                    omVName,
                    emitFnBlockBody(prop.body, 2, accOpts, {
                      implicitReturn: false,
                      varParams: omVarParams,
                    }),
                    collectForkBindingNames(prop.body).filter((n) => !omVarParams.has(n)),
                    1,
                    [
                      // Bug 151：setter 的 arguments 长度 = 1（原生 setter 形参 1 个）
                      `    let __nudoArgs = $arguments([${omVName}]);`,
                      ...(omFirstP && omFirstP.type !== "Identifier"
                        ? emitParamBindingFromArgs(prop.params as Node[], "    ", accOpts, "__nudoArgs").prologue
                        : []),
                    ],
                  );
            // Bug 112：计算键访问器的键表达式只求值一次——此前 computedKeySrc
            // 内嵌两处（占位槽写 + $objAccessorKey 注册），副作用键翻倍
            //（原生键只在字面量位置求值一次）。IIFE 绑定临时键 __k 供两处
            // 共用；注册是侧表插入（与位置无关），键求值保持在字面量位置
            if (computedKeySrc !== null) {
              const getArg = prop.kind === "get" ? thunkSrc : "null";
              const setArg = prop.kind === "set" ? thunkSrc : "null";
              acc = `((__k) => $objAccessorKey($setKey(${acc ?? "$obj({})"}, __k, $lit(void 0)), __k, ${getArg}, ${setArg}))(${computedKeySrc})`;
              continue;
            }
            // 占位槽保键存在性（'x' in o / keys / assign 拷贝目标）；读写在 $get/$set 派发
            if (isProtoKey) {
              acc = `$setKey(${acc ?? "$obj({})"}, $lit("__proto__"), $lit(void 0))`;
            } else if (symK !== null) {
              // Bug 73：symbol 键投影写打 Slot.symbolKey 标记（JSON 枚举面不可见）
              flushProps();
              acc = `$set(${acc ?? "$obj({})"}, ${symK}, $lit(void 0), { symbolKey: true })`;
            } else {
              props.push(`${mkey}: $lit(void 0)`);
            }
            // 静态键访问器经 $objAccessor 注册（字面量末尾统一应用）
            accRegs.push(
              prop.kind === "get"
                ? { key: mkey ?? undefined, get: thunkSrc }
                : { key: mkey ?? undefined, set: thunkSrc },
            );
            continue;
          }
          let mBodyInner = emitFnBlockBody(prop.body, 1, methodOpts, { varParams: paramNamesOfFn(prop.params as Node[]) });
          let mParams = ["__this", ...bindNames];
          if (omBindFromArgs) {
            const bound = emitParamBindingFromArgs(prop.params as Node[], "  ", methodOpts, "__nudoArgs");
            mBodyInner = [
              `  let __nudoArgs = $arguments(__margs);`,
              ...bound.prologue,
              mBodyInner,
            ].join("\n");
            mParams = ["__this", "...__margs"];
          }
          // Bug 58：generator 对象方法体不在调用期执行——包 $gen（吞调用期
          // throws；yield 收集保持既有 eager 口径，与声明/类方法路径同编）
          if (prop.generator) {
            mBodyInner = [
              `return $gen(() => {`,
              mBodyInner,
              `});`,
            ].join("\n");
          }
          // Bug 70：async 对象方法体包 $async（此前丢 async 修饰——返回裸体
          // 值而非 Promise）；async *m() 双包（$gen 内、$async 外，镜像类
          // 方法 stmt.ts 路径）
          if ((prop as { async?: boolean }).async) {
            mBodyInner = [
              `return $async(() => {`,
              mBodyInner,
              `});`,
            ].join("\n");
          }
          const bodySrc = `{\n${mBodyInner}\n}`;
          // Bug 9：对象方法是方法定义语法，原生不可 new → ctor: false
          // Bug 69：原生 fn.length（首个默认值/rest 前形参；bindThis 的 receiver 注入不占用户形参）
          const fnValSrc = `$fnVal([${displayNames.map((p) => JSON.stringify(p)).join(", ")}], (${mParams.join(", ")}) => ${bodySrc}, { bindThis: true, ctor: false, length: ${nativeParamArity(prop.params)} })`;
          if (isProtoKey) {
            acc = `$setKey(${acc ?? "$obj({})"}, $lit("__proto__"), ${fnValSrc})`;
          } else if (symK !== null) {
            // Bug 73：symbol 键投影写打 Slot.symbolKey 标记（JSON 枚举面不可见）
            flushProps();
            acc = `$set(${acc ?? "$obj({})"}, ${symK}, ${fnValSrc}, { symbolKey: true })`;
          } else if (computedKeySrc !== null) {
            acc = `$setKey(${acc ?? "$obj({})"}, ${computedKeySrc}, ${fnValSrc})`;
          } else {
            props.push(`${mkey}: ${fnValSrc}`);
          }
          continue;
        }
        if (prop.type !== "ObjectProperty") continue;
        // 计算属性 { [expr]: v } → $setKey；[Symbol.X] 投影为 "@@X" 字符串槽
        if (prop.computed) {
          flushProps();
          const symK = symbolKeyOf(prop.key as unknown as Parameters<typeof symbolKeyOf>[0]);
          // Bug 133：NamedEvaluation——计算键为**字面量**时以键值为类名
          // （`{ ["K"]: class {} }` → "K"）；动态键的类名取决于运行期键值，
          // 不静态回灌。[Symbol.X] 是符号键——原生不给类名。
          const litKey = (() => {
            const kk = prop.key as { type?: string; value?: unknown };
            if (kk?.type === "StringLiteral" || kk?.type === "NumericLiteral") return String(kk.value);
            return undefined;
          })();
          const v = transpileExpression(
            prop.value as Expression,
            withClassNameHint(opts, prop.value as Node, litKey),
          );
          const base = acc === null ? `$obj({})` : acc;
          if (symK !== null) {
            // Bug 73：symbol 键投影写打 Slot.symbolKey 标记（JSON 枚举面不可见）
            acc = `$set(${base}, ${symK}, ${v}, { symbolKey: true })`;
            continue;
          }
          const k = transpileExpression(prop.key as Expression, opts);
          acc = `$setKey(${base}, ${k}, ${v})`;
          continue;
        }
        const rawKey = staticKeyOf(prop.key as { type?: string; name?: string; value?: unknown });
        const key = rawKey === null ? null : JSON.stringify(rawKey);
        if (key === null) continue;
        // 非计算 `__proto__` 是 ES 特殊原型设定，不是自有键
        //（`{ "__proto__": v }` 经宿主 JS 对象字面量会丢键/改 [[Prototype]]）。
        if (!prop.computed && key === '"__proto__"') {
          protoSet = transpileExpression(prop.value as Expression, opts);
          continue;
        }
        // 方法型 FunctionExpression：与 ObjectMethod 同 this 绑定语义
        if (
          prop.value.type === "FunctionExpression" &&
          !(prop.value as { async?: boolean }).async
        ) {
          const fn = prop.value as unknown as {
            params: Array<{ type: string; name?: string }>;
            body: Node;
            generator?: boolean;
          };
          if (!fn.generator) {
            const displayNames = paramDisplayNames(fn.params);
            const bindNames = methodBindNames(fn.params);
            const mHasArgs = fnBodyHasOwnArguments({
              body: fn.body,
              params: fn.params as unknown as Node[] | undefined,
            });
            // N3：非简单形参（默认值/解构/rest）同走 ...__margs 槽绑定（ObjectMethod 同口径）
            const feBindFromArgs =
              mHasArgs ||
              (fn.params as unknown as Node[]).some((p) => (p as { type?: string } | undefined)?.type !== "Identifier");
            const methodOpts: TranspileOptions = {
              ...opts,
              inLoop: 0,
              // 方法型函数表达式体是新函数边界：return 不携带外层 if 臂退出信号
              conditionalFlow: 0,
              thisParam: "__this",
              argsBinding: feBindFromArgs ? "__nudoArgs" : undefined,
            };
            let mBodyInner = emitFnBlockBody(fn.body, 1, methodOpts, {
              varParams: paramNamesOfFn(fn.params as unknown as Node[]),
            });
            let mParams = ["__this", ...bindNames];
            if (feBindFromArgs) {
              const bound = emitParamBindingFromArgs(fn.params as Node[], "  ", methodOpts, "__nudoArgs");
              mBodyInner = [
                `  let __nudoArgs = $arguments(__margs);`,
                ...bound.prologue,
                mBodyInner,
              ].join("\n");
              mParams = ["__this", "...__margs"];
            }
            const bodySrc = `{\n${mBodyInner}\n}`;
            // Bug 9：方法型 FunctionExpression 仍是函数表达式——原生可 new（区别于 ObjectMethod）
            props.push(
              `${key}: $fnVal([${displayNames.map((p) => JSON.stringify(p)).join(", ")}], (${mParams.join(", ")}) => ${bodySrc}, { bindThis: true, ctor: true, length: ${nativeParamArity(fn.params)} })`,
            );
            continue;
          }
        }
        const valSrc = transpileExpression(
          prop.value as Expression,
          // Bug 133：NamedEvaluation——`{ K: class {} }` 以属性键为类名
          withClassNameHint(opts, prop.value as Node, rawKey ?? undefined),
        );
        props.push(`${key}: ${valSrc}`);
      }
      flushProps();
      let result = acc ?? `$obj({})`;
      for (const r of accRegs) {
        // 静态键访问器注册（计算键访问器已在属性位就地 $objAccessorKey——Bug 112）
        result = `$objAccessor(${result}, ${r.key}, ${r.get ?? "null"}, ${r.set ?? "null"})`;
      }
      if (protoSet !== null) result = `$setProto(${result}, ${protoSet})`;
      return result;
    }
    case "ArrayExpression": {
      // [...a, b] → $concat；含 spread 时 hole 下标不可静态确定，保守置 undefined
      const hasSpread = expr.elements.some((el) => el?.type === "SpreadElement");
      if (!hasSpread) {
        const items: string[] = [];
        const holes: number[] = [];
        for (const el of expr.elements) {
          if (!el) {
            holes.push(items.length);
            items.push("$lit(void 0)");
            continue;
          }
          items.push(transpileExpression(el as Expression, opts));
        }
        return `$arrWithHoles([${items.join(", ")}], [${holes.join(", ")}])`;
      }
      let acc: string | null = null;
      for (const el of expr.elements) {
        if (!el) continue;
        let piece: string;
        if (el.type === "SpreadElement") {
          // 经 $concat 归一：字符串按 code points 拆、单元素 spread 也是数组
          piece = `$concat(${transpileExpression(el.argument as Expression, opts)}, $arr([]))`;
        } else {
          piece = `$arr([${transpileExpression(el, opts)}])`;
        }
        acc = acc === null ? piece : `$concat(${acc}, ${piece})`;
      }
      return acc ?? `$arr([])`;
    }
  }
}
