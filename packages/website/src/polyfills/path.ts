/**
 * Minimal Node `path` polyfill for the website/playground browser bundle.
 * Analysis code calls path.dirname/join on virtual filenames; webpack
 * fallback:false would make those undefined.
 */

function splitPath(p: string): string[] {
  return p.split(/[/\\]+/).filter((s) => s.length > 0);
}

export const sep = "/";
export const delimiter = ":";

export function isAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

export function normalize(p: string): string {
  if (!p) return ".";
  const absolute = isAbsolute(p);
  const trailing = /[/\\]$/.test(p);
  const parts = splitPath(p);
  const out: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(part);
  }
  let result = out.join("/");
  if (absolute) result = "/" + result.replace(/^\/+/, "");
  if (!result) result = absolute ? "/" : ".";
  if (trailing && !result.endsWith("/")) result += "/";
  return result;
}

export function join(...parts: string[]): string {
  const joined = parts.filter((p) => p != null && p !== "").join("/");
  return joined ? normalize(joined) : ".";
}

export function resolve(...parts: string[]): string {
  let resolved = "";
  let absolute = false;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i] ?? "";
    if (!part) continue;
    resolved = resolved ? part + "/" + resolved : part;
    if (isAbsolute(part)) {
      absolute = true;
      break;
    }
  }
  if (!absolute) resolved = "/" + resolved;
  resolved = normalize(resolved);
  return resolved.length > 1 && resolved.endsWith("/")
    ? resolved.slice(0, -1)
    : resolved || "/";
}

export function dirname(p: string): string {
  if (!p) return ".";
  const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  if (idx < 0) return ".";
  if (idx === 0) return "/";
  return normalized.slice(0, idx);
}

export function basename(p: string, ext?: string): string {
  const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  let base = idx < 0 ? normalized : normalized.slice(idx + 1);
  if (ext && base.endsWith(ext) && base !== ext) base = base.slice(0, -ext.length);
  return base;
}

export function extname(p: string): string {
  const base = basename(p);
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return "";
  return base.slice(idx);
}

export function relative(from: string, to: string): string {
  const f = resolve(from).split("/").filter(Boolean);
  const t = resolve(to).split("/").filter(Boolean);
  let i = 0;
  while (i < f.length && i < t.length && f[i] === t[i]) i++;
  const up = f.slice(i).map(() => "..");
  return [...up, ...t.slice(i)].join("/") || ".";
}

const pathShim = {
  sep,
  delimiter,
  posix: null as unknown,
  win32: null as unknown,
  isAbsolute,
  normalize,
  join,
  resolve,
  dirname,
  basename,
  extname,
  relative,
};

pathShim.posix = pathShim;
pathShim.win32 = pathShim;

export default pathShim;
