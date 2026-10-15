/**
 * 调用族发射（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - 标识符调用走 $callNamed（call@ 采集 + 实参 provenance）；内建名
 *   （undefined/NaN/Infinity）不走 callNamed（调用位读标识符绑定）；
 * - require(spec) 可折叠说明符 → __nudoRequire；真动态 → 诚实 $unknown()；
 * - RegExp test/exec 的 lastIndex 写回必须发生在表达式内部（元素顺序副作用），
 *   receiver 为本地绑定时内联「求值 + 写回」IIFE；
 * - 计算字面量键调用（obj["m"]()/obj[1]()）同走 $invoke 保 this 绑定。
 */
import type {
  Expression,
  Node,
  NewExpression,
  CallExpression,
  OptionalCallExpression,
} from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { isExpression, foldRequireSpecArg } from "../helpers.ts";
import { HOST_INTRINSIC_SET } from "../intrinsics.ts";
import { REGEX_STATEFUL_NAMES } from "../ops.ts";
import { emitTranspileExpression as transpileExpression } from "../transpile-dispatch.ts";
/**
 * 调用族：new、super()、super.m()、obj.m()、计算字面量键调用、标识符 $callNamed、
 * require/require.resolve 折叠与表达式 callee $call。
 */
export function transpileCallExpr(
  expr:
    | NewExpression
    | CallExpression
    | OptionalCallExpression,
  opts: TranspileOptions = {},
): string {
  switch (expr.type) {
    case "NewExpression": {
      const callee = expr.callee;
      const cname =
        callee.type === "Identifier" ? callee.name : isExpression(callee) ? transpileExpression(callee, opts) : "$lit(void 0)";
      const args = expr.arguments
        .map((a) =>
          a.type === "SpreadElement"
            ? `...$elems(${transpileExpression(a.argument as Expression, opts)})`
            : transpileExpression(a as Expression, opts),
        )
        .join(", ");
      return `$new(${cname}, [${args}])`;
    }
    case "CallExpression":
    case "OptionalCallExpression": {
      const exprAny = expr as {
        type: string;
        callee: Node;
        arguments: unknown[];
        optional?: boolean;
      };
      const optionalCall = exprAny.type === "OptionalCallExpression" || exprAny.optional === true;
      const callee = expr.callee;
      // super() → __this = $super(__this, Child, [...])
      if (callee.type === "Super" && opts.thisParam && opts.className) {
        const args = expr.arguments
          .map((a) =>
            a.type === "SpreadElement"
              ? `...$elems(${transpileExpression(a.argument as Expression, opts)})`
              : transpileExpression(a as Expression, opts),
          )
          .join(", ");
        return `${opts.thisParam} = $super(${opts.thisParam}, ${JSON.stringify(opts.className)}, [${args}])`;
      }
      // super.method(args) / super[k](args) → $invokeSuper(...)（类实例方法）；
      // 对象字面量方法 → $invokeSuperObj（home object 原型链派发，Bug 19）；
      // 静态方法体 → $staticSuperInvoke（父类静态链 + 接收者 this，R5）。
      if (
        callee.type === "MemberExpression" &&
        callee.object.type === "Super" &&
        (callee.property.type === "Identifier" || callee.computed === true)
      ) {
        const args = expr.arguments
          .map((a) =>
            a.type === "SpreadElement"
              ? `...$elems(${transpileExpression(a.argument as Expression, opts)})`
              : transpileExpression(a as Expression, opts),
          )
          .join(", ");
        const keySrc = callee.computed
          ? transpileExpression(callee.property as Expression, opts)
          : `$lit(${JSON.stringify((callee.property as { name: string }).name)})`;
        // R5：静态方法体 super.m()——父类**静态**链查找，接收者 = this
        //（调用类值，非父类）。须先于实例分支（静态体现在也带
        // thisParam+className）。
        if (opts.thisParam && opts.className && opts.staticSuperSrc) {
          return `$staticSuperInvoke(${opts.thisParam}, ${JSON.stringify(opts.className)}, ${keySrc}, [${args}])`;
        }
        if (opts.thisParam && opts.className) {
          const nameArg = callee.computed
            ? ""
            : `, ${JSON.stringify((callee.property as { name: string }).name)}`;
          return callee.computed
            ? `$invokeSuperKey(${opts.thisParam}, ${JSON.stringify(opts.className)}, ${keySrc}, [${args}])`
            : `$invokeSuper(${opts.thisParam}, ${JSON.stringify(opts.className)}${nameArg}, [${args}])`;
        }
        if (opts.thisParam && !opts.className && !opts.staticSuperSrc) {
          return `$invokeSuperObj(${opts.thisParam}, ${keySrc}, [${args}])`;
        }
      }
      // require.resolve(spec) → 静态说明符字面量（模块身份；非宿主绝对路径）
      // 必须在 obj.method $invoke 分支之前（否则 require.resolve 被吃成 $invoke）
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        callee.object.name === "require" &&
        callee.property.type === "Identifier" &&
        callee.property.name === "resolve"
      ) {
        const spec = foldRequireSpecArg(expr.arguments[0]);
        if (spec !== undefined) return `$lit(${JSON.stringify(spec)})`;
        // 动态 resolve：诚实 unknown（不假装某条路径）
        return "$unknown()";
      }
      // require(spec)：可折叠说明符 → __nudoRequire；真动态 → 诚实 unknown
      //（不走 $callNamed("require", …)——那会把未声明 require 当全局调用炸掉）
      if (callee.type === "Identifier" && callee.name === "require") {
        const spec = foldRequireSpecArg(expr.arguments[0]);
        if (spec !== undefined) return `__nudoRequire(${JSON.stringify(spec)})`;
        return "$unknown()";
      }
      // obj.method(args) / obj?.method(args) → $invoke / $optionalInvoke
      if (
        (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") &&
        !callee.computed &&
        (callee.property.type === "Identifier" || callee.property.type === "PrivateName")
      ) {
        const recv = transpileExpression(callee.object as Expression, opts);
        const args = expr.arguments
          .map((a) =>
            a.type === "SpreadElement"
              ? `...$elems(${transpileExpression(a.argument as Expression, opts)})`
              : transpileExpression(a as Expression, opts),
          )
          .join(", ");
        const propName =
          callee.property.type === "PrivateName"
            ? // Bug 78：this.#m() → "#m" 混淆键
              `#${(callee.property as { id?: { name?: string }; name?: string }).id?.name
                ?? (callee.property as { name?: string }).name
                ?? ""}`
            : (callee.property as { name: string }).name;
        const name = JSON.stringify(propName);
        const opt = optionalCall || (callee as { optional?: boolean }).optional === true;
        const loc = expr.loc;
        const locArg = loc ? `, [${loc.start.line}, ${loc.start.column}]` : "";
        // RegExp test/exec 的状态写回必须发生在**表达式内部**（元素顺序副作用：
        // [r.test(s), r.lastIndex] 原生第二个元素读到更新后的位置）。receiver 是
        // 本地绑定时内联「求值 + 写回」IIFE；语句级 emit 不再重复写回。
        if (
          !opt &&
          callee.property.type === "Identifier" &&
          REGEX_STATEFUL_NAMES.has(callee.property.name) &&
          callee.object.type === "Identifier"
        ) {
          const recvName = (callee.object as { name: string }).name;
          return `(() => { const __v = $invoke(${recvName}, ${name}, [${args}]${locArg}); ${recvName} = $reStateCall(${recvName}, ${name}, [${args}]); return __v; })()`;
        }
        return opt
          ? `$optionalInvoke(${recv}, ${name}, [${args}])`
          : `$invoke(${recv}, ${name}, [${args}]${locArg})`;
      }
      // obj["m"](args) / obj[1](args) → $invoke：计算字面量键（Bug 60 数字键
      // 原生 ToPropertyKey 成串）——this 仍绑 recv；$call($idx(...)) 路径丢
      // this 且方法在类注册表而非实例槽上
      {
        const keyNode = (callee as { computed?: boolean; property?: { type?: string; value?: unknown } })
          .property as { type?: string; value?: unknown } | undefined;
        const calleeComputed = (callee as { computed?: boolean }).computed === true;
        if (
          (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") &&
          calleeComputed &&
          callee.object.type !== "Super" &&
          (keyNode?.type === "StringLiteral" || keyNode?.type === "NumericLiteral")
        ) {
          const recv = transpileExpression(callee.object as Expression, opts);
          const args = expr.arguments
            .map((a) =>
              a.type === "SpreadElement"
                ? `...$elems(${transpileExpression(a.argument as Expression, opts)})`
                : transpileExpression(a as Expression, opts),
            )
            .join(", ");
          const name = JSON.stringify(String(keyNode.value));
          const opt = optionalCall || (callee as { optional?: boolean }).optional === true;
          const loc = expr.loc;
          const locArg = loc ? `, [${loc.start.line}, ${loc.start.column}]` : "";
          return opt
            ? `$optionalInvoke(${recv}, ${name}, [${args}])`
            : `$invoke(${recv}, ${name}, [${args}]${locArg})`;
        }
      }
      // 标识符调用 → $callNamed（可采集 call@ + 实参 provenance）
      // 内建名（undefined/NaN/Infinity）不走 callNamed：调用位读的是标识符绑定
      if (callee.type === "Identifier" && !HOST_INTRINSIC_SET.has(callee.name)) {
        const argSrcs: string[] = [];
        const argLocSrcs: string[] = [];
        for (const a of expr.arguments) {
          if (a.type === "SpreadElement") {
            // spread 实参展开（DEC-006 K5）：$elems → JS Abs[]，数组字面量 JS spread 平铺
            // 此前折 $unknown() 单参，后续形参绑到 JS undefined
            argSrcs.push(`...$elems(${transpileExpression(a.argument as Expression, opts)})`);
            argLocSrcs.push("null");
          } else {
            argSrcs.push(transpileExpression(a as Expression, opts));
            const al = (a as { loc?: { start: { line: number; column: number } } }).loc;
            argLocSrcs.push(al ? `[${al.start.line}, ${al.start.column}]` : "null");
          }
        }
        const loc = expr.loc;
        const locArg = loc ? `, [${loc.start.line}, ${loc.start.column}]` : "";
        const argLocArg = loc ? `, [${argLocSrcs.join(", ")}]` : "";
        const calleeRef = opts.lenientGlobals
          ? `(typeof ${callee.name} !== "undefined" ? ${callee.name} : void 0)`
          : callee.name;
        return `$callNamed(${JSON.stringify(callee.name)}, ${calleeRef}, [${argSrcs.join(", ")}]${locArg}${argLocArg})`;
      }
      const args = expr.arguments
        .map((a) =>
          a.type === "SpreadElement"
            ? `...$elems(${transpileExpression(a.argument as Expression, opts)})`
            : transpileExpression(a as Expression, opts),
        )
        .join(", ");
      const c =
        callee.type === "Identifier"
          ? callee.name
          : isExpression(callee)
            ? transpileExpression(callee, opts)
            : "/* callee */";
      // 表达式 callee（add.bind(…)() / IIFE）：结果是 Abs fn，宿主裸调用无效——
      // 走 $call（Abs 一等函数调用）。Identifier 仍走宿主调用（函数声明/绑定）。
      if (callee.type !== "Identifier") {
        return `$call(${c}, [${args}])`;
      }
      return `${c}(${args})`;
    }
  }
}
