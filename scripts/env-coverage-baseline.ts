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
 *                     aligned with docs/design-limitations.md §八
 *
 * Usage (from monorepo root):
 *   pnpm run coverage:env
 *   pnpm run coverage:env --json   # stdout JSON only
 *
 * Output:
 *   docs/reports/env-coverage-baseline.json
 *   docs/reports/env-coverage-baseline.md
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
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
const generatedAt = new Date().toISOString();

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
  reason: string;
};

/**
 * High-frequency Node API probes (default priority from plan §3 B3).
 * Library probes are inventory-only: they document import resolution path
 * (JS execution / @types harvest / mock) rather than env module slots.
 */
const NODE_PROBES: Probe[] = [
  // fs
  { id: "fs.readFileSync", module: "fs", path: ["readFileSync"] },
  { id: "fs.writeFileSync", module: "fs", path: ["writeFileSync"] },
  { id: "fs.existsSync", module: "fs", path: ["existsSync"] },
  { id: "fs.statSync", module: "fs", path: ["statSync"] },
  { id: "fs.promises.readFile", module: "fs", path: ["readFile"] },
  { id: "fs.promises.writeFile", module: "fs", path: ["writeFile"] },
  { id: "fs.promises.mkdir", module: "fs", path: ["mkdir"] },
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

  // stream (skeleton; machine callbacks stay mock-recommended)
  { id: "stream.Readable", module: "stream", path: ["Readable"] },
  { id: "stream.Writable", module: "stream", path: ["Writable"] },
  { id: "stream.Duplex", module: "stream", path: ["Duplex"] },
  { id: "stream.Transform", module: "stream", path: ["Transform"] },
  { id: "stream.pipeline", module: "stream", path: ["pipeline"] },
  {
    id: "stream.machine-callbacks",
    module: "stream",
    path: ["Transform"],
    forceMock: true,
    note: "Node stream machine drives internal callbacks — design-limitations §八",
  },

  // querystring
  { id: "querystring.parse", module: "querystring", path: ["parse"] },
  { id: "querystring.stringify", module: "querystring", path: ["stringify"] },

  // crypto / process / os
  { id: "crypto.randomUUID", module: "crypto", path: ["randomUUID"] },
  { id: "crypto.createHash", module: "crypto", path: ["createHash"] },
  { id: "crypto.randomBytes", module: "crypto", path: ["randomBytes"] },
  { id: "process.env", path: ["process", "env"] },
  { id: "process.cwd", path: ["process", "cwd"] },
  { id: "process.argv", path: ["process", "argv"] },
  { id: "os.platform", module: "os", path: ["platform"] },
  { id: "Buffer.from", path: ["Buffer", "from"] },

  // child_process / native boundary
  {
    id: "child_process.spawn-native",
    module: "child_process",
    path: ["spawn"],
    forceMock: true,
    note: "native process spawn — mock or env signature only; no side-effect simulation",
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
    note: ".d.ts harvest via harvestNodeTypes / nudo harvest node",
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
      reason: "present but formatShape is unknown/any (signature only, no leaf shape)",
    };
  }
  return {
    ...probe,
    status: "resolved",
    format,
    reason: "present in handwritten env with concrete Abs shape",
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
      "Extensional env coverage baseline — resolution rate is NOT a soundness/completeness claim. See design-limitations.md §八 and website semantics mock-boundary section.",
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
      total: nodeResults.length,
      results: nodeResults,
    },
    esProbes: {
      counts: countByStatus(esResults),
      total: esResults.length,
      results: esResults,
    },
    webProbes: {
      counts: countByStatus(webResults),
      total: webResults.length,
      results: webResults,
    },
    libraryProbes: libResults,
  };

  const outDir = join(root, "docs", "reports");
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, "env-coverage-baseline.json");
  const mdPath = join(outDir, "env-coverage-baseline.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const md: string[] = [];
  md.push("# Env / Node coverage baseline");
  md.push("");
  md.push("> **Generated** by `scripts/env-coverage-baseline.ts` (`pnpm run coverage:env`).");
  md.push("> Do not hand-edit numbers — regenerate the report.");
  md.push(">");
  md.push("> **Honest boundary:** resolution rate is *not* a soundness guarantee.");
  md.push("> Categories still recommended for mock are listed below and aligned with");
  md.push("> `docs/design-limitations.md` §八 (call-site ceiling).");
  md.push("");
  md.push(`- Generated at: \`${generatedAt}\``);
  md.push(`- Harvest budgets: maxFiles=\`${report.budgets.harvestNodeTypes.maxFiles}\`, maxMs=\`${report.budgets.harvestNodeTypes.maxMs}\`, disable=\`NUDO_HARVEST_NODE=off\``);
  md.push("");
  md.push("## Summary — Node env probes");
  md.push("");
  md.push(`| Status | Count |`);
  md.push(`|---|---:|`);
  md.push(`| resolved | ${nodeCounts.resolved} |`);
  md.push(`| unknown | ${nodeCounts.unknown} |`);
  md.push(`| mock-required | ${nodeCounts["mock-required"]} |`);
  md.push(`| **total** | ${report.nodeProbes.total} |`);
  md.push("");
  const resolvedPct =
    report.nodeProbes.total === 0
      ? 0
      : Math.round((nodeCounts.resolved / report.nodeProbes.total) * 1000) / 10;
  md.push(`Resolved ratio (resolved / total): **${resolvedPct}%**`);
  md.push("");
  md.push("### Probe detail (node)");
  md.push("");
  md.push("| Probe | Status | Format | Reason |");
  md.push("|---|---|---|---|");
  for (const r of nodeResults) {
    md.push(
      `| \`${r.id}\` | ${r.status} | ${r.format ? `\`${r.format.replace(/\|/g, "\\|")}\`` : "—"} | ${r.reason} |`,
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
  md.push("| `@types/*` / package ships `.d.ts` | `harvestDts` / `harvestNodeTypes` / `nudo harvest` → env injection |");
  md.push("| Neither JS analysis path nor types | **mock-required** — use `@nudo:mock` / path `@nudo:env` / sidecar hint |");
  md.push("");
  md.push("## Still mock-recommended categories");
  md.push("");
  md.push("- Native bindings (process spawn, native addons)");
  md.push("- Dynamic `require` / computed module graphs");
  md.push("- Stream machine callbacks (Node Transform internals) — design-limitations §八");
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
        `(unknown=${nodeCounts.unknown}, mock-required=${nodeCounts["mock-required"]})\n` +
        `wrote ${jsonPath}\nwrote ${mdPath}\n`,
    );
  }
}

main();
