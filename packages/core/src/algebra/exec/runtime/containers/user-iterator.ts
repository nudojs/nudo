/**
 * 用户迭代器协议：GetIterator / next / return / 截断上界。
 *
 * 从 iterate.ts 抽出；spread / rest / for-of 的消费视图仍由 iterate 负责。
 */
import type { Abs } from "../../../abs.ts";
import { litValue, strLit, unknown } from "../../../abs.ts";
import { $arr } from "./arr-make.ts";
import {
  matchIterElements,
  registerUserIter,
  registerUserIterLen,
  replayGenDeferred,
  userIterOf,
} from "../../match-iter.ts";
import { getFnImpl } from "../../../abs-fn.ts";
import { classSpecOfAbs, lookupClassValue } from "../../class-registry.ts";
import { $call } from "../../call.ts";
import { $get } from "./member.ts";
import {
  NudoThrow,
  asAbsVal,
  litTruth,
  noBody,
  undef,
} from "../state.ts";
import { errorTypeAbs, recordMayThrow } from "../../may-throw.ts";

export const USER_ITER_MAX_STEPS = 1024;

/**
 * fn 值是否**真实现**（可驱动）。
 *
 * 引擎自建迭代器的 `@@iterator` 是**空体占位** fn（`absFunction([], { body:
 * noBody })`——无 apply、无真 body）；用户方法（`$fnVal` / 转译函数）有
 * apply 钩子或真 body。占位 fn 调出来是 undefined（不是迭代器）⇒ 不算
 * 用户 iterable。
 *
 * 不变量：`noBody` 是**全局唯一**占位 body 单例（`exec/runtime/state.ts` 与
 * `builtins/shared.ts` 共用同一对象）——按身份判「是否占位」才成立。此前两
 * 模块各有一份同形对象 ⇒ 身份比较对 builtins 侧建的占位恒失配 ⇒ 引擎原生
 * 迭代器（`abstractSeqIteratorAbs` 的 `@@iterator`）被误判为真实现 ⇒ 跑
 * 用户协议调占位 fn ⇒ 确定 TypeError（`[...Array.from('ab').keys()]` 假抛）。
 */
function hasRealImpl(fn: Abs): boolean {
  const impl = getFnImpl(fn);
  if (!impl) return false;
  if (typeof impl.apply === "function") return true;
  return !!impl.body && impl.body !== noBody;
}

/**
 * 用户 iterable 的 `@@iterator` 槽值（非用户 iterable → undefined）。
 *
 * 判据（与原生 GetMethod 一致）：接收者带**自有** `@@iterator` 槽 **且**
 * 引擎无其元素模型——生成器对象 / `$tpl` 标签对象 / 集合迭代器
 * （Array/Map/Set 的 values/keys/entries）/ matchAll 迭代器各有侧表 ⇒ 走
 * 既有消费路径（`$idx` peek / drain / 侧表切片），**不进**用户协议。
 */
export function userIteratorFn(a: Abs): Abs | undefined {
  if (matchIterElements(a) !== undefined) return undefined;
  const fn = $get(a, "@@iterator", { symbolKey: true });
  if (!fn || !hasRealImpl(fn)) return undefined;
  return fn;
}

/**
 * 用户迭代器协议采集：调 `@@iterator`（this = 接收者）拿迭代器 → 反复调
 * `next()`（this = 迭代器）→ 读结果对象的 `value` / `done` → 元素列表
 * （**迭代序**，不是索引序）。
 *
 * 返回 null = 非用户 iterable（调用方走既有 `$idx` / `$arrRest` 快速路径）。
 * `truncated` = 元素列表可能不完整（步数上界触顶 / `done` 抽象不可判）⇒
 * 尾域折 unknown（sound）。
 */
