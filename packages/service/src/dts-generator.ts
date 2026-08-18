import type { TypeValue } from "@nudojs/core";
import { T, isTemplate, getTemplateParts, simplifyUnion, typeValueEquals } from "@nudojs/core";
import type { AnalysisResult, FunctionAnalysis } from "./analyzer.ts";

export function typeValueToTSType(tv: TypeValue): string {
  switch (tv.kind) {
    case "literal": {
      const v = tv.value;
      if (v === null) return "null";
      if (v === undefined) return "undefined";
      if (typeof v === "string") return JSON.stringify(v);
      if (typeof v === "boolean") return String(v);
      return String(v);
    }
    case "primitive":
      return tv.type;
    case "refined": {
      if (isTemplate(tv)) {
        const parts = getTemplateParts(tv)!;
        const inner = parts
          .map((p) => (p.kind === "literal" && typeof p.value === "string" ? p.value : `\${${typeValueToTSType(p)}}`))
          .join("");
        return `\`${inner}\``;
      }
      return typeValueToTSType(tv.base);
    }
    case "object": {
      const entries = Object.entries(tv.properties);
      if (entries.length === 0) return "{}";
      const inner = entries
        .map(([k, v]) => `${k}: ${typeValueToTSType(v)}`)
        .join("; ");
      return `{ ${inner} }`;
    }
    case "array":
      return `${wrapComplexType(tv.element)}[]`;
    case "tuple": {
      const inner = tv.elements.map(typeValueToTSType).join(", ");
      return `[${inner}]`;
    }
    case "function": {
      const params = tv.params
        .map((p) => `${p}: unknown`)
        .join(", ");
      const returnType = (tv as any)._returnType;
      const retStr = returnType ? typeValueToTSType(returnType) : "unknown";
      return `(${params}) => ${retStr}`;
    }
    case "promise":
      return `Promise<${typeValueToTSType(tv.value)}>`;
    case "instance":
      return tv.className;
    case "union":
      return tv.members.map(typeValueToTSType).join(" | ");
    case "never":
      return "never";
    case "unknown":
      return "unknown";
  }
}

function wrapComplexType(tv: TypeValue): string {
  const ts = typeValueToTSType(tv);
  if (tv.kind === "union") return `(${ts})`;
  return ts;
}

function getParamName(fn: FunctionAnalysis, index: number): string {
  if (fn.paramNames && fn.paramNames[index]) {
    return fn.paramNames[index];
  }
  return `arg${index}`;
}

// ---------------------------------------------------------------------------
// Widening —— 主签名语义
//
// case 形状携带字面量精度（10、"Alice"、true、[1,2,3]、{ id: 1 }），但
// .d.ts 是调用面而非 case 台账：按 case 生成重载时 `safeSqrt(arg0: 10): 10`
// 会让合法调用 `safeSqrt(5)` 匹配不到任何重载，直接编译错误（tsc 5.9.3
// 实测 TS2769，见 __tests__/dts-generator.test.ts 的 safeSqrt 场景）。
// 主签名因此取 Combined 语义：每个参数位置取各 case 对应参数类型的联合
// 并 widen，返回类型对 combined 同样 widen（顶层标量字面量 → 基类型
// number/string/boolean/bigint；null/undefined 字面量本身是基类型，不变）。
//
// 参数位是逆变位，拦截面最广，widen 递归进结构（tsc --strict 实测）：
//   - 同构元组 [1,2,3,4,5] → number[]：定长 widened 元组
//     [number,number,number,number,number] 仍会拒收变长合法实参（TS2345
//     "Source has 2 element(s) but target requires 3"），而字面量长度只是
//     单次调用观察，不该构成约束；
//   - 异构元组 [1,"two"] → [number, string]：位置语义真实，且不拦截
//     合法的按位调用（实测 f([1,"x"]) 通过）；
//   - 对象属性值 { id: 1 } → { id: number }、数组元素、Promise 载荷、
//     实例属性同样递归 widen（全部处于逆变位，字面量精度同样拦截赋值）；
//   - refined（模板串/数值收窄）剥到 base：参数位收窄拦截一切不匹配
//     实参，精确形状由 JSDoc Case: 行保留。
//
// 返回值位是协变位，收窄只会让调用方拿到更精确的类型、不会拦截调用，
// 维持现状：仅顶层（含 union 成员）标量字面量 widen，嵌套精度保留
// （Promise<42>、返回元组字面量等）。
//
// 就地实现而不复用 core 的 widenLiteral：①本路径不依赖 core 侧并行改动的
// 落地时序；②core 版本把 bigint 字面量映射到 unknown，不符合此处语义。
// ---------------------------------------------------------------------------
function widenLiteralToBase(tv: TypeValue): TypeValue {
  if (tv.kind !== "literal") return tv;
  const v = tv.value;
  if (typeof v === "number") return T.number;
  if (typeof v === "string") return T.string;
  if (typeof v === "boolean") return T.boolean;
  if (typeof v === "bigint") return T.bigint;
  return tv;
}

