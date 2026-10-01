import type { Abs } from "@nudojs/core";
import { joinAbs, litValue, abs as makeAbs, collectAbsFreeVars } from "@nudojs/core";
import {
  isTemplateLike,
  templatePartsOf,
  escapeTemplateTypeFixed,
  formatObjectKey,
  isJsBindingIdent,
  sanitizeCommentText,
  ProjectionBudget,
} from "@nudojs/core/internal";
import type { AnalysisResult, CaseResult, FunctionAnalysis } from "../analyzer.ts";

// ---------------------------------------------------------------------------
// Abs → TS（dts 主路径）
//
// design-refine-derivation §12.1：`.d.ts` 优先源是 refine / Abs。
// C3.3 / design-hof-relations P5：有 hof 快照时投成泛型函数声明。
//
// widen 策略（参数逆变 / 返回协变），语义不变：
//   - 参数位：结构内字面量与收窄 pred 剥到基类型；同构元组 → array
//   - 返回位：仅顶层（含 sum 成员）标量字面量 → 基类型，嵌套精度保留
// ---------------------------------------------------------------------------

/** α / B:param → TS 类型参数名（`B:transform` → `B_transform`）。 */
function tsTypeParamName(id: string): string {
  let n = id.replace(/[^A-Za-z0-9_$]/g, "_");
  if (!/^[A-Za-z_$]/.test(n)) n = `T_${n}`;
  if (n.length === 0) n = "T";
  return n;
}

/** 函数类型 / 并集在数组元素、`| undefined` 等位置必须加括号（TS 优先级）。 */
function wrapComplexAbs(a: Abs, typeVars: Map<string, string> | undefined, budget: ProjectionBudget): string {
  const ts = absToTSTypeB(a, typeVars, budget);
  if (a.shape.k === "sum" || a.shape.k === "fn") return `(${ts})`;
  return ts;
}

/** 并集成员：函数类型必须括号，否则 `number | (x) => T` 非法（TS1385）。 */
function wrapUnionMember(a: Abs, typeVars: Map<string, string> | undefined, budget: ProjectionBudget): string {
  const ts = absToTSTypeB(a, typeVars, budget);
  if (a.shape.k === "fn") return `(${ts})`;
  return ts;
}

/**
 * 截断标记（DESIGN-001）：注释 + 基类型，任何类型位都是合法 TS 且可观测。
 * 模板插值位 unknown 不可插值（TS2322）→ string 变体；两个常量串不会与
 * 合法投影混淆（类型名不可能含 `/*`）。dts 无 dropped 台账——标记即观测。
 */
const TS_TRUNC = {
  cycle: "/* nudo:truncated:cycle */ unknown",
  depth: "/* nudo:truncated:depth */ unknown",
  cycleTpl: "/* nudo:truncated:cycle */ string",
  depthTpl: "/* nudo:truncated:depth */ string",
} as const;

/** 模板插值位换合法变体（unknown 不是可插值类型） */
function tsTplSafe(ts: string): string {
  if (ts === TS_TRUNC.cycle) return TS_TRUNC.cycleTpl;
  if (ts === TS_TRUNC.depth) return TS_TRUNC.depthTpl;
  return ts;
}

/** 成员声明里不能用保留字/非法标识符；空名与非 ident 落到 argN。 */
function sanitizeParamName(name: string, index: number): string {
  if (name.startsWith("...")) {
    const rest = name.slice(3);
    if (isJsBindingIdent(rest)) return name;
    return `...arg${index}`;
  }
  if (isJsBindingIdent(name)) return name;
  return `arg${index}`;
}

/** 对象字面量键：ident / 规范数字键可裸写，其余 JSON 引号（与 schema formatJsObjectKey 同口径）。 */
function formatPropKey(k: string): string {
  return formatObjectKey(k);
}

/**
 * Abs → TS 类型串。有损：pred / 非 lit term 落到 shape 基类型。
 * `typeVars`：term var id → TS 类型参数名（HOF 泛型投影时传入；
 * `any`+var 在此映射下渲染为该参数名，否则 `unknown`）。
 */
export function absToTSType(a: Abs, typeVars?: Map<string, string>): string {
  return absToTSTypeB(a, typeVars, new ProjectionBudget());
}

function absToTSTypeB(a: Abs, typeVars: Map<string, string> | undefined, budget: ProjectionBudget): string {
  // DESIGN-001：环 / 超深 shape 截断为显式标记（合法 TS，tsc 门可过）
  const stop = budget.enter(a);
  if (stop === "cycle") return TS_TRUNC.cycle;
  if (stop === "depth") return TS_TRUNC.depth;
  try {
    return absToTSTypeInner(a, typeVars, budget);
  } finally {
    budget.exit();
  }
}

