/**
 * 代码动作（quickfix / refactor）：自 server.ts 机械拆出；语义未改。
 */
import { readFileSync } from "node:fs";
import {
  checkSource,
  interfaceTierOf,
  localNamedExports,
  pTrue,
  sidecarPathOf,
  actionsForIssue,
  absToConstraint,
  formatConstraint,
  type Abs,
  type CheckAction,
} from "@nudojs/core";
import {
  materializeAction,
  type QuickfixPlan,
} from "@nudojs/service/emit";
import { defaultLoadModule } from "@nudojs/service";
import type { Connection, CodeAction } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { parse } from "@nudojs/parser";
import type { File, Node, ObjectExpression, ObjectProperty } from "@babel/types";
import { traverseEsm } from "./traverse-esm.ts";
import { findFnContractInsertPos } from "./sidecar-insert.ts";
import { relaxSidecarConstraint, relaxSidecarReturnToSurface } from "./a6-relax.ts";
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
      // BUG-201：**只认「缺字段」诊断形态**。「值/类型不满足」（`u.v ∈ lit(1)`）
      // 是**另一个语义** —— 复用「补字段」会在字段**已经存在**时再插一个同名键
      // （重复键 ⇒ 消费端 tsc --strict 报 TS1117），且对被报的违规毫无作用
      // （重跑 check 仍是同一条 `u.v ∈ lit(1)`）。`∈` 文案一律不走这条路径。
      const missing = typeof data.expected === "string"
        ? data.expected.match(/missing field\s+([\w.$]+)/)
        : null;
      if (missing) {
        const fieldPath = missing[1]!;
        // 缺字段路径：首段 = 形参名（`u.name` → `u`），其余段 = 形参 shape 内的
        // 嵌套字段路径（`u.addr.city` → `["addr","city"]`）
        const segments = fieldPath.split(".");
        const field = segments[segments.length - 1] ?? fieldPath;
        const param = segments.length > 1 ? segments[0]! : undefined;
        const shapePath = segments.slice(1);
        // 形参身份（BUG-263）：诊断消息形如 `greet[b]: argument ⊭ precondition`
        // ⇒ 违例落在形参 `b` 上；同一文件里能定位到被调函数的形参表时，
        // **只**取第 n 个实参（不猜位置）。判不出 ⇒ 交给插入点按「唯一对象
        // 字面量实参」口径裁决（多实参时**不下发**）。
        const paramIndex = param && typeof data.fn === "string" && data.fn
          ? formalIndexOfFn(getAst(), data.fn, param)
          : undefined;
        // 调用点：**AST** 定位实参对象字面量（行内 `indexOf("{")` 会把 `{` 认成
        // 字符串 / 模板串里的花括号 ⇒ 字段被插进字面量内部 —— Bug 737）
        // BUG-202：按诊断的嵌套路径**逐级下钻**（`u.addr.city` ⇒ 落到 `addr` 里）；
        // BUG-201：目标对象**已有**该键 ⇒ 不插（不造重复键）。
        const callSite = findCallArgObjectInsertPos(getAst(), diag.range.start, {
          ...(paramIndex !== undefined ? { paramIndex } : {}),
          path: segments.slice(1, -1),
          existingField: field,
        });
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
          // BUG-237：「Create sidecar draft」只能承诺**生成草稿**——它没有
          // 「补某个字段」的能力（`nudo.contract.draft` 的参数契约里没有 field），
          // 且草稿生成器**按设计跳过手写契约函数**（`@nudo:contract` /
          // `@nudo:import` 模板）⇒ 对这类函数下发「with field 'x'」必然空转
          // （标题说谎 + 建议不可执行）。跨模块诊断同理：`data.fn` 住**别的
          // 模块**，按本文件生成的草稿里既没有被调方也没有那个字段。
          // ⇒ 只在「目标函数是本文件的**代码优先**导出」时下发，并按命令面
          // 既有的位置参数形态带上目标函数名；标题**不再**承诺字段。
          const fnName = typeof data.fn === "string" && data.fn ? data.fn : undefined;
          if (fnName && isCodeFirstExport(source, filePath, fnName)) {
            actions.push({
              title: `Create sidecar draft for ${fnName} (add field '${field}' manually)`,
              kind: "quickfix",
              diagnostics: [diag],
              command: {
                title: "nudo draft",
                command: "nudo.contract.draft",
                arguments: [params.textDocument.uri, fnName],
              },
            });
          }
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
        // BUG-133：目标槽必须能**唯一确定**。诊断文案不匹配那三条 `loosen`
        // 正则时（`add the missing field u.name` / `use a value satisfying
        // u > 0, or relax the precondition on u`），旧实现传 `param = undefined`
        // ⇒ 替换器顺序落到 **`tryReturnSlot`** ⇒ 改的是**返回槽**：参数诊断
        // 原样保留、返回契约被静默削弱（`number().gt(40)` → `number()`）。
        // ⇒ 从诊断本身推导被违反的形参（路径首段 / "precondition on u"）。
        const param = loosen?.[2] ?? violatedParamOf(data);
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
          // 验证门（BUG-133 / BUG-134）：改写后的侧车必须**真的**消掉目标
          // 函数的 constraint-violated / entry-may-throw，否则不下发——
          // 「只剥数值谓词」对**基类型冲突**（`string ⊭ number`）与**参数
          // 缺字段**根本无能为力 ⇒ 那样的动作只是「做了但没用」的假修复
          // （用户点完 diff 出现、诊断一条不少）。
          if (
            relaxed &&
            relaxed !== scText &&
            sidecarRelaxClearsTarget({
              filePath,
              source,
              sidecarPath,
              sidecarText: relaxed,
              fnName,
              ...(deps.agentToolDeps?.loadModule
                ? { loadModule: deps.agentToolDeps.loadModule }
                : {}),
            })
          ) {
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
      //
      // BUG-135：标题（service 的 `[review] Relax return contract for g to
      // inferred surface`）与 CLI 的机器可读 action 文案都承诺「放宽到
      // **推断面**」⇒ 落盘必须是推断面。旧实现走 `relaxSidecarConstraint`
      // ⇒ 只**剥数值谓词** ⇒ 落盘 `number()`（基类型）：既不是推断面，
      // 也**消不掉** `nudo:unproven-return`（`any ⊭ number()`）⇒ 建议不可
      // 执行 + 标题说谎。
      // ⇒ 现在按 check 面的**推断面**（NudoSig.abs）写返回槽，并过
      // 「落盘后目标诊断消失」的验证门（残留 ⇒ 不下发）。
      if (
        code === DIAG.unprovenReturn &&
        action.kind === "relax" &&
        fn &&
        sidecarText !== undefined
      ) {
        const surface = inferredReturnSurfaceText(filePath, source, fn, {
          // 装载器与门禁复检同源（sidecar 的**原**文本：契约种子进形参域）
          loadModule: deps.agentToolDeps?.loadModule ?? defaultLoadModule,
        });
        const relaxed =
          surface !== undefined
            ? relaxSidecarReturnToSurface(sidecarText, fn, surface)
            : undefined;
        if (
          relaxed &&
          relaxed !== sidecarText &&
          sidecarRelaxClearsTarget({
            filePath,
            source,
            sidecarPath,
            sidecarText: relaxed,
            fnName: fn,
            codes: [DIAG.unprovenReturn],
            ...(deps.agentToolDeps?.loadModule
              ? { loadModule: deps.agentToolDeps.loadModule }
              : {}),
          })
        ) {
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
 * ⇒ 走 **AST**：取**包含诊断位置的最内层调用**，再定位目标实参对象字面量：
 * - `paramIndex`（形参身份，BUG-263）：**只**看第 n 个实参；它是对象字面量 ⇒
 *   用它（多实参调用里「取第一个对象字面量」是**猜位置**，会改错实参 +
 *   造重复键 + 原违规仍在）；
 * - `paramIndex` 指向的实参**不是**对象字面量时，按**该实参是什么**分两路：
 *   · **原始值字面量**（字符串 / 数字 / 布尔 / null / bigint / 模板串）⇒ 它
 *     运行时**不可能是对象** ⇒ 「missing field」这条诊断**不可能**落在它
 *     身上 ⇒ 形参身份在此**自相矛盾、不可用** ⇒ 回落「唯一对象字面量实参」
 *     口径（多个 ⇒ 不猜；Bug 737 的夹具就是这一路：形参位收的是 `"a{b"`，
 *     真正缺字段的对象字面量在另一个实参位）；
 *   · **表达式**（变量 / 成员 / 调用）⇒ 它运行时**可能就是**那个缺字段的
 *     对象 ⇒ 形参身份**仍有效**、只是落点不是内联对象字面量 ⇒ 不提供该
 *     quickfix（宁可没有建议，也不要改错实参）。
 * - 无 `paramIndex`：调用里**恰有一个**对象字面量实参时才用它；多个 ⇒ 不猜
 *   （沿用它自己的「绝不猜位置」原则）；
 * - `path`（嵌套路径，BUG-202）：从目标对象**逐级下钻**（每一级必须是内联对象
 *   字面量属性），插到诊断指的那一层；
 * - `existingField`（BUG-201）：目标对象**已有**该键 ⇒ 不提供（不造重复键）。
 */
function findCallArgObjectInsertPos(
  ast: File | undefined,
  diagPos: { line: number; character: number },
  target: { paramIndex?: number; path?: string[]; existingField?: string } = {},
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
        // 形参身份优先（BUG-263）；判不出形参时只在「唯一对象字面量实参」时采纳
        const args = path.node.arguments;
        const candidates = args.filter((a) => a.type === "ObjectExpression");
        let obj: ObjectExpression | undefined;
        if (target.paramIndex !== undefined) {
          const a = args[target.paramIndex];
          if (a?.type === "ObjectExpression") {
            // 形参位就是那个对象字面量 ⇒ 直接采纳（BUG-263 的定位口径）
            obj = a;
          } else if (isPrimitiveLiteralArg(a)) {
            // 该形参位收的是**原始值字面量** ⇒ 运行时不可能是对象 ⇒
            // 「missing field」诊断不可能落在它身上 ⇒ 形参身份与诊断
            // **自相矛盾**（不可用）⇒ 回落「唯一对象字面量实参」口径
            // （多个对象字面量 ⇒ 不猜位置 ⇒ 不下发）。
            obj = candidates.length === 1 ? candidates[0] : undefined;
          } else {
            // 该形参位收的是**表达式** ⇒ 它运行时可能就是那个缺字段的对象
            // ⇒ 形参身份仍有效、只是落点不是内联对象字面量 ⇒ 不可在此插入
            obj = undefined;
          }
          if (!obj) {
            // 该形参位不是对象字面量 ⇒ 不可在此插入；清空已命中的候选
            hit = null;
            return;
          }
        } else {
          obj = candidates.length === 1 ? candidates[0] : undefined;
          if (!obj) {
            hit = null;
            return;
          }
        }
        // traverse 自顶向下 ⇒ 后命中的（更内层）覆盖先命中的
        hit = obj;
      },
    });
  } catch {
    return null;
  }
  // 回调里的赋值 TS 不跟踪 ⇒ 显式 cast 把窄化收回声明类型
  let obj = hit as ObjectExpression | null;
  if (!obj) return null;
  // 嵌套路径下钻（BUG-202）：每一级都必须是内联对象字面量属性
  for (const seg of target.path ?? []) {
    const prop = objectPropertyOf(obj, seg);
    if (!prop || prop.value.type !== "ObjectExpression") return null;
    obj = prop.value;
  }
  // 字段已在目标对象里 ⇒ 不写重复键（BUG-201）
  if (target.existingField !== undefined && objectPropertyOf(obj, target.existingField)) {
    return null;
  }
  const loc = obj.loc;
  if (!loc) return null;
  return {
    pos: { line: loc.start.line - 1, character: loc.start.column + 1 },
    empty: obj.properties.length === 0,
  };
}