/** 返回值位（协变）：仅顶层标量字面量 widen，嵌套精度保留 */
function widenTopLevel(tv: TypeValue): TypeValue {
  if (tv.kind !== "union") return widenLiteralToBase(tv);
  return simplifyUnion(tv.members.map(widenLiteralToBase));
}

function widenProperties(properties: Record<string, TypeValue>): Record<string, TypeValue> {
  const out: Record<string, TypeValue> = {};
  for (const [k, v] of Object.entries(properties)) out[k] = widenParamType(v);
  return out;
}

/** 参数位（逆变）递归 widen：结构内的字面量精度一律放宽到基类型 */
function widenParamType(tv: TypeValue): TypeValue {
  switch (tv.kind) {
    case "literal":
      return widenLiteralToBase(tv);
    case "union":
      return simplifyUnion(tv.members.map(widenParamType));
    case "tuple": {
      const widened = tv.elements.map(widenParamType);
      const first = widened[0];
      if (first && widened.every((el) => typeValueEquals(el, first))) {
        return T.array(first);
      }
      return T.tuple(widened);
    }
    case "array":
      return T.array(widenParamType(tv.element));
    case "object":
      return T.object(widenProperties(tv.properties));
    case "promise":
      return T.promise(widenParamType(tv.value));
    case "instance":
      return T.instanceOf(tv.className, widenProperties(tv.properties));
    case "refined":
      return widenParamType(tv.base);
    default:
      return tv;
  }
}

/**
 * 各 case 在同一参数位的类型 → 拍平、递归 widen、去重后的单一 TypeValue。
 * 去重以 TS 渲染串为键：TypeValue 的对象/元组相等性是引用比较，两个同形
 * 的 widened 对象（如各 case 的 { id: number }）不去重会渲染成重复成员。
 */
