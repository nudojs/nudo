/**
 * Entry-variant (browser / node) observation signal.
 *
 * (Module named entry-variants to avoid "dual engine" confusion; the
 * product diagnostic code remains `nudo:dual-entry`.)
 *
 * Call-site records are file-scoped: when a package ships separate browser and
 * node entrypoints, records collected against one variant do **not** inject
 * into analysis of the other (design limitation, not a bug). This module makes
 * that ceiling visible: when analysis runs on one entry variant of a dual-entry
 * package, emit `nudo:dual-entry` once so the user is not left thinking both
 * entries were covered.
 *
 * Zero-FP discipline: fires only when package.json really declares two faces
 * (browser + node/default) that resolve to **different** files, and the file
 * being analyzed is one of those entry targets. Single-entry packages never
 * fire.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type EntryVariantInfo = {
  pkgPath: string;
  pkgDir: string;
  pkgName?: string;
  kind: "exports-conditions" | "browser-field";
  /** resolved absolute paths of the browser face */
  browserPaths: string[];
  /** resolved absolute paths of the node/default face */
  nodePaths: string[];
  /** which face the analyzed file belongs to */
  role: "browser" | "node";
  /** display targets (as declared, relative) for the message */
  browserTargets: string[];
  nodeTargets: string[];
};

type EntryVariantFaces = {
  kind: "exports-conditions" | "browser-field";
  browser: string[];
  node: string[];
};

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, into);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, into);
  }
}

/** Walk a package.json `exports` condition tree, splitting browser vs node-ish leaves. */
function collectExportFaces(exportsField: unknown, browser: string[], node: string[]): void {
  if (exportsField == null) return;
  if (typeof exportsField === "string") {
    node.push(exportsField);
    return;
  }
  const walk = (val: unknown, inBrowser: boolean): void => {
    if (typeof val === "string") {
      if (inBrowser) browser.push(val);
      else node.push(val);
      return;
    }
    if (Array.isArray(val)) {
      for (const v of val) walk(v, inBrowser);
      return;
    }
    if (!val || typeof val !== "object") return;
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (k.startsWith(".")) {
        // subpath key (".", "./feature") — same condition tree
        walk(v, inBrowser);
      } else if (k === "browser" || k === "web") {
        walk(v, true);
      } else {
        // node / default / import / require / types / … — node-ish unless already under browser
        walk(v, inBrowser);
      }
    }
  };
  walk(exportsField, false);
}

/**
 * Detect browser/node dual faces in a parsed package.json.
 * Returns null unless both faces exist and differ (zero-FP on single-entry).
 */
export function detectEntryVariantsFromPackageJson(pkg: unknown): EntryVariantFaces | null {
  if (!pkg || typeof pkg !== "object") return null;
  const p = pkg as Record<string, unknown>;

  const browser: string[] = [];
  const node: string[] = [];

  collectExportFaces(p.exports, browser, node);

  // legacy top-level `browser` field (string entry or remap map)
  const bField = p.browser;
  if (typeof bField === "string") browser.push(bField);
  else if (bField && typeof bField === "object") {
    for (const v of Object.values(bField as Record<string, unknown>)) {
      if (typeof v === "string") browser.push(v);
    }
    // remap keys are the node-side sources
    for (const k of Object.keys(bField as Record<string, unknown>)) {
      if (k.startsWith(".")) node.push(k);
    }
  }
  if (typeof p.main === "string") node.push(p.main);
  if (typeof p.module === "string") node.push(p.module);

  const browserPaths = uniqueResolved(browser, null);
  const nodePaths = uniqueResolved(node, null);
  if (browserPaths.length === 0 || nodePaths.length === 0) return null;

  const browserSet = new Set(browserPaths);
  const nodeSet = new Set(nodePaths);
  // identical faces = not dual (e.g. browser === main)
  if (browserSet.size === nodeSet.size && [...browserSet].every((p) => nodeSet.has(p))) {
    return null;
  }

  const kind: EntryVariantFaces["kind"] =
    typeof p.exports !== "undefined" && collectExportHasBrowser(p.exports)
      ? "exports-conditions"
      : "browser-field";
  return { kind, browser: [...new Set(browser)], node: [...new Set(node)] };
}

