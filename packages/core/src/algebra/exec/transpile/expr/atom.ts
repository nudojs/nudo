/**
 * 原子/字面量族发射（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - 宿主内建标识符（undefined/NaN/Infinity）按 **opts.shadowedIntrinsics**
 *   分态：未遮蔽 → 字面量精确折叠（$lit(void 0) / $lit(0/0) / $lit(1/0)）；
 *   已遮蔽（用户绑定：`const undefined = 5` / 形参名）→ 发射标识符本身 +
 *   外层 `$absVal(...)`，由 JS 词法绑定决定读值（见 Identifier 臂）；
 * - 自由 arguments（无 argsBinding）→ $throwFreeArguments() 定抛 ReferenceError；
 * - 顶层 this（无 thisParam）= $lit(void 0)（ESM 语义）；
 * - JSX 未 lowering → $unknown()（显式 unknown，不连坐整文件 fail-closed）。
 */
import type {
  Expression,
  NumericLiteral,
  StringLiteral,
  BooleanLiteral,
  BigIntLiteral,
  NullLiteral,
  Identifier,
  ThisExpression,
  RegExpLiteral,
  TemplateLiteral,
  TaggedTemplateExpression,
  MetaProperty,
  ImportExpression,
  JSXElement,
  JSXFragment,
} from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { HOST_INTRINSIC_SET } from "../intrinsics.ts";
import { emitTranspileExpression as transpileExpression } from "../transpile-dispatch.ts";
/**
 * 原子/字面量族：标量字面量、标识符/this 解析、模板与标签模板、import() 与 JSX。
 * 路由与默认 unsupported 臂在 ./transpile.ts。
 */
