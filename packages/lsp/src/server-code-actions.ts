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
import { findFnContractInsertPos } from "./sidecar-insert.ts";
import { relaxSidecarConstraint } from "./a6-relax.ts";
import { extractToWorkspaceEdit, fullDocumentRange } from "./extract-function.ts";
import { inlineVariableAt, makeParamOptionalAt } from "./refactor-b2.ts";
import type { AgentToolDeps } from "./agent-tools.ts";
import { uriToFilePath } from "./validation.ts";
import { filePathToUri } from "./server-navigation.ts";

export type CodeActionDeps = {
  connection: Connection;
  getDocument: (uri: string) => TextDocument | undefined;
  isNudoFile: (uri: string) => boolean;
  agentToolDeps: AgentToolDeps;
};

export function attachCodeActions(deps: CodeActionDeps): void {
  const connection = deps.connection;
  const documents = { get: deps.getDocument };
  const isNudoFile = deps.isNudoFile;
  const agentToolDeps = deps.agentToolDeps;

connection.onCodeAction((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const actions = [];
  const source = document.getText();
  const lines = source.split("\n");
  const filePath = uriToFilePath(params.textDocument.uri);

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
    if (diag.code === "nudo:constraint-violated" || diag.code === "nudo:missing-slot") {
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
        const field = fieldPath.split(".").pop() ?? fieldPath;
        const line = diag.range.start.line;
        const lineText = lines[line] ?? "";
        // 调用点：单 `{` 行插入 field: undefined
        const braceCount = (lineText.match(/\{/g) ?? []).length;
        const braceCol = lineText.indexOf("{");
        if (braceCol >= 0 && braceCount === 1) {
          const insertAt = { line, character: braceCol + 1 };
          const snippet = lineText.slice(braceCol + 1).trimStart().startsWith("}")
            ? ` ${field}: undefined `
            : ` ${field}: undefined, `;
          actions.push({
            title: `Add missing field '${field}' to call`,
            kind: "quickfix",
            diagnostics: [diag],
            edit: {
              changes: {
                [params.textDocument.uri]: [{
                  range: { start: insertAt, end: insertAt },
                  newText: snippet,
                }],
              },
            },
          });
        }
        // A6：侧车 shape 补字段（同文件 *.nudo.js）
        const sidecarUri = filePathToUri(sidecarPathOf(filePath));
        const sidecarText = agentToolDeps.getOpenText?.(sidecarPathOf(filePath))?.text
          ?? (() => {
            try {
              return readFileSync(sidecarPathOf(filePath), "utf-8");
            } catch {
              return undefined;
            }
          })();
        if (sidecarText !== undefined) {
          const scLines = sidecarText.split("\n");
          // A6：只在目标 fn 自身的 `fn(` 调用括号内插入契约 `{`（P1）
          const fnName = typeof data.fn === "string" && data.fn ? data.fn : undefined;
          if (fnName) {
            const pos = findFnContractInsertPos(scLines, fnName);
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
      const relaxableCodes = new Set([
        "nudo:constraint-violated",
        "nudo:domain-exceeds",
        "nudo:interface-domain-exceeds",
        "constraint-violated",
        "contract",
      ]);
      // missing-slot 只补字段，不挂「放宽侧车」——避免剥掉无关数值谓词
      const codeStr = String(diag.code ?? "");
      const isMissingSlot =
        codeStr === "nudo:missing-slot" || codeStr === "missing-slot";
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
        const scText = agentToolDeps.getOpenText?.(sidecarPath)?.text
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
      });
    const sidecarPath = sidecarPathOf(filePath);
    const sidecarText = (() => {
      try {
        return (
          agentToolDeps.getOpenText?.(sidecarPath)?.text ??
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
        });
      } catch {
        continue;
      }
      if (!plan) continue;

      // unproven-return relax：补 a6-relax 的实际文本改写（review）
      if (
        code === "nudo:unproven-return" &&
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
