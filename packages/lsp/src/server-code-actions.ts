/**
 * 代码动作（quickfix / refactor）：自 server.ts 机械拆出；语义未改。
 */
import { readFileSync } from "node:fs";
import { sidecarPathOf, actionsForIssue, type CheckAction } from "@nudojs/core";
import {
  materializeAction,
  type QuickfixPlan,
} from "@nudojs/service/emit";
import type { Connection, CodeAction } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { parse } from "@nudojs/parser";
import type { File, ObjectExpression } from "@babel/types";
import { traverseEsm } from "./traverse-esm.ts";
import { findFnContractInsertPos } from "./sidecar-insert.ts";
import { relaxSidecarConstraint } from "./a6-relax.ts";
import { extractToWorkspaceEdit, fullDocumentRange } from "./extract-function.ts";
import { inlineVariableAt, makeParamOptionalAt } from "./refactor-b2.ts";
import type { AgentToolDeps } from "./agent-tools.ts";
import { uriToFilePath } from "./validation.ts";
import { filePathToUri } from "./server-navigation.ts";
import { DIAG } from "@nudojs/core/internal";

export type CodeActionDeps = {
  connection: Connection;
  getDocument: (uri: string) => TextDocument | undefined;
  isNudoFile: (uri: string) => boolean;
  /**
   * 延迟求值的依赖（server 注入 getter）：挂载期 `agentToolDepsRef.current` 仍是
   * `undefined`（server.ts 先建 ref、后回填）⇒ **每次使用点现取**，不许提前捕获。
   */
  agentToolDeps: AgentToolDeps | undefined;
};

