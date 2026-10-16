/**
 * LSP 表面 — 补全域。
 *
 * owns：getCompletionsAtPosition（成员补全 = Abs 接收者优先，变量补全 =
 * 绑定面）、内置成员唯一真值来源 builtinProtoMember(Names) 的补全投影
 * （promise / string / array / sum 成员交集）。补全 detail 走外延口径
 * （formatShape / formatAbs）。
 * 不 owns：绑定面求值与复用载荷（replay.ts 的 reuseBinding /
 * SurfaceReuse——直接 import 叶子模块）。
 */
import { formatAbs, formatShape, type Abs } from "@nudojs/core";
import { extractDirectivesQuiet, parse } from "@nudojs/parser";
import {
  builtinProtoMember,
  builtinProtoMemberNames,
  describeAbsMember,
} from "@nudojs/service/evaluator";
import {
  collectAbsBindingsFromGraph,
  mockDirectivesToAbsSeeds,
  type CompletionItem,
} from "@nudojs/service";
import { reuseBinding, type SurfaceReuse } from "./replay.ts";
export function getCompletionsAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  reuse?: SurfaceReuse,
): CompletionItem[] {
  const textBefore = getTextBeforePosition(source, line, column);
  const dotMatch = textBefore.match(/(\w+)\.\s*\w*$/);
  if (!dotMatch) return getVariableCompletions(filePath, source, reuse);

  const objName = dotMatch[1];

  // 成员补全的接收者解析用「尾点消毒」源码（与原 source 内容不同）；
  // reuse.ast 只对原文成立，这里保持独立 parse（parseSource 自带 LRU）
  let ast;
  try {
    ast = parse(sanitizeSourceForParsing(source));
  } catch {
    try {
      ast = parse(source);
    } catch {
      return [];
    }
  }

  // Abs 接收者优先：模块图绑定无损，不经 TypeValue evaluateProgram。
  // 空结果（unknown/never/fn 无属性）再落 TypeValue 兜底。
  if (reuse?.result) {
    // 同源绑定面：直接读 analyzeFile 的 bindings，不再整文件求值
    const bound = reuseBinding(reuse, objName);
    if (bound && bound.shape.k !== "unknown" && bound.shape.k !== "never") {
      const absCompletions = getCompletionsForAbs(bound);
      if (absCompletions.length > 0) return absCompletions;
    }
    return [];
  }
  try {
    const seeds = mockDirectivesToAbsSeeds(extractDirectivesQuiet(ast), { fromFile: filePath });
    const binds = collectAbsBindingsFromGraph(source, filePath, {
      seedVars: seeds.seedVars,
      seedFns: seeds.seedFns as never,
    });
    const bound = binds.get(objName);
    if (bound && bound.shape.k !== "unknown" && bound.shape.k !== "never") {
      const absCompletions = getCompletionsForAbs(bound);
      if (absCompletions.length > 0) return absCompletions;
    }
  } catch {
    /* fall through */
  }

  // TypeValue evaluateProgram 已删除：无 Abs 接收者 → 空
  return [];
}

function sanitizeSourceForParsing(source: string): string {
  return source.replace(/(\w+)\.\s*$/gm, "$1._ ");
}

function getTextBeforePosition(source: string, line: number, column: number): string {
  const lines = source.split("\n");
  if (line < 1 || line > lines.length) return "";
  return lines[line - 1].slice(0, column);
}

function getVariableCompletions(
  filePath: string,
  source: string,
  reuse?: SurfaceReuse,
): CompletionItem[] {
  if (reuse?.result) {
    // 同源绑定面（analyzeFile bindings）：不再 parse + 整文件求值
    const completions: CompletionItem[] = [];
    for (const [name, info] of reuse.result.bindings) {
      if (name.startsWith("__export_")) continue;
      completions.push({
        label: name,
        kind: info.abs.shape.k === "fn" ? "method" : "variable",
        detail: absDetail(info.abs),
      });
    }
    if (completions.length > 0) return completions;
    return [];
  }
  const ast = parse(source);

  // Abs 模块图绑定优先（无损；detail 经外延桥保持既有文案）
  try {
    const seeds = mockDirectivesToAbsSeeds(extractDirectivesQuiet(ast), { fromFile: filePath });
    const binds = collectAbsBindingsFromGraph(source, filePath, {
      seedVars: seeds.seedVars,
      seedFns: seeds.seedFns as never,
    });
    if (binds.size > 0) {
      const completions: CompletionItem[] = [];
      for (const [name, absVal] of binds) {
        if (name.startsWith("__export_")) continue;
        completions.push({
          label: name,
          kind: absVal.shape.k === "fn" ? "method" : "variable",
          detail: absDetail(absVal),
        });
      }
      if (completions.length > 0) return completions;
    }
  } catch {
    /* fall through */
  }

  // TypeValue evaluateProgram 已删除：无 Abs 绑定时返回空
  return [];
}