/** 对象字面量里的非计算属性（标识符键 / 字符串键） */
function objectPropertyOf(
  obj: ObjectExpression,
  key: string,
): ObjectProperty | null {
  for (const p of obj.properties) {
    if (p.type !== "ObjectProperty" || p.computed) continue;
    if (p.key.type === "Identifier" && p.key.name === key) return p;
    if (p.key.type === "StringLiteral" && p.key.value === key) return p;
  }
  return null;
}

/**
 * 实参是不是**原始值字面量**（字符串 / 数字 / 布尔 / null / bigint / 模板串）。
 *
 * 判据的意义（`findCallArgObjectInsertPos` 的形参身份回落）：这类实参
 * **运行时不可能是对象** ⇒ 「missing field」诊断不可能落在它身上 ⇒ 形参
 * 身份与诊断自相矛盾、不可用 ⇒ 回落「唯一对象字面量实参」口径。
 *
 * **正则字面量不算**（`/x/` 是对象）——它仍可能是「缺字段的对象」，
 * 按「表达式」处理（不回落、不猜位置）。
 */
function isPrimitiveLiteralArg(a: Node | undefined): boolean {
  if (!a) return false;
  switch (a.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "BigIntLiteral":
    case "TemplateLiteral":
      return true;
    default:
      return false;
  }
}