export function attachCodeActions(deps: CodeActionDeps): void {
  const connection = deps.connection;
  const documents = { get: deps.getDocument };
  const isNudoFile = deps.isNudoFile;
  // Bug 735：`deps.agentToolDeps` 是**延迟求值的 getter**——挂载这一刻
  // `agentToolDepsRef.current` 还是 `undefined`（server.ts 的回填晚于
  // `attachCodeActions(...)`）⇒ 提前捕获成局部常量后，闭包里恒为
  // `undefined`，`agentToolDeps.getOpenText?.(...)` 在**可选链生效之前**就抛
  // TypeError ⇒ 整个 `textDocument/codeAction` 面全瘫（0 个 action）。
  // ⇒ 每次使用点现取 `deps.agentToolDeps`（并用 `?.` 兜住「还没回填」）。

connection.onCodeAction((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const actions = [];
  const source = document.getText();
  const filePath = uriToFilePath(params.textDocument.uri);
  // 本次请求的 AST（懒解析 + 缓存）：A6 的插入点定位走 AST（Bug 737），
  // 一条请求里多条诊断时**只解析一次**。
  let astCache: File | undefined;
  let astBroken = false;
  const getAst = (): File | undefined => {
    if (astBroken) return undefined;
    if (!astCache) {
      try {
        astCache = parse(source);
      } catch {
        astBroken = true;
      }
    }
    return astCache;
  };

  // Extract function（非空选区）
  const sel = params.range;
  const nonEmpty =
    sel.start.line !== sel.end.line || sel.start.character !== sel.end.character;
  if (nonEmpty) {
    try {
      const extracted = extractToWorkspaceEdit(source, sel, { name: "extracted" });
      if (extracted.ok) {
        actions.push({
          title: extracted.title,
          kind: "refactor.extract",
          edit: {
            changes: {
              [params.textDocument.uri]: [
                {
                  range: fullDocumentRange(source),
                  newText: extracted.newText,
                },
              ],
            },
          },
        });
      }
    } catch {
      /* extract is best-effort */
    }
  }

  // B2：内联变量（光标落在声明/init）
  try {
    const line = params.range.start.line + 1;
    const column = params.range.start.character;
    const inl = inlineVariableAt(source, line, column);
    if (inl && "edits" in inl) {
      actions.push({
        title: inl.title,
        kind: "refactor.inline",
        edit: { changes: { [params.textDocument.uri]: inl.edits } },
      });
    }
    const sig = makeParamOptionalAt(source, line, column);
    if (sig && "edits" in sig) {
      actions.push({
        title: sig.title,
        kind: "refactor.rewrite",
        edit: { changes: { [params.textDocument.uri]: sig.edits } },
      });
    }
  } catch {
    /* B2 is best-effort */
  }

  for (const diag of params.context.diagnostics) {
    if (diag.code === "nudo-unreachable") {
      actions.push({
        title: "Remove unreachable code",
        kind: "quickfix",
        diagnostics: [diag],
        edit: {
          changes: {
            [params.textDocument.uri]: [{
              range: diag.range,
              newText: "",
            }],
          },
        },
      });
    }
    // A6：缺 slot → 调用点插字段 + 侧车 shape 补字段
    if (diag.code === DIAG.constraintViolated || diag.code === DIAG.missingSlot) {
      const data = (diag.data ?? {}) as {
        expected?: string;
        actual?: string;
        suggestions?: string[];
        fn?: string;
      };
      const missing = typeof data.expected === "string"
        ? data.expected.match(/missing field\s+([\w.$]+)/) ?? data.expected.match(/([\w.$]+)\s*∈/)
        : null;
      if (missing) {
        const fieldPath = missing[1]!;
        // 缺字段路径：首段 = 形参名（`u.name` → `u`），其余段 = 形参 shape 内的
        // 嵌套字段路径（`u.addr.city` → `["addr","city"]`）
        const segments = fieldPath.split(".");
        const field = segments[segments.length - 1] ?? fieldPath;
        const param = segments.length > 1 ? segments[0]! : undefined;
        const shapePath = segments.slice(1);
        // 调用点：**AST** 定位实参对象字面量（行内 `indexOf("{")` 会把 `{` 认成
        // 字符串 / 模板串里的花括号 ⇒ 字段被插进字面量内部 —— Bug 737）
        const callSite = findCallArgObjectInsertPos(getAst(), diag.range.start);
        if (callSite) {
          // Bug 730：占位值**不许写 `undefined`**——它是「待填」的哑值，却会被
          // 当成合法值写进调用点（未填的字段因此不再被报）。`null` 是可编译的
          // 显式占位，且**不满足**被约束的契约（prim / shape / lit）⇒ 违规仍被
          // 报出（不会被悄悄放过），用户照诊断文案补真值即可。
          const snippet = callSite.empty
            ? ` ${field}: null `
            : ` ${field}: null, `;
          actions.push({
            title: `Add missing field '${field}' to call`,
            kind: "quickfix",
            diagnostics: [diag],
            edit: {
              changes: {
                [params.textDocument.uri]: [{
                  range: { start: callSite.pos, end: callSite.pos },
                  newText: snippet,
                }],
              },
            },
          });
        }
        // A6：侧车 shape 补字段（同文件 *.nudo.js）
        const sidecarUri = filePathToUri(sidecarPathOf(filePath));
        const sidecarText = deps.agentToolDeps?.getOpenText?.(sidecarPathOf(filePath))?.text
          ?? (() => {
            try {
              return readFileSync(sidecarPathOf(filePath), "utf-8");
            } catch {
              return undefined;
            }
          })();
        if (sidecarText !== undefined) {
          const scLines = sidecarText.split("\n");
          // A6：只在目标 fn 自身的契约 **shape 内部**插入字段（Bug 731：
          // 旧实现找 `fn(` 括号内第一层的 `{` = 形参表顶层 ⇒ 「往某个 shape
          // 里补字段」被执行成「往形参表里加一个形参」⇒ 契约被写坏）
          const fnName = typeof data.fn === "string" && data.fn ? data.fn : undefined;
          if (fnName && param && shapePath.length > 0) {
            const pos = findFnContractInsertPos(scLines, fnName, {
              param,
              path: shapePath,
            });
            if (pos) {
              const t = scLines[pos.line]!;
              const insert = t.slice(pos.character).trimStart().startsWith("}")
                ? ` ${field}: undefined `
                : ` ${field}: undefined, `;
              actions.push({
                title: `Add '${field}' to ${fnName} contract shape`,
                kind: "quickfix",
                diagnostics: [diag],
                edit: {
                  changes: {
                    [sidecarUri]: [{
                      range: {
                        start: { line: pos.line, character: pos.character },
                        end: { line: pos.line, character: pos.character },
                      },
                      newText: insert,
                    }],
                  },
                },
              });
            }
          }
        } else {
          actions.push({
            title: `Create sidecar draft with field '${field}'`,
            kind: "quickfix",
            diagnostics: [diag],
            command: {
              title: "nudo draft",
              command: "nudo.contract.draft",
              arguments: [params.textDocument.uri],
            },
          });
        }
      }

      // A6：契约违例 → 放宽侧车契约（仅 constraint 类诊断 + suggestion 命中）
      const sug = data.suggestions?.[0] ?? "";
      const loosen = sug.match(
        /Loosen the handwritten contract for\s+(\w+)\s*\((\w+):\s*([^)]+)\)/i,
      ) ?? sug.match(/放宽\s+(\w+)\s*的前置/) ?? sug.match(/改用满足\s+(.+?)\s*的/);
      const relaxableCodes = new Set<string>([
        DIAG.constraintViolated,
        // 不进 DIAG 注册表：从未发射的遗留宽松匹配名（无 glossary 锚点），
        // 仅为旧缓存诊断的兜底匹配保留字面量
        "nudo:domain-exceeds",
        DIAG.interfaceDomainExceeds,
        "constraint-violated",
        "contract",
      ]);
      // missing-slot 只补字段，不挂「放宽侧车」——避免剥掉无关数值谓词
      const codeStr = String(diag.code ?? "");
      const isMissingSlot =
        codeStr === DIAG.missingSlot || codeStr === "missing-slot";
      const canRelax =
        !isMissingSlot &&
        (loosen !== null ||
          (typeof data.fn === "string" &&
            data.fn.length > 0 &&
            (relaxableCodes.has(codeStr) ||
              /constraint|refine|contract/i.test(
                codeStr + String((data as { suggestions?: string[] }).suggestions?.join(" ") ?? ""),
              ))));
      if (canRelax && (loosen || data.fn)) {
        const fnName = data.fn ?? (loosen?.[1] || undefined);
        const param = loosen?.[2];
        const constraintText = loosen?.[3]?.trim();
        const sidecarPath = sidecarPathOf(filePath);
        const scText = deps.agentToolDeps?.getOpenText?.(sidecarPath)?.text
          ?? (() => {
            try {
              return readFileSync(sidecarPath, "utf-8");
            } catch {
              return undefined;
            }
          })();
        if (scText !== undefined && fnName) {
          const relaxed = relaxSidecarConstraint(scText, fnName, param, constraintText);
          if (relaxed && relaxed !== scText) {
            const scUri = filePathToUri(sidecarPath);
            const scLines = scText.split("\n");
            const last = scLines.length - 1;
            actions.push({
              title: `Relax sidecar contract for ${fnName}${param ? `.${param}` : ""}`,
              kind: "quickfix",
              diagnostics: [diag],
              edit: {
                changes: {
                  [scUri]: [{
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: last, character: scLines[last]?.length ?? 0 },
                    },
                    newText: relaxed,
                  }],
                },
              },
            });
          }
        }
      }
    }
  }

  // #69：action-map 物化 — kind → quickfix（标题区分 fix/silence/review）
  for (const diag of params.context.diagnostics) {
    const code = String(diag.code ?? "");
    if (!code.startsWith("nudo")) continue;
    const data = (diag.data ?? {}) as {
      fn?: string;
      expected?: string;
      actual?: string;
      suggestion?: string;
      reason?: string;
      actions?: CheckAction[];
    };
    const fn = data.fn;
    const acts =
      data.actions ??
      actionsForIssue({
        code,
        fn,
        expected: data.expected,
        suggestion: data.suggestion,
        reason: data.reason,
      });
    const sidecarPath = sidecarPathOf(filePath);
    const sidecarText = (() => {
      try {
        return (
          deps.agentToolDeps?.getOpenText?.(sidecarPath)?.text ??
          readFileSync(sidecarPath, "utf-8")
        );
      } catch {
        return undefined;
      }
    })();
    // entry-may-throw 的 throws 类型
    const throwsKind =
      data.suggestion?.match(/@nudo:throws\s+(\w+)/)?.[1] ??
      data.actual?.match(/throws\s+([A-Za-z]+)/)?.[1];

    for (const action of acts) {
      if (action.kind === "info") continue;
      let plan: QuickfixPlan | undefined;
      try {
        plan = materializeAction({
          code,
          fn,
          file: filePath,
          source,
          sidecarText,
          sidecarPath,
          action,
          throwsKind,
          expected: data.expected,
          suggestion: data.suggestion,
          reason: data.reason,
        });
      } catch {
        continue;
      }
      if (!plan) continue;

      // Bug 743：侧车计划若是**追加一条同名导出**（service 的 `next` 是追加
      // 语义：原侧车 + 新契约行），而侧车里**已经有**该 fn 的导出绑定 ⇒
      // 落盘后是**重复 export** ⇒ 侧车整体 SyntaxError ⇒ 侧车里**所有**契约
      // 一起失效（`nudo:interface-load`）⇒ 门禁从「有诊断」变成「装载失败」。
      // ⇒ 这种会把侧车写坏的计划**不下发**（宁可少一个 action，也不给一个
      // 落盘即损坏侧车的编辑）。service 的追加语义本族不改。
      if (plan.sidecar && fn && countSidecarExportBindings(plan.sidecar.newText, fn) > 1) {
        continue;
      }

      // unproven-return relax：补 a6-relax 的实际文本改写（review）
      if (
        code === DIAG.unprovenReturn &&
        action.kind === "relax" &&
        fn &&
        sidecarText !== undefined
      ) {
        const relaxed = relaxSidecarConstraint(sidecarText, fn, undefined, data.expected);
        if (relaxed && relaxed !== sidecarText) {
          const scUri = filePathToUri(sidecarPath);
          const scLines = sidecarText.split("\n");
          const last = scLines.length - 1;
          actions.push({
            title: plan.title,
            kind: "quickfix",
            diagnostics: [diag],
            edit: {
              changes: {
                [scUri]: [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: last, character: scLines[last]?.length ?? 0 },
                    },
                    newText: relaxed,
                  },
                ],
              },
            },
          });
        }
        continue;
      }

      const changes: Record<string, Array<{
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        newText: string;
      }>> = {};

      for (const e of plan.edits) {
        const uri = params.textDocument.uri;
        (changes[uri] ??= []).push({
          range: {
            start: { line: e.startLine, character: e.startCol },
            end: { line: e.endLine, character: e.endCol },
          },
          newText: e.newText,
        });
      }
      if (plan.sidecar) {
        const scUri = filePathToUri(plan.sidecar.path);
        let scSource = sidecarText ?? "";
        const scLines = scSource.split("\n");
        const last = Math.max(0, scLines.length - 1);
        (changes[scUri] ??= []).push({
          range: {
            start: { line: 0, character: 0 },
            end: { line: last, character: scLines[last]?.length ?? 0 },
          },
          newText: plan.sidecar.newText,
        });
      }

      if (Object.keys(changes).length === 0 && action.command) {
        actions.push({
          title: plan.title,
          kind: "quickfix",
          diagnostics: [diag],
          command: {
            title: plan.title,
            command: "nudo.contract.draft",
            arguments: [params.textDocument.uri],
          },
        });
        continue;
      }
      if (Object.keys(changes).length === 0) continue;

      actions.push({
        title: plan.title,
        kind: "quickfix",
        diagnostics: [diag],
        edit: { changes },
      });
    }
  }

  return actions;
});

}

