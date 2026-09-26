#!/usr/bin/env tsx
/**
 * P0-B B1 — env / Node API coverage baseline.
 *
 * Measures high-frequency Node + library probes against handwritten env
 * modules (`@nudojs/env` es/web/node) and harvest availability.
 *
 * Classification (extensional inventory — not a soundness claim):
 *   - resolved:       probe path exists in env and formatShape is not unknown/any
 *   - unknown:        probe path missing, or formatShape is unknown/any
 *   - mock-required:  category still recommended for handwritten mock
 *                     (native bindings / stream machine / dynamic require /
 *                      dual-entry variants / no call-site functions) —
 *                     aligned with docs/design/limitations.md §2
 *
 * Usage (from monorepo root):
 *   pnpm run coverage:env
 *   pnpm run coverage:env --json   # stdout JSON only
 *   pnpm run coverage:env -- --check  # CI: fail if committed baseline drifted
 *
 * Output:
 *   docs/reports/env-coverage-baseline.json
 *   docs/reports/env-coverage-baseline.md
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { Abs } from "../packages/core/src/algebra/abs.ts";
import { formatShape } from "../packages/core/src/algebra/format.ts";
import { defineEnv as defineEsEnv } from "../packages/env/src/es.ts";
import { defineEnv as defineWebEnv } from "../packages/env/src/web.ts";
import { defineEnv as defineNodeEnv } from "../packages/env/src/node.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsonMode = process.argv.includes("--json");
const checkMode = process.argv.includes("--check");
const generatedAt = new Date().toISOString();

/** Stable payload for drift checks — ignores timestamps. Pins node + es/web probes. */
function coverageStablePayload(report: {
  nodeProbes: { counts: unknown; leaf: unknown; total: unknown; results: unknown };
  esProbes?: { counts: unknown; leaf: unknown; total: unknown; results: unknown };
  webProbes?: { counts: unknown; leaf: unknown; total: unknown; results: unknown };
  libraryProbes?: unknown;
  envModuleKeys?: unknown;
}): string {
  return JSON.stringify({
    envModuleKeys: report.envModuleKeys,
    nodeProbes: {
      counts: report.nodeProbes.counts,
      leaf: report.nodeProbes.leaf,
      total: report.nodeProbes.total,
      results: report.nodeProbes.results,
    },
    esProbes: report.esProbes
      ? {
          counts: report.esProbes.counts,
          leaf: report.esProbes.leaf,
          total: report.esProbes.total,
          results: report.esProbes.results,
        }
      : undefined,
    webProbes: report.webProbes
      ? {
          counts: report.webProbes.counts,
          leaf: report.webProbes.leaf,
          total: report.webProbes.total,
          results: report.webProbes.results,
        }
      : undefined,
  });
}

type EnvDef = {
  globals: Record<string, Abs>;
  modules?: Record<string, Record<string, Abs>>;
};

type ProbeStatus = "resolved" | "unknown" | "mock-required";

type Probe = {
  id: string;
  /** module key; omit for globals */
  module?: string;
  /** property path inside the module / global */
  path: string[];
  /** Always classify mock-required even if env has a signature (honest boundary) */
  forceMock?: boolean;
  note?: string;
};

type ProbeResult = Probe & {
  status: ProbeStatus;
  format?: string;
  /** clean = format string has no unknown/any token; mentions-unknown = signature-level only */
  leaf?: "clean" | "mentions-unknown";
  reason: string;
};

/**
 * High-frequency Node API probes (default priority from plan §3 B3 + B-gap pass).
 * Library probes are inventory-only: they document import resolution path
 * (JS execution / @types harvest / mock) rather than env module slots.
 */