export function transpileAtomExpr(
  expr:
    | NumericLiteral
    | StringLiteral
    | BooleanLiteral
    | BigIntLiteral
    | NullLiteral
    | Identifier
    | ThisExpression
    | RegExpLiteral
    | TemplateLiteral
    | TaggedTemplateExpression
    | MetaProperty
    | ImportExpression
    | JSXElement
    | JSXFragment,
  opts: TranspileOptions = {},
): string {
  switch (expr.type) {
    case "NumericLiteral": {
      // Bug 150：数值字面量的渲染不能用 JSON.stringify——它对非有限数返回
      // "null"（JSON 无 Infinity 表示），该文本被直接拼进生成代码 ⇒
      // `1e400` 折成 null（原生 Infinity）、`-1e400` 折成 -0（原生
      // -Infinity）。非有限数按 intrinsics.ts 同口径发 `1/0` / `-1/0`
      // （无标识符依赖，宿主求值即 ±Infinity）；-0 另需保号
      // （JSON.stringify(-0) === "0"，而 1/-0 = -Infinity ≠ 1/0）。
      const v = expr.value as number;
      if (Number.isNaN(v)) return "$lit(0/0)";
      if (v === Infinity) return "$lit(1/0)";
      if (v === -Infinity) return "$lit(-1/0)";
      if (Object.is(v, -0)) return "$lit(-0)";
      return `$lit(${JSON.stringify(v)})`;
    }
    case "StringLiteral":
    case "BooleanLiteral":
      return `$lit(${JSON.stringify(expr.value)})`;
    case "BigIntLiteral":
      // JSON.stringify(bigint) 会抛；按字面量拼法输出（$lit(5n)）
      return `$lit(${String((expr as { value: bigint }).value)}n)`;
    case "NullLiteral":
      return `$lit(null)`;
    case "Identifier": {
      // 宿主内建名（undefined/NaN/Infinity）分两态发射：
      // - **未遮蔽**（本转译单元无同名绑定）：恢复字面量精确折叠
      //   （$lit(void 0) / $lit(0/0) / $lit(1/0)）——宿主全局读取即该字面量，
      //   折叠保 exact 精度，且与旧产物逐字节一致；
      // - **已遮蔽**（用户合法绑定：模块级 `const undefined = 5`、形参名
      //   `undefined`、`let NaN`、@nudo:mock 注入）：发射**标识符本身**，由
      //   JS 词法绑定决定读值，外层 `$absVal` 只把「遮蔽绑定是 Abs」的情形
      //   原样返回（未遮蔽面本分支已折字面量，不会读到裸值）。
      //
      // 遮蔽判定见 helpers.ts 的 shadowedIntrinsicsOf（opts.shadowedIntrinsics
      // 由 transpileFile / transpileBodyNode / body-fn / evalExprAbs 线程化）。
      // 静态窄化（stmt-predicates）同用该标记：`x === undefined` / `case
      // undefined:` 在遮蔽后比较的是绑定值，不得当 nullish 字面量事实。
      if (HOST_INTRINSIC_SET.has(expr.name)) {
        if (opts.shadowedIntrinsics?.has(expr.name)) return `$absVal(${expr.name})`;
        if (expr.name === "undefined") return "$lit(void 0)";
        if (expr.name === "NaN") return "$lit(0/0)";
        return "$lit(1/0)";
      }
      if (expr.name === "arguments") {
        // 词法外层 arguments：非箭头函数体（或其嵌套箭头）引用时建
        // argsBinding——箭头沿该绑定词法继承。无绑定（模块顶层）→ 自由
        // arguments 非宿主全局，原生 unresolvable reference → 定抛
        // ReferenceError（`typeof arguments` 豁免由 Unary 分支折
        // "undefined"，不落此处）。
        return opts.argsBinding ?? "$throwFreeArguments()";
      }
      return expr.name;
    }
    case "ThisExpression":
      // 顶层 this（无 thisParam 且不在函数体）：ESM 语义 this === undefined。
      // 读 → undefined；写（this.x = 1）经写路径 strict 语义硬抛 TypeError
      // （模块装载失败，与原生一致）。函数体 this 由 thisParam/降级处理。
      return opts.thisParam ?? "$lit(void 0)";
    case "RegExpLiteral": {
      return `$regex(${JSON.stringify(expr.pattern)}${expr.flags ? `, ${JSON.stringify(expr.flags)}` : ""})`;
    }
    case "TemplateLiteral": {
      const quasis = expr.quasis;
      const exprs = expr.expressions;
      // `a${b}c` → $add($add($lit("a"), b), $lit("c"))
      let acc: string | null = null;
      for (let i = 0; i < quasis.length; i++) {
        const cooked = quasis[i]!.value.cooked ?? quasis[i]!.value.raw;
        const piece = `$lit(${JSON.stringify(cooked)})`;
        acc = acc === null ? piece : `$add(${acc}, ${piece})`;
        if (i < exprs.length) {
          const e = transpileExpression(exprs[i] as Expression, opts);
          acc = `$add(${acc}, ${e})`;
        }
      }
      return acc ?? `$lit("")`;
    }
    case "TaggedTemplateExpression": {
      // Bug 34：标签模板 = 以 (模板对象, ...替换值) 调用标签函数——
      // tag`a${b}c` ≡ tag(GetTemplateObject(`a${b}c`), b)。模板对象走 $tpl
      //（cooked 数字槽——无效转义时原生是 undefined、length、.raw 数组、
      // 迭代器面）；调用按标签形态路由：标识符 → $callNamed（call@ 采集）、
      // obj.method → $invoke、其余（(fn)`x` / 1`x`）→ $call——非函数字面量
      // callee 的 definite TypeError 与 any 标签的 may 在 $call/$callNamed
      // 的 callee 校验（Bug 2 修复位）记录，此前整个表达式 unsupported →
      // 模块级 opaque 连坐同文件其余签名。
      const quasis = expr.quasi.quasis;
      const cookedSrc = `[${quasis
        .map((q) => (q.value.cooked == null ? "void 0" : JSON.stringify(q.value.cooked)))
        .join(", ")}]`;
      const rawSrc = `[${quasis
        .map((q) => JSON.stringify(q.value.raw ?? q.value.cooked ?? ""))
        .join(", ")}]`;
      const args = [
        `$tpl(${cookedSrc}, ${rawSrc})`,
        ...expr.quasi.expressions.map((e) => transpileExpression(e as Expression, opts)),
      ].join(", ");
      const tag = expr.tag;
      if (tag.type === "Identifier" && !HOST_INTRINSIC_SET.has(tag.name)) {
        const loc = expr.loc;
        const locArg = loc ? `, [${loc.start.line}, ${loc.start.column}]` : "";
        const calleeRef = opts.lenientGlobals
          ? `(typeof ${tag.name} !== "undefined" ? ${tag.name} : void 0)`
          : tag.name;
        return `$callNamed(${JSON.stringify(tag.name)}, ${calleeRef}, [${args}]${locArg})`;
      }
      if (
        (tag.type === "MemberExpression" || tag.type === "OptionalMemberExpression") &&
        !(tag as { computed?: boolean }).computed &&
        tag.property.type === "Identifier"
      ) {
        const recv = transpileExpression(tag.object as Expression, opts);
        return `$invoke(${recv}, ${JSON.stringify(tag.property.name)}, [${args}])`;
      }
      // 表达式标签 / 宿主内建名（String.raw`x` 等内建标签走标识符宿主面）：
      // Abs 一等函数调用走 $call（prim 字面量标签 → definite TypeError）
      return `$call(${transpileExpression(tag, opts)}, [${args}])`;
    }
    case "MetaProperty":
      // Bug 79：import.meta → { url: string }（宿主 URL 非字面量）；
      // new.target → $newTarget()（普通调用 undefined；$new 构造帧内为类值）
      // ——此前两者混编 $importMeta()，new.target 假精确 { url: string }。
      if ((expr.meta as { name?: string }).name === "new") return "$newTarget()";
      return "$importMeta()";
    case "ImportExpression": {
      // import(spec) → Promise<open module namespace>
      const specSrc = transpileExpression(expr.source as Expression, opts);
      return `$dynamicImport(${specSrc})`;
    }
    case "JSXElement":
    case "JSXFragment":
      // JSX 未 lowering：显式 unknown（不假精确 undefined），文件其余
      // 构造保持 eval-hosted——不再整文件 fail-closed
      return "$unknown()";
  }
}
