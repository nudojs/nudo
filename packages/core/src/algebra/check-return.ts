/**
 * 返回契约对账（`check.ts` 的 L1 通道）——族 07 片 S4 抽出（**内部模块**）。
 *
 * 四条修复都落在本模块（它们在旧 `check.ts` 里同属一个函数 ⇒ 物理切不开）：
 * - **#367**：审计归因从「函数上**有没有**这条引理」改成「**本次证明真正消费过**
 *   哪条引理」。消费集由代数核在引理消费点记账（`assume-ledger.ts`），
 *   check 面回传；**记账不参与判定**（不改 prove / disprove 逻辑）。
 * - **#369 / #372**：issue 构造处补 `line` / `column`（被违约函数的声明位置）
 *   ⇒ LSP / vite / GHA / GitLab / JSON 机器面不再兜底到第 1 行。
 * - **#378**：文案反映**真实约束来源**（源码 `@nudo:contract return` 指令 vs
 *   侧车 `fn()` 返回槽）——侧车来源不再被说成「源码里那条指令」。
 * - **#1094**：返回点的**路径前提 Φ**（`audit.phi`）透传给证明通道；Φ 侧
 *   只按「同项 ∧ 蕴含」计入证据面 ⇒ Φ 只能把「证不出」升级成「已证明」，
 *   **绝不**制造「确定违约」（假红）。Φ 真的被依赖时，构成 Φ 的前提记进
 *   引理账本 ⇒ `nudo:assume-relied` 归因可见（公理不得被静默消费）。
 *
 * 零新增公共导出：本模块只被 `check.ts` 相对导入，不进任何 barrel
 * （`algebra/index.ts` / `core/src/index.ts` / `internal.ts` 均无新增）。
 */
import type { Abs } from "./abs.ts";
import type { NudoConstraint } from "./constraint.ts";
import type { CheckIssue } from "./check-report.ts";
import type { Phi, Pred } from "./pred.ts";
import { assertImplies, phiSuppliesConstraint } from "./postcondition.ts";
import { assumeConsumed, noteAssumeConsumed } from "./assume-ledger.ts";
import { formatAbs } from "./format.ts";
import { formatConstraint } from "./interface.ts";
import { DIAG } from "./diag-codes.ts";

/**
 * 返回约束的**来源**（#378）：
 * - `directive` = 源码里的 `@nudo:contract return <name>` 指令；
 * - `sidecar` = 侧车 `fn({...}, <ret>)` 的返回槽（源码里**没有**那条指令）。
 */
export type ReturnContractSource = "directive" | "sidecar";

/**
 * 对账的审计上下文（缺省字段 = 零行为变化）。
 *
 * `loc` 口径与 core 其它 issue 一致：**line 1 基**（Babel `loc.start.line`）、
 * **column 0 基**（Babel `loc.start.column`）；消费面各自换算
 * （LSP 走 `lspDiagnosticRange`，CI 注解走 `check-report.ts`）。
 */
export type ReturnContractAudit = {
  /** 被违约函数的声明位置 */
  loc?: { line?: number; column?: number };
  /** 约束来源（缺省 = 源码指令口径） */
  source?: ReturnContractSource;
  /** `@nudo:assume` 引理展示串（函数上声明的全部**合法**前提） */
  assumeDisplay?: readonly string[];
  /** `@nudo:invariant` 循环界展示串 */
  invariantDisplay?: readonly string[];
  /**
   * 本次证明**实际消费过**的 `@nudo:assume` 引理展示串（#367 记账集）。
   * 缺省 = 未知 ⇒ 不宣称依赖；给出 = 只宣称集合内的引理。
   */
  consumedAssume?: ReadonlySet<string>;
  /**
   * 返回点的**路径前提**（Φ）——证明通道的 Φ 侧（Bug 1080）。
   *
   * 缺省 = 无路径前提（`pTrue`）：证据面只有 `ret.pred`（值域事实）。
   *
   * ⚠ 只放**约束返回项本身**的关系事实（守卫界 / 补集臂）：与返回项无关的
   * 前提（如 `if (x > 0) return y` 里的 `x > 0`）**不构成**返回值的值域
   * 证据——证明通道按「同项」口径消费（见 `postcondition.ts` 的同项判定），
   * 不得用无关证据把「证不出」升级成「确定违约」（假红）。
   *
   * Bug 1094：Φ 侧计入证据面的条件再收紧一档 = 同项 ∧ **蕴含**该约束的
   * pred ⇒ Φ 只能把「证不出」升级成「已证明」，**绝不**制造「确定违约」。
   */
  phi?: Phi;
  /**
   * Φ 的构成前提对象（`@nudo:assume` 引理）——**记账用**（对象身份即引理
   * 身份，与 `assume-ledger.ts` 的去重口径一致）。
   *
   * 与 `assumeDisplay` **同序**（第 i 条 display 对应第 i 条 premise）。
   * Φ 真的被证明**依赖**时（去掉 Φ 就证不出），命中的前提记进账本 ⇒
   * `nudo:assume-relied` 归因可见——用户公理不得被静默消费。
   */
  phiPremises?: readonly Pred[];
};

