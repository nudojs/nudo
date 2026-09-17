import type { Abs } from "@nudojs/core";
import {
  joinAbs,
  litValue,
  abs as makeAbs,
  isTemplateLike,
  templatePartsOf,
} from "@nudojs/core";
import type { AnalysisResult, CaseResult, FunctionAnalysis } from "./analyzer.ts";

// ---------------------------------------------------------------------------
// Abs → TS（dts 主路径）
//
// design-refine-derivation §12.1：`.d.ts` 优先源是 refine / Abs。
//
// widen 策略（参数逆变 / 返回协变），语义不变：
//   - 参数位：结构内字面量与收窄 pred 剥到基类型；同构元组 → array
//   - 返回位：仅顶层（含 sum 成员）标量字面量 → 基类型，嵌套精度保留
// ---------------------------------------------------------------------------

function wrapComplexAbs(a: Abs): string {
  const ts = absToTSType(a);
  if (a.shape.k === "sum") return `(${ts})`;
  return ts;
}

/** Abs → TS 类型串。有损：pred / 非 lit term 落到 shape 基类型。 */
export function absToTSType(a: Abs): string {
  if (a.term?.op === "lit") {
    const v = a.term.value;
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (a.shape.k === "prim") {
      if (typeof v === "string") return JSON.stringify(v);
      if (typeof v === "boolean") return String(v);
      if (typeof v === "number") return String(v);
    }
  }

  // 模板串：prim(string) + template pred
  if (a.shape.k === "prim" && a.shape.type === "string" && isTemplateLike(a)) {
    const parts = templatePartsOf(a);
    const inner = parts
      .map((p) => {
        const lv = litValue(p);
        if (typeof lv === "string") return lv;
        return `\${${absToTSType(p)}}`;
      })
      .join("");
    return `\`${inner}\``;
  }

  switch (a.shape.k) {
    case "never":
      return "never";
    case "unknown":
    case "any":
      return "unknown";
    case "prim":
      return a.shape.type;
    case "obj": {
      const entries = Object.entries(a.shape.slots).map(([k, slot]) => {
        // optional 槽与 TypeValue 桥接出口径一致：`k: T | undefined`，不用 `k?:`
        const inner = absToTSType(slot.value);
        if (slot.optional) {
          const t = slot.value.shape.k === "sum" ? `(${inner})` : inner;
          return `${k}: ${t} | undefined`;
        }
        return `${k}: ${inner}`;
      });
      if (entries.length === 0) return "{}";
      return `{ ${entries.join("; ")} }`;
    }
    case "arr":
      return `${wrapComplexAbs(a.shape.element)}[]`;
    case "tuple": {
      const inner = a.shape.elements.map(absToTSType).join(", ");
      return `[${inner}]`;
    }
    case "fn": {
      const params = a.shape.params.map((p) => `${p}: unknown`).join(", ");
      const ret = a.shape.returnType ? absToTSType(a.shape.returnType) : "unknown";
      return `(${params}) => ${ret}`;
    }
    case "brand":
      return a.shape.name;
    case "eff":
      if (a.shape.eff === "promise") return `Promise<${absToTSType(a.shape.inner)}>`;
      return absToTSType(a.shape.inner);
    case "sum": {
      // 并集成员按渲染串去重：widen 后可能出现 number | number；
      // never 是 join 单位元，对 .d.ts 返回位无意义。
      const parts = a.shape.members
        .map(absToTSType)
        .filter((p) => p !== "never");
      const uniq = [...new Set(parts)];
      if (uniq.length === 0) return "never";
      if (uniq.length === 1) return uniq[0]!;
      return uniq.join(" | ");
    }
    default:
      return "unknown";
  }
}

/** case 在参数位 i 的 Abs */
function caseArgAbs(c: CaseResult, i: number): Abs | undefined {
  return c.argAbs[i];
}

/** case 结果 Abs */
function caseResultAbs(c: CaseResult): Abs {
  return c.abs;
}

/**
 * 参数位（逆变）递归 widen：字面量/收窄 pred → 基类型，结构递归。
 * 同构元组 → array；null/undefined/never/unknown/fn 保持。
 */