/**
 * 侧车文本里 `export const <name> = …` 这样的导出绑定有几个。
 *
 * 用于 Bug 743 的守门：追加语义的侧车计划会把**同名绑定再声明一次** ⇒
 * 落盘后是重复 export ⇒ 侧车整体 SyntaxError。
 */
function countSidecarExportBindings(sidecarText: string, name: string): number {
  let ast: File;
  try {
    // errorRecovery：重复 export 是**语法错**（Babel 默认直接 throw ⇒ 拿不到
    // AST）⇒ 必须让解析器带着错误恢复跑完，才能数出「同一个名字声明了几次」
    ast = parse(sidecarText, { errorRecovery: true });
  } catch {
    return 0;
  }
  // 直接扫 program.body（不用 traverse：重复声明会让 Babel 的作用域登记抛错）
  let count = 0;
  for (const node of ast.program.body) {
    if (node.type !== "ExportNamedDeclaration") continue;
    const decl = node.declaration;
    if (!decl || decl.type !== "VariableDeclaration") continue;
    for (const d of decl.declarations) {
      if (d.id.type === "Identifier" && d.id.name === name) count++;
    }
  }
  return count;
}

/**
 * 调用点插入点：诊断所在调用的**对象字面量实参**的 `{` 之后一列。
 *
 * 旧实现是**行内文本启发式**（`indexOf("{")` + 行内 `{` 计数 == 1）：只要诊断
 * 所在行的第一个 `{` 落在字符串 / 模板串里，插入点就落进字面量内部
 * （Bug 737）—— 字段被插进 `"a{b"` 这种字符串里，源码语义被改坏。
 *
 * ⇒ 走 **AST**：取**包含诊断位置的最内层调用**，再取它的第一个对象字面量
 * 实参（没有对象实参 ⇒ 不提供该 quickfix，绝不猜位置）。
 */