export function collectUserIterElems(
  a: Abs,
  maxSteps: number,
): { els: Abs[]; truncated: boolean } | null {
  const iterFn = userIteratorFn(a);
  if (!iterFn) return null;
  const limit = Math.max(0, Math.min(maxSteps, USER_ITER_MAX_STEPS));
  // GetIterator：调 @@iterator（this = 接收者）
  const iter = $call(iterFn, [], a);
  // Bug 199：登记迭代器对象——非正常退出（break/return/throw）的
  // IteratorClose（调 return()）按此取用。
  registerUserIter(a, iter);
  const els: Abs[] = [];
  let truncated = false;
  let exhausted = false;
  for (let i = 0; i < limit; i++) {
    const nextFn = $get(iter, "next");
    if (!hasRealImpl(nextFn)) {
      // 原生：iter.next 不可调用 → TypeError（引擎保守：may-throw + 尾域折
      // unknown——不因引擎建模缺口定抛假错）
      recordMayThrow({ kind: "TypeError", cause: "iterator has no callable next method" });
      truncated = true;
      break;
    }
    // IteratorNext：调 next()（this = 迭代器）读结果对象的 value / done
    const res = $call(nextFn, [], iter);
    if (res.shape.k !== "obj" && res.shape.k !== "brand") {
      recordMayThrow({ kind: "TypeError", cause: "iterator result is not an object" });
      truncated = true;
      break;
    }
    // done 语义 = ToBoolean（原生 Get(result, "done") 的真值判定）
    const dt = litTruth($get(res, "done"));
    if (dt !== false) {
      // done 为真 → 迭代结束；done 抽象（不可判）→ 保守停（尾域折 unknown）
      exhausted = dt === true;
      truncated = dt === undefined;
      break;
    }
    els.push($get(res, "value"));
  }
  // 步数上界触顶（未 done）⇒ 剩余元素个数不可知 → 折 unknown（sound）
  if (els.length >= limit && limit >= USER_ITER_MAX_STEPS) truncated = true;
  // Bug 199：迭代器报告 done ⇒ 元素数确切（for-of 迭代次数据此定 N 次，
  // 与原生同）；未耗尽 ⇒ 长度不可知 ⇒ 沿用 unbounded 单代表口径。
  registerUserIterLen(a, exhausted && !truncated ? els.length : undefined);
  return { els, truncated };
}

/**
 * 用户 iterable 的**迭代序**元素读取器（`$iterCheck` 返回值）：
 * - `get(i)`：第 i 个元素（迭代序）；越界 = 迭代已 done → exact undefined；
 *   列表被截断（truncated）→ unknown（sound）。
 * - `rest(i)`：从第 i 项起的剩余元素（原生 rest 语义：迭代到 done 为止）；
 *   截断 → unknown（剩余长度不可知）。
 */
export interface UserIterReader {
  get(i: number): Abs;
  rest(i: number): Abs;
}

/**
 * Bug 199：IteratorClose——对**用户迭代器**调 `return()`（原生规范：
 * ForIn/OfBodyEvaluation 的任何 abrupt completion，以及数组解构模式填满
 * 而迭代器未耗尽时，都触发 IteratorClose）。
 *
 * 规范细节（ECMA-262 IteratorClose / GetMethod）：
 * - 无 `return` 槽（GetMethod 得 undefined/null）⇒ 不调用（原生无副作用）。
 * - `return` 槽是**确定的非可调用值** ⇒ GetMethod 定抛 TypeError。
 * - `return()` 抛错 ⇒ 该抛错**取代**原完成值（break 被换成 throw）⇒ 冒泡。
 * - `return()` 的返回值**必须是对象**⇒ 否则原生定抛 TypeError（`return(){}`
 *   无返回值即抛——原生实测）。
 * - 抽象面（占位 fn / 不可判值）⇒ 不判定（不得凭空抛——引擎建模缺口
 *   不得折成原生定抛）。
 */
export function iteratorClose(iter: Abs | undefined): void {
  if (!iter) return;
  const ret = $get(iter, "return", { silent: true });
  if (!ret) return;
  const lit = ret.term?.op === "lit" ? (ret.term as { value: unknown }).value : undefined;
  if (ret.term?.op === "lit") {
    // GetMethod：undefined/null ⇒ 无 return 槽（不调用）
    if (lit === undefined || lit === null) return;
    // 确定的非可调用值 ⇒ GetMethod 定抛 TypeError
    if (typeof lit !== "function") throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // 抽象/占位 fn ⇒ 不判定（不得凭空抛）
  if (!hasRealImpl(ret)) return;
  const r = $call(ret, [], iter);
  // IteratorClose step 5：return() 的返回值必须是对象 ⇒ 否则定抛 TypeError
  if (r?.term?.op === "lit") {
    const v = (r.term as { value: unknown }).value;
    if (v === null || (typeof v !== "object" && typeof v !== "function")) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
}

/**
 * 数组解构模式接收者守卫 + **用户 iterable 迭代序元素读取器**。
 *
 * 两件事（同一调用，避免生成码再判一次接收者形态）：
 * ①守卫：原生数组解构 = GetIterator + IteratorNext，非可迭代接收者抛
 *   TypeError（definite）；抽象接收者记 may-throw。
 * ②返回用户 iterable（对象带自有 `@@iterator` 槽、引擎无其元素模型）的
 *   迭代序元素读取器；**非**用户 iterable → null ⇒ 调用方走既有 `$idx` /
 *   `$arrRest` 快速路径（tuple / 数组 / 字符串 / Set / Map / 生成器 /
 *   `$tpl` / 数组迭代器…逐字不变）。
 *
 * `maxElements`：本次最多取几个元素（原生按需取：模式有 n 个位置就取 n 个，
 * 空位也消耗一个）；缺省 / 负数 = 取到 done（受 USER_ITER_MAX_STEPS 上界约束）。
 */
