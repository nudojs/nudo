import type { Pred } from "./pred.ts";

/**
 * 合取原子展平（递归）。
 *
 * 合取**可结合**：`and(and(A,B),C)` ≡ `and(A,B,C)`。但合取读侧历来只扫
 * **顶层** `and.args`（`buildCtx` / `collectBoundsFromPhi` /
 * `collectExclusionsFromPhi` / `impliesNotTypeof` …）——嵌套一层的
 * `and` 原子对它们**不可见** ⇒ Φ 里的事实被静默丢弃 ⇒ 蕴含关系证不出。
 *
 * 真实触发（族 06 Bug 333/335 引入 typeof 类型义务后）：入口 Φ 由
 * 「每形参一条契约谓词」合成，而每条谓词本身是 `and(typeof x, ge(x,0))`
 * ⇒ Φ = `and(and(…), and(…))` ⇒ `ge(max,1)` 藏在第二层 ⇒
 * `implies(Φ, ne(max,0))` 证不出 ⇒ `max === 0 ? … : …` 的死臂没被剪掉
 * ⇒ 签名退化成 `1 | number`（族 06 回归，verify-examples 抓到的红项）。
 *
 * 展平是**读侧**修正：不动任何已构造谓词的形状 ⇒ 展示串 / `predEquals`
 * / 缓存键零漂移。
 */
export function conjAtoms(p: Pred): Pred[] {
  if (p.op === "and") {
    const out: Pred[] = [];
    for (const q of p.args) out.push(...conjAtoms(q));
    return out;
  }
  return [p];
}