const NODE_PROBES: Probe[] = [
  // fs
  { id: "fs.readFileSync", module: "fs", path: ["readFileSync"] },
  { id: "fs.writeFileSync", module: "fs", path: ["writeFileSync"] },
  { id: "fs.existsSync", module: "fs", path: ["existsSync"] },
  { id: "fs.statSync", module: "fs", path: ["statSync"] },
  { id: "fs.readdirSync", module: "fs", path: ["readdirSync"] },
  { id: "fs.mkdirSync", module: "fs", path: ["mkdirSync"] },
  { id: "fs.rmSync", module: "fs", path: ["rmSync"] },
  { id: "fs.readFile-callback", module: "fs", path: ["readFile"] },
  { id: "fs.promises.readFile", module: "fs/promises", path: ["readFile"] },
  { id: "fs.promises.writeFile", module: "fs/promises", path: ["writeFile"] },
  { id: "fs.promises.mkdir", module: "fs/promises", path: ["mkdir"] },
  { id: "node:fs/promises.readFile", module: "node:fs/promises", path: ["readFile"] },
  { id: "node:fs/promises.appendFile", module: "node:fs/promises", path: ["appendFile"] },
  { id: "node:fs/promises.unlink", module: "node:fs/promises", path: ["unlink"] },
  { id: "node:fs/promises.rename", module: "node:fs/promises", path: ["rename"] },
  { id: "node:fs/promises.copyFile", module: "node:fs/promises", path: ["copyFile"] },
  { id: "node:fs/promises.chmod", module: "node:fs/promises", path: ["chmod"] },

  // path
  { id: "path.join", module: "path", path: ["join"] },
  { id: "path.resolve", module: "path", path: ["resolve"] },
  { id: "path.dirname", module: "path", path: ["dirname"] },
  { id: "path.basename", module: "path", path: ["basename"] },
  { id: "path.extname", module: "path", path: ["extname"] },
  { id: "path.relative", module: "path", path: ["relative"] },
  { id: "path.parse", module: "path", path: ["parse"] },
  { id: "path.isAbsolute", module: "path", path: ["isAbsolute"] },
  { id: "path.sep", module: "path", path: ["sep"] },
  { id: "path.posix", module: "path", path: ["posix"] },
  { id: "path.win32", module: "path", path: ["win32"] },

  // url
  { id: "url.URL", module: "url", path: ["URL"] },
  { id: "url.URLSearchParams", module: "url", path: ["URLSearchParams"] },
  { id: "url.fileURLToPath", module: "url", path: ["fileURLToPath"] },
  { id: "url.pathToFileURL", module: "url", path: ["pathToFileURL"] },

  // events
  { id: "events.EventEmitter", module: "events", path: ["EventEmitter"] },
  { id: "events.once", module: "events", path: ["once"] },
  { id: "events.on", module: "events", path: ["on"] },
  { id: "node:events.EventEmitter", module: "node:events", path: ["EventEmitter"] },

  // util
  { id: "util.promisify", module: "util", path: ["promisify"] },
  { id: "util.inspect", module: "util", path: ["inspect"] },
  { id: "util.format", module: "util", path: ["format"] },
  { id: "util.types.isDate", module: "util", path: ["types", "isDate"] },
  { id: "util.inherits", module: "util", path: ["inherits"] },
  { id: "util.callbackify", module: "util", path: ["callbackify"] },

  // stream (instance + user hooks signature-level; data machine stays mock)
  { id: "stream.Readable", module: "stream", path: ["Readable"] },
  { id: "stream.Writable", module: "stream", path: ["Writable"] },
  { id: "stream.Duplex", module: "stream", path: ["Duplex"] },
  { id: "stream.Transform", module: "stream", path: ["Transform"] },
  { id: "stream.pipeline", module: "stream", path: ["pipeline"] },
  { id: "stream.finished", module: "stream", path: ["finished"] },
  { id: "stream.promises.pipeline", module: "stream", path: ["promises", "pipeline"] },
  {
    id: "stream.machine-callbacks",
    module: "stream",
    path: ["Transform"],
    forceMock: true,
    note: "data/error events are machine-driven (limitations §2); transform/flush hooks are signature-level for refine",
  },

  // querystring
  { id: "querystring.parse", module: "querystring", path: ["parse"] },
  { id: "querystring.stringify", module: "querystring", path: ["stringify"] },

  // crypto / process / os / Buffer / assert
  { id: "crypto.randomUUID", module: "crypto", path: ["randomUUID"] },
  { id: "crypto.createHash", module: "crypto", path: ["createHash"] },
  { id: "crypto.randomBytes", module: "crypto", path: ["randomBytes"] },
  { id: "process.env", path: ["process", "env"] },
  { id: "process.cwd", path: ["process", "cwd"] },
  { id: "process.argv", path: ["process", "argv"] },
  { id: "process.nextTick", path: ["process", "nextTick"] },
  { id: "process.exitCode", path: ["process", "exitCode"] },
  { id: "process.version", path: ["process", "version"] },
  { id: "process.platform", path: ["process", "platform"] },
  { id: "os.platform", module: "os", path: ["platform"] },
  { id: "os.homedir", module: "os", path: ["homedir"] },
  { id: "os.tmpdir", module: "os", path: ["tmpdir"] },
  { id: "os.EOL", module: "os", path: ["EOL"] },
  { id: "os.cpus", module: "os", path: ["cpus"] },
  { id: "Buffer.from", path: ["Buffer", "from"] },
  { id: "Buffer.alloc", path: ["Buffer", "alloc"] },
  { id: "Buffer.concat", path: ["Buffer", "concat"] },
  { id: "assert.ok", module: "assert", path: ["ok"] },
  { id: "assert.strictEqual", module: "assert", path: ["strictEqual"] },
  { id: "assert.deepStrictEqual", module: "assert", path: ["deepStrictEqual"] },

  // child_process: instance surface is signature-level; side effects stay mock
  { id: "child_process.spawn", module: "child_process", path: ["spawn"] },
  { id: "child_process.execFile", module: "child_process", path: ["execFile"] },
  { id: "child_process.spawnSync", module: "child_process", path: ["spawnSync"] },
  {
    id: "child_process.spawn-native",
    module: "child_process",
    path: ["spawn"],
    forceMock: true,
    note: "native process spawn — no side-effect simulation; ChildProcess shape is signature-level",
  },
];

