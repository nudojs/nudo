/**
 * nudo test — 观察主报告面 + 声明断言（design-cli-semantics §1.1）。
 *
 * - 默认打印全部 case（含合成 call@/entry@）——这就是调用点观察
 * - 仅 `@nudo:case` 且带 `=> expected` 进入 pass/fail；失败才影响 exit
 * - **引擎未能推断**实测值（`unknown` / `conf=opaque`）⇒ 记 unchecked
 *   （Bug 950 第三态：无法判定 ⇒ 既不是失败，也不是空洞通过）
 * - `--freeze[=update]`：见证固化，仍在 test 名下
 *
 * 报告本体（类型 / buildTestReport / formatTestReport / ENTRY_CONTRACT_NOTE）
 * 的**唯一实现在 service**（`@nudojs/service` 的 `test-report.ts`，CLI 文本面
 * 与 agent JSON 面同一实现）。本文件曾是 CLI 侧平行副本，且已漂移两处
 * （caseLines 容器缩进 BUG-136 / 期望渲染带谓词 Bug 207）⇒ 去重后此处只
 * **再导出**，供既有消费路径（`commands/test.ts`、lsp 的
 * `lsp-bug-136-witness-line-parity.test.ts`）按原路径取同一份实现。
 * 本文件保留 CLI 专属职责：entry@ × 有效契约的注解判定（entryContractNoteFns）。
 */
import { dirname } from "node:path";
import {
  effectiveInterface,
  interfaceDiagCount,
  takeInterfaceDiagsSince,
} from "@nudojs/core";
import {
  defaultLoadModule,
  findProjectConfig,
  interfaceConfig,
  type AnalysisResult,
} from "@nudojs/service";

export {
  buildTestReport,
  formatTestReport,
  ENTRY_CONTRACT_NOTE,
  type CaseTestOutcome,
  type TestReport,
  type TestReportOptions,
} from "@nudojs/service";

/**
 * 计算 entry@ case 区块尾需要契约注解的函数名集（仅同文件 functions；
 * external 函数的契约绑定在定义模块，不在本面）。判定与 check 门禁同口径：
 * effectiveInterface 返回 handwritten（侧车手写绑定 ∪ 源码 @nudo:contract）；
 * `@generated` 段是事实快照不执法，不触发注解。无契约函数（真 entry-only
 * 回退）不在集内——那是普通回退，不是矛盾。
 */
export function entryContractNoteFns(
  filePath: string,
  source: string,
  result: AnalysisResult,
): Set<string> {
  const candidates = result.functions.filter(
    (fn) => !fn.skipped && fn.cases.some((c) => c.name.startsWith("entry@")),
  );
  if (candidates.length === 0) return new Set();
  // 配置同源 check（commands/check.ts loadCheckCache）：autoBind 关闭 /
  // 树外侧车不参与契约判定
  const proj = findProjectConfig(dirname(filePath));
  const autoBind = interfaceConfig(proj?.config).autoBind;
  const fns = new Set<string>();
  for (const fn of candidates) {
    const since = interfaceDiagCount();
    try {
      const eff = effectiveInterface(source, fn.name, {
        loadModule: defaultLoadModule,
        fromFile: filePath,
        ...(autoBind === false ? { autoBind: false } : {}),
        ...(proj?.projectDir ? { projectDir: proj.projectDir } : {}),
      });
      if (eff?.source === "handwritten") fns.add(fn.name);
    } catch {
      /* optional: 契约解析失败按无契约处理（不注解） */
    } finally {
      // 探测诊断就地排干（工具面惯例），不滞留 interface 诊断通道
      takeInterfaceDiagsSince(since);
    }
  }
  return fns;
}
