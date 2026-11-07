/**
 * 临时名分配 / this 载体名 / 语句发射状态袋（transpile helper 叶）。
 *
 * 模块级状态全部收敛于本文件：
 * - userIdentCache（BoundedLruMap(64)：源文本 → 用户标识符信息）；
 * - DEFAULT_STMT_EMIT（非根直调兜底的共享默认袋，含可变计数器）。
 *
 * thisCarrierOf 与临时名同叶：载体名经 internalTmpName 分配（跨域调用 ⇒
 * 合入同一叶）。避让口径：源文本词形 ∪ opts.userIdents（保守超集，
 * Bug 181 / 1058 / 1059——撞名 ⇒ 重复声明 SyntaxError 或遮蔽用户绑定）。
 */
import type { TranspileOptions, StmtEmitState } from "../types.ts";
import { BoundedLruMap } from "../../../key/lru-map.ts";

/**
 * Bug 181：源文本里的**用户标识符**信息（临时名避让用）。
 *
 * 转译器发的解构临时名（`_d{n}` / `_n{n}` / `_p{i}` / `_rest{i}` /
 * `_pd{i}`）此前不带任何避让：用户自己声明了同名标识符时，生成码出现
 * `const _d0`（用户已有 `let _d0`）⇒ **重复声明 SyntaxError** ⇒ 整个
 * 模块求值失败 ⇒ 全模块导出退化为 unknown（假 opaque-result）；另一面，
 * 函数体里的 `const _d0` 会**遮蔽**模块级同名用户绑定 ⇒ 用户读到错值。
 *
 * 口径：收集源文本里出现过的**全部标识符词形**（保守超集——含属性名、
 * 字符串与注释里的词形）。临时名只需避开用户名字，超集落在安全侧。
 */
export interface UserIdentInfo {
  /** 源文本里出现过的标识符词形（保守超集） */
  names: Set<string>;
  /** 用户占用的 `_d{n}` / `_n{n}` 序号最大值（-1 = 无占用） */
  tmpSeqMax: number;
}

const EMPTY_USER_IDENT: UserIdentInfo = { names: new Set<string>(), tmpSeqMax: -1 };

/** 源文本 → 用户标识符信息（按源文本缓存：同一模块只扫一次）。
 *  有界 LRU（容量 64，与旧「满 64 整表 clear」同上限）：大仓分析后驻留
 *  可预测，且近期模块的缓存不再被整表清空重扫。 */
const userIdentCache = new BoundedLruMap<UserIdentInfo>(64);

export function userIdentInfo(source: string | undefined): UserIdentInfo {
  if (!source) return EMPTY_USER_IDENT;
  const hit = userIdentCache.get(source);
  if (hit) return hit;
  const names = new Set<string>();
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) names.add(m[0]);
  let tmpSeqMax = -1;
  for (const name of names) {
    const hitSeq = /^_[dn](\d+)$/.exec(name);
    if (!hitSeq) continue;
    const idx = Number(hitSeq[1]);
    if (idx > tmpSeqMax) tmpSeqMax = idx;
  }
  const info: UserIdentInfo = { names, tmpSeqMax };
  // 超限时 LRU 淘汰最旧键（BoundedLruMap 内建），不再整表 clear
  userIdentCache.set(source, info);
  return info;
}

/**
 * Bug 181：把共享的解构临时名计数器**推过**用户占用的 `_d{n}` / `_n{n}`
 * 序号。计数器是 statement.ts 的 `_d{n}` 与 emit.ts 的 `_n{n}` 共用的
 * （`n++`），推过后两族名都不再与用户标识符相撞。
 */
export function bumpDestrTmpSeq(seq: { n: number }, info: UserIdentInfo): void {
  if (info.tmpSeqMax < 0) return;
  if (seq.n <= info.tmpSeqMax) seq.n = info.tmpSeqMax + 1;
}

/**
 * 词形集 → `_d{n}` / `_n{n}` 序号最大值（-1 = 无占用）。
 * 与 `userIdentInfo` 的同名计算同口径（供**合并**后的避让集复用）。
 */
export function tmpSeqMaxOf(names: ReadonlySet<string>): number {
  let max = -1;
  for (const name of names) {
    const hitSeq = /^_[dn](\d+)$/.exec(name);
    if (!hitSeq) continue;
    const idx = Number(hitSeq[1]);
    if (idx > max) max = idx;
  }
  return max;
}

/**
 * 避让集 = 源文本词形 ∪ 调用方补给的词形（`opts.userIdents`）。
 *
 * 无补充词形时**原样返回**源文本信息（产物逐字不变）；有补充时并集重算
 * `_d{n}` / `_n{n}` 序号上限（解构临时名计数器同口径）。
 */
export function userIdentInfoOf(opts: TranspileOptions): UserIdentInfo {
  const info = userIdentInfo(opts.source);
  const extra = opts.userIdents;
  if (!extra || extra.size === 0) return info;
  const names = new Set<string>(info.names);
  for (const n of extra) names.add(n);
  return { names, tmpSeqMax: Math.max(info.tmpSeqMax, tmpSeqMaxOf(extra)) };
}

/**
 * Bug 181：取一个不与用户标识符相撞的临时名（base 为期望基名）。
 * 撞名时加数字后缀（`_p0` → `_p0_1`）——形参占位名不能改形（签名面按位对齐）。
 */
export function safeTmpName(base: string, info: UserIdentInfo): string {
  if (!info.names.has(base)) return base;
  let k = 1;
  while (info.names.has(`${base}_${k}`)) k++;
  return `${base}_${k}`;
}