/** Library import-path probes (three-state harvest auto path). */
type LibProbe = {
  id: string;
  package: string;
  kind: "js-source" | "types" | "none";
  note: string;
};

const LIB_PROBES: LibProbe[] = [
  {
    id: "commander",
    package: "commander",
    kind: "js-source",
    note: "JS source present — analysis via execution / checkSource, not d.ts harvest",
  },
  {
    id: "ms",
    package: "ms",
    kind: "js-source",
    note: "JS source — infer/check without handwritten mock",
  },
  {
    id: "@types/node",
    package: "@types/node",
    kind: "types",
    note: ".d.ts harvest via harvestNodeTypes (analysis auto-fill)",
  },
  {
    id: "no-types-example",
    package: "left-pad",
    kind: "none",
    note: "if installed without types and no JS eval path → mock/hint required",
  },
];

function walkAbs(a: Abs | undefined, path: string[]): { found: Abs | undefined; format?: string } {
  let cur: Abs | undefined = a;
  for (const key of path) {
    if (!cur) return { found: undefined };
    // brand carries its payload as shape.shape (an Abs), not as obj slots
    if (cur.shape.k === "brand") {
      cur = cur.shape.shape as Abs | undefined;
    }
    if (!cur || cur.shape.k !== "obj") return { found: undefined };
    const slot = cur.shape.slots[key];
    if (!slot) return { found: undefined };
    cur = slot.value;
  }
  return { found: cur, format: cur ? formatShape(cur) : undefined };
}

function isWeakFormat(fmt: string | undefined): boolean {
  if (fmt === undefined) return true;
  return fmt === "unknown" || fmt === "any" || fmt === "·";
}

/** True when the format string itself still carries an unknown/any leaf token. */
function formatMentionsUnknown(fmt: string | undefined): boolean {
  if (!fmt) return true;
  return /(^|[^\w])(unknown|any)([^\w]|$)/.test(fmt);
}

/** Empty object bags (`process.env` → `{  }`) are not leaf-clean. */
function isEmptyObjFormat(fmt: string | undefined): boolean {
  if (!fmt) return false;
  return /^\{\s*\}$/.test(fmt.replace(/\s+/g, " ").trim());
}

function leafOf(format: string | undefined): "clean" | "mentions-unknown" {
  if (!format) return "mentions-unknown";
  if (isEmptyObjFormat(format)) return "mentions-unknown";
  return formatMentionsUnknown(format) ? "mentions-unknown" : "clean";
}

