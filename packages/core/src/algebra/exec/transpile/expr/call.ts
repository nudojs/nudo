/**
 * 调用族发射（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - 标识符调用走 $callNamed（call@ 采集 + 实参 provenance）；内建名
 *   （undefined/NaN/Infinity）不走 callNamed（调用位读标识符绑定）；
 * - require(spec) 可折叠说明符 → __nudoRequire；真动态 → 诚实 $unknown()；
 * - RegExp test/exec 的 lastIndex 写回必须发生在表达式内部（元素顺序副作用），
 *   receiver 为本地绑定时内联「求值 + 写回」IIFE；
 * - 计算字面量键调用（obj["m"]()/obj[1]()）同走 $invoke 保 this 绑定；
 * - 计算非字面量键调用（obj[key]()，key 运行时求值）走 $invokeKey
 *   （键折叠槽名 + $invoke 派发），接收者不丢。
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
import { memberPathOf, setPathSrc } from "../member-path.ts";
import { emitTranspileExpression as transpileExpression } from "../transpile-dispatch.ts";
/**
 * Object.defineProperty 目标的**写回源**（第一实参可重绑时）：
 * - 标识符 → `name = __nudoDefR`（`arguments` → argsBinding 槽）；
 * - 成员路径 → `root = $set(root, …, __nudoDefR)`（不可变更新链写回根）；
 * 不可重绑（调用结果 / new 表达式等）→ null（只发调用，不写回）。
 */
function definePropRebindSrc(target: Node, opts: TranspileOptions): string | null {
  if (target.type === "Identifier") {
    const name = (target as { name: string }).name;
    if (name === "arguments") {
      return opts.argsBinding ? `${opts.argsBinding} = __nudoDefR` : null;
    }
    return `${name} = __nudoDefR`;
  }
  if (target.type === "MemberExpression") {
    const path = memberPathOf(target as unknown as Parameters<typeof memberPathOf>[0], opts);
    if (!path) return null;
    return `${path.rootTarget} = ${setPathSrc(path, "__nudoDefR")}`;
  }
  return null;
}
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
      // Object.defineProperty / Object.defineProperties(o, …)：**求值点自包含**
      // （Bug 137/176）——实参只求值一次（语句位写回曾**重发整条调用** ⇒ 实参
      // 副作用翻倍），写回同点完成（同一条表达式里排在后面的读看到变更后的
      // 状态）。返回值是新容器（value 进 slots、访问器进侧表）——写回第一
      // 实参；freeze/seal/preventExtensions 就地标记无需写回（写回也无害）。
      // 第一实参不可重绑（foo().p）→ 只发调用（不写回），与旧口径一致。
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        (callee.object as { name: string }).name === "Object" &&
        callee.property.type === "Identifier" &&
        ((callee.property as { name: string }).name === "defineProperty" ||
          (callee.property as { name: string }).name === "defineProperties") &&
        expr.arguments[0]
      ) {
        const methodName = (callee.property as { name: string }).name;
        const rebind = definePropRebindSrc(expr.arguments[0] as Node, opts);
        if (rebind !== null) {
          const args = expr.arguments
            .map((a) =>
              a.type === "SpreadElement"
                ? `...$elems(${transpileExpression(a.argument as Expression, opts)})`
                : transpileExpression(a as Expression, opts),
            )
            .join(", ");
          const loc = expr.loc;
          const locArg = loc ? `, [${loc.start.line}, ${loc.start.column}]` : "";
          return `(() => { const __nudoDefR = $invoke(Object, ${JSON.stringify(methodName)}, [${args}]${locArg}); ${rebind}; return __nudoDefR; })()`;
        }
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
        // Bug 171：实参**只求值一次**——原先同一份 `[${args}]` 源码文本内联进
        // $invoke 与 $reStateCall 两处，实参表达式被执行两遍（副作用翻倍）。
        // 改为先把实参物化成数组 __a，两个通道共用同一份值。
        if (
          !opt &&
          callee.property.type === "Identifier" &&
          REGEX_STATEFUL_NAMES.has(callee.property.name) &&
          callee.object.type === "Identifier"
        ) {
          const recvName = (callee.object as { name: string }).name;
          return `(() => { const __nudoReArgs = [${args}]; const __v = $invoke(${recvName}, ${name}, __nudoReArgs${locArg}); $reStateCall(${recvName}, ${name}, __nudoReArgs); return __v; })()`;
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
      // obj[key](args)（计算**非字面量**键：标识符/调用/成员链/Symbol 常量
      // 读等）→ $invokeKey：键运行时求值折叠槽名后走 $invoke 既有派发，
      // 接收者不丢（此前落通用 $call($idx(...))——$call 无接收者参数，方法体
      // this 读失败/内建 brand 校验假定抛 → 假 never）。super 接收者由上方
      // 专用分支接管，不在此列。
      {
        const calleeComputed = (callee as { computed?: boolean }).computed === true;
        const keyNode = calleeComputed
          ? (callee as { property?: { type?: string } }).property
          : undefined;
        if (
          (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") &&
          keyNode !== undefined &&
          isExpression(keyNode as Node) &&
          callee.object.type !== "Super"
        ) {
          const recv = transpileExpression(callee.object as Expression, opts);
          const keySrc = transpileExpression(keyNode as Expression, opts);
          const args = expr.arguments
            .map((a) =>
              a.type === "SpreadElement"
                ? `...$elems(${transpileExpression(a.argument as Expression, opts)})`
                : transpileExpression(a as Expression, opts),
            )
            .join(", ");
          const opt = optionalCall || (callee as { optional?: boolean }).optional === true;
          const loc = expr.loc;
          const locArg = loc ? `, [${loc.start.line}, ${loc.start.column}]` : "";
          return opt
            ? `$optionalInvokeKey(${recv}, ${keySrc}, [${args}])`
            : `$invokeKey(${recv}, ${keySrc}, [${args}]${locArg})`;
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
