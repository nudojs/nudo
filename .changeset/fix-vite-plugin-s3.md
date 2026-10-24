---
"vite-plugin-nudo": minor
---

The build plugin no longer hides contract failures or drops diagnostics.

**BREAKING**: 两处构建期行为变化（0.5.x 的绿构建可能变红 / 静默构建可能变吵）：

1. `nudo.analysis.diagnostics: "off"` **不再静默契约门禁**。此前门禁诊断
   （L1 `nudo:constraint-violated` / L2 `nudo:entry-may-throw`）与显示通道合并
   过滤 ⇒ `off` 项目**零诊断**、`failOnError: true` 也照样**绿**（坏契约上的
   绿灯 CI）。现在门禁通道独立：**error 级的 check 诊断在任何档位（含 `off`）
   都照常上报、照常拦构建**。
2. `build.logLevel: "silent"` 现在**真的什么都不输出**（含汇总行）。汇总行此前
   走裸 `console.log`，逃出 Vite logger 的管辖 ⇒ 静默构建仍打印
   `[nudo] Analysis complete: N error(s), M warning(s)`，却看不到那 N 条诊断
   （只报数、不给理由）。现在汇总行走 Vite logger ⇒ 静默档下**连汇总行都没有**。

谁会坏：靠 `diagnostics: "off"` 换「构建期不拦契约」的流水线（CI 由绿转红）；
以及在 `logLevel: "silent"` 下仍依赖 `[nudo] Analysis complete: …` 这行汇总
做日志采集的脚本（该行不再出现）。

怎么迁移：想让构建期完全安静，用 `build.logLevel: "silent"`（现在它真的静默）
并把 `failOnError` 设为 `false`；想让契约门禁在构建期也生效，保持现状即可
（门禁不再被 `off` 抹掉，这是有意的 fail-closed 方向）。`vite-plugin-nudo` 仍是
**pre-1.0**（0.x）：本次按政策以 **minor** 发布（0.x 的 minor 可能含破坏性变更）。

- `nudo.analysis.diagnostics: "off"` no longer silences the **contract gate**.
  Previously the check-gate diagnostics (L1 `nudo:constraint-violated`, L2
  `nudo:entry-may-throw`) were merged into the display path and filtered
  together with it, so an `off` project reported **zero** diagnostics and a
  build with `failOnError: true` still **passed** — a green CI on a broken
  contract. The gate channel is now separate: error-level check diagnostics
  are reported and still fail the build under `failOnError: true`, in every
  diagnostics tier including `off`. The display path (evaluator diagnostics,
  path-env failures, and check warnings/info) keeps the old tier semantics.

- `build.logLevel: "silent"` now silences **everything** the plugin prints.
  The build summary used to be written with a bare `console.log`, which
  escaped Vite's logger: a silent build still printed
  `[nudo] Analysis complete: N error(s), M warning(s)` while none of the N
  diagnostics were shown. The summary now goes through Vite's logger, so a
  silent build prints nothing at all.

**Fixes**

- `failOnError: true` reported only the **first** error-level diagnostic and
  dropped the rest, while the build summary counted them all ("2 error(s)"
  next to a single reported error). The first error still fails the build;
  every remaining error-level diagnostic is now reported as well, so the
  summary count and the number of reported diagnostics agree.

- Diagnostics without a source position were rendered as `:0:0` (a line that
  does not exist) or `:1:0` (an invented first line). A diagnostic with no
  position now omits the `:line:col` part entirely, matching the CLI, which
  prints no location for the same diagnostic.

- The evaluator-side diagnostics dropped their `(nudo:code)` suffix, so a
  single build log mixed two text formats and `grep '(nudo:'` only found half
  of the diagnostics. Every diagnostic now carries its code, and the two
  sources use the same format.