function lookupProbe(env: EnvDef, probe: Probe): { found?: Abs; format?: string } {
  if (probe.module) {
    const mod = env.modules?.[probe.module];
    if (!mod) return {};
    if (probe.path.length === 0) return {};
    const rootKey = probe.path[0]!;
    const rest = probe.path.slice(1);
    const top = mod[rootKey];
    if (!top) return {};
    if (rest.length === 0) return { found: top, format: formatShape(top) };
    return walkAbs(top, rest);
  }
  // global
  if (probe.path.length === 0) return {};
  const rootKey = probe.path[0]!;
  const rest = probe.path.slice(1);
  const top = env.globals[rootKey];
  if (!top) return {};
  if (rest.length === 0) return { found: top, format: formatShape(top) };
  return walkAbs(top, rest);
}

function classify(env: EnvDef, probe: Probe): ProbeResult {
  const { found, format } = lookupProbe(env, probe);
  if (probe.forceMock) {
    return {
      ...probe,
      status: "mock-required",
      format,
      reason: probe.note ?? "mock-recommended category",
    };
  }
  if (!found) {
    return {
      ...probe,
      status: "unknown",
      reason: `missing from env${probe.module ? ` module "${probe.module}"` : " globals"}`,
    };
  }
  if (isWeakFormat(format)) {
    return {
      ...probe,
      status: "unknown",
      format,
      leaf: "mentions-unknown",
      reason: "present but formatShape is unknown/any (signature only, no leaf shape)",
    };
  }
  const leaf = leafOf(format);
  return {
    ...probe,
    status: "resolved",
    format,
    leaf,
    reason:
      leaf === "clean"
        ? "present in handwritten env with concrete Abs shape (format has no unknown leaf)"
        : "present in env; signature-level — format still mentions unknown/any leaves",
  };
}

function countByStatus(results: ProbeResult[]): Record<ProbeStatus, number> {
  const out: Record<ProbeStatus, number> = {
    resolved: 0,
    unknown: 0,
    "mock-required": 0,
  };
  for (const r of results) out[r.status]++;
  return out;
}

function countLeaf(results: ProbeResult[]): { clean: number; mentionsUnknown: number } {
  let clean = 0;
  let mentionsUnknown = 0;
  for (const r of results) {
    if (r.status !== "resolved") continue;
    if (r.leaf === "clean") clean++;
    else mentionsUnknown++;
  }
  return { clean, mentionsUnknown };
}

function tryResolvePkg(pkg: string): boolean {
  // pnpm isolated layout: fixture packages live under packages/core/node_modules
  const candidates = [
    join(root, "packages/core/package.json"),
    join(root, "packages/service/package.json"),
    join(root, "packages/env/package.json"),
    join(root, "package.json"),
  ];
  for (const ctx of candidates) {
    try {
      const req = createRequire(pathToFileURL(ctx).href);
      req.resolve(pkg);
      return true;
    } catch {
      // next context
    }
  }
  // Types-only packages (@types/*) often lack "main" — require.resolve fails.
  // Fall back to directory presence on the same node_modules walk.
  for (const ctx of candidates) {
    const dir = join(dirname(ctx), "node_modules", pkg);
    if (existsSync(dir)) return true;
  }
  return existsSync(join(root, "node_modules", pkg));
}

