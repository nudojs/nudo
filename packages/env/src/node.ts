/**
 * Node env：es globals + node 内建 modules（Abs 原生）。
 */

import {
  type Abs,
  type AbsSigImpl,
  litValue,
  strLit,
  boolLit,
} from "@nudojs/core";
import {
  arrOf,
  brandOf,
  dateAbs,
  envFn,
  envFnVariadic,
  nullLit,
  objAbs,
  openObjBrand,
  promiseOf,
  tupleOf,
  undef,
  unionOf,
  prim,
} from "./abs-helpers.ts";
import { type EnvDefinition, defineEnv as defineEsEnv } from "./es.ts";
import nodePath from "node:path";

export type { EnvDefinition };

function absStr(a: Abs | undefined): string | undefined {
  if (!a) return undefined;
  const v = litValue(a);
  return typeof v === "string" ? v : undefined;
}

function allAbsStr(args: Abs[]): string[] | undefined {
  const result: string[] = [];
  for (const a of args) {
    const s = absStr(a);
    if (s === undefined) return undefined;
    result.push(s);
  }
  return result;
}

export function defineEnv(): EnvDefinition {
  const esEnv = defineEsEnv();

  const BufferInstance = brandOf(
    "Buffer",
    objAbs({
      toString: envFn([prim.str(), prim.num(), prim.num()], prim.str(), undefined, {
        params: ["encoding?", "start?", "end?"],
      }),
      toJSON: envFn(
        [],
        objAbs({ type: prim.str(), data: arrOf(prim.num()) }),
      ),
      length: prim.num(),
      slice: envFn([prim.num(), prim.num()], brandOf("Buffer")),
      copy: envFn(
        [brandOf("Buffer"), prim.num(), prim.num(), prim.num()],
        prim.num(),
      ),
      write: envFn(
        [prim.str(), prim.num(), prim.num(), prim.str()],
        prim.num(),
      ),
      readUInt8: envFn([prim.num()], prim.num()),
      readUInt16BE: envFn([prim.num()], prim.num()),
      readUInt16LE: envFn([prim.num()], prim.num()),
      readUInt32BE: envFn([prim.num()], prim.num()),
      readUInt32LE: envFn([prim.num()], prim.num()),
      readInt8: envFn([prim.num()], prim.num()),
      readInt16BE: envFn([prim.num()], prim.num()),
      readInt16LE: envFn([prim.num()], prim.num()),
      readInt32BE: envFn([prim.num()], prim.num()),
      readInt32LE: envFn([prim.num()], prim.num()),
      includes: envFn([unionOf(prim.str(), prim.num())], prim.bool()),
      indexOf: envFn([unionOf(prim.str(), prim.num())], prim.num()),
      fill: envFn([unionOf(prim.str(), prim.num())], brandOf("Buffer")),
      equals: envFn([brandOf("Buffer")], prim.bool()),
      compare: envFn([brandOf("Buffer")], prim.num()),
      subarray: envFn([prim.num(), prim.num()], brandOf("Buffer")),
    }),
  );

  // Buffer brand 作为槽位时用同一实例引用（避免重复 brand）
  const bufferBrand = BufferInstance;

  const errOrNull = unionOf(brandOf("Error"), nullLit());
  const dateOr = dateAbs();

  /** fs 通用 encoding/flag options（readFile/writeFile 等） */
  const encodingOptions = objAbs({
    encoding: { value: prim.str(), optional: true },
    flag: { value: prim.str(), optional: true },
  });
  const encodingOptionsArg = unionOf(prim.str(), encodingOptions);

  const statOptions = objAbs({
    bigint: { value: prim.bool(), optional: true },
    throwIfNoEntry: { value: prim.bool(), optional: true },
  });

  const mkdirOptions = objAbs({
    recursive: { value: prim.bool(), optional: true },
    mode: { value: prim.num(), optional: true },
  });

  const rmOptions = objAbs({
    recursive: { value: prim.bool(), optional: true },
    force: { value: prim.bool(), optional: true },
    maxRetries: { value: prim.num(), optional: true },
    retryDelay: { value: prim.num(), optional: true },
  });

  const readdirOptions = objAbs({
    encoding: { value: prim.str(), optional: true },
    withFileTypes: { value: prim.bool(), optional: true },
    recursive: { value: prim.bool(), optional: true },
  });

  const inspectOptions = objAbs({
    showHidden: { value: prim.bool(), optional: true },
    depth: { value: prim.num(), optional: true },
    colors: { value: prim.bool(), optional: true },
    customInspect: { value: prim.bool(), optional: true },
    maxArrayLength: { value: prim.num(), optional: true },
    breakLength: { value: prim.num(), optional: true },
    compact: { value: prim.bool(), optional: true },
    sorted: { value: prim.bool(), optional: true },
  });

  const querystringOptions = objAbs({
    maxKeys: { value: prim.num(), optional: true },
  });

  const streamOptions = objAbs({
    highWaterMark: { value: prim.num(), optional: true },
    objectMode: { value: prim.bool(), optional: true },
    encoding: { value: prim.str(), optional: true },
    autoDestroy: { value: prim.bool(), optional: true },
    emitClose: { value: prim.bool(), optional: true },
  });

  const eventEmitterOptions = objAbs({
    captureRejections: { value: prim.bool(), optional: true },
  });

  /** 无约束参数：产品语义 = any（≠ unknown 推导失败） */
  const anyParam = prim.any();

  /** 回调/高阶 fn 角色 brand — 真实形参 arity 由调用点决定 */
  const callbackFnBrand = brandOf(
    "CallbackFn",
    envFnVariadic(anyParam, undef(), { restName: "...args" }),
  );
  const promiseFnBrand = brandOf(
    "PromiseFn",
    envFnVariadic(anyParam, promiseOf(anyParam), { restName: "...args" }),
  );
  /** 断言/工具接受的任意值（无约束） */
  const anyValueBrand = brandOf("Value");

  /** path.posix / path.win32 平台路径对象 */
  const platformPathMethods = () => ({
    join: envFnVariadic(prim.str(), prim.str(), {
      restName: "...paths",
    }),
    resolve: envFnVariadic(prim.str(), prim.str(), {
      restName: "...paths",
    }),
    dirname: envFn([prim.str()], prim.str()),
    basename: envFn([prim.str(), prim.str()], prim.str(), undefined, {
      params: ["path", "ext?"],
    }),
    extname: envFn([prim.str()], prim.str()),
    normalize: envFn([prim.str()], prim.str()),
    isAbsolute: envFn([prim.str()], prim.bool()),
    relative: envFn([prim.str(), prim.str()], prim.str()),
    sep: prim.str(),
    delimiter: prim.str(),
  });

  const fsModule: Record<string, Abs> = {
    // encoding 字面量 → string；否则 string|Buffer（TS 重载近似）
    readFileSync: envFn(
      [prim.str(), encodingOptionsArg],
      unionOf(prim.str(), bufferBrand),
      (args) => {
        const enc = args[1];
        if (!enc) return unionOf(prim.str(), bufferBrand);
        if (enc.term?.op === "lit" && typeof enc.term.value === "string") {
          return prim.str();
        }
        if (enc.shape.k === "prim" && enc.shape.type === "string" && !enc.term) {
          return prim.str();
        }
        return unionOf(prim.str(), bufferBrand);
      },
      { params: ["path", "options?"] },
    ),
    writeFileSync: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), encodingOptionsArg],
      undef(),
      undefined,
      { params: ["path", "data", "options?"] },
    ),
    appendFileSync: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), encodingOptionsArg],
      undef(),
      undefined,
      { params: ["path", "data", "options?"] },
    ),
    existsSync: envFn([prim.str()], prim.bool()),
    mkdirSync: envFn(
      [prim.str(), mkdirOptions],
      unionOf(prim.str(), undef()),
      undefined,
      { params: ["path", "options?"] },
    ),
    rmdirSync: envFn([prim.str()], undef()),
    rmSync: envFn(
      [prim.str(), rmOptions],
      undef(),
      undefined,
      { params: ["path", "options?"] },
    ),
    unlinkSync: envFn([prim.str()], undef()),
    renameSync: envFn([prim.str(), prim.str()], undef()),
    copyFileSync: envFn([prim.str(), prim.str()], undef()),
    statSync: envFn(
      [prim.str(), statOptions],
      objAbs({
        isFile: envFn([], prim.bool()),
        isDirectory: envFn([], prim.bool()),
        isSymbolicLink: envFn([], prim.bool()),
        isBlockDevice: envFn([], prim.bool()),
        isCharacterDevice: envFn([], prim.bool()),
        isFIFO: envFn([], prim.bool()),
        isSocket: envFn([], prim.bool()),
        size: prim.num(),
        mtime: dateOr,
        ctime: dateOr,
        atime: dateOr,
        birthtime: dateOr,
        mtimeMs: prim.num(),
        ctimeMs: prim.num(),
        atimeMs: prim.num(),
        birthtimeMs: prim.num(),
        mode: prim.num(),
        uid: prim.num(),
        gid: prim.num(),
        ino: prim.num(),
        dev: prim.num(),
        nlink: prim.num(),
      }),
      undefined,
      { params: ["path", "options?"] },
    ),
    readdirSync: envFn(
      [prim.str(), readdirOptions],
      // brand 名避免 `string | Dirent[]` 的结合歧义（真实是 (string|Dirent)[]）
      brandOf(
        "Array<string | Dirent>",
        arrOf(unionOf(prim.str(), brandOf("Dirent", objAbs({
          name: prim.str(),
          isFile: envFn([], prim.bool()),
          isDirectory: envFn([], prim.bool()),
          isSymbolicLink: envFn([], prim.bool()),
        })))),
      ),
      undefined,
      { params: ["path", "options?"] },
    ),
    realpathSync: envFn([prim.str()], prim.str()),
    readlinkSync: envFn([prim.str()], prim.str()),
    symlinkSync: envFn([prim.str(), prim.str()], undef()),
    chmodSync: envFn([prim.str(), prim.num()], undef()),
    chownSync: envFn([prim.str(), prim.num(), prim.num()], undef()),
    accessSync: envFn([prim.str(), prim.num()], undef()),
    // Callback-style async on `fs` / `node:fs` (Node actual API).
    // Promise APIs live only under fs.promises / node:fs/promises.
    readFile: envFn(
      [prim.str(), encodingOptionsArg, callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    writeFile: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), encodingOptionsArg, callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "data", "options?", "callback"] },
    ),
    mkdir: envFn(
      [prim.str(), mkdirOptions, callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    rm: envFn(
      [prim.str(), rmOptions, callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    stat: envFn(
      [prim.str(), statOptions, callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    readdir: envFn(
      [prim.str(), readdirOptions, callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    access: envFn(
      [prim.str(), prim.num(), callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "mode?", "callback"] },
    ),
    appendFile: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), encodingOptionsArg, callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "data", "options?", "callback"] },
    ),
    unlink: envFn(
      [prim.str(), callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "callback"] },
    ),
    rename: envFn(
      [prim.str(), prim.str(), callbackFnBrand],
      undef(),
      undefined,
      { params: ["oldPath", "newPath", "callback"] },
    ),
    copyFile: envFn(
      [prim.str(), prim.str(), callbackFnBrand],
      undef(),
      undefined,
      { params: ["src", "dest", "callback"] },
    ),
    realpath: envFn(
      [prim.str(), encodingOptionsArg, callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    readlink: envFn(
      [prim.str(), encodingOptionsArg, callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    symlink: envFn(
      [prim.str(), prim.str(), prim.str(), callbackFnBrand],
      undef(),
      undefined,
      { params: ["target", "path", "type?", "callback"] },
    ),
    chmod: envFn(
      [prim.str(), prim.num(), callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "mode", "callback"] },
    ),
    open: envFn(
      [prim.str(), unionOf(prim.str(), prim.num()), callbackFnBrand],
      undef(),
      undefined,
      { params: ["path", "flags?", "callback"] },
    ),
  };

  /** fs.promises / node:fs/promises — Promise-returning slots only here. */
  const fsPromisesModule: Record<string, Abs> = {
    readFile: envFn(
      [prim.str(), encodingOptionsArg],
      promiseOf(unionOf(prim.str(), bufferBrand)),
      undefined,
      { params: ["path", "options?"] },
    ),
    writeFile: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), encodingOptionsArg],
      promiseOf(undef()),
      undefined,
      { params: ["path", "data", "options?"] },
    ),
    mkdir: envFn(
      [prim.str(), mkdirOptions],
      promiseOf(unionOf(prim.str(), undef())),
      undefined,
      { params: ["path", "options?"] },
    ),
    rm: envFn(
      [prim.str(), rmOptions],
      promiseOf(undef()),
      undefined,
      { params: ["path", "options?"] },
    ),
    stat: envFn(
      [prim.str(), statOptions],
      promiseOf(objAbs({
        isFile: envFn([], prim.bool()),
        isDirectory: envFn([], prim.bool()),
        isSymbolicLink: envFn([], prim.bool()),
        size: prim.num(),
        mtime: dateOr,
        ctime: dateOr,
        atime: dateOr,
        birthtime: dateOr,
        mode: prim.num(),
        uid: prim.num(),
        gid: prim.num(),
      })),
      undefined,
      { params: ["path", "options?"] },
    ),
    readdir: envFn(
      [prim.str(), readdirOptions],
      promiseOf(brandOf(
        "Array<string | Dirent>",
        arrOf(unionOf(prim.str(), brandOf("Dirent"))),
      )),
      undefined,
      { params: ["path", "options?"] },
    ),
    access: envFn([prim.str(), prim.num()], promiseOf(undef())),
    appendFile: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), encodingOptionsArg],
      promiseOf(undef()),
      undefined,
      { params: ["path", "data", "options?"] },
    ),
    unlink: envFn([prim.str()], promiseOf(undef())),
    rename: envFn([prim.str(), prim.str()], promiseOf(undef())),
    copyFile: envFn([prim.str(), prim.str()], promiseOf(undef())),
    realpath: envFn([prim.str(), encodingOptionsArg], promiseOf(prim.str()), undefined, {
      params: ["path", "options?"],
    }),
    readlink: envFn([prim.str(), encodingOptionsArg], promiseOf(prim.str()), undefined, {
      params: ["path", "options?"],
    }),
    symlink: envFn([prim.str(), prim.str(), prim.str()], promiseOf(undef()), undefined, {
      params: ["target", "path", "type?"],
    }),
    chmod: envFn([prim.str(), prim.num()], promiseOf(undef())),
    open: envFn([prim.str(), prim.str()], promiseOf(brandOf("FileHandle"))),
  };

  const strImpl1Abs = (fn: (a: string) => string): AbsSigImpl => (args) => {
    const a = absStr(args[0]);
    return a !== undefined ? strLit(fn(a)) : undefined;
  };

  const pathJoinAbs: AbsSigImpl = (args) => {
    const strs = allAbsStr(args);
    return strs ? strLit(nodePath.join(...strs)) : undefined;
  };
  const pathResolveAbs: AbsSigImpl = (args) => {
    const strs = allAbsStr(args);
    return strs ? strLit(nodePath.resolve(...strs)) : undefined;
  };
  const pathBasenameAbs: AbsSigImpl = (args) => {
    const p = absStr(args[0]);
    if (p === undefined) return undefined;
    const ext = args[1] !== undefined ? absStr(args[1]) : undefined;
    return strLit(ext !== undefined ? nodePath.basename(p, ext) : nodePath.basename(p));
  };
  const pathRelativeAbs: AbsSigImpl = (args) => {
    const from = absStr(args[0]);
    const to = absStr(args[1]);
    return from !== undefined && to !== undefined
      ? strLit(nodePath.relative(from, to))
      : undefined;
  };
  const pathIsAbsoluteAbs: AbsSigImpl = (args) => {
    const p = absStr(args[0]);
    return p !== undefined ? boolLit(nodePath.isAbsolute(p)) : undefined;
  };

  const pathModule: Record<string, Abs> = {
    // Node variadic: declare min required arity + rest label (not n fixed slots).
    join: envFnVariadic(prim.str(), prim.str(), {
      apply: pathJoinAbs,
      required: [prim.str()],
      restName: "...paths",
    }),
    resolve: envFnVariadic(prim.str(), prim.str(), {
      apply: pathResolveAbs,
      restName: "...paths",
    }),
    dirname: envFn([prim.str()], prim.str(), strImpl1Abs(nodePath.dirname)),
    // ext is optional in Node — required arity 1; label+type render `ext?: string`.
    basename: envFn([prim.str(), prim.str()], prim.str(), pathBasenameAbs, {
      params: ["path", "ext?"],
    }),
    extname: envFn([prim.str()], prim.str(), strImpl1Abs(nodePath.extname)),
    relative: envFn([prim.str(), prim.str()], prim.str(), pathRelativeAbs),
    normalize: envFn([prim.str()], prim.str(), strImpl1Abs(nodePath.normalize)),
    isAbsolute: envFn([prim.str()], prim.bool(), pathIsAbsoluteAbs),
    parse: envFn(
      [prim.str()],
      objAbs({
        root: prim.str(),
        dir: prim.str(),
        base: prim.str(),
        ext: prim.str(),
        name: prim.str(),
      }),
      (args) => {
        const p = absStr(args[0]);
        if (p === undefined) return undefined;
        const parsed = nodePath.parse(p);
        return objAbs({
          root: strLit(parsed.root),
          dir: strLit(parsed.dir),
          base: strLit(parsed.base),
          ext: strLit(parsed.ext),
          name: strLit(parsed.name),
        });
      },
    ),
    format: envFn(
      [objAbs({
        root: { value: prim.str(), optional: true },
        dir: { value: prim.str(), optional: true },
        base: { value: prim.str(), optional: true },
        name: { value: prim.str(), optional: true },
        ext: { value: prim.str(), optional: true },
      })],
      prim.str(),
    ),
    // 常量：平台相关字面量在 defineEnv 时可具体化
    sep: prim.str(),
    delimiter: prim.str(),
    posix: brandOf("path.PlatformPath", objAbs(platformPathMethods())),
    win32: brandOf("path.PlatformPath", objAbs(platformPathMethods())),
  };

  const osModule: Record<string, Abs> = {
    platform: envFn([], prim.str()),
    arch: envFn([], prim.str()),
    type: envFn([], prim.str()),
    release: envFn([], prim.str()),
    hostname: envFn([], prim.str()),
    homedir: envFn([], prim.str()),
    tmpdir: envFn([], prim.str()),
    cpus: envFn(
      [],
      arrOf(objAbs({ model: prim.str(), speed: prim.num() })),
    ),
    totalmem: envFn([], prim.num()),
    freemem: envFn([], prim.num()),
    uptime: envFn([], prim.num()),
    loadavg: envFn([], tupleOf([prim.num(), prim.num(), prim.num()])),
    networkInterfaces: envFn(
      [],
      openObjBrand(
        "Record<string, NetworkInterfaceInfo[]>",
        { key: prim.str(), value: arrOf(objAbs({
          address: prim.str(),
          netmask: prim.str(),
          family: prim.str(),
          mac: prim.str(),
          internal: prim.bool(),
          cidr: unionOf(prim.str(), nullLit()),
        })) },
      ),
    ),
    userInfo: envFn(
      [],
      objAbs({
        username: prim.str(),
        uid: prim.num(),
        gid: prim.num(),
        shell: unionOf(prim.str(), nullLit()),
        homedir: prim.str(),
      }),
    ),
    EOL: prim.str(),
  };

  const nodeUrlObj = objAbs({
    href: prim.str(),
    origin: prim.str(),
    protocol: prim.str(),
    username: prim.str(),
    password: prim.str(),
    host: prim.str(),
    hostname: prim.str(),
    port: prim.str(),
    pathname: prim.str(),
    search: prim.str(),
    hash: prim.str(),
    toString: envFn([], prim.str()),
    toJSON: envFn([], prim.str()),
  });

  const urlModule: Record<string, Abs> = {
    // base is optional in Node — required arity 1; label+type render `base?: string`.
    URL: envFn(
      [prim.str(), prim.str()],
      nodeUrlObj,
      (args) => {
        const href = absStr(args[0]);
        const base = args[1] !== undefined ? absStr(args[1]) : undefined;
        if (href === undefined) return undefined;
        try {
          const url = base !== undefined ? new URL(href, base) : new URL(href);
          return objAbs({
            href: strLit(url.href),
            origin: strLit(url.origin),
            protocol: strLit(url.protocol),
            username: strLit(url.username),
            password: strLit(url.password),
            host: strLit(url.host),
            hostname: strLit(url.hostname),
            port: strLit(url.port),
            pathname: strLit(url.pathname),
            search: strLit(url.search),
            hash: strLit(url.hash),
            toString: envFn([], prim.str(), () => strLit(url.href)),
            toJSON: envFn([], prim.str(), () => strLit(url.href)),
          });
        } catch {
          return undefined;
        }
      },
      { params: ["href", "base?"] },
    ),
    URLSearchParams: envFn(
      [unionOf(
        prim.str(),
        openObjBrand("Record<string, string>", { key: prim.str(), value: prim.str() }),
        arrOf(arrOf(prim.str())),
      )],
      objAbs({
        get: envFn([prim.str()], unionOf(prim.str(), nullLit())),
        getAll: envFn([prim.str()], arrOf(prim.str())),
        has: envFn([prim.str()], prim.bool()),
        set: envFn([prim.str(), prim.str()], undef()),
        append: envFn([prim.str(), prim.str()], undef()),
        delete: envFn([prim.str()], undef()),
        toString: envFn([], prim.str()),
        size: prim.num(),
      }),
      undefined,
      { params: ["init?"] },
    ),
    fileURLToPath: envFn([prim.str()], prim.str(), strImpl1Abs((s) => {
      try {
        return new URL(s).pathname;
      } catch {
        return s;
      }
    })),
    pathToFileURL: envFn(
      [prim.str()],
      objAbs({ href: prim.str() }),
      (args) => {
        const p = absStr(args[0]);
        if (p === undefined) return undefined;
        try {
          const href = `file://${p.startsWith("/") ? "" : "/"}${p}`;
          return objAbs({ href: strLit(href) });
        } catch {
          return undefined;
        }
      },
    ),
    format: envFn(
      [objAbs({
        auth: { value: unionOf(prim.str(), nullLit()), optional: true },
        hash: { value: unionOf(prim.str(), nullLit()), optional: true },
        host: { value: unionOf(prim.str(), nullLit()), optional: true },
        hostname: { value: unionOf(prim.str(), nullLit()), optional: true },
        href: { value: unionOf(prim.str(), nullLit()), optional: true },
        pathname: { value: unionOf(prim.str(), nullLit()), optional: true },
        protocol: { value: unionOf(prim.str(), nullLit()), optional: true },
        search: { value: unionOf(prim.str(), nullLit()), optional: true },
        port: { value: unionOf(prim.str(), prim.num(), nullLit()), optional: true },
      })],
      prim.str(),
    ),
  };

  const cryptoModule: Record<string, Abs> = {
    randomBytes: envFn([prim.num()], bufferBrand),
    randomUUID: envFn([], prim.str()),
    randomInt: envFn([prim.num(), prim.num()], prim.num()),
    // Hash/HMAC 实例：update 链式返回自身 brand（不是 unknown）
    createHash: envFn(
      [prim.str()],
      brandOf("Hash", objAbs({
        update: envFn([unionOf(prim.str(), bufferBrand)], brandOf("Hash")),
        digest: envFn(
          [prim.str()],
          unionOf(prim.str(), bufferBrand),
          undefined,
          { params: ["encoding?"] },
        ),
        copy: envFn([], brandOf("Hash")),
      })),
    ),
    createHmac: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand)],
      brandOf("Hmac", objAbs({
        update: envFn([unionOf(prim.str(), bufferBrand)], brandOf("Hmac")),
        digest: envFn(
          [prim.str()],
          unionOf(prim.str(), bufferBrand),
          undefined,
          { params: ["encoding?"] },
        ),
      })),
    ),
    createCipheriv: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), unionOf(prim.str(), bufferBrand)],
      brandOf("Cipher"),
    ),
    createDecipheriv: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), unionOf(prim.str(), bufferBrand)],
      brandOf("Decipher"),
    ),
    pbkdf2Sync: envFn(
      [prim.str(), prim.str(), prim.num(), prim.num(), prim.str()],
      bufferBrand,
    ),
    scryptSync: envFn([prim.str(), prim.str(), prim.num()], bufferBrand),
    timingSafeEqual: envFn([bufferBrand, bufferBrand], prim.bool()),
  };

  const childProcessModule: Record<string, Abs> = {
    execSync: envFn(
      [prim.str(), objAbs({
        encoding: { value: prim.str(), optional: true },
        timeout: { value: prim.num(), optional: true },
        maxBuffer: { value: prim.num(), optional: true },
        cwd: { value: prim.str(), optional: true },
      })],
      unionOf(prim.str(), bufferBrand),
      undefined,
      { params: ["command", "options?"] },
    ),
    execFileSync: envFn(
      [prim.str(), arrOf(prim.str()), objAbs({
        encoding: { value: prim.str(), optional: true },
        timeout: { value: prim.num(), optional: true },
        maxBuffer: { value: prim.num(), optional: true },
        cwd: { value: prim.str(), optional: true },
      })],
      unionOf(prim.str(), bufferBrand),
      undefined,
      { params: ["file", "args", "options?"] },
    ),
    spawnSync: envFn(
      [prim.str(), arrOf(prim.str()), objAbs({
        encoding: { value: prim.str(), optional: true },
        timeout: { value: prim.num(), optional: true },
        maxBuffer: { value: prim.num(), optional: true },
        cwd: { value: prim.str(), optional: true },
      })],
      objAbs({
        status: unionOf(prim.num(), nullLit()),
        stdout: unionOf(prim.str(), bufferBrand),
        stderr: unionOf(prim.str(), bufferBrand),
        error: unionOf(brandOf("Error"), undef()),
      }),
      undefined,
      { params: ["command", "args", "options?"] },
    ),
    exec: envFn([prim.str(), callbackFnBrand], brandOf("ChildProcess"), undefined, {
      params: ["command", "callback?"],
    }),
    spawn: envFn([prim.str(), arrOf(prim.str()), objAbs({
      cwd: { value: prim.str(), optional: true },
      env: { value: openObjBrand("Record<string, string | undefined>", { key: prim.str(), value: unionOf(prim.str(), undef()) }), optional: true },
      stdio: { value: unionOf(prim.str(), arrOf(prim.str())), optional: true },
    })], brandOf("ChildProcess"), undefined, {
      params: ["command", "args", "options?"],
    }),
    fork: envFn([prim.str(), arrOf(prim.str()), objAbs({
      cwd: { value: prim.str(), optional: true },
      env: { value: openObjBrand("Record<string, string | undefined>", { key: prim.str(), value: unionOf(prim.str(), undef()) }), optional: true },
      stdio: { value: unionOf(prim.str(), arrOf(prim.str())), optional: true },
    })], brandOf("ChildProcess"), undefined, {
      params: ["modulePath", "args", "options?"],
    }),
  };

  const utilModule: Record<string, Abs> = {
    // HOF：callback 风格 fn → promise 风格 fn。真实 arity 由调用点决定，
    // 用角色 brand 表达（format 干净，不假装具体参数表）。
    promisify: envFn([callbackFnBrand], promiseFnBrand, undefined, {
      name: "util.promisify",
    }),
    // value 无约束（产品 any）；options 具体化
    inspect: envFn(
      [anyParam, inspectOptions],
      prim.str(),
      undefined,
      { params: ["value", "options?"], name: "util.inspect" },
    ),
    // util.format() with zero args is valid in Node；混参无约束
    format: envFnVariadic(anyParam, prim.str(), {
      restName: "...args",
      name: "util.format",
    }),
    // HOF 与 promisify 对偶：promise fn → callback fn
    callbackify: envFn([promiseFnBrand], callbackFnBrand),
    deprecate: envFn([anyParam, prim.str()], anyValueBrand),
    inherits: envFn([brandOf("Function"), brandOf("Function")], undef()),
    isDeepStrictEqual: envFn([anyValueBrand, anyValueBrand], prim.bool()),
    types: objAbs({
      // 谓词收任意值（产品 any）；返回精确 bool
      isDate: envFn([anyParam], prim.bool()),
      isRegExp: envFn([anyParam], prim.bool()),
      isPromise: envFn([anyParam], prim.bool()),
      isArrayBuffer: envFn([anyParam], prim.bool()),
      isTypedArray: envFn([anyParam], prim.bool()),
      isNativeError: envFn([anyParam], prim.bool()),
      isAsyncFunction: envFn([anyParam], prim.bool()),
      isGeneratorFunction: envFn([anyParam], prim.bool()),
    }),
    TextEncoder: envFn(
      [],
      objAbs({
        encode: envFn([prim.str()], brandOf("Uint8Array", objAbs({
          length: prim.num(),
          buffer: brandOf("ArrayBuffer"),
        }))),
        encoding: prim.str(),
      }),
    ),
    TextDecoder: envFn(
      [prim.str()],
      objAbs({
        decode: envFn([brandOf("Uint8Array", objAbs({ length: prim.num() }))], prim.str()),
        encoding: prim.str(),
      }),
      undefined,
      { params: ["encoding?"] },
    ),
  };

  /** EventEmitter instance brand: on/once/emit/off at signature level. */
  const eventEmitterShape = objAbs({
    on: envFn([prim.str(), callbackFnBrand], brandOf("EventEmitter")),
    once: envFn([prim.str(), callbackFnBrand], brandOf("EventEmitter")),
    off: envFn([prim.str(), callbackFnBrand], brandOf("EventEmitter")),
    emit: envFn([prim.str(), anyParam], prim.bool(), undefined, {
      params: ["event", "...args"],
    }),
    addListener: envFn([prim.str(), callbackFnBrand], brandOf("EventEmitter")),
    removeListener: envFn([prim.str(), callbackFnBrand], brandOf("EventEmitter")),
    removeAllListeners: envFn([prim.str()], brandOf("EventEmitter")),
    listeners: envFn([prim.str()], arrOf(callbackFnBrand)),
    listenerCount: envFn([prim.str()], prim.num()),
    eventNames: envFn([], arrOf(prim.str())),
  });
  const eventEmitterInstance = brandOf("EventEmitter", eventEmitterShape);
  /**
   * Constructor: `new EventEmitter()` / `new EventEmitter(options)`.
   * Options optional — required arity 0; format shows typed options bag.
   */
  const EventEmitterCtor = envFn([eventEmitterOptions], eventEmitterInstance, undefined, {
    params: ["options?"],
  });

  const eventsModule: Record<string, Abs> = {
    EventEmitter: EventEmitterCtor,
    // 事件实参依赖事件类型 — 用 EventArgs brand 留口，不假装具体元组
    once: envFn(
      [eventEmitterInstance, prim.str()],
      promiseOf(brandOf("EventArgs", arrOf(anyParam))),
      undefined,
      { params: ["emitter", "event"] },
    ),
    // AsyncIterator 由事件流驱动（limitations §2 机器回调边界）
    on: envFn(
      [eventEmitterInstance, prim.str()],
      brandOf(
        "AsyncIterator",
        objAbs({
          next: envFn([], promiseOf(objAbs({
            value: arrOf(anyParam),
            done: prim.bool(),
          }))),
          return: envFn([], promiseOf(objAbs({
            value: arrOf(anyParam),
            done: prim.bool(),
          }))),
        }),
      ),
      undefined,
      { params: ["emitter", "event"] },
    ),
    listenerCount: envFn([eventEmitterInstance, prim.str()], prim.num()),
  };

  const streamIoMethods = {
    on: envFn([prim.str(), callbackFnBrand], brandOf("Stream")),
    once: envFn([prim.str(), callbackFnBrand], brandOf("Stream")),
    off: envFn([prim.str(), callbackFnBrand], brandOf("Stream")),
    emit: envFn([prim.str(), anyParam], prim.bool(), undefined, {
      params: ["event", "...args"],
    }),
    pipe: envFn([brandOf("Writable")], brandOf("Writable")),
    destroy: envFn([errOrNull], undef(), undefined, { params: ["error?"] }),
    read: envFn([prim.num()], unionOf(prim.str(), bufferBrand, nullLit())),
    write: envFn([unionOf(prim.str(), bufferBrand)], prim.bool()),
    end: envFn([unionOf(prim.str(), bufferBrand), callbackFnBrand], undef(), undefined, {
      params: ["chunk?", "callback?"],
    }),
    pause: envFn([], brandOf("Stream")),
    resume: envFn([], brandOf("Stream")),
    setEncoding: envFn([prim.str()], brandOf("Stream")),
  };

  const streamCtor = (brandName: string): Abs =>
    envFn([streamOptions], brandOf(brandName, objAbs(streamIoMethods)), undefined, {
      params: ["options?"],
    });

  /**
   * stream skeleton: brand + pipe/finished. Machine-driven callbacks remain
   * mock-recommended (limitations §2).
   */
  const streamModule: Record<string, Abs> = {
    Readable: streamCtor("Readable"),
    Writable: streamCtor("Writable"),
    Duplex: streamCtor("Duplex"),
    Transform: streamCtor("Transform"),
    pipeline: envFnVariadic(brandOf("Stream"), promiseOf(undef()), {
      restName: "...streams",
    }),
    finished: envFn([brandOf("Stream"), callbackFnBrand], promiseOf(undef()), undefined, {
      params: ["stream", "callback?"],
    }),
  };

  /** querystring.parse returns a dynamic key bag — slots are not statically known. */
  const parsedQueryString = openObjBrand(
    "ParsedQueryString",
    { key: prim.str(), value: unionOf(prim.str(), arrOf(prim.str())) },
  );

  const querystringModule: Record<string, Abs> = {
    // sep/eq/options optional — required arity 1; labels+types render typed options
    parse: envFn(
      [prim.str(), prim.str(), prim.str(), querystringOptions],
      parsedQueryString,
      undefined,
      { params: ["str", "sep?", "eq?", "options?"] },
    ),
    stringify: envFn(
      [openObjBrand(
        "StringifyInput",
        { key: prim.str(), value: unionOf(prim.str(), prim.num(), prim.bool(), arrOf(unionOf(prim.str(), prim.num(), prim.bool()))) },
      ), prim.str(), prim.str(), querystringOptions],
      prim.str(),
      undefined,
      { params: ["obj", "sep?", "eq?", "options?"] },
    ),
    escape: envFn([prim.str()], prim.str()),
    unescape: envFn([prim.str()], prim.str()),
  };

  /**
   * assert 模块：断言函数无返回值。value 参数是产品无约束（any）；
   * message 可选 string | Error。
   */
  const assertMessageArg = unionOf(prim.str(), brandOf("Error"));
  const assertModule: Record<string, Abs> = {
    ok: envFn(
      [anyParam, assertMessageArg],
      undef(),
      undefined,
      { params: ["value", "message?"] },
    ),
    strictEqual: envFn(
      [anyParam, anyParam, assertMessageArg],
      undef(),
      undefined,
      { params: ["actual", "expected", "message?"] },
    ),
    deepStrictEqual: envFn(
      [anyParam, anyParam, assertMessageArg],
      undef(),
      undefined,
      { params: ["actual", "expected", "message?"] },
    ),
    notStrictEqual: envFn(
      [anyParam, anyParam, assertMessageArg],
      undef(),
      undefined,
      { params: ["actual", "expected", "message?"] },
    ),
    match: envFn(
      [prim.str(), brandOf("RegExp"), assertMessageArg],
      undef(),
      undefined,
      { params: ["value", "regexp", "message?"] },
    ),
    fail: envFn([assertMessageArg], prim.never, undefined, {
      params: ["message?"],
    }),
  };

  const nodeGlobals: Record<string, Abs> = {
    process: objAbs({
      // Record<string, string | undefined> 语义：开放键 + string|undefined 值
      env: openObjBrand(
        "Record<string, string | undefined>",
        { key: prim.str(), value: unionOf(prim.str(), undef()) },
      ),
      argv: arrOf(prim.str()),
      argv0: prim.str(),
      execArgv: arrOf(prim.str()),
      execPath: prim.str(),
      cwd: envFn([], prim.str()),
      chdir: envFn([prim.str()], undef()),
      exit: envFn([prim.num()], prim.never, undefined, { params: ["code?"] }),
      exitCode: unionOf(prim.num(), undef()),
      pid: prim.num(),
      ppid: prim.num(),
      platform: prim.str(),
      arch: prim.str(),
      version: prim.str(),
      versions: openObjBrand(
        "Record<string, string>",
        { key: prim.str(), value: prim.str() },
      ),
      stdout: objAbs({ write: envFn([prim.str()], prim.bool()) }),
      stderr: objAbs({ write: envFn([prim.str()], prim.bool()) }),
      stdin: objAbs({
        on: envFn([prim.str(), callbackFnBrand], brandOf("EventEmitter")),
      }),
      hrtime: objAbs({ bigint: envFn([], brandOf("bigint")) }),
      memoryUsage: envFn(
        [],
        objAbs({
          rss: prim.num(),
          heapTotal: prim.num(),
          heapUsed: prim.num(),
          external: prim.num(),
          arrayBuffers: prim.num(),
        }),
      ),
      cpuUsage: envFn(
        [],
        objAbs({ user: prim.num(), system: prim.num() }),
      ),
      uptime: envFn([], prim.num()),
      // 额外转发实参由 callback 形参吸收（CallbackFn brand 内部 variadic）
      nextTick: envFn([callbackFnBrand], undef(), undefined, {
        params: ["callback"],
      }),
      on: envFn([prim.str(), callbackFnBrand], brandOf("EventEmitter")),
      once: envFn([prim.str(), callbackFnBrand], brandOf("EventEmitter")),
      off: envFn([prim.str(), callbackFnBrand], brandOf("EventEmitter")),
      emit: envFn([prim.str(), anyParam], prim.bool(), undefined, {
        params: ["event", "...args"],
      }),
    }),

    Buffer: objAbs({
      from: envFn([unionOf(prim.str(), arrOf(prim.num()), bufferBrand)], bufferBrand),
      alloc: envFn(
        [prim.num(), unionOf(prim.str(), prim.num(), bufferBrand), prim.str()],
        bufferBrand,
        undefined,
        { params: ["size", "fill?", "encoding?"] },
      ),
      allocUnsafe: envFn([prim.num()], bufferBrand),
      isBuffer: envFn([anyParam], prim.bool()),
      byteLength: envFn(
        [unionOf(prim.str(), bufferBrand)],
        prim.num(),
      ),
      concat: envFn([arrOf(bufferBrand)], bufferBrand),
      compare: envFn([bufferBrand, bufferBrand], prim.num()),
    }),

    __dirname: prim.str(),
    __filename: prim.str(),

    setTimeout: envFn([callbackFnBrand, prim.num(), anyParam], brandOf("Timeout"), undefined, {
      params: ["callback", "ms", "...args"],
    }),
    setInterval: envFn([callbackFnBrand, prim.num(), anyParam], brandOf("Timeout"), undefined, {
      params: ["callback", "ms", "...args"],
    }),
    setImmediate: envFn([callbackFnBrand, anyParam], brandOf("Immediate"), undefined, {
      params: ["callback", "...args"],
    }),
    clearTimeout: envFn([brandOf("Timeout")], undef()),
    clearInterval: envFn([brandOf("Timeout")], undef()),
    clearImmediate: envFn([brandOf("Immediate")], undef()),
    queueMicrotask: envFn([callbackFnBrand], undef()),

    structuredClone: envFn([anyParam], anyValueBrand),
  };

  const modules: Record<string, Record<string, Abs>> = {
    fs: fsModule,
    "node:fs": fsModule,
    "fs/promises": fsPromisesModule,
    "node:fs/promises": fsPromisesModule,
    path: pathModule,
    "node:path": pathModule,
    os: osModule,
    "node:os": osModule,
    url: urlModule,
    "node:url": urlModule,
    crypto: cryptoModule,
    "node:crypto": cryptoModule,
    child_process: childProcessModule,
    "node:child_process": childProcessModule,
    util: utilModule,
    "node:util": utilModule,
    events: eventsModule,
    "node:events": eventsModule,
    stream: streamModule,
    "node:stream": streamModule,
    querystring: querystringModule,
    "node:querystring": querystringModule,
    assert: assertModule,
    "node:assert": assertModule,
  };

  return {
    globals: { ...esEnv.globals, ...nodeGlobals },
    modules,
  };
}
