import { analyzeFile, type AnalysisResult } from "@nudojs/service";

export type NudoPluginOptions = {
  include?: string[];
  exclude?: string[];
  failOnError?: boolean;
};

const DEFAULT_INCLUDE = ["**/*.js"];
const DEFAULT_EXCLUDE = ["**/node_modules/**"];

function matchesPatterns(id: string, include: string[], exclude: string[]): boolean {
  const isExcluded = exclude.some((p) => minimatch(id, p));
  if (isExcluded) return false;
  return include.some((p) => minimatch(id, p));
}

function minimatch(str: string, pattern: string): boolean {
  if (pattern === "**/*.js") return str.endsWith(".js");
  if (pattern === "**/node_modules/**") return str.includes("/node_modules/");
  if (pattern.startsWith("**/")) {
    return str.endsWith(pattern.slice(3)) || str.includes(pattern.slice(2));
  }
  return str.includes(pattern);
}

export default function nudoPlugin(options: NudoPluginOptions = {}): any {
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const failOnError = options.failOnError ?? false;

  const analysisCache = new Map<string, AnalysisResult>();

  return {
    name: "vite-plugin-nudo",

    buildStart() {
      analysisCache.clear();
    },

    transform(code: string, id: string) {
      if (!matchesPatterns(id, include, exclude)) return null;
      if (!/@nudo:(case|mock|pure|skip|sample|returns)\b/.test(code)) return null;

      try {
        const result = analyzeFile(id, code);
        analysisCache.set(id, result);

        for (const diag of result.diagnostics) {
          const loc = `${id}:${diag.range.start.line}:${diag.range.start.column}`;
          const msg = `[nudo] ${loc} ${diag.severity}: ${diag.message}`;

          if (diag.severity === "error") {
            if (failOnError) {
              (this as any).error(msg);
            } else {
              (this as any).warn(msg);
            }
          } else if (diag.severity === "warning") {
            (this as any).warn(msg);
          }
        }
      } catch (err) {
        (this as any).warn(`[nudo] Failed to analyze ${id}: ${(err as Error).message}`);
      }

      return null;
    },

    buildEnd() {
      const totalDiags = Array.from(analysisCache.values())
        .reduce((sum, r) => sum + r.diagnostics.length, 0);
      if (totalDiags > 0) {
        const errorCount = Array.from(analysisCache.values())
          .reduce((sum, r) => sum + r.diagnostics.filter((d) => d.severity === "error").length, 0);
        const warnCount = totalDiags - errorCount;
        console.log(`[nudo] Analysis complete: ${errorCount} error(s), ${warnCount} warning(s)`);
      }
    },
  };
}