function widenedUnion(members: TypeValue[]): TypeValue {
  const flat: TypeValue[] = [];
  const collect = (tv: TypeValue): void => {
    if (tv.kind === "union") {
      tv.members.forEach(collect);
      return;
    }
    flat.push(tv);
  };
  members.forEach(collect);
  const widened = flat.map(widenParamType);
  const seen = new Set<string>();
  const deduped = widened.filter((tv) => {
    const key = typeValueToTSType(tv);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return simplifyUnion(deduped);
}

type MainSignature = {
  /** 渲染后的参数声明（含 `?` / `...rest`），如 `["x: number", "y?: string"]` */
  params: string[];
  /** 去重后的参数名（JSDoc @param 与渲染共用，保证一致） */
  paramNames: string[];
  /** 各参数位 widen 后的 TS 类型串（JSDoc 与精确度比对用） */
  paramTypes: string[];
  /** widen 后的返回类型串 */
  returnType: string;
};

function computeMainSignature(fn: FunctionAnalysis): MainSignature {
  const arity = Math.max(...fn.cases.map((c) => c.args.length));
  const minArity = Math.min(...fn.cases.map((c) => c.args.length));
  const params: string[] = [];
  const paramNames: string[] = [];
  const paramTypes: string[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < arity; i++) {
    const members = fn.cases
      .filter((c) => i < c.args.length)
      .map((c) => c.args[i]);
    const typeStr = typeValueToTSType(widenedUnion(members));
    let name = getParamName(fn, i);
    if (usedNames.has(name)) {
      // 解构/模式参数在 AST 提取时都叫 "_"；单一签名里重名会让 .d.ts
      // 非法（tsc TS2300 Duplicate identifier），序号去重
      let n = 2;
      while (usedNames.has(`${name}${n}`)) n++;
      name = `${name}${n}`;
    }
    usedNames.add(name);
    // 各 case 元数不一致时，短 case 不传的尾部参数标可选，长调用短调用都放行
    const optional = i >= minArity && !name.startsWith("...");
    params.push(optional ? `${name}?: ${typeStr}` : `${name}: ${typeStr}`);
    paramNames.push(name);
    paramTypes.push(typeStr);
  }
  const combined = fn.combined ?? simplifyUnion(fn.cases.map((c) => c.result));
  const returnType = typeValueToTSType(widenTopLevel(combined));
  return { params, paramNames, paramTypes, returnType };
}

function generateJSDoc(fn: FunctionAnalysis, sig: MainSignature): string {
  if (fn.cases.length === 0) return "";
  const lines: string[] = ["/**"];
  // 精确 case 形状记录在主签名 JSDoc 而非生成精确重载。决策依据按实测修正
  // （tsc 5.9.3，最小 .d.ts + 调用文件 + tsc --noEmit）：字面量参数重载其实
  // 可达——「宽主签名在前则后置精确重载永不命中」不成立，新鲜与非新鲜
  // （as const 传入）字面量实参都会优先命中字面量参数重载，与声明顺序无关。
  // 即便如此仍只生成单一主签名：① --callsites 场景单个函数可合成几十个
  // case，逐 case 重载会让声明面爆炸；② throwing case 的 `: never` 重载对
  // 调用方是陷阱（对 never 取属性/运算直接报错）；③ 字面量精度由下面的
  // Case: 行完整保留。与主签名同形的 case（无信息损失）不罗列。
  for (const c of fn.cases) {
    const preciseDiffers =
      c.args.length !== sig.paramTypes.length ||
      c.args.some((a, i) => typeValueToTSType(a) !== sig.paramTypes[i]) ||
      typeValueToTSType(c.result) !== sig.returnType;
    if (!preciseDiffers) continue;
    const argsStr = c.args.map(typeValueToTSType).join(", ");
    lines.push(` * Case: ${c.name} (${argsStr}) => ${typeValueToTSType(c.result)}`);
  }
  for (let i = 0; i < sig.paramTypes.length; i++) {
    lines.push(` * @param ${sig.paramNames[i]} - ${sig.paramTypes[i]}`);
  }
  lines.push(` * @returns ${sig.returnType}`);
  lines.push(" */");
  return lines.join("\n");
}

/**
 * 为单个函数生成 .d.ts 声明行（JSDoc + 单一 widen 主签名）。
 * service 的 generateDts 与 CLI `--dts`（infer/watch）共用本函数，
 * 两条路径输出保持一致。
 */
export function generateFunctionDtsLines(fn: FunctionAnalysis): string[] {
  // CJS-style binding/assignment functions have no declaration-stable
  // export name; they stay in infer/JSON output only.
  if (fn.noDeclaration) return [];

  if (fn.cases.length === 0) {
    // skipped / entryOnly / 无 case 函数：只有声明或 combined 返回类型已知，
    // 保持历史行为——rest-args 形式，combined（含 Promise<T>）原样输出。
    if (fn.combined) {
      return [
        `export declare function ${fn.name}(...args: unknown[]): ${typeValueToTSType(fn.combined)};`,
      ];
    }
    return [];
  }

  const sig = computeMainSignature(fn);
  const jsdoc = generateJSDoc(fn, sig);
  const lines: string[] = [];
  if (jsdoc) lines.push(jsdoc);
  lines.push(`export declare function ${fn.name}(${sig.params.join(", ")}): ${sig.returnType};`);
  return lines;
}

export function generateDts(result: AnalysisResult): string {
  const lines: string[] = [];

  for (const fn of result.functions) {
    lines.push(...generateFunctionDtsLines(fn));
  }

  return lines.join("\n") + "\n";
}
