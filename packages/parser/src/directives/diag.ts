// ---------------------------------------------------------------------------
// 指令文法诊断（单一通道：显式 sink）
//
// extractDirectives(ast, { diags }) / extractInlineDirectives(node, { diags })
// 传入调用方自备的累积数组——诊断同步落袋，单次调用内同文案去重。
// 不传 diags 的纯查询形态（等价 extractDirectivesQuiet）直接丢弃诊断。
// 需要把「extract 之后的再解析」（如 mock 种子对 @nudo:mock 表达式的
// parseCaseArgExpr 复解析）并入同一去重域的调用方，用
// runWithDirectiveDiags(diags, fn) 包住 extract + 再解析整段。
//
// 历史注记：曾有模块级 side-channel（全局缓冲 + directiveDiagCount()/
// takeDirectiveDiags(Since) 序号锚排干），两轮并发偷诊断事故（R2B-003：
// 全量 take 在 await 窗口偷走在途诊断）均源于该全局态，已删除。
//
// 非法/边界形态的 case、mock、as、skip 输入不再静默丢弃：发 nudo:directive-syntax
// 显式诊断。产品原则与侧车加载一致（refine.ts）：「执行失败/导出形式不识别
// 不再静默吞错」——文法层同等对待。
// ---------------------------------------------------------------------------

/**
 * 指令文法诊断。
 *
 * `at`：**出错指令在源码中的位置**（行 1-based / 列 0-based）。
 *
 * Bug 848：去重身份此前只有 `code + message`（**无位置**）⇒ 同文件两处
 * **逐字相同**的畸形指令**塌缩成一条** ⇒ 第二处**完全不可见**（用户修好
 * 第一处后以为已经修完）。身份必须含位置：同一处同一问题仍去重（extract
 * + 再解析共域），**不同位置**的同文案问题各报一条。
 *
 * 不传 `at` 的调用点保持旧身份（`code + message`）——兼容未升级的调用方，
 * 但**同文案塌缩**在这些族上仍存在（见交付报告的「需收口」清单）。
 */
export type DirectiveDiag = {
  code: string;
  message: string;
  /** 出错指令的位置（行 1-based / 列 0-based）；缺省 ⇒ 旧身份（无位置） */
  at?: { line: number; column: number };
};

/** 显式诊断通道的调用内状态：单次 extract / scope 内生效（含同文案去重） */
type DiagSinkState = { list: DirectiveDiag[]; seen: Set<string> };
let activeDiagSink: DiagSinkState | null = null;

/**
 * 在指定诊断数组上执行 fn：fn 内所有指令文法诊断（含不传 diags 的 extract
 * 与再解析路径，如 @nudo:mock 表达式的 parseCaseArgExpr 复解析）落袋并共用
 * 同一去重域——用于「extract + 复解析」必须共享 seen 的窗口（nudojs check
 * 的 D1 段）。fn 内显式传 diags 的 extract 自成新去重域。
 */
export function runWithDirectiveDiags<T>(diags: DirectiveDiag[], fn: () => T): T {
  const prev = activeDiagSink;
  activeDiagSink = { list: diags, seen: new Set() };
  try {
    return fn();
  } finally {
    activeDiagSink = prev;
  }
}

export function emitDirectiveDiag(d: DirectiveDiag): void {
  // 无活动 sink 的纯查询路径：丢弃（hover/completion 等探测不得产诊断）
  if (!activeDiagSink) return;
  // Bug 848：身份 = 码 + 文案 + **位置**——同文案但不同位置的畸形指令各报一条
  // （同一处同一问题仍去重：位置相同 ⇒ 键相同 ⇒ 只报一次）。
  const at = d.at;
  const posKey = at ? `${at.line}:${at.column}` : "";
  const key = `${d.code}\0${d.message}\0${posKey}`;
  // seen 只在**单个 sink 域内**去重（同文件同文案不双报）。
  // 跨调用共享 seen 会同消息跨文件吞报（B 先 extract 后 A 丢报），也会让
  // 再次 extract 无法重新 emit（重分析饿死）。
  if (activeDiagSink.seen.has(key)) return;
  activeDiagSink.seen.add(key);
  activeDiagSink.list.push(d);
}

/**
 * 诊断位置——从 AST 节点 / 注释取（行 1-based / 列 0-based）。
 *
 * Bug 848 的配套件：各调用点把自己扫描的**出错指令所在节点/注释**交给本函数，
 * 再把结果作为 `at` 传给 `emitDirectiveDiag` ⇒ 去重身份含位置 ⇒ 同文件两处
 * 逐字相同的畸形指令**各报一条**（同一处同一问题仍只报一次）。
 *
 * 无 `loc`（非 Babel 注释 / 纯查询路径）⇒ undefined ⇒ 退回旧身份。
 */
export function directiveSiteOf(node: {
  loc?: { start?: { line?: number; column?: number } | null } | null;
} | null | undefined): { line: number; column: number } | undefined {
  const start = node?.loc?.start;
  if (!start) return undefined;
  if (typeof start.line !== "number" || typeof start.column !== "number") return undefined;
  return { line: start.line, column: start.column };
}

/**
 * extractDirectives 显式诊断通道 opts。
 *
 * `diags`：调用方自备的诊断累积数组——本次 extract 产生的指令文法诊断
 * 全部同步落袋，单次调用内同文案去重。不传时为纯查询形态：诊断丢弃
 * （等价 extractDirectivesQuiet）；若外层有 runWithDirectiveDiags 活动域，
 * 则落入该域并与其共享去重。
 */
export type ExtractDirectivesOpts = {
  diags?: DirectiveDiag[];
};