/**
 * Bug 1058 / Bug 1059：引擎**内部临时名**必须**避开用户标识符**。
 *
 * 引擎为转译生成的内部绑定（`arguments` 槽 `__nudoArgs` / try 标记
 * `__nudoTm_{n}` / catch 载体 `__nudoE_{n}` / try 内 return 载体 `__nudoRet`
 * / 写回载体 `__mutRet` / 函数体 catch 载体 `__nudoFnRet` …）此前一律用
 * **固定名**发射 ⇒ 用户源码里写了同名标识符时两种失效形态都成立：
 * - **同作用域重复词法声明** ⇒ 产物不是合法 JS ⇒ `new Function` 编译期
 *   SyntaxError ⇒ 求值器 fail-closed（**整模块**导出退化 unknown + 假
 *   `nudo:opaque-result` ⇒ 门禁假绿）；
 * - **内层遮蔽**用户同名外层绑定 ⇒ 初始化器自引用 ⇒ TDZ ReferenceError ⇒
 *   被用户自己的 catch 吞掉 ⇒ 原生值被算成别的值（wrong-exact）。
 *
 * 口径：`userIdentInfo(source).names` 是**源文本里出现过的全部标识符词形**
 * （保守超集）⇒ 避让在**整个转译单元**生效（不做作用域分析——用户在内层
 * 作用域声明的名字也会遮蔽外层生成的临时名）⇒ 生成名与用户标识符**词形**
 * 永不相撞。命名 `<base>_<k>`（k 从 1 起跳过已占用名）——与 Bug 181 的
 * `safeTmpName` 同款且**确定性**（同一源文本 ⇒ 同一名 ⇒ 产物逐字可重现；
 * 缓存键 / 差分语料依赖它）。**无碰撞时原名返回** ⇒ 产物逐字不变。
 *
 * 配对义务：内部名**生成与使用必须同名**（词法槽 / 载体名）⇒ 调用点要把
 * 算出的名字**存成局部变量**再同时用在声明与引用处，不得各处各算一次
 * （同源文本下两次计算结果相同，但存变量更抗后续改动）。
 */
export function internalTmpName(base: string, opts: TranspileOptions): string {
  return safeTmpName(base, userIdentInfoOf(opts));
}

/**
 * Bug 1160：this 载体名（跨发射器共享的**单一来源**）。
 *
 * 载体协议：真函数体 prologue 声明 `let <名> = $rawThis(this)`；类/对象
 * 方法、访问器 thunk、字段 / 静态块 thunk 把 `<名>` 作宿主首参——声明方与
 * `thisParam` 读方必须同名。根转译单元（`transpileFile` / `transpileBodyNode`）
 * 在入口经 `internalTmpName("__this", opts)` 分配一次并写入 `opts.thisSlot`；
 * 各发射器一律经本函数取同一名（不各自现算）。表达式级公面入口
 * （`transpileExpression(expr, {})`）无根分配 ⇒ 按同口径现算（确定性：
 * 同源文本 ⇒ 同名）。**无碰撞时基名 `__this` 原样返回 ⇒ 产物逐字不变。**
 */
export function thisCarrierOf(opts: TranspileOptions): string {
  return opts.thisSlot ?? internalTmpName("__this", opts);
}

/**
 * Bug 1127：批量分配内部临时名（**同款避让口径**，一次算避让集）。
 *
 * 与 `internalTmpName` 同口径（`userIdentInfoOf(opts)` = 源文本词形 ∪
 * `opts.userIdents`），但：
 * - 避让集**只算一次**（逐个调 `internalTmpName` 会把避让集重算 n 次——
 *   `opts.userIdents` 非空时每次都重建并集）；
 * - 同一批内**互不撞名**（不同 base 避让后可能落到同一个名字——`<base>_<k>`
 *   形态下 `X` 与 `X_1` 两族可撞）⇒ 组内去重（`taken` 集）。
 *
 * 确定性：同一 opts ⇒ 同一批名（同序）⇒ 产物逐字可重现。
 */
export function internalTmpNameSet(bases: readonly string[], opts: TranspileOptions): string[] {
  const info = userIdentInfoOf(opts);
  const taken = new Set<string>();
  const out: string[] = [];
  for (const base of bases) {
    let name = safeTmpName(base, info);
    let k = 1;
    while (taken.has(name)) {
      name = safeTmpName(`${base}_${k}`, info);
      k++;
    }
    taken.add(name);
    out.push(name);
  }
  return out;
}

/** 语句发射序号袋的单元初值（各计数器从 0 起；标签栈空） */
export function newStmtEmitState(): StmtEmitState {
  return {
    switchBodySeq: 0,
    switchBreakSeq: 0,
    curSwitchBreakLabel: null,
    forInRecvSeq: 0,
    forLoopVarSeq: 0,
  };
}

/**
 * 非根入口（不经 transpileFileDetailed / transpileBodyNode 的直调，如
 * 表达式入口 `transpileExpression` 内的箭头块体）兜底的共享默认袋——
 * 保留旧模块级 let 的跨调用行为（发射器只读 opts 透传，不各自新建：
 * 新建会让嵌套语句（switch 臂内的 break 读标签）各自拿到独立袋 ⇒ 标签
 * 丢失）。根转译单元一律自建新袋（确定性：同源 ⇒ 同产物），不触本表。
 */
const DEFAULT_STMT_EMIT: StmtEmitState = newStmtEmitState();

/** 语句发射单元状态的取用口（根单元经 opts 线程化；非根直调落共享默认袋） */
export function stmtEmitStateOf(opts: TranspileOptions): StmtEmitState {
  return opts.stmtEmit ?? DEFAULT_STMT_EMIT;
}