/**
 * 内置成员签名：直接读 BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS（唯一真值）。
 */
function builtinMemberAbs(className: string, member: string): Abs | null {
  return builtinProtoMember(className, member);
}

/**
 * 内置成员补全的唯一真值来源：求值器原型近似表。
 */
function builtinProtoMembers(className: string): string[] {
  return builtinProtoMemberNames(className);
}

/**
 * 成员 detail 的展示形态：内置方法优先取 Abs 签名
 * （formatAbs 渲染为 `(a: string) => boolean` 形式）；无签名
 * （未建模）时退回 `成员名(…)@<类>` 概要。
 */
function describeMember(label: string, a: Abs | null, fallbackClass: string): string {
  if (a) {
    const s = describeAbsMember(a);
    if (s) return s;
  }
  return `${label}(…)@${fallbackClass}`;
}

function getPromiseCompletions(): CompletionItem[] {
  return builtinProtoMembers("Promise").map((m) => ({
    label: m,
    kind: "method" as const,
    detail: describeMember(m, builtinMemberAbs("Promise", m), "Promise"),
  }));
}

function getStringCompletions(): CompletionItem[] {
  const completions: CompletionItem[] = [];
  for (const m of builtinProtoMembers("String")) {
    completions.push({
      label: m,
      kind: "method",
      detail: describeMember(m, builtinMemberAbs("String", m), "String"),
    });
  }
  completions.push({ label: "length", kind: "property", detail: "number" });
  return completions;
}

// ---------------------------------------------------------------------------
// Abs 接收者补全
// ---------------------------------------------------------------------------

/** Abs → 补全 detail（外延口径："1" / "number"） */
function absDetail(a: Abs): string {
  try {
    return formatShape(a);
  } catch {
    return formatAbs(a);
  }
}

function absIsFn(a: Abs): boolean {
  return a.shape.k === "fn";
}

/** Abs 接收者的成员补全；空数组表示该形态无可派生成员（调用方可回退） */
function getCompletionsForAbs(a: Abs): CompletionItem[] {
  const s = a.shape;
  switch (s.k) {
    case "obj": {
      const completions: CompletionItem[] = [];
      for (const [key, slot] of Object.entries(s.slots)) {
        completions.push({
          label: key,
          kind: absIsFn(slot.value) ? "method" : "property",
          detail: absDetail(slot.value),
        });
      }
      return completions;
    }
    case "brand":
      return getCompletionsForAbs(s.shape);
    case "sum":
      return getSumCompletions(s.members);
    case "tuple":
      // Abs 定长元组（含 path conf——map 同长/filter 子集和的臂成员）：length
      // 就是字面量长度。旧口径只放 exact 元组、path 元组回退 TypeValue 求宽
      // array——filter 的不确定谓词臂已是精确子序列和（长度集合诚实），
      // 不再需要按「假精确」熔断。
      return getArrayCompletionsAbs(s.elements.length);
    case "arr":
      return getArrayCompletionsAbs(undefined);
    case "eff":
      if (s.eff === "promise") return getPromiseCompletions();
      return [];
    case "prim":
      if (s.type === "string") return getStringCompletions();
      return [];
    default:
      // fn / never / unknown / any：无属性面
      return [];
  }
}

function getArrayCompletionsAbs(tupleLen?: number): CompletionItem[] {
  const completions: CompletionItem[] = [];
  for (const m of builtinProtoMembers("Array")) {
    const detail = describeMember(m, builtinMemberAbs("Array", m), "Array");
    completions.push({ label: m, kind: "method", detail });
  }
  completions.push({
    label: "length",
    kind: "property",
    detail: tupleLen !== undefined ? `${tupleLen}` : "number",
  });
  return completions;
}

/**
 * sum 接收者：各成员补全取交集（与 getUnionCompletions 同口径），
 * detail 为各成员该键类型字符串的并集渲染。
 */
function getSumCompletions(members: Abs[]): CompletionItem[] {
  if (members.length === 0) return [];
  const labelsByMember = members.map((m) => getCompletionsForAbs(m));
  const baseIdx = labelsByMember.findIndex((labels) => labels.length > 0);
  if (baseIdx === -1) return [];

  const common: CompletionItem[] = [];
  for (const base of labelsByMember[baseIdx]!) {
    let allPresent = true;
    const memberTypes: string[] = [base.detail ?? base.label];
    for (let i = 0; i < members.length; i++) {
      if (i === baseIdx) continue;
      const labels = labelsByMember[i]!;
      if (labels.length === 0) continue;
      const hit = labels.find((l) => l.label === base.label);
      if (!hit) {
        allPresent = false;
        break;
      }
      memberTypes.push(hit.detail ?? hit.label);
    }
    if (allPresent) {
      // 臂渲染去重：`[] | [1] | ["a"]` 的 length 臂 0|1|1|2 → 0|1|2
      common.push({ ...base, detail: [...new Set(memberTypes)].join(" | ") });
    }
  }
  return common;
}