function findCallArgObjectInsertPos(
  ast: File | undefined,
  diagPos: { line: number; character: number },
): { pos: { line: number; character: number }; empty: boolean } | null {
  if (!ast) return null;
  let hit: ObjectExpression | null = null;
  try {
    traverseEsm()(ast, {
      CallExpression(path) {
        const loc = path.node.loc;
        if (!loc) return;
        const startLine = loc.start.line - 1;
        const startCol = loc.start.column;
        const endLine = loc.end.line - 1;
        const endCol = loc.end.column;
        const afterStart =
          diagPos.line > startLine ||
          (diagPos.line === startLine && diagPos.character >= startCol);
        const beforeEnd =
          diagPos.line < endLine ||
          (diagPos.line === endLine && diagPos.character <= endCol);
        if (!afterStart || !beforeEnd) return;
        const obj = path.node.arguments.find((a) => a.type === "ObjectExpression");
        if (!obj || obj.type !== "ObjectExpression") return;
        // traverse 自顶向下 ⇒ 后命中的（更内层）覆盖先命中的
        hit = obj;
      },
    });
  } catch {
    return null;
  }
  // 回调里的赋值 TS 不跟踪 ⇒ 显式 cast 把窄化收回声明类型
  const obj = hit as ObjectExpression | null;
  const loc = obj?.loc;
  if (!obj || !loc) return null;
  return {
    pos: { line: loc.start.line - 1, character: loc.start.column + 1 },
    empty: obj.properties.length === 0,
  };
}
