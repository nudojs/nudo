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
 * (browser + node/default) that resolve to **different** files, **within the
 * same subpath / field-source group**, and the file being analyzed is one of
 * those entry targets. Multi-subpath packages do not leak faces across
 * subpaths (a single-entry `"."` never inherits `"./tool"`'s dual pair).
 * Single-entry groups never fire.
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

/** One browser/node face pair, scoped to a subpath or field source. */
export type EntryVariantFaceGroup = {
  /** group id: `exports:.`, `exports:./tool`, `browser-field`, `browser:./lib.js` */
  key: string;
  browser: string[];
  node: string[];
};

export type EntryVariantFaces = {
  kind: "exports-conditions" | "browser-field";
  /**
   * Faces grouped by subpath / field source. A group is dual only when its own
   * browser and node leaves resolve to different files — never compare across
   * groups (multi-subpath zero-FP).
   */
  groups: Map<string, EntryVariantFaceGroup>;
};

/** Walk one condition tree, splitting browser vs node-ish leaves. */
function collectConditionFaces(val: unknown): { browser: string[]; node: string[] } {
  const browser: string[] = [];
  const node: string[] = [];
  const walk = (v: unknown, inBrowser: boolean): void => {
    if (typeof v === "string") {
      (inBrowser ? browser : node).push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, inBrowser);
      return;
    }
    if (!v || typeof v !== "object") return;
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      if (k === "browser" || k === "web") walk(child, true);
      // node / default / import / require / types / … — node-ish unless already under browser
      else walk(child, inBrowser);
    }
  };
  walk(val, false);
  return { browser, node };
}

function putGroup(
  groups: Map<string, EntryVariantFaceGroup>,
  key: string,
  faces: { browser: string[]; node: string[] },
): void {
  const existing = groups.get(key);
  if (!existing) {
    groups.set(key, { key, browser: [...faces.browser], node: [...faces.node] });
    return;
  }
  existing.browser.push(...faces.browser);
  existing.node.push(...faces.node);
}

/**
 * Collect `exports` faces **per subpath** (`.`, `./feature`, …). Top-level
 * condition keys without a subpath map mean the implicit `"."` subpath.
 */
function collectExportGroups(exportsField: unknown, groups: Map<string, EntryVariantFaceGroup>): void {
  if (exportsField == null) return;
  if (typeof exportsField === "string") {
    putGroup(groups, "exports:.", { browser: [], node: [exportsField] });
    return;
  }
  if (Array.isArray(exportsField)) {
    putGroup(groups, "exports:.", collectConditionFaces(exportsField));
    return;
  }
  if (typeof exportsField !== "object") return;
  const entries = Object.entries(exportsField as Record<string, unknown>);
  const hasSubpath = entries.some(([k]) => k.startsWith("."));
  if (hasSubpath) {
    for (const [k, v] of entries) {
      if (k.startsWith(".")) putGroup(groups, `exports:${k}`, collectConditionFaces(v));
    }
    return;
  }
  // condition map for the implicit "." subpath
  putGroup(groups, "exports:.", collectConditionFaces(exportsField));
}

/** True when a single group's own browser and node faces both exist and differ. */
function isGroupDual(group: { browser: string[]; node: string[] }): boolean {
  const browserPaths = uniqueResolved(group.browser, null);
  const nodePaths = uniqueResolved(group.node, null);
  if (browserPaths.length === 0 || nodePaths.length === 0) return false;
  const browserSet = new Set(browserPaths);
  const nodeSet = new Set(nodePaths);
  // identical faces = not dual (e.g. browser === main)
  if (browserSet.size === nodeSet.size && [...browserSet].every((p) => nodeSet.has(p))) return false;
  return true;
}

/**
 * Detect browser/node dual faces in a parsed package.json.
 * Faces are grouped by subpath / field source; returns null unless **some
 * group** is dual (zero-FP on single-entry groups and single-entry packages).
 */
export function detectEntryVariantsFromPackageJson(pkg: unknown): EntryVariantFaces | null {
  if (!pkg || typeof pkg !== "object") return null;
  const p = pkg as Record<string, unknown>;

  const groups = new Map<string, EntryVariantFaceGroup>();

  collectExportGroups(p.exports, groups);

  // legacy top-level `browser` field (string entry or remap map)
  const browserField = p.browser;
  if (typeof browserField === "string") {
    // classic pair: browser string vs main (the node entry). `module` is a
    // bundler ESM face — not a node face — and is deliberately not collected.
    putGroup(groups, "browser-field", {
      browser: [browserField],
      node: typeof p.main === "string" ? [p.main] : [],
    });
  } else if (browserField && typeof browserField === "object") {
    for (const [k, v] of Object.entries(browserField as Record<string, unknown>)) {
      // remap key = node-side source file; bare module ids ("fs": false) are not file entries
      if (!k.startsWith(".")) continue;
      const browser: string[] = [];
      if (typeof v === "string") browser.push(v);
      // v === true means "same file in browser"
      else if (v === true) browser.push(k);
      // v === false disables the module in browser — no browser face (do not
      // fake one); the key stays the node-side source of *this* pair only.
      putGroup(groups, `browser:${normalizeTarget(k)}`, { browser, node: [k] });
    }
  }

  if (![...groups.values()].some(isGroupDual)) return null;

  const kind: EntryVariantFaces["kind"] =
    typeof p.exports !== "undefined" && collectExportHasBrowser(p.exports)
      ? "exports-conditions"
      : "browser-field";
  return { kind, groups };
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
 * Dual-entry info for an analyzed file: the owning package must declare a
 * dual group (browser + node faces resolving to different files **in the same
 * subpath / field source**) **and** this file must be one of that group's
 * entry targets on exactly one face. Returns null otherwise (single-entry
 * groups, shared helpers, single-entry subpaths of a multi-subpath package, …).
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
  // only the group this file belongs to may justify a dual-entry signal
  for (const group of faces.groups.values()) {
    const browserPaths = uniqueResolved(group.browser, owning.dir);
    const nodePaths = uniqueResolved(group.node, owning.dir);
    const inBrowser = browserPaths.includes(abs);
    const inNode = nodePaths.includes(abs);
    if (!inBrowser && !inNode) continue;
    // shared target (same file on both faces) is not a dual variant — records
    // would land on the same path; never fire (zero-FP).
    if (inBrowser && inNode) continue;
    // single-entry group (e.g. exports "." with one file) never fires
    if (!isGroupDual(group)) continue;

    return {
      pkgPath: owning.path,
      pkgDir: owning.dir,
      ...(typeof owning.pkg.name === "string" ? { pkgName: owning.pkg.name } : {}),
      kind: faces.kind,
      browserPaths,
      nodePaths,
      role: inBrowser ? "browser" : "node",
      browserTargets: [...new Set(group.browser.map(normalizeTarget))],
      nodeTargets: [...new Set(group.node.map(normalizeTarget))],
    };
  }
  return null;
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