function absToTSTypeInner(a: Abs, typeVars: Map<string, string> | undefined, budget: ProjectionBudget): string {
  // 类型变量：shape any + term var（α / B:param）
  if (a.shape.k === "any" && a.term?.op === "var" && typeVars) {
    const mapped = typeVars.get(a.term.id);
    if (mapped) return mapped;
  }
  // arr(element=any+var) → T[]
  if (
    a.shape.k === "arr" &&
    a.shape.element.shape.k === "any" &&
    a.shape.element.term?.op === "var" &&
    typeVars
  ) {
    const mapped = typeVars.get(a.shape.element.term.id);
    if (mapped) return `${mapped}[]`;
  }

  if (a.term?.op === "lit") {
    const v = a.term.value;
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (a.shape.k === "prim") {
      if (typeof v === "string") return JSON.stringify(v);
      if (typeof v === "boolean") return String(v);
      if (typeof v === "number") {
        // NaN/±Infinity 不是 TS 类型名；投影到基类型 number
        if (!Number.isFinite(v)) return "number";
        return String(v);
      }
    }
  }

  // 模板串：prim(string) + template pred
  if (a.shape.k === "prim" && a.shape.type === "string" && isTemplateLike(a)) {
    const parts = templatePartsOf(a);
    const inner = parts
      .map((p) => {
        const lvR = litValue(p);
        const lv = lvR.ok ? lvR.value : undefined;
        // 固定段是嵌入语言：`\` `` ` `` `$` 必须转义，否则 `${` 变成类型插值
        if (typeof lv === "string") return escapeTemplateTypeFixed(lv);
        return `\${${tsTplSafe(absToTSTypeB(p, typeVars, budget))}}`;
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
        const inner = absToTSTypeB(slot.value, typeVars, budget);
        if (slot.optional) {
          const t = wrapComplexAbs(slot.value, typeVars, budget);
          return `${formatPropKey(k)}: ${t} | undefined`;
        }
        return `${formatPropKey(k)}: ${inner}`;
      });
      if (entries.length === 0) return "{}";
      return `{ ${entries.join("; ")} }`;
    }
    case "arr":
      return `${wrapComplexAbs(a.shape.element, typeVars, budget)}[]`;
    case "tuple": {
      // hole 槽（`1 in a` 为 false）不得伪装成显式 undefined 元素。
      // TS 元组类型无空槽语法，用 labeled element `hole: T` 标出稀疏位。
      const holes = a.shape.holes ?? [];
      const parts = a.shape.elements.map((e, i) => {
        const ts = absToTSTypeB(e, typeVars, budget);
        return holes.includes(i) ? `hole: ${ts}` : ts;
      });
      if (a.shape.rest) {
        const rest = a.shape.rest;
        // rest 元素类型位与 arr 元素位同口径：union/fn 必须括号，
        // 否则 `...number | string[]` / `...(x) => T[]` 语义不同或非法
        const restTs =
          rest.shape.k === "arr"
            ? absToTSTypeB(rest, typeVars, budget)
            : `${wrapComplexAbs(rest, typeVars, budget)}[]`;
        parts.push(`...${restTs}`);
      }
      return `[${parts.join(", ")}]`;
    }
    case "fn": {
      const paramTypes = a.shape.paramTypes;
      const params = a.shape.params
        .map((p, i) => {
          const isRest = p.startsWith("...");
          const name = sanitizeParamName(p, i);
          const pt = paramTypes?.[i];
          let typeStr: string;
          if (pt) typeStr = absToTSTypeB(pt, typeVars, budget);
          else if (isRest) typeStr = "unknown[]";
          else typeStr = "unknown";
          return `${name}: ${typeStr}`;
        })
        .join(", ");
      const ret = a.shape.returnType
        ? absToTSTypeB(a.shape.returnType, typeVars, budget)
        : "unknown";
      return `(${params}) => ${ret}`;
    }
    case "brand":
      return isJsBindingIdent(a.shape.name) || /^[A-Z][A-Za-z0-9_$]*$/.test(a.shape.name)
        ? a.shape.name
        : "unknown";
    case "eff":
      if (a.shape.eff === "promise")
        return `Promise<${absToTSTypeB(a.shape.inner, typeVars, budget)}>`;
      return absToTSTypeB(a.shape.inner, typeVars, budget);
    case "sum": {
      // 并集成员按渲染串去重：widen 后可能出现 number | number；
      // never 是 join 单位元，对 .d.ts 返回位无意义。
      const parts = a.shape.members
        .map((m) => wrapUnionMember(m, typeVars, budget))
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
function widenParamAbs(a: Abs, budget: ProjectionBudget = new ProjectionBudget()): Abs {
  // DESIGN-001：环 / 超深时原样返回（widen 是尽力精度剥离，不是正确性必需）；
  // 渲染侧 absToTSType 的预算会在同位置给出显式截断标记。
  const stop = budget.enter(a);
  if (stop) return a;
  try {
    return widenParamAbsInner(a, budget);
  } finally {
    budget.exit();
  }
}

function widenParamAbsInner(a: Abs, budget: ProjectionBudget): Abs {
  const s = a.shape;
  switch (s.k) {
    case "prim":
      return makeAbs(s, undefined, undefined, "exact");
    case "tuple": {
      const widened = s.elements.map((el) => widenParamAbs(el, budget));
      // rest 槽必须透传/并入：`[1, ...string]` 不得塌成 `number[]`（拒绝合法值）
      const widenedRest = s.rest ? widenParamAbs(s.rest, budget) : undefined;
      const holes = s.holes;
      const first = widened[0];
      // holes 必须透传：洞/显式 undefined 是可观察不同的（`in` / Object.keys），
      // 同构退化成 array 会把稀疏位抹平成稠密元素。
      // rest 参与同构判定：只有 rest 元素与固定位同型时才退化（`[1, ...number]` → number[]）。
      if (
        !holes?.length &&
        first &&
        widened.length > 0 &&
        widened.every((el) => absToTSType(el) === absToTSType(first)) &&
        (!widenedRest || absToTSType(widenedRest) === absToTSType(first))
      ) {
        return makeAbs({ k: "arr", element: first }, undefined, undefined, "exact");
      }
      return makeAbs(
        {
          k: "tuple",
          elements: widened,
          ...(widenedRest ? { rest: widenedRest } : {}),
          ...(holes?.length ? { holes: [...holes] } : {}),
        },
        undefined,
        undefined,
        "exact",
      );
    }
    case "arr":
      return makeAbs({ k: "arr", element: widenParamAbs(s.element, budget) }, undefined, undefined, "exact");
    case "obj": {
      const slots: Record<string, { value: Abs; optional?: boolean }> = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        slots[k] = {
          value: widenParamAbs(slot.value, budget),
          ...(slot.optional ? { optional: true } : {}),
        };
      }
      return makeAbs({ k: "obj", slots }, undefined, undefined, "exact");
    }
    case "eff":
      return makeAbs(
        { k: "eff", eff: s.eff, inner: widenParamAbs(s.inner, budget) },
        undefined,
        undefined,
        "exact",
      );
    case "brand":
      return makeAbs(
        { k: "brand", name: s.name, shape: widenParamAbs(s.shape, budget) },
        undefined,
        undefined,
        "exact",
      );
    case "sum":
      return makeAbs(
        { k: "sum", members: s.members.map((m) => widenParamAbs(m, budget)) },
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
    const isRest = name.startsWith("...");
    const bare = isRest ? name.slice(3) : name;
    if (!isJsBindingIdent(bare)) {
      name = isRest ? `...arg${i}` : `arg${i}`;
    }
    if (usedNames.has(name)) {
      // 解构/模式参数在 AST 提取时都叫 "_"；单一签名里重名会让 .d.ts
      // 非法（tsc TS2300 Duplicate identifier），序号去重
      let n = 2;
      while (usedNames.has(`${name}${n}`)) n++;
      name = `${name}${n}`;
    }
    usedNames.add(name);
    // 各 case 元数不一致时，短 case 不传的尾部参数标可选，长调用短调用都放行
    const optional = i >= minArity && !isRest;
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
  // 即便如此仍只生成单一主签名：① --from 场景单个函数可合成几十个
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
    const argsStr = c.argAbs.map((a) => absToTSType(a)).join(", ");
    // Case 名 / 类型串都可能含 `*/`、换行——注释体必须先清洗，否则提前闭合 JSDoc
    lines.push(` * Case: ${sanitizeCommentText(`${c.name} (${argsStr}) => ${absToTSType(c.abs)}`)}`);
  }
  for (let i = 0; i < sig.paramTypes.length; i++) {
    lines.push(` * @param ${sanitizeCommentText(`${sig.paramNames[i]} - ${sig.paramTypes[i]}`)}`);
  }
  lines.push(` * @returns ${sanitizeCommentText(sig.returnType)}`);
  lines.push(" */");
  return lines.join("\n");
}

/**
 * C3.3：从 hof 快照构造 TS 泛型主签名。
 * design-hof-relations §7：fnRels/entryShapes 的 α / B:param → 泛型参数。
 *
 * 策略（避免抢走更精确的 case-widen）：
 * - 无 case（entryOnly / 纯 HOF）→ 用泛型；
 * - 有 case 时，仅当 **所有** HOF 提升形参在 case-widen 下仍是 unknown
 *   才用泛型——`reduceSum([1..5])` 这类 concrete case 的 `number[]`
 *   优于 `A1[]`，继续走 case-widen。
 * 无可用关系时返回 undefined。
 */
function computeHofSignature(
  fn: FunctionAnalysis,
):
  | {
      typeParams: string[];
      params: string[];
      paramNames: string[];
      paramTypes: string[];
      returnType: string;
    }
  | undefined {
  const hof = fn.hof;
  if (!hof) return undefined;
  const byParam = new Map<string, Abs>();
  for (const s of hof.entryShapes ?? []) byParam.set(s.param, s.abs);
  for (const r of hof.fnRels ?? []) byParam.set(r.param, r.abs);
  if (byParam.size === 0 && !hof.symbolic) return undefined;

  // 有 case 时：HOF 提升位若已有非 unknown 外延，让位给 case-widen
  if (fn.cases.length > 0) {
    for (const [param] of byParam) {
      const idx = fn.paramNames.indexOf(param);
      if (idx < 0) continue;
      const caseType = paramTypeFromAbs(
        fn.cases.map((c) => c.argAbs[idx]).filter((a): a is Abs => !!a),
      );
      if (caseType !== "unknown" && caseType !== "unknown[]") {
        return undefined;
      }
    }
  }

  const arity = Math.max(
    fn.paramNames.length,
    ...[...(byParam.keys())].map((p) => fn.paramNames.indexOf(p) + 1),
    0,
  );
  if (arity === 0 && !hof.symbolic) return undefined;

  // 收集签名位上的自由变元（复用 L2 collectAbsVars）
  const free = new Set<string>();
  for (const a of byParam.values()) {
    for (const id of collectAbsFreeVars(a)) free.add(id);
  }
  const retAbs = hof.symbolic ?? fn.combinedAbs;
  if (retAbs) {
    for (const id of collectAbsFreeVars(retAbs)) free.add(id);
  }
  if (free.size === 0) return undefined;

  // α / B:param → 稳定 TS 名；同名冲突加序号
  const typeVars = new Map<string, string>();
  const used = new Set<string>();
  const typeParams: string[] = [];
  for (const id of [...free].sort()) {
    let n = tsTypeParamName(id);
    if (used.has(n) || !isJsBindingIdent(n)) {
      let i = 2;
      while (used.has(`${n}${i}`)) i++;
      n = `${n}${i}`;
    }
    used.add(n);
    typeVars.set(id, n);
    typeParams.push(n);
  }

  const params: string[] = [];
  const paramNames: string[] = [];
  const paramTypes: string[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < arity; i++) {
    const rawName = getParamName(fn, i);
    const isRest = rawName.startsWith("...");
    let name = sanitizeParamName(rawName, i);
    if (usedNames.has(name)) {
      let n = 2;
      while (usedNames.has(`${name}${n}`)) n++;
      name = isRest && name.startsWith("...") ? `...${name.slice(3)}${n}` : `${name}${n}`;
    }
    usedNames.add(name);
    const promoted = byParam.get(fn.paramNames[i] ?? rawName) ?? byParam.get(rawName);
    const typeStr = promoted
      ? absToTSType(promoted, typeVars)
      : isRest
        ? "unknown[]"
        : "unknown";
    params.push(`${name}: ${typeStr}`);
    paramNames.push(name);
    paramTypes.push(typeStr);
  }
  const returnType = retAbs ? absToTSType(retAbs, typeVars) : "unknown";
  return { typeParams, params, paramNames, paramTypes, returnType };
}

/**
 * 为单个函数生成 .d.ts 声明行（JSDoc + 单一 widen 主签名）。
 * 有 hof 关系时优先泛型投影（C3.3）；否则 case-widen。
 * service 的 generateDts 与 CLI `--dts`（infer/watch）共用本函数，
 * 两条路径输出保持一致。
 */
export function generateFunctionDtsLines(fn: FunctionAnalysis): string[] {
  // CJS-style binding/assignment functions have no declaration-stable
  // export name; they stay in infer/JSON output only.
  // Class.method：投影为 Class_method（core 侧车可绑定同名），不再静默丢弃
  let emitFn = fn;
  if (fn.noDeclaration) {
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(fn.name);
    if (!m) return [];
    emitFn = { ...fn, name: `${m[1]}_${m[2]}`, noDeclaration: false };
  }
  fn = emitFn;

  const hofSig = computeHofSignature(fn);
  if (hofSig) {
    const lines: string[] = [];
    if (fn.cases.length > 0) {
      const jsdoc = generateJSDoc(fn, {
        params: hofSig.params,
        paramNames: hofSig.paramNames,
        paramTypes: hofSig.paramTypes,
        returnType: hofSig.returnType,
      });
      if (jsdoc) lines.push(jsdoc);
    }
    const tparams =
      hofSig.typeParams.length > 0 ? `<${hofSig.typeParams.join(", ")}>` : "";
    lines.push(
      `export declare function ${fn.name}${tparams}(${hofSig.params.join(", ")}): ${hofSig.returnType};`,
    );
    return lines;
  }

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