function main(): void {
  const envs: Record<string, EnvDef> = {
    es: defineEsEnv() as EnvDef,
    web: defineWebEnv() as EnvDef,
    node: defineNodeEnv() as EnvDef,
  };

  const nodeResults = NODE_PROBES.map((p) => classify(envs.node!, p));
  const nodeCounts = countByStatus(nodeResults);
  const nodeLeaf = countLeaf(nodeResults);

  // ES / web globals sample (small control set)
  const ES_PROBES: Probe[] = [
    { id: "Array.isArray", path: ["Array", "isArray"] },
    { id: "JSON.stringify", path: ["JSON", "stringify"] },
    { id: "Math.max", path: ["Math", "max"] },
    { id: "Promise", path: ["Promise"] },
  ];
  const WEB_PROBES: Probe[] = [
    { id: "fetch", path: ["fetch"] },
    { id: "URL", path: ["URL"] },
    { id: "AbortController", path: ["AbortController"] },
  ];
  const esResults = ES_PROBES.map((p) => classify(envs.es!, p));
  const webResults = WEB_PROBES.map((p) => classify(envs.web!, p));
  const esLeaf = countLeaf(esResults);
  const webLeaf = countLeaf(webResults);

  const libResults = LIB_PROBES.map((lib) => {
    const installed = tryResolvePkg(lib.package);
    let status: ProbeStatus | "installed" | "absent";
    let reason: string;
    if (!installed) {
      status = "absent";
      reason = "package not on Node resolution path in this worktree";
    } else if (lib.kind === "js-source") {
      status = "resolved";
      reason = lib.note;
    } else if (lib.kind === "types") {
      status = "resolved";
      reason = lib.note;
    } else {
      status = "mock-required";
      reason = lib.note;
    }
    return { ...lib, installed, status, reason };
  });

  const report = {
    generatedAt,
    note:
      "Extensional env coverage baseline — resolution rate is NOT a soundness/completeness claim. See design/limitations.md §2 and website semantics mock-boundary section.",
    budgets: {
      harvestNodeTypes: { maxFiles: 12, maxMs: 2500, disableEnvVar: "NUDO_HARVEST_NODE=off" },
    },
    envModuleKeys: {
      es: Object.keys(envs.es!.globals).length,
      web: Object.keys(envs.web!.globals).length + Object.keys(envs.web!.modules ?? {}).length,
      nodeGlobals: Object.keys(envs.node!.globals).length,
      nodeModules: Object.keys(envs.node!.modules ?? {}).sort(),
    },
    nodeProbes: {
      counts: nodeCounts,
      leaf: nodeLeaf,
      total: nodeResults.length,
      results: nodeResults,
    },
    esProbes: {
      counts: countByStatus(esResults),
      leaf: esLeaf,
      total: esResults.length,
      results: esResults,
    },
    webProbes: {
      counts: countByStatus(webResults),
      leaf: webLeaf,
      total: webResults.length,
      results: webResults,
    },
    libraryProbes: libResults,
  };

  const outDir = join(root, "docs", "reports");
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, "env-coverage-baseline.json");
  const mdPath = join(outDir, "env-coverage-baseline.md");

  if (checkMode) {
    let committed: string | null = null;
    try {
      committed = readFileSync(jsonPath, "utf8");
    } catch {
      committed = null;
    }
    if (!committed) {
      process.stderr.write(
        `env-coverage-baseline --check: missing ${jsonPath}; run \`pnpm run coverage:env\` and commit\n`,
      );
      process.exit(1);
    }
    let committedPayload = "";
    try {
      committedPayload = coverageStablePayload(JSON.parse(committed));
    } catch {
      process.stderr.write(
        `env-coverage-baseline --check: unparseable ${jsonPath}; run \`pnpm run coverage:env\` and commit\n`,
      );
      process.exit(1);
    }
    const freshPayload = coverageStablePayload(report);
    if (committedPayload !== freshPayload) {
      process.stderr.write(
        `env-coverage-baseline --check: docs/reports/env-coverage-baseline.* is stale.\n` +
          `Run \`pnpm run coverage:env\` and commit the regenerated reports.\n` +
          `Fresh: node resolved ${nodeCounts.resolved}/${report.nodeProbes.total} ` +
          `(leaf-clean=${nodeLeaf.clean}, unknown=${nodeCounts.unknown}, ` +
          `mock-required=${nodeCounts["mock-required"]})\n`,
      );
      process.exit(1);
    }
    process.stdout.write(
      `env-coverage-baseline --check: committed baseline matches (node resolved ${nodeCounts.resolved}/${report.nodeProbes.total})\n`,
    );
    return;
  }

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const md: string[] = [];
  md.push("# Env / Node coverage baseline");
  md.push("");
  md.push("> **Generated** by `scripts/env-coverage-baseline.ts` (`pnpm run coverage:env`).");
  md.push("> Do not hand-edit numbers — regenerate the report.");
  md.push(">");
  md.push("> **Honest boundary:** resolution rate is *not* a soundness guarantee.");
  md.push("> Categories still recommended for mock are listed below and aligned with");
  md.push("> `docs/design/limitations.md` §2 (call-site ceiling).");
  md.push("");
  md.push(`- Generated at: \`${generatedAt}\``);
  md.push(`- Harvest budgets: maxFiles=\`${report.budgets.harvestNodeTypes.maxFiles}\`, maxMs=\`${report.budgets.harvestNodeTypes.maxMs}\`, disable=\`NUDO_HARVEST_NODE=off\``);
  md.push("");
  md.push("## Summary — Node env probes");
  md.push("");
  md.push(`| Status | Count |`);
  md.push(`|---|---:|`);
  md.push(`| resolved (leaf-clean format) | ${nodeLeaf.clean} |`);
  md.push(`| resolved (signature-level; format still mentions unknown/any) | ${nodeLeaf.mentionsUnknown} |`);
  md.push(`| unknown | ${nodeCounts.unknown} |`);
  md.push(`| mock-required | ${nodeCounts["mock-required"]} |`);
  md.push(`| **total** | ${report.nodeProbes.total} |`);
  md.push("");
  const resolvedPct =
    report.nodeProbes.total === 0
      ? 0
      : Math.round((nodeCounts.resolved / report.nodeProbes.total) * 1000) / 10;
  const cleanPct =
    report.nodeProbes.total === 0
      ? 0
      : Math.round((nodeLeaf.clean / report.nodeProbes.total) * 1000) / 10;
  md.push(`Resolved ratio (resolved / total): **${resolvedPct}%**`);
  md.push(`Leaf-clean ratio (format has no unknown/any token / total): **${cleanPct}%**`);
  md.push("");
  md.push("### Probe detail (node)");
  md.push("");
  md.push("| Probe | Status | Leaf | Format | Reason |");
  md.push("|---|---|---|---|---|");
  for (const r of nodeResults) {
    md.push(
      `| \`${r.id}\` | ${r.status} | ${r.leaf ?? "—"} | ${r.format ? `\`${r.format.replace(/\|/g, "\\|")}\`` : "—"} | ${r.reason} |`,
    );
  }
  md.push("");
  md.push("### ES / web sample");
  md.push("");
  md.push(`- ES: resolved ${countByStatus(esResults).resolved}/${esResults.length}`);
  md.push(`- Web: resolved ${countByStatus(webResults).resolved}/${webResults.length}`);
  md.push("");
  md.push("## Library three-state path");
  md.push("");
  md.push("| Package | Kind | Installed here | Classification | Note |");
  md.push("|---|---|---|---|---|");
  for (const lib of libResults) {
    md.push(
      `| \`${lib.package}\` | ${lib.kind} | ${lib.installed ? "yes" : "no"} | ${lib.status} | ${lib.note} |`,
    );
  }
  md.push("");
  md.push("### Three-state harvest rule");
  md.push("");
  md.push("| Import target | Analysis path |");
  md.push("|---|---|");
  md.push("| JS source package (e.g. `commander`, `ms`) | Execute/analyze source — `checkSource` / `analyzeFile`; no handwritten mock required for zero-FP gate |");
  md.push("| `@types/*` / package ships `.d.ts` | `harvestDts` / `harvestNodeTypes` → analysis auto-fill env injection |");
  md.push("| Neither JS analysis path nor types | **mock-required** — use `@nudo:mock` / path `@nudo:env` / sidecar hint |");
  md.push("");
  md.push("## Still mock-recommended categories");
  md.push("");
  md.push("- Native bindings (process spawn, native addons)");
  md.push("- Dynamic `require` / computed module graphs");
  md.push("- Stream machine callbacks (Node Transform internals) — limitations §2");
  md.push("- Dual-entry browser/node variants (call-site records do not cross files)");
  md.push("- Functions with no call-site usage (entry@ fallback is honest)");
  md.push("");
  md.push("## Node env module keys");
  md.push("");
  md.push("```");
  md.push(report.envModuleKeys.nodeModules.join("\n"));
  md.push("```");
  md.push("");
  md.push(`JSON twin: \`docs/reports/env-coverage-baseline.json\``);
  md.push("");

  writeFileSync(mdPath, md.join("\n"), "utf8");

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `env-coverage-baseline: node resolved ${nodeCounts.resolved}/${report.nodeProbes.total} ` +
        `(leaf-clean=${nodeLeaf.clean}, signature-level=${nodeLeaf.mentionsUnknown}, ` +
        `unknown=${nodeCounts.unknown}, mock-required=${nodeCounts["mock-required"]})\n` +
        `wrote ${jsonPath}\nwrote ${mdPath}\n`,
    );
  }
}

main();