/**
 * 诊断指向的**被违反形参**（BUG-133）：没有 `loosen` 文案可解析时的推导。
 *
 * 两个来源（都是门禁诊断自身携带的事实）：
 * - 缺字段路径的**首段**（`missing field u.addr.city` ⇒ `u`）；
 * - 建议文案的 `relax the precondition on <param>`（参数谓词违例）。
 *
 * 判不出 ⇒ undefined（调用方据此把目标槽交给替换器自行裁决——验证门兜底）。
 */
function violatedParamOf(data: {
  expected?: string;
  suggestions?: string[];
}): string | undefined {
  const expected = typeof data.expected === "string" ? data.expected : "";
  const fieldPath = /missing field\s+([\w$]+(?:\.[\w$]+)*)/.exec(expected)?.[1];
  if (fieldPath) {
    const segments = fieldPath.split(".");
    if (segments.length > 1) return segments[0];
  }
  for (const s of data.suggestions ?? []) {
    const m = /precondition on\s+([\w$]+)/.exec(s);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * 侧车改写验证门（BUG-133 / BUG-134 / BUG-135）：把改写后的侧车作为**唯一**
 * 侧车来源重跑 `checkSource`，确认目标函数的指定诊断**消失**。
 *
 * `codes` = 要确认消失的诊断码：
 * - 缺省（约束放宽族）= `nudo:constraint-violated` + `nudo:entry-may-throw`；
 * - BUG-135（unproven-return 放宽到推断面）= `nudo:unproven-return`。
 *
 * 与 service `emit/quickfix-edits.ts` 的 `sidecarClearsConstraintViolation`
 * **同一判据**（LSP 不反向依赖产品包 `nudojs`，该函数也未从 `service/emit`
 * 导出 ⇒ 按实现镜像）。
 *
 * 任何失败（界面装载失败 / 求值抛 / 诊断仍在）⇒ false ⇒ 调用方**不下发**
 * 该动作（宁可没有建议，也不给一个消不掉诊断的假修复）。
 */
function sidecarRelaxClearsTarget(input: {
  filePath: string;
  source: string;
  sidecarPath: string;
  sidecarText: string;
  fnName: string;
  /** 要确认消失的诊断码（缺省 = 约束放宽族） */
  codes?: readonly string[];
  loadModule?: (spec: string, fromFile: string) => string | undefined;
}): boolean {
  const codes: readonly string[] =
    input.codes ?? [DIAG.constraintViolated, DIAG.entryMayThrow];
  const norm = (p: string): string => p.replace(/\\/g, "/");
  const resolveRel = (from: string, spec: string): string | undefined => {
    if (!spec.startsWith(".")) return undefined;
    const parts = norm(from).split("/").slice(0, -1);
    for (const seg of norm(spec).split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  };
  const target = norm(input.sidecarPath);
  const loadModule = (spec: string, from: string): string | undefined => {
    if (norm(spec) === target) return input.sidecarText;
    const p = resolveRel(from, spec);
    if (p !== undefined && p === target) return input.sidecarText;
    return (input.loadModule ?? defaultLoadModule)(spec, from);
  };
  try {
    const r = checkSource(input.filePath, input.source, pTrue, {
      loadModule,
      fromFile: input.filePath,
    });
    if (r.issues.some((i) => i.code === DIAG.interfaceLoad)) return false;
    return !r.issues.some(
      (i) => codes.includes(i.code) && i.fn === input.fnName,
    );
  } catch {
    return false;
  }
}

/**
 * BUG-135：目标函数的**推断面**（check 口径的返回 Abs）→ 侧车返回槽可写的
 * 约束文本。
 *
 * - `any` ⇒ `any()`（推断面 = 无约束 ⇒ 契约写成 `any()`；侧车的约束构建器
 *   `any` 是 **ambient** 注入名，不 import 也能用）；
 * - 可投影的 Abs ⇒ `absToConstraint` + `formatConstraint`（精确面，如
 *   `number().gt(40)` / `lit(0)`）；
 * - 不可投影但形状可靠（widened / partial 的 prim）⇒ **基类型**
 *   （`number()` / `string()` / `boolean()`）——bug 报告允许的「推断面基类型」；
 * - 其余（obj / arr / 非字面量 union …）⇒ undefined ⇒ 调用方**不下发**动作
 *   （写不出忠实的推断面 ⇒ 不能承诺「放宽到推断面」）。
 */
function inferredReturnSurfaceText(
  filePath: string,
  source: string,
  fnName: string,
  opts?: { loadModule?: (spec: string, fromFile: string) => string | undefined },
): string | undefined {
  try {
    // check 口径（与 CLI 签名行 / hover 签名同源）：NudoSig.abs = 推断面
    const r = checkSource(filePath, source, pTrue, {
      ...(opts?.loadModule ? { loadModule: opts.loadModule } : {}),
      fromFile: filePath,
    });
    const sig = r.signatures.find((s) => s.name === fnName);
    if (!sig) return undefined;
    return surfaceConstraintTextOf(sig.abs);
  } catch {
    return undefined;
  }
}

/** Abs → 侧车返回槽可写的约束文本（见 {@link inferredReturnSurfaceText}） */
function surfaceConstraintTextOf(abs: Abs): string | undefined {
  // 先试**精确**投影（`lit(0)` / `number().gt(40)` / `union(lit…, …)`）；
  // `any` 只有带 or-pred 字面量集时可投影，其余 any 走下面的 `any()`。
  const projected = absToConstraint(abs);
  if (projected !== undefined) return formatConstraint(projected);
  if (abs.shape.k === "any") return "any()";
  const s = abs.shape;
  if (s.k === "prim" && (s.type === "number" || s.type === "string" || s.type === "boolean")) {
    return `${s.type}()`;
  }
  return undefined;
}

/**
 * 目标函数是否为「本文件**代码优先**的导出」（BUG-237）。
 *
 * 草稿生成器（`draftInterface`）只从**代码**推导契约，并**按设计跳过**手写
 * 契约函数（`@nudo:contract` / `@nudo:import` 模板）⇒ 对这类函数下发
 * 「Create sidecar draft…」必然空转；住在**别的模块**的函数同理（按本文件
 * 生成的草稿里既没有它、也没有要补的字段）。
 */
function isCodeFirstExport(
  source: string,
  filePath: string,
  fnName: string,
): boolean {
  try {
    if (!localNamedExports(source).has(fnName)) return false;
    const tier = interfaceTierOf(source, fnName, filePath, {});
    return tier?.source !== "handwritten";
  } catch {
    return false;
  }
}

/**
 * 被调函数形参表里 `paramName` 的下标（BUG-263 的形参身份来源）。
 *
 * 只认同文件里的**顶层**声明形态（`function f(a, b)` / `const f = (a, b) => …`）；
 * 判不出（跨模块被调方 / 解构形参 / 类方法）⇒ undefined ⇒ 调用点退回
 * 「唯一对象字面量实参」口径（多实参时不下发）。
 */
function formalIndexOfFn(
  ast: File | undefined,
  fnName: string,
  paramName: string,
): number | undefined {
  if (!ast) return undefined;
  const indexOfParam = (params: Node[]): number | undefined => {
    const i = params.findIndex(
      (p) => p.type === "Identifier" && p.name === paramName,
    );
    return i >= 0 ? i : undefined;
  };
  for (const stmt of ast.program.body) {
    const d = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (!d) continue;
    if (d.type === "FunctionDeclaration" && d.id?.name === fnName) {
      return indexOfParam(d.params);
    }
    if (d.type === "VariableDeclaration") {
      for (const decl of d.declarations) {
        if (decl.id.type !== "Identifier" || decl.id.name !== fnName) continue;
        const init = decl.init;
        if (
          init &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        ) {
          return indexOfParam(init.params);
        }
      }
    }
  }
  return undefined;
}