function widenParamAbs(a: Abs): Abs {
  const s = a.shape;
  switch (s.k) {
    case "prim":
      return makeAbs(s, undefined, undefined, "exact");
    case "tuple": {
      const widened = s.elements.map(widenParamAbs);
      const first = widened[0];
      if (
        first &&
        widened.length > 0 &&
        widened.every((el) => absToTSType(el) === absToTSType(first))
      ) {
        return makeAbs({ k: "arr", element: first }, undefined, undefined, "exact");
      }
      return makeAbs({ k: "tuple", elements: widened }, undefined, undefined, "exact");
    }
    case "arr":
      return makeAbs({ k: "arr", element: widenParamAbs(s.element) }, undefined, undefined, "exact");
    case "obj": {
      const slots: Record<string, { value: Abs; optional?: boolean }> = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        slots[k] = {
          value: widenParamAbs(slot.value),
          ...(slot.optional ? { optional: true } : {}),
        };
      }
      return makeAbs({ k: "obj", slots }, undefined, undefined, "exact");
    }
    case "eff":
      return makeAbs(
        { k: "eff", eff: s.eff, inner: widenParamAbs(s.inner) },
        undefined,
        undefined,
        "exact",
      );
    case "brand":
      return makeAbs(
        { k: "brand", name: s.name, shape: widenParamAbs(s.shape) },
        undefined,
        undefined,
        "exact",
      );
    case "sum":
      return makeAbs(
        { k: "sum", members: s.members.map(widenParamAbs) },
        undefined,
        undefined,
        "exact",
      );
    default:
      return a;
  }
}

/** 返回位（协变）：仅顶层（含 sum 成员）标量字面量 → 基类型，嵌套精度保留 */
function widenTopLevelAbs(a: Abs): Abs {
  if (a.shape.k === "sum") {
    return makeAbs(
      { k: "sum", members: a.shape.members.map(widenTopLevelAbs) },
      undefined,
      undefined,
      a.conf,
    );
  }
  return widenLiteralToPrimAbs(a);
}

function widenLiteralToPrimAbs(a: Abs): Abs {
  if (a.term?.op === "lit" && a.term.value === null) return a;
  if (a.term?.op === "lit" && a.term.value === undefined) return a;
  if (a.term?.op === "lit" && a.shape.k === "prim") {
    const v = a.term.value;
    if (
      typeof v === "number" ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      typeof v === "bigint"
    ) {
      return makeAbs(a.shape, undefined, undefined, a.conf);
    }
  }
  return a;
}

/** 同参数位多 case 的 Abs join + 逆变 widen → TS 串 */
function paramTypeFromAbs(members: Abs[]): string {
  if (members.length === 0) return "unknown";
  let joined: Abs;
  try {
    joined = members.reduce((a, b) => joinAbs(a, b));
  } catch {
    joined = members[0]!;
  }
  return absToTSType(widenParamAbs(joined));
}

/** 返回位 Abs：combinedAbs 优先，否则 join case 结果 Abs */
function returnAbsOf(fn: FunctionAnalysis): Abs | undefined {
  if (fn.combinedAbs) return fn.combinedAbs;
  const results = fn.cases.map(caseResultAbs);
  if (results.length > 0) {
    try {
      return results.reduce((a, b) => joinAbs(a, b));
    } catch {
      /* fall through */
    }
    return results[0];
  }
  return undefined;
}

function getParamName(fn: FunctionAnalysis, index: number): string {
  if (fn.paramNames && fn.paramNames[index]) {
    return fn.paramNames[index];
  }
  return `arg${index}`;
}

// ---------------------------------------------------------------------------
// Widening —— 主签名语义（注释保留自 TypeValue 路径；实现已在 Abs 侧）
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
// ---------------------------------------------------------------------------

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
  const arity = Math.max(...fn.cases.map((c) => c.argAbs.length));
  const minArity = Math.min(...fn.cases.map((c) => c.argAbs.length));
  const params: string[] = [];
  const paramNames: string[] = [];
  const paramTypes: string[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < arity; i++) {
    const members: Abs[] = [];
    for (const c of fn.cases) {
      if (i >= c.argAbs.length) continue;
      const a = caseArgAbs(c, i);
      if (a) members.push(a);
    }
    const typeStr = paramTypeFromAbs(members);
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
  const retAbs = returnAbsOf(fn);
  const returnType = retAbs
    ? absToTSType(widenTopLevelAbs(retAbs))
    : "unknown";
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
  // Case: 行走 Abs 精确展示（字面量台账），不参与主签名计算。
  for (const c of fn.cases) {
    const preciseDiffers =
      c.argAbs.length !== sig.paramTypes.length ||
      c.argAbs.some((a, i) => absToTSType(a) !== sig.paramTypes[i]) ||
      absToTSType(c.abs) !== sig.returnType;
    if (!preciseDiffers) continue;
    const argsStr = c.argAbs.map(absToTSType).join(", ");
    lines.push(` * Case: ${c.name} (${argsStr}) => ${absToTSType(c.abs)}`);
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
    const retAbs = fn.combinedAbs;
    if (retAbs) {
      return [
        `export declare function ${fn.name}(...args: unknown[]): ${absToTSType(retAbs)};`,
      ];
    }
    return [];
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
