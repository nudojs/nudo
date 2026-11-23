/**
 * dts 函数 JSDoc 生成：Case 见证 / @param / @returns / Contract 注记。
 *
 * 从 dts-generator 抽出；类型面仍由主签名决定，JSDoc 不改产物类型。
 */
import type { FunctionAnalysis } from "../analyzer.ts";
import { sanitizeCommentText } from "@nudojs/core/internal";
import { absToTSTypeIr } from "./dts-context.ts";
import { isNoInfoType } from "./dts-type-text.ts";
import type { DtsContractFace, MainSignature } from "./dts-generator.ts";

export function generateJSDoc(fn: FunctionAnalysis, sig: MainSignature): string {
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
    const argRenders = c.argAbs.map((a) => absToTSTypeIr(a));
    const resultRender = absToTSTypeIr(c.abs);
    // 无信息行（entry@ 兜底：全位 unknown / any）不占 JSDoc——签名位有
    // 契约/种子证据时它只会以 "=> unknown" / "=> any" 与主签名矛盾。
    // Abs 的 any（未约束）与 unknown（推断失败）分面后（Bug 544），两者
    // 都是「无信息」形态 ⇒ 一并抑制。
    if (argRenders.every(isNoInfoType) && isNoInfoType(resultRender)) {
      continue;
    }
    const preciseDiffers =
      c.argAbs.length !== sig.paramTypes.length ||
      argRenders.some((s, i) => s !== sig.paramTypes[i]) ||
      resultRender !== sig.returnType;
    if (!preciseDiffers) continue;
    const argsStr = argRenders.join(", ");
    // Case 名 / 类型串都可能含 `*/`、换行——注释体必须先清洗，否则提前闭合 JSDoc
    lines.push(` * Case: ${sanitizeCommentText(`${c.name} (${argsStr}) => ${resultRender}`)}`);
  }
  for (let i = 0; i < sig.paramTypes.length; i++) {
    lines.push(` * @param ${sanitizeCommentText(`${sig.paramNames[i]} - ${sig.paramTypes[i]}`)}`);
  }
  lines.push(` * @returns ${sanitizeCommentText(sig.returnType)}`);
  lines.push(" */");
  return lines.join("\n");
}

/**
 * ABS-03：契约可读注记（JSDoc）。**不改类型面**——契约的权威投影仍是
 * Abs（参数位 / 返回位）；这里只是把用户写的约束原文留给读者，
 * `Case:` 行继续只做调试见证，二者不互相冒充。
 */
export function contractJSDocLines(contract: DtsContractFace | undefined): string[] {
  if (!contract) return [];
  const rows: string[] = [];
  for (const p of contract.params) {
    if (p.display) {
      rows.push(` * Contract: ${sanitizeCommentText(`${p.name}: ${p.display}`)}`);
    }
  }
  if (contract.returnDisplay) {
    rows.push(
      ` * Contract: ${sanitizeCommentText(`return: ${contract.returnDisplay}`)}`,
    );
  }
  return rows.length > 0 ? ["/**", ...rows, " */"] : [];
}