function collectExportHasBrowser(exportsField: unknown): boolean {
  if (!exportsField || typeof exportsField !== "object") return false;
  const walk = (val: unknown): boolean => {
    if (!val || typeof val !== "object") return false;
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (k === "browser" || k === "web") return true;
      if (walk(v)) return true;
    }
    return false;
  };
  return walk(exportsField);
}

function uniqueResolved(targets: string[], pkgDir: string | null): string[] {
  const out = new Set<string>();
  for (const t of targets) {
    if (typeof t !== "string" || t.length === 0) continue;
    out.add(pkgDir === null ? normalizeTarget(t) : resolve(pkgDir, t));
  }
  return [...out];
}

function normalizeTarget(t: string): string {
  // compare relative targets consistently (./a.js vs a.js)
  return t.replace(/^\.\//, "");
}

/** Nearest package.json walking up from the file's directory. */
export function findOwningPackage(
  fromFile: string,
): { path: string; dir: string; pkg: Record<string, unknown> } | null {
  let dir = dirname(resolve(fromFile));
  const root = resolve("/");
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
        return { path: pkgPath, dir, pkg };
      } catch {
        return null;
      }
    }
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Dual-entry info for an analyzed file: the owning package must declare two
 * differing faces **and** this file must be one of the entry targets.
 * Returns null otherwise (single-entry packages, shared helpers, …).
 */
export function entryVariantForFile(filePath: string): EntryVariantInfo | null {
  let owning: { path: string; dir: string; pkg: Record<string, unknown> } | null = null;
  try {
    owning = findOwningPackage(filePath);
  } catch {
    return null;
  }
  if (!owning) return null;

  const faces = detectEntryVariantsFromPackageJson(owning.pkg);
  if (!faces) return null;

  const abs = resolve(filePath);
  const browserPaths = uniqueResolved(faces.browser, owning.dir);
  const nodePaths = uniqueResolved(faces.node, owning.dir);
  const inBrowser = browserPaths.includes(abs);
  const inNode = nodePaths.includes(abs);
  // shared target (same file on both faces) is not a dual variant — records
  // would land on the same path; never fire (zero-FP).
  if (!inBrowser && !inNode) return null;
  if (inBrowser && inNode) return null;

  return {
    pkgPath: owning.path,
    pkgDir: owning.dir,
    ...(typeof owning.pkg.name === "string" ? { pkgName: owning.pkg.name } : {}),
    kind: faces.kind,
    browserPaths,
    nodePaths,
    role: inBrowser ? "browser" : "node",
    browserTargets: [...new Set(faces.browser.map(normalizeTarget))],
    nodeTargets: [...new Set(faces.node.map(normalizeTarget))],
  };
}

export function entryVariantMessage(info: EntryVariantInfo): string {
  const name = info.pkgName ? `"${info.pkgName}"` : info.pkgPath;
  const b = info.browserTargets.join(", ") || "(browser)";
  const n = info.nodeTargets.join(", ") || "(node)";
  return (
    `dual-entry package ${name}: browser (${b}) and node (${n}) call-site records ` +
    `do not cross files — analysis observes only the ${info.role} entry variant`
  );
}

export function entryVariantSuggestion(): string {
  return (
    "analyze the entry you ship and mock or skip the other variant; " +
    "browser/node records stay file-scoped (limits: dual package entrypoints)"
  );
}

/** Host-facing info issue (CLI check / JSON) for one analyzed entry variant. */
export type EntryVariantIssue = {
  severity: "info";
  code: "nudo:dual-entry";
  message: string;
  suggestion: string;
  line: number;
  column: number;
};

export function entryVariantIssueForFile(filePath: string): EntryVariantIssue | null {
  const info = entryVariantForFile(filePath);
  if (!info) return null;
  return {
    severity: "info",
    code: "nudo:dual-entry",
    message: entryVariantMessage(info),
    suggestion: entryVariantSuggestion(),
    line: 0,
    column: 0,
  };
}