/**
 * 返回契约对账：声明的返回约束 vs 推断/实测的返回 Abs。
 *
 * - `proved` ⇒ 只上审计标注（公理依赖面）；**归因只认真正消费过的引理**（#367）。
 * - `disproved` ⇒ error（`nudo:constraint-violated`）。
 * - `unprovable` ⇒ warning（`nudo:unproven-return`）——不得伪装成功。
 */
export function checkReturnConstraint(
  fnName: string,
  cName: string,
  constraint: NudoConstraint,
  ret: Abs,
  audit: ReturnContractAudit = {},
): CheckIssue[] {
  const {
    loc,
    source = "directive",
    assumeDisplay,
    invariantDisplay,
    consumedAssume,
    phi,
    phiPremises,
  } = audit;
  // Bug 1080：Φ 侧（返回点路径前提）进证明通道——证据面 = ret.pred ∧ Φ 的
  // 「同项」界事实（与被约束项无关的前提事实不得制造确定违约）。
  // Bug 1094：Φ 侧只按「同项 ∧ 蕴含」计入 ⇒ Φ 只能把「证不出」升级成
  // 「已证明」，绝不制造「确定违约」（假红）。
  const proof = assertImplies(ret, constraint, phi ? { phi } : undefined);
  // Bug 1094：**Φ 依赖判定 + 记账**——去掉 Φ 就证不出 ⇒ 本次证明依赖路径
  // 前提 ⇒ 把命中的前提记进账本（对象身份）⇒ 归因面（nudo:assume-relied）
  // 可见：用户公理不得被静默消费。
  //
  // ⚠ 这次记账是**活写**：归因面在下方就地读账本（读在写之后）⇒ 命中的前提
  // 真的进 `nudo:assume-relied`。早前版本的归因集取自调用方传入的调用**前**
  // 快照 ⇒ 这里的写入读不到（死写）⇒ 账本与归因两套口径。
  const phiUsedIdx = new Set<number>();
  if (phi && proof.status === "proved" && phiPremises && phiPremises.length > 0) {
    const withoutPhi = assertImplies(ret, constraint);
    if (withoutPhi.status !== "proved") {
      // 逐条定位「哪条前提真的产出了界」：单独蕴含该约束的那条；单条都不够
      // （靠合取才成立）⇒ 全部记上（宁可多记，也不得静默消费公理）。
      const solo = phiPremises.filter((p) =>
        phiSuppliesConstraint(p, constraint, ret),
      );
      const used = solo.length > 0 ? solo : [...phiPremises];
      for (const p of used) noteAssumeConsumed(p);
      phiPremises.forEach((p, i) => {
        if (used.includes(p)) phiUsedIdx.add(i);
      });
    }
  }
  // #369 / #372：issue 构造处带位置（函数声明位置）⇒ 消费面不再兜底首行
  const where = (): { line?: number; column?: number } => {
    if (loc?.line === undefined) return {};
    return loc.column === undefined ? { line: loc.line } : { line: loc.line, column: loc.column };
  };
  // #378：约束来源标签——侧车 `fn()` 返回槽 ≠ 源码里的 `@nudo:contract` 指令
  const origin =
    source === "sidecar"
      ? `sidecar fn() return slot (${cName})`
      : `@nudo:contract return ${cName}`;
  if (proof.status === "proved") {
    // #152/#176 审计分层：assume / invariant 都是用户公理（引擎不验证其
    // 真实性）——依赖了公理的证明必须上屏可见。
    // #367：粒度从「函数级（声明了就算）」收紧到「**本次证明消费过**」
    // （消费集由代数核在引理消费点记账 ⇒ 只认真产出了界的那条引理）。
    // Bug 1094：Φ 侧消费的前提同样进归因集（公理不得被静默消费）。
    // 归因集 = **引理账本**（assume-ledger.ts）真正消费过的前提 ∪ Φ 侧命中的
    // 前提（phiUsedIdx 兜底）∪ 调用方传入的快照（consumedAssume）。
    //
    // ⚠ 账本取数必须在**本次 Φ 消费记账之后**：Φ 侧的 `noteAssumeConsumed`
    // 写入发生在上面的证明段里，而调用方传入的 `consumedAssume` 快照取自
    // 调用**之前** ⇒ 早取会把 Φ 侧的写入读丢（账本写入成了死写）。
    // ⇒ 这里就地取账本（读在写之后），账本才是"消费过"的唯一事实源。
    const ledgerUsedIdx = new Set<number>();
    if (assumeDisplay && phiPremises) {
      const consumed = assumeConsumed();
      for (let i = 0; i < assumeDisplay.length; i++) {
        const premise = phiPremises[i];
        if (premise !== undefined && consumed.includes(premise)) ledgerUsedIdx.add(i);
      }
    }
    const relied: CheckIssue[] = [];
    const usedAssume = (assumeDisplay ?? []).filter(
      (d, i) =>
        consumedAssume?.has(d) === true || ledgerUsedIdx.has(i) || phiUsedIdx.has(i),
    );
    if (usedAssume.length > 0) {
      relied.push({
        severity: "info",
        code: DIAG.assumeRelied,
        message: `${fnName}: return contract proved via @nudo:assume ${usedAssume.join("; ")}`,
        actual: `proof relies on user lemma${usedAssume.length > 1 ? "s" : ""}`,
        expected: "engine verifies the obligation, not the lemma itself",
        suggestion:
          "@nudo:assume is a user-supplied axiom — falsify it with concrete @nudo:case runs (nudo test)",
        fn: fnName,
        ...where(),
      });
    }
    if (invariantDisplay && invariantDisplay.length > 0) {
      relied.push({
        severity: "info",
        code: DIAG.invariantRelied,
        message: `${fnName}: return contract proved via @nudo:invariant ${invariantDisplay.join("; ")}`,
        actual: `proof relies on user invariant${invariantDisplay.length > 1 ? "s" : ""}`,
        expected: "engine verifies the obligation, not the loop invariant itself",
        suggestion:
          "@nudo:invariant is a user-supplied axiom — falsify it with concrete @nudo:case runs (nudo test)",
        fn: fnName,
        ...where(),
      });
    }
    return relied;
  }
  const push = (
    severity: "error" | "warning",
    actual: string,
    expected: string,
    suggestion: string,
  ): CheckIssue[] => [
    {
      severity,
      code: severity === "error" ? DIAG.constraintViolated : DIAG.unprovenReturn,
      message: `${fnName}: return value ⊭ ${origin}`,
      actual,
      expected,
      suggestion,
      fn: fnName,
      ...where(),
    },
  ];
  if (proof.status === "disproved") {
    return push(
      "error",
      formatAbs(ret),
      proof.reason,
      proof.reason.includes("nullish")
        ? `use nullable(${formatConstraint(constraint)}) or union(..., lit(null)) to allow nullish returns`
        : `return a value satisfying ${formatConstraint(constraint)}`,
    );
  }
  // unprovable：any / unknown=推断失败 / opaque —— 不得伪装成功（warning 可见）
  // 也不得计 error（gold FP 门禁：opaque/截断误报是已知禁区）
  return push(
    "warning",
    formatAbs(ret),
    formatConstraint(constraint),
    `${proof.reason}; add a precondition, narrow the return expression, or relax the return contract`,
  );
}
