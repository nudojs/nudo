/**
 * Node env：es globals + node 内建 modules（Abs 原生）。
 */

import {
  type Abs,
  type AbsApplyResult,
  type AbsSigImpl,
  strLit,
  boolLit,
  leqAbs,
  makeAbsApplyResult,
  never as neverAbs,
} from "@nudojs/core";
import { absStrLit, allAbsStr } from "@nudojs/core/internal";
import {
  arrOf,
  brandOf,
  dateAbs,
  envFn,
  envFnVariadic,
  errBrand,
  nullLit,
  objAbs,
  openObjBrand,
  promiseOf,
  tupleOf,
  undef,
  unionOf,
  prim,
  type EnvApplyImpl,
  type Slot,
} from "./abs-helpers.ts";
import { type EnvDefinition, defineEnv as defineEsEnv } from "./es.ts";
import nodePath from "node:path";
import { getCiphers as nodeGetCiphers, getHashes as nodeGetHashes } from "node:crypto";
import { fileURLToPath as nodeFileURLToPath, pathToFileURL as nodePathToFileURL } from "node:url";


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
      // Bug 868：Buffer 是 Uint8Array 的**视图** ⇒ byteLength === length，
      // buffer 是底层 ArrayBuffer，byteOffset 是视图起点偏移。
      // 旧面缺这三个槽 ⇒ 成员读出 **exact undefined**（真值分别是
      // 4 / ArrayBuffer / 0）——不是精度债，是**确定的错值**。
      byteLength: prim.num(),
      buffer: brandOf(
        "ArrayBuffer",
        objAbs({
          byteLength: prim.num(),
          slice: envFn([prim.num(), prim.num()], brandOf("ArrayBuffer")),
        }),
      ),
      byteOffset: prim.num(),
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

  /** 无约束参数：产品语义 = any（≠ unknown 推导失败） */
  const anyParam = prim.any();

  /** 回调/高阶 fn 角色 brand — 真实形参 arity 由调用点决定 */
  const callbackFnBrand = brandOf(
    "CallbackFn",
    envFnVariadic(anyParam, undef(), { restName: "...args" }),
  );

  const streamOptions = objAbs({
    highWaterMark: { value: prim.num(), optional: true },
    objectMode: { value: prim.bool(), optional: true },
    encoding: { value: prim.str(), optional: true },
    autoDestroy: { value: prim.bool(), optional: true },
    emitClose: { value: prim.bool(), optional: true },
  });
  /** 流实例 I/O 方法（Readable/Writable/Duplex/Transform/ChildProcess.stdio 共用） */
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
  /**
   * Transform/Duplex/Readable/Writable 用户钩子（options 或子类方法）。
   * 机器何时调用仍是 limitations §2；形参表给到 refine 可执法。
   */
  const chunk = unionOf(prim.str(), bufferBrand);
  const streamCallback = envFn([errOrNull], undef(), undefined, { params: ["error?"] });
  const transformHook = envFn(
    [chunk, prim.str(), envFn([errOrNull, chunk], undef(), undefined, { params: ["error?", "data?"] })],
    undef(),
    undefined,
    { params: ["chunk", "encoding", "callback"] },
  );
  const writeHook = envFn(
    [chunk, prim.str(), envFn([errOrNull], undef(), undefined, { params: ["error?"] })],
    undef(),
    undefined,
    { params: ["chunk", "encoding", "callback"] },
  );
  const readHook = envFn([prim.num()], undef(), undefined, { params: ["size"] });
  const finalHook = envFn([streamCallback], undef(), undefined, { params: ["callback"] });
  const flushHook = envFn([streamCallback], undef(), undefined, { params: ["callback"] });
  const streamBaseSlots: Record<string, Slot> = {
    highWaterMark: { value: prim.num(), optional: true },
    objectMode: { value: prim.bool(), optional: true },
    encoding: { value: prim.str(), optional: true },
    autoDestroy: { value: prim.bool(), optional: true },
    emitClose: { value: prim.bool(), optional: true },
  };
  const streamHooks: Record<string, Slot> = {
    transform: { value: transformHook, optional: true },
    flush: { value: flushHook, optional: true },
    read: { value: readHook, optional: true },
    write: { value: writeHook, optional: true },
    final: { value: finalHook, optional: true },
    construct: { value: streamCallback, optional: true },
    destroy: { value: envFn([errOrNull, streamCallback], undef(), undefined, { params: ["error", "callback"] }), optional: true },
  };

  const eventEmitterOptions = objAbs({
    captureRejections: { value: prim.bool(), optional: true },
  });

  const promiseFnBrand = brandOf(
    "PromiseFn",
    envFnVariadic(anyParam, promiseOf(anyParam), { restName: "...args" }),
  );
  /** 断言/工具接受的任意值（无约束） */
  const anyValueBrand = brandOf("Value");

  /** path.posix / path.win32 平台路径对象（Bug 877：与 path 族同一套实参执法） */
  const platformPathMethods = () => ({
    join: envFnVariadic(prim.str(), prim.str(), {
      apply: pathApply(pathJoinAbs, prim.str(), 0),
      restName: "...paths",
    }),
    resolve: envFnVariadic(prim.str(), prim.str(), {
      apply: pathApply(pathResolveAbs, prim.str(), 0),
      restName: "...paths",
    }),
    dirname: envFn(
      [prim.str()],
      prim.str(),
      pathApply(strImpl1Abs(nodePath.dirname), prim.str(), 1),
      { enforceArgs: true },
    ),
    basename: envFn([prim.str(), prim.str()], prim.str(), pathApply(pathBasenameAbs, prim.str(), 1, 1), {
      params: ["path", "ext?"],
    }),
    extname: envFn(
      [prim.str()],
      prim.str(),
      pathApply(strImpl1Abs(nodePath.extname), prim.str(), 1),
      { enforceArgs: true },
    ),
    normalize: envFn(
      [prim.str()],
      prim.str(),
      pathApply(strImpl1Abs(nodePath.normalize), prim.str(), 1),
      { enforceArgs: true },
    ),
    isAbsolute: envFn(
      [prim.str()],
      prim.bool(),
      pathApply(pathIsAbsoluteAbs, prim.bool(), 1),
      { enforceArgs: true },
    ),
    relative: envFn(
      [prim.str(), prim.str()],
      prim.str(),
      pathApply(pathRelativeAbs, prim.str(), 2),
      { enforceArgs: true },
    ),
    sep: prim.str(),
    delimiter: prim.str(),
  });

  // ══════════════════════════════════════════════════════════════════════
  // 族 29 S3 共享件：fs 结果对象表 / fs 同步族 throws 面 / path 族实参执法
  // ══════════════════════════════════════════════════════════════════════

  /**
   * fs `Stats` 结果对象（**同步族 / promise 族共用同一张表** —— Bug 891：
   * promise 族此前是同步族的**裁剪副本**（只抄 12 槽）⇒ 成员读出
   * **exact `undefined` / `NaN` / `never`**——那是**确定的错值**，不是精度债）。
   *
   * 成员清单按原生 oracle（Node v26：`fs.statSync` 与 `fs.promises.stat`
   * 的成员表一致）：谓词 isFile / isDirectory / isSymbolicLink /
   * isBlockDevice / isCharacterDevice / isFIFO / isSocket；数值 size /
   * mode / uid / gid / ino / dev / nlink / blksize / blocks / rdev；
   * 时刻 mtime / ctime / atime / birthtime（Date）与 mtimeMs / ctimeMs /
   * atimeMs / birthtimeMs（number）。
   */
  const statsAbs = objAbs({
    isFile: envFn([], prim.bool()),
    isDirectory: envFn([], prim.bool()),
    isSymbolicLink: envFn([], prim.bool()),
    isBlockDevice: envFn([], prim.bool()),
    isCharacterDevice: envFn([], prim.bool()),
    isFIFO: envFn([], prim.bool()),
    isSocket: envFn([], prim.bool()),
    size: prim.num(),
    mode: prim.num(),
    uid: prim.num(),
    gid: prim.num(),
    ino: prim.num(),
    dev: prim.num(),
    nlink: prim.num(),
    blksize: prim.num(),
    blocks: prim.num(),
    rdev: prim.num(),
    mtime: dateOr,
    ctime: dateOr,
    atime: dateOr,
    birthtime: dateOr,
    mtimeMs: prim.num(),
    ctimeMs: prim.num(),
    atimeMs: prim.num(),
    birthtimeMs: prim.num(),
  });

  /**
   * fs `Dirent`（`readdir(…, {withFileTypes:true})` 的元素）——同步族 /
   * promise 族共用（Bug 891：promise 族此前是**空 shape 的 brand** ⇒
   * 成员读出 unknown / exact undefined）。
   */
  const direntAbs = brandOf("Dirent", objAbs({
    name: prim.str(),
    parentPath: prim.str(),
    isFile: envFn([], prim.bool()),
    isDirectory: envFn([], prim.bool()),
    isSymbolicLink: envFn([], prim.bool()),
  }));

  /**
   * `readdir` 结果（`Array<string | Dirent>`）——同步族 / promise 族共用。
   * brand 名避免 `string | Dirent[]` 的结合歧义（真实是 (string|Dirent)[]）。
   */
  const readdirResultAbs = brandOf(
    "Array<string | Dirent>",
    arrOf(unionOf(prim.str(), direntAbs)),
  );

  /**
   * fs **同步族**的 throws 面（Bug 880）。
   *
   * 原生对「路径不存在 / 权限不足」抛 `Error`（带 `code`：ENOENT / EEXIST /
   * EACCES …）——引擎**判不出**路径是否存在 ⇒ 语义是 **may-throw**
   * （不是 always-throw：成功路径也不该变成「必抛」）。
   * 原生 oracle：`fs.readFileSync("/nope/x")` → `Error` code=ENOENT。
   */
  const fsMayThrow = (value: Abs): AbsApplyResult =>
    makeAbsApplyResult(value, errBrand("Error"));

  /** options 对象里某槽是否为**字面量** true / false */
  const optIsLit = (opt: Abs | undefined, key: string, want: boolean): boolean => {
    if (!opt || opt.shape.k !== "obj") return false;
    const v = opt.shape.slots[key]?.value;
    return v?.term?.op === "lit" && v.term.value === want;
  };

  /**
   * `readdir` 结果的元素类型：原生按 `withFileTypes` 分叉
   * —— `true` ⇒ `Dirent[]`；`false` / 缺省 ⇒ `string[]`；判不出 ⇒ 声明的并集。
   * （Bug 891：promise 族此前是**空 shape 的 brand** ⇒ 元素成员读出 unknown。）
   */
  const readdirResult = (opt: Abs | undefined): Abs => {
    if (optIsLit(opt, "withFileTypes", true)) return arrOf(direntAbs);
    if (opt === undefined || optIsLit(opt, "withFileTypes", false)) return arrOf(prim.str());
    return readdirResultAbs;
  };

  /**
   * `node:path` 族**实参执法**的判定档位（Bug 877）。
   *
   * 口径与机制层 `enforceArgs` 一致（`leqAbs` 判 false ⇒ 确定不符）：
   * - `ok`：可赋给 `string` ⇒ 放行。
   * - `mismatch`：**确定不可赋给** `string`（number / object / 品牌 / 并集）
   *   ⇒ 原生**必抛** TypeError。
   * - `abstract`：判不出（unknown / any / 非 exact）⇒ 原生**可能**抛。
   * - `undef`：实参是 `undefined` 字面量 ⇒ 必填位原生抛、可选位视作未传。
   */
  const pathArgVerdict = (arg: Abs): "ok" | "mismatch" | "abstract" | "undef" => {
    // undefined 字面量：必填位原生抛、可选位视作未传
    if (arg.term?.op === "lit" && arg.term.value === undefined) return "undef";
    // 抽象（unknown / any / 非 exact）⇒ 判不出 ⇒ 原生可能抛
    if (arg.shape.k === "unknown" || arg.shape.k === "any" || arg.conf !== "exact") {
      return "abstract";
    }
    // 其余按声明类型判：可赋给 string ⇒ 放行；确定不符 ⇒ 原生必抛
    return leqAbs(arg, prim.str()).ok ? "ok" : "mismatch";
  };

  /**
   * path 族实参执法闸：返回 undefined = 放行；否则是带 throws 面的结果
   * （确定不符 ⇒ **必抛** TypeError；抽象 ⇒ **may-throw** TypeError）。
   *
   * @param required 必填位个数（缺传 ⇒ 原生抛 TypeError，如 `path.dirname()`）
   * @param optional 可选位个数（可选位传 undefined ⇒ 视作未传，原生不抛：
   *                 `path.basename("/x/y.txt", undefined)` → "y.txt"）
   */
  const pathArgsGuard = (
    args: Abs[],
    ret: Abs,
    required: number,
    optional = 0,
  ): AbsApplyResult | undefined => {
    if (args.length < required) {
      return makeAbsApplyResult(neverAbs, errBrand("TypeError"));
    }
    for (let i = 0; i < args.length; i++) {
      const verdict = pathArgVerdict(args[i]!);
      if (verdict === "ok") continue;
      if (verdict === "undef") {
        if (i < required) return makeAbsApplyResult(neverAbs, errBrand("TypeError"));
        if (i < required + optional) continue;
        return makeAbsApplyResult(neverAbs, errBrand("TypeError"));
      }
      if (verdict === "mismatch") {
        return makeAbsApplyResult(neverAbs, errBrand("TypeError"));
      }
      return makeAbsApplyResult(ret, errBrand("TypeError"));
    }
    return undefined;
  };

  /**
   * path 族 apply 包装：先过实参执法闸（Bug 877），再走折叠。
   *
   * 执法闸命中 ⇒ 返回带 throws 面的结果（确定不符 ⇒ **必抛** TypeError；
   * 抽象 ⇒ **may-throw** TypeError）；放行 ⇒ 走折叠——折叠不出来（实参不是
   * 字面量）时返回 undefined ⇒ 回落**声明**返回类型，**不折出**原生
   * 产不出的自信精确字面量。
   */
  const pathApply = (
    fold: AbsSigImpl,
    ret: Abs,
    required: number,
    optional = 0,
  ): EnvApplyImpl => (args) => {
    const guard = pathArgsGuard(args, ret, required, optional);
    if (guard) return guard;
    return fold(args);
  };

  /**
   * `fs.openSync` **合法**的 flags 字符串（宿主实测 Node v26.10.0：逐个
   * `openSync(<真实文件>, flag)` 试出来——非法名抛 TypeError
   * ERR_INVALID_ARG_VALUE）。
   *
   * 实测合法名：`a` / `ax` / `a+` / `as` / `as+` / `r` / `r+` / `rs` / `rs+` /
   * `sr` / `sr+` / `w` / `wx` / `w+` / `xw`；
   * 实测**非法**名：`ws` / `ws+` / `x` / `x+` / `xs` / `xs+`（⇒ TypeError）。
   * flags 名**大小写敏感**（实测 `"R"` / `"W"` / `"A"` 都非法）⇒ 精确比对。
   */
  const FS_OPEN_FLAGS = new Set([
    "a",
    "ax",
    "a+",
    "as",
    "as+",
    "r",
    "r+",
    "rs",
    "rs+",
    "sr",
    "sr+",
    "w",
    "wx",
    "w+",
    "xw",
  ]);

  const fsModule: Record<string, Abs> = {
    // encoding 字面量 → string；否则 string|Buffer（TS 重载近似）
    // Bug 880：同步族带 throws 面（原生对不存在路径抛 Error / code=ENOENT …）
    readFileSync: envFn(
      [prim.str(), encodingOptionsArg],
      unionOf(prim.str(), bufferBrand),
      (args) => {
        const enc = args[1];
        if (!enc) return fsMayThrow(unionOf(prim.str(), bufferBrand));
        if (enc.term?.op === "lit" && typeof enc.term.value === "string") {
          return fsMayThrow(prim.str());
        }
        if (enc.shape.k === "prim" && enc.shape.type === "string" && !enc.term) {
          return fsMayThrow(prim.str());
        }
        return fsMayThrow(unionOf(prim.str(), bufferBrand));
      },
      { params: ["path", "options?"] },
    ),
    writeFileSync: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), encodingOptionsArg],
      undef(),
      () => fsMayThrow(undef()),
      { params: ["path", "data", "options?"] },
    ),
    appendFileSync: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), encodingOptionsArg],
      undef(),
      () => fsMayThrow(undef()),
      { params: ["path", "data", "options?"] },
    ),
    // existsSync：原生**永不抛**（路径不存在 ⇒ 返回 false）⇒ 不加 throws 面
    existsSync: envFn([prim.str()], prim.bool()),
    mkdirSync: envFn(
      [prim.str(), mkdirOptions],
      unionOf(prim.str(), undef()),
      () => fsMayThrow(unionOf(prim.str(), undef())),
      { params: ["path", "options?"] },
    ),
    rmdirSync: envFn([prim.str()], undef(), () => fsMayThrow(undef())),
    rmSync: envFn(
      [prim.str(), rmOptions],
      undef(),
      (args) => {
        // 原生：`rmSync(p, {force:true})` 对不存在的路径**不抛**（ENOENT 被吞）；
        // 其余形态（无 force / force 非 true）⇒ 原生抛 ENOENT。
        if (optIsLit(args[1], "force", true)) return undef();
        return fsMayThrow(undef());
      },
      { params: ["path", "options?"] },
    ),
    unlinkSync: envFn([prim.str()], undef(), () => fsMayThrow(undef())),
    renameSync: envFn([prim.str(), prim.str()], undef(), () => fsMayThrow(undef())),
    copyFileSync: envFn([prim.str(), prim.str()], undef(), () => fsMayThrow(undef())),
    statSync: envFn(
      [prim.str(), statOptions],
      statsAbs,
      (args) => {
        // Bug 893：原生 `statSync(p, {throwIfNoEntry:false})` 在路径不存在时
        // **返回 undefined**（不抛）；紧接着的成员读**必抛 TypeError** ⇒
        // 返回域必须含 undefined，否则引擎判「不抛」还给出自信的
        // `boolean` / `number`（L2 假绿）。
        // Bug 880：同步族 may-throw（原生 ENOENT / EACCES …）。
        if (optIsLit(args[1], "throwIfNoEntry", false)) {
          return fsMayThrow(unionOf(statsAbs, undef()));
        }
        return fsMayThrow(statsAbs);
      },
      { params: ["path", "options?"] },
    ),
    readdirSync: envFn(
      [prim.str(), readdirOptions],
      readdirResultAbs,
      (args) => fsMayThrow(readdirResult(args[1])),
      { params: ["path", "options?"] },
    ),
    realpathSync: envFn([prim.str()], prim.str(), () => fsMayThrow(prim.str())),
    readlinkSync: envFn([prim.str()], prim.str(), () => fsMayThrow(prim.str())),
    symlinkSync: envFn([prim.str(), prim.str()], undef(), () => fsMayThrow(undef())),
    chmodSync: envFn([prim.str(), prim.num()], undef(), () => fsMayThrow(undef())),
    chownSync: envFn([prim.str(), prim.num(), prim.num()], undef(), () => fsMayThrow(undef())),
    accessSync: envFn([prim.str(), prim.num()], undef(), () => fsMayThrow(undef())),
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
    // 族 61：`openSync` 此前**未声明** ⇒ 走宿主路径（行为对、精度随 core）。
    // 宿主实测 Node v26.10.0：
    // - `openSync(path)` / `openSync(path, flags)` / `openSync(path, flags, mode)`
    //   ⇒ 返回 **fd（number）**；flags 缺省 = "r"；mode 缺省 = 0o666。
    // - 路径不存在 ⇒ **Error**（ENOENT）⇒ 同步族口径 = may-throw Error。
    // - flags 是**非法字符串** ⇒ **TypeError**（ERR_INVALID_ARG_VALUE）
    //   ⇒ 字面量可判定 ⇒ 必抛 TypeError。
    openSync: envFn(
      [prim.str(), unionOf(prim.str(), prim.num()), prim.num()],
      prim.num(),
      (args) => {
        const flags = absStrLit(args[1]);
        if (flags !== undefined && !FS_OPEN_FLAGS.has(flags)) {
          // 原生抛 TypeError（ERR_INVALID_ARG_VALUE："The argument 'flags' is invalid"）
          return makeAbsApplyResult(neverAbs, errBrand("TypeError"));
        }
        // 原生：路径不存在 / 权限不足 ⇒ Error（ENOENT / EACCES …）
        return fsMayThrow(prim.num());
      },
      { params: ["path", "flags?", "mode?"] },
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
      promiseOf(statsAbs),
      (args) => {
        // Bug 891：结果对象与同步族**共用同一张 Stats 表**（此前是裁剪副本
        // ⇒ 成员读出 exact `undefined` / `NaN` / `never`）。
        // Bug 893：原生 `fs.promises.stat(p, {throwIfNoEntry:false})` 在路径
        // 不存在时**兑现 undefined**（不抛）⇒ 兑现值域含 undefined。
        // （原生 promise 失败走 **reject**，不是同步抛 ⇒ 不加同步 throws 面；
        //   rejected 通道是族 29 Bug 890 的面，不在本分片。）
        if (optIsLit(args[1], "throwIfNoEntry", false)) {
          return promiseOf(unionOf(statsAbs, undef()));
        }
        return promiseOf(statsAbs);
      },
      { params: ["path", "options?"] },
    ),
    readdir: envFn(
      [prim.str(), readdirOptions],
      promiseOf(readdirResultAbs),
      (args) => promiseOf(readdirResult(args[1])),
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
    // ── 族 61：`fs/promises` 三个宿主真实成员此前**未声明** ──────────
    // 宿主实测 Node v26.10.0（`require("node:fs/promises")` 自有键）：
    // - `lstat(path[, options])` ⇒ Promise<**Stats**>（与 `stat` **同一张表**
    //   —— 原生两者的成员表一致；只是 stat 跟随符号链接、lstat 不跟随）。
    // - `statfs(path[, options])` ⇒ Promise<{ type, bsize, frsize, blocks,
    //   bfree, bavail, files, ffree }>（8 个**数值**槽）。
    // - `opendir(path[, options])` ⇒ Promise<**Dir**>（原型面 = `path` /
    //   `read` / `readSync` / `close` / `closeSync` / `entries`）。
    // 原生这三者**失败走 reject**（不是同步抛）⇒ 不加同步 throws 面
    // （rejected 通道见族 29 Bug 890 的 promiseOf）。
    lstat: envFn(
      [prim.str(), statOptions],
      promiseOf(statsAbs),
      undefined,
      { params: ["path", "options?"] },
    ),
    statfs: envFn(
      [prim.str(), statOptions],
      promiseOf(objAbs({
        type: prim.num(),
        bsize: prim.num(),
        frsize: prim.num(),
        blocks: prim.num(),
        bfree: prim.num(),
        bavail: prim.num(),
        files: prim.num(),
        ffree: prim.num(),
      })),
      undefined,
      { params: ["path", "options?"] },
    ),
    opendir: envFn(
      [prim.str(), statOptions],
      promiseOf(brandOf("Dir", objAbs({
        path: prim.str(),
        read: envFn([], promiseOf(unionOf(direntAbs, nullLit()))),
        readSync: envFn([], unionOf(direntAbs, nullLit())),
        close: envFn([], promiseOf(undef())),
        closeSync: envFn([], undef()),
        entries: envFn([], promiseOf(arrOf(direntAbs))),
      }))),
      undefined,
      { params: ["path", "options?"] },
    ),
  };

  const strImpl1Abs = (fn: (a: string) => string): AbsSigImpl => (args) => {
    const a = absStrLit(args[0]);
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
    const p = absStrLit(args[0]);
    if (p === undefined) return undefined;
    const ext = args[1] !== undefined ? absStrLit(args[1]) : undefined;
    return strLit(ext !== undefined ? nodePath.basename(p, ext) : nodePath.basename(p));
  };
  const pathRelativeAbs: AbsSigImpl = (args) => {
    const from = absStrLit(args[0]);
    const to = absStrLit(args[1]);
    return from !== undefined && to !== undefined
      ? strLit(nodePath.relative(from, to))
      : undefined;
  };
  const pathIsAbsoluteAbs: AbsSigImpl = (args) => {
    const p = absStrLit(args[0]);
    return p !== undefined ? boolLit(nodePath.isAbsolute(p)) : undefined;
  };

  /**
   * `path.parse` 的结果对象（root / dir / base / ext / name）。
   */
  const pathParseAbs = objAbs({
    root: prim.str(),
    dir: prim.str(),
    base: prim.str(),
    ext: prim.str(),
    name: prim.str(),
  });

  /**
   * `path.format` 的入参对象（pathObject）——原生要求**对象**。
   */
  const pathFormatArg = objAbs({
    root: { value: prim.str(), optional: true },
    dir: { value: prim.str(), optional: true },
    base: { value: prim.str(), optional: true },
    name: { value: prim.str(), optional: true },
    ext: { value: prim.str(), optional: true },
  });

  const pathModule: Record<string, Abs> = {
    // Node variadic: declare min required arity + rest label (not n fixed slots).
    // Bug 877：变长族的 `enforceArgs` 只覆盖 required 段 ⇒ **整段**实参
    //   （含 rest）由 apply 内的执法闸把关：确定不符 ⇒ 必抛 TypeError。
    join: envFnVariadic(prim.str(), prim.str(), {
      apply: pathApply(pathJoinAbs, prim.str(), 0),
      required: [prim.str()],
      restName: "...paths",
    }),
    resolve: envFnVariadic(prim.str(), prim.str(), {
      apply: pathApply(pathResolveAbs, prim.str(), 0),
      restName: "...paths",
    }),
    dirname: envFn(
      [prim.str()],
      prim.str(),
      pathApply(strImpl1Abs(nodePath.dirname), prim.str(), 1),
      { enforceArgs: true },
    ),
    // ext is optional in Node — required arity 1; label+type render `ext?: string`.
    // Bug 877：ext 是**可选位** ⇒ 传 undefined 视作未传（原生不抛）⇒ 不用
    //   `enforceArgs`（它把 undefined 当抽象 ⇒ may-throw），由 apply 内的
    //   执法闸按「必填 1 + 可选 1」判定。
    basename: envFn(
      [prim.str(), prim.str()],
      prim.str(),
      pathApply(pathBasenameAbs, prim.str(), 1, 1),
      { params: ["path", "ext?"] },
    ),
    extname: envFn(
      [prim.str()],
      prim.str(),
      pathApply(strImpl1Abs(nodePath.extname), prim.str(), 1),
      { enforceArgs: true },
    ),
    relative: envFn(
      [prim.str(), prim.str()],
      prim.str(),
      pathApply(pathRelativeAbs, prim.str(), 2),
      { enforceArgs: true },
    ),
    normalize: envFn(
      [prim.str()],
      prim.str(),
      pathApply(strImpl1Abs(nodePath.normalize), prim.str(), 1),
      { enforceArgs: true },
    ),
    isAbsolute: envFn(
      [prim.str()],
      prim.bool(),
      pathApply(pathIsAbsoluteAbs, prim.bool(), 1),
      { enforceArgs: true },
    ),
    parse: envFn(
      [prim.str()],
      pathParseAbs,
      pathApply((args) => {
        const p = absStrLit(args[0]);
        if (p === undefined) return undefined;
        const parsed = nodePath.parse(p);
        return objAbs({
          root: strLit(parsed.root),
          dir: strLit(parsed.dir),
          base: strLit(parsed.base),
          ext: strLit(parsed.ext),
          name: strLit(parsed.name),
        });
      }, pathParseAbs, 1),
      { enforceArgs: true },
    ),
    format: envFn(
      [pathFormatArg],
      prim.str(),
      (args) => {
        // Bug 877：原生 `path.format(x)` 要求 x 是**对象**
        // （`path.format(123)` → TypeError；`path.format()` → TypeError）。
        const arg = args[0];
        if (arg === undefined) return makeAbsApplyResult(neverAbs, errBrand("TypeError"));
        if (arg.term?.op === "lit" && arg.term.value === undefined) {
          return makeAbsApplyResult(neverAbs, errBrand("TypeError"));
        }
        if (arg.shape.k === "obj") return prim.str();
        if (arg.shape.k === "prim") {
          // primitive ⇒ 原生必抛 TypeError
          return makeAbsApplyResult(neverAbs, errBrand("TypeError"));
        }
        // 抽象（unknown / any / brand …）⇒ 原生可能抛
        return makeAbsApplyResult(prim.str(), errBrand("TypeError"));
      },
      { params: ["pathObject"] },
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
      // Bug 867：原生 `os.cpus()[i]` = `{ model, speed, times: { user, nice,
      //   sys, idle, irq } }`——旧面只建模 model / speed ⇒ `times` 缺槽 ⇒
      //   读出 exact `undefined` ⇒ `times.user` 被判**定抛 TypeError**（假红）。
      arrOf(objAbs({
        model: prim.str(),
        speed: prim.num(),
        times: objAbs({
          user: prim.num(),
          nice: prim.num(),
          sys: prim.num(),
          idle: prim.num(),
          irq: prim.num(),
        }),
      })),
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

  /**
   * URL 实例面（11 组件 + toString / toJSON）——`URL` 构造器与
   * `pathToFileURL` **共用**（Bug 894：pathToFileURL 旧面只有 `{ href }`
   * 一个槽 ⇒ `.pathname` / `.protocol` … 读出 **exact undefined**（错值），
   * `.pathname.length` 更被判「**确定抛 TypeError**」⇒ L2 假红）。
   */
  const urlAbsOf = (u: {
    href: string;
    origin: string;
    protocol: string;
    username: string;
    password: string;
    host: string;
    hostname: string;
    port: string;
    pathname: string;
    search: string;
    hash: string;
  }): Abs =>
    objAbs({
      href: strLit(u.href),
      origin: strLit(u.origin),
      protocol: strLit(u.protocol),
      username: strLit(u.username),
      password: strLit(u.password),
      host: strLit(u.host),
      hostname: strLit(u.hostname),
      port: strLit(u.port),
      pathname: strLit(u.pathname),
      search: strLit(u.search),
      hash: strLit(u.hash),
      toString: envFn([], prim.str(), () => strLit(u.href)),
      toJSON: envFn([], prim.str(), () => strLit(u.href)),
    });

// ══════════════════════════════════════════════════════════════════════════
// 族 29 S4：assert / crypto 族的**实参域判定**助手
//
// 判定口径（三个值域，缺一不可）：
// - 「确定成立」⇒ 原生**不抛** ⇒ 零 throws 面；
// - 「确定不成立」⇒ 原生**必抛** ⇒ throws 面 + abs 面 = never（必抛）；
// - 「判不出」⇒ 原生**可能抛** ⇒ throws 面 + abs 面 = 声明返回面（may-throw）。
//
// 判不出的一律落到 may-throw（不是「不抛」）：原生在该实参域上**确实可能**
// 抛错，may-throw 是如实陈述；把它记成「永不抛」才是假绿。
// ══════════════════════════════════════════════════════════════════════════

/**
 * 实参的 shape（**裸宿主值 ⇒ undefined**）——env apply 收到的实参可能是宿主
 * 函数 / 宿主构造器（Bug 882 的普通调用面），不是 Abs ⇒ 读 shape 必须防呆。
 */
function argShape(a: Abs | undefined): Abs["shape"] | undefined {
  return (a as Abs | undefined)?.shape;
}

/** 实参的 lit term 值（**裸宿主值 ⇒ 判不出**） */
function litOf(a: Abs | undefined): { ok: true; value: unknown } | { ok: false } {
  const t = (a as Abs | undefined)?.term as { op?: string; value?: unknown } | undefined;
  return t?.op === "lit" ? { ok: true, value: t.value } : { ok: false };
}

/** 实参的数字字面量值（判不出 ⇒ undefined） */
function numOf(a: Abs | undefined): number | undefined {
  const v = litOf(a);
  return v.ok && typeof v.value === "number" ? v.value : undefined;
}

/**
 * 断言真值域（`assert.ok` 口径：ToBoolean）。
 *
 * - lit term ⇒ 原生 ToBoolean（0 / "" / false / null / undefined 皆 falsy）；
 * - obj / arr / tuple / fn / 非 null 品牌 ⇒ 原生恒真；
 * - 缺参 ⇒ undefined ⇒ falsy（原生 `ok()` 抛 AssertionError）；
 * - 其余（prim 抽象域 / unknown / any / sum / 裸宿主值）⇒ 判不出。
 */
function assertTruthiness(a: Abs | undefined): "truthy" | "falsy" | "unknown" {
  if (a === undefined) return "falsy";
  const v = litOf(a);
  if (v.ok) return v.value ? "truthy" : "falsy";
  const shape = argShape(a);
  if (!shape) return "unknown";
  const k = shape.k;
  if (k === "obj" || k === "arr" || k === "tuple" || k === "fn") return "truthy";
  if (k === "brand") return shape.name === "null" ? "falsy" : "truthy";
  return "unknown";
}

/**
 * 严格相等（`assert.strictEqual` 口径：Object.is）。
 * 任一实参非字面量 ⇒ 判不出（undefined）。
 */
function assertStrictEquals(
  a: Abs | undefined,
  b: Abs | undefined,
): boolean | undefined {
  if (!a || !b) return undefined;
  const va = litOf(a);
  const vb = litOf(b);
  if (!va.ok || !vb.ok) return undefined;
  return Object.is(va.value, vb.value);
}

/**
 * 深度相等（`assert.deepStrictEqual` 口径）：结构比对。
 * 一边字面量、一边抽象 ⇒ 抽象侧可能取到同值 ⇒ 判不出。
 */
function assertDeepEquals(
  a: Abs | undefined,
  b: Abs | undefined,
  depth = 0,
): boolean | undefined {
  if (depth > 4) return undefined;
  if (!a || !b) return undefined;
  const va = litOf(a);
  const vb = litOf(b);
  if (va.ok && vb.ok) return Object.is(va.value, vb.value);
  if (va.ok || vb.ok) return undefined;
  const sa = argShape(a);
  const sb = argShape(b);
  if (!sa || !sb) return undefined;
  if (sa.k !== sb.k) {
    // 两个 prim 的**类型**不同 ⇒ 必不相等；其余跨 kind ⇒ 判不出
    if (sa.k === "prim" && sb.k === "prim") return sa.type !== sb.type;
    return undefined;
  }
  if (sa.k === "obj" && sb.k === "obj") {
    const keys = Object.keys(sa.slots);
    if (keys.length !== Object.keys(sb.slots).length) return false;
    for (const k of keys) {
      const r = assertDeepEquals(sa.slots[k]?.value, sb.slots[k]?.value, depth + 1);
      if (r === undefined) return undefined;
      if (!r) return false;
    }
    return true;
  }
  if (sa.k === "tuple" && sb.k === "tuple") {
    if (sa.elements.length !== sb.elements.length) return false;
    for (let i = 0; i < sa.elements.length; i++) {
      const r = assertDeepEquals(sa.elements[i], sb.elements[i], depth + 1);
      if (r === undefined) return undefined;
      if (!r) return false;
    }
    return true;
  }
  if (sa.k === "arr" && sb.k === "arr") {
    return assertDeepEquals(sa.element, sb.element, depth + 1);
  }
  if (sa.k === "brand" && sb.k === "brand") {
    if (sa.name !== sb.name) return false;
    return assertDeepEquals(sa.shape, sb.shape, depth + 1);
  }
  return undefined;
}

/**
 * RegExp brand 的 source / flags（`assert.match` 判定用）。
 * 只有**字面量 pattern + 字面量 flags** 才可判定；抽象 pattern ⇒ undefined。
 */
function assertRegexpPattern(
  a: Abs | undefined,
): { source: string; flags: string } | undefined {
  const shape = argShape(a);
  if (!shape || shape.k !== "brand" || shape.name !== "RegExp") return undefined;
  const inner = argShape(shape.shape);
  if (!inner || inner.k !== "obj") return undefined;
  const source = inner.slots.source?.value;
  const flags = inner.slots.flags?.value;
  if (!source || !flags) return undefined;
  const s = absStrLit(source);
  const f = absStrLit(flags);
  if (s === undefined || f === undefined) return undefined;
  return { source: s, flags: f };
}

  const urlModule: Record<string, Abs> = {
    // base is optional in Node — required arity 1; label+type render `base?: string`.
    // Bug 866：模块导出的构造器必须带 `ctor: true`——否则 `new URL(...)` 落
    // 「fn 形 callee 构造性未知」⇒ 记 unknown-constructibility **假 may-throw**
    // （原生 `new URL("https://x.dev/a")` 一个都不抛）。
    // **不加 name**：带 name 会让 `$new` 按名派发到 core 的 `evalBuiltinNew`
    // （core 的 URL 模型），丢掉本 env 的字面量精度路径。
    URL: envFn(
      [prim.str(), prim.str()],
      nodeUrlObj,
      (args) => {
        const href = absStrLit(args[0]);
        const base = args[1] !== undefined ? absStrLit(args[1]) : undefined;
        if (href === undefined) {
          // 抽象实参：原生是否抛取决于运行时值 ⇒ may-throw TypeError
          // （旧实现 `return undefined` ⇒ 回落「返回 URL 面、**永不抛**」⇒ 假绿）
          return makeAbsApplyResult(nodeUrlObj, errBrand("TypeError"));
        }
        try {
          const url = base !== undefined ? new URL(href, base) : new URL(href);
          return urlAbsOf(url);
        } catch {
          // 原生抛 TypeError（Invalid URL）⇒ 记 throws 面（不再静默吞掉）
          // ——套 Bug 881（fileURLToPath）同款范式。
          return makeAbsApplyResult(nodeUrlObj, errBrand("TypeError"));
        }
      },
      { params: ["href", "base?"], ctor: true, throws: errBrand("TypeError") },
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
      // Bug 866：`new URLSearchParams(...)` 是合法构造（原生不抛）
      { params: ["init?"], ctor: true },
    ),
    // Bug 881：apply 的 catch 分支**曾经**把原生异常静默吞掉（`return undefined`
    // ⇒ 回落「返回 string、**永不抛**」），而源码注释却写着「保留 returnType/
    // throws 面」——envFn 当时**根本没有** throws 面（注释与实现直接矛盾）。
    // 现在走 core 的 throws 通道：非法 URL / 非 file: scheme ⇒ TypeError
    // （ERR_INVALID_URL / ERR_INVALID_URL_SCHEME）；抽象实参 ⇒ 原生可能抛。
    fileURLToPath: envFn(
      [prim.str()],
      prim.str(),
      (args) => {
        const s = absStrLit(args[0]);
        if (s === undefined) {
          // 抽象实参：原生是否抛取决于运行时值 ⇒ may-throw TypeError
          return makeAbsApplyResult(prim.str(), errBrand("TypeError"));
        }
        try {
          return strLit(nodeFileURLToPath(s));
        } catch {
          // 原生抛 TypeError ⇒ 记 throws 面（不再静默吞掉）
          return makeAbsApplyResult(prim.str(), errBrand("TypeError"));
        }
      },
      { throws: errBrand("TypeError") },
    ),
    // Bug 894：返回域从 1 槽闭合对象 `{ href }` 换成**完整 URL 面**
    // （nodeUrlObj）——原生 pathToFileURL 返回的是 URL 实例（11 组件 + 两个方法）。
    pathToFileURL: envFn(
      [prim.str()],
      nodeUrlObj,
      (args) => {
        const p = absStrLit(args[0]);
        // 抽象实参 ⇒ 回落声明面（nodeUrlObj，成员面完整）
        if (p === undefined) return undefined;
        try {
          return urlAbsOf(nodePathToFileURL(p));
        } catch {
          return makeAbsApplyResult(nodeUrlObj, errBrand("TypeError"));
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

  /** Hash 实例面（createHash 的返回域）——apply 与声明共用一份 brand */
  const hashInstance = brandOf("Hash", objAbs({
    update: envFn([unionOf(prim.str(), bufferBrand)], brandOf("Hash")),
    digest: envFn(
      [prim.str()],
      unionOf(prim.str(), bufferBrand),
      undefined,
      { params: ["encoding?"] },
    ),
    copy: envFn([], brandOf("Hash")),
  }));

  /**
   * Buffer brand 的 length 槽（**字面量**才可判定）——env 的 Buffer 面不建模
   * 长度（`Buffer.alloc(n)` 回落共享 brand）⇒ 通常判不出。
   */
  const bufferLengthOf = (a: Abs | undefined): number | undefined => {
    const shape = argShape(a);
    if (!shape || shape.k !== "brand") return undefined;
    const inner = argShape(shape.shape);
    if (!inner || inner.k !== "obj") return undefined;
    return numOf(inner.slots.length?.value);
  };

  /**
   * `node:crypto` 族（Bug 885）：五个入口的**实参域抛错**原先全缺 ⇒
   * 原生必抛的入口在引擎里恒不抛 ⇒ L2 门禁假绿（一次放行五个）。
   *
   * 原生 oracle（Node v26.10.0 逐个实测，**不猜**）：
   * - `createHash("nope")` ⇒ **Error**（"Digest method not supported"）
   * - `randomBytes(-1)` ⇒ **RangeError**（ERR_OUT_OF_RANGE；size ∈ [0, 2^31-1]）
   * - `randomInt(5, 1)` ⇒ **RangeError**（ERR_OUT_OF_RANGE；max 必须 > min）
   * - `pbkdf2Sync(..., iterations=0, ...)` ⇒ **RangeError**（iterations ∈ [1, 2^31-1]）
   * - `timingSafeEqual` 长度不等 ⇒ **RangeError**（ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH）
   *
   * 判定口径：实参可判定 ⇒ **必抛**（abs 面 = never）；实参抽象 ⇒ **may-throw**
   * （原生在该实参域上确实可能抛）；落在合法域 ⇒ **零抛**。
   */
  /**
   * 受支持的 digest 名（`node:crypto.getHashes()`，小写归一）——
   * `createHash` / `pbkdf2Sync` 的**算法名实参域**判定用（Bug 885）。
   *
   * oracle 实测：`getHashes()` 的每个名字都能被 `createHash` 接受（大小写不敏感），
   * 故该集合对 `createHash` 是**精确**的。（`pbkdf2Sync` 另拒 8 个名字
   * ——shake-* / keccak-kmac*——属 Node 版本细节，未建模。）
   */
  const cryptoDigestNames = new Set(nodeGetHashes().map((n) => n.toLowerCase()));

  /**
   * HMAC **可用**的 digest 名（宿主实测 Node v26.10.0：`getHashes()` 的 81 个
   * 名字里 **73 个**能被 `createHmac` 接受；被拒的 8 个是 `shake*` /
   * `keccak-kmac*` —— XOF / KMAC 没有 HMAC 形式）。
   *
   * 原生分两档：`createHmac("nope", k)`（**不认识**的名字）⇒ **TypeError**
   * （ERR_CRYPTO_INVALID_DIGEST）；`createHmac("shake256", k)`（**认识但 HMAC
   * 用不了**）⇒ **Error**（OpenSSL 错误）⇒ 这 8 个名字必须排除，否则
   * `createHmac` 的实参域闸会放行（**假绿**）。
   */
  const CRYPTO_HMAC_REJECTED_DIGESTS = new Set([
    "keccak-kmac-128",
    "keccak-kmac-256",
    "keccak-kmac128",
    "keccak-kmac256",
    "shake-128",
    "shake-256",
    "shake128",
    "shake256",
  ]);
  const cryptoHmacDigestNames = new Set(
    [...cryptoDigestNames].filter((n) => !CRYPTO_HMAC_REJECTED_DIGESTS.has(n)),
  );

  /**
   * `createCipheriv` / `createDecipheriv` **可用**的 cipher 名（宿主实测：
   * `node:crypto.getCiphers()` ⇒ 165 个）。原生对**未知** cipher 名抛
   * **Error**（ERR_CRYPTO_UNKNOWN_CIPHER / "Unknown cipher"）。
   */
  const cryptoCipherNames = new Set(nodeGetCiphers().map((n) => n.toLowerCase()));

  /**
   * `generateKeyPairSync` 支持的 key type（宿主实测 Node v26.10.0）。
   * 原生对**不支持**的 type 抛 **TypeError**（ERR_INVALID_ARG_VALUE
   * / "The argument 'type' must be a supported key type."）。
   */
  const cryptoKeyTypes = new Set([
    "rsa",
    "dsa",
    "ec",
    "ed25519",
    "ed448",
    "x25519",
    "x448",
  ]);

  /**
   * digest 名实参域闸（`createHash` / `createHmac` / `createSign` /
   * `createVerify` 共用一份口径——族 61 同源化）。
   *
   * 原生有**两档**错误（宿主实测 Node v26.10.0）：
   * - 名字**根本不认识**（不在 `getHashes()` 里）⇒ **TypeError**
   *   （ERR_CRYPTO_INVALID_DIGEST / "Invalid digest: nope"）；
   * - 名字**认识但该入口用不了**（如 HMAC 的 shake-* / keccak-kmac-*，
   *   或 OpenSSL 不支持的 md4）⇒ **Error**（OpenSSL 错误）。
   *
   * 判定：
   * - 实参**抽象** ⇒ 原生**可能**抛 ⇒ **may-throw**（取「不认识」那档的品牌）；
   * - 字面量**不在 known 集** ⇒ 必抛（unknownBrand）；
   * - 字面量在 known 集但**不在 usable 集** ⇒ 必抛（unusableBrand）；
   * - 落在 usable 集 ⇒ **零抛**。
   */
  const digestNameGuard = (
    arg: Abs | undefined,
    known: Set<string>,
    usable: Set<string>,
    ret: Abs,
    unknownBrand: string,
    unusableBrand: string,
  ): AbsApplyResult | undefined => {
    const name = absStrLit(arg);
    if (name === undefined) {
      // 抽象实参：digest 名未知 ⇒ 原生可能抛（不认识 ⇒ 抛）
      return makeAbsApplyResult(ret, errBrand(unknownBrand));
    }
    const key = name.toLowerCase();
    if (!known.has(key)) {
      // 原生抛（不认识的 digest 名）⇒ 必抛
      return makeAbsApplyResult(neverAbs, errBrand(unknownBrand));
    }
    if (!usable.has(key)) {
      // 原生抛（认识但该入口用不了）⇒ 必抛
      return makeAbsApplyResult(neverAbs, errBrand(unusableBrand));
    }
    return undefined;
  };

  /** cipher 名实参域闸（`createCipheriv` / `createDecipheriv` 共用）。 */
  const cipherNameGuard = (
    arg: Abs | undefined,
    ret: Abs,
  ): AbsApplyResult | undefined => {
    const name = absStrLit(arg);
    if (name === undefined) {
      // 抽象实参：cipher 名未知 ⇒ 原生可能抛（未知 cipher ⇒ 抛 Error）
      return makeAbsApplyResult(ret, errBrand("Error"));
    }
    if (!cryptoCipherNames.has(name.toLowerCase())) {
      // 原生抛 Error（ERR_CRYPTO_UNKNOWN_CIPHER / "Unknown cipher"）⇒ 必抛
      return makeAbsApplyResult(neverAbs, errBrand("Error"));
    }
    return undefined;
  };

  /** HMAC 实例面（`createHmac` 的返回域）——apply 与声明共用一份 brand */
  const hmacInstance = brandOf("Hmac", objAbs({
    update: envFn([unionOf(prim.str(), bufferBrand)], brandOf("Hmac")),
    digest: envFn(
      [prim.str()],
      unionOf(prim.str(), bufferBrand),
      undefined,
      { params: ["encoding?"] },
    ),
  }));

  /** Cipher / Decipher 实例面（原生只暴露 `update` / `final` / `getAuthTag`） */
  const cipherInstance = brandOf("Cipher");
  const decipherInstance = brandOf("Decipher");

  /** KeyObject 实例面（`generateKeyPairSync` 的 publicKey / privateKey） */
  const keyObjectInstance = brandOf("KeyObject", objAbs({
    type: prim.str(),
    asymmetricKeyType: prim.str(),
    export: envFn([objAbs({
      format: { value: prim.str(), optional: true },
      type: { value: prim.str(), optional: true },
    })], unionOf(prim.str(), bufferBrand)),
  }));

  /** `generateKeyPairSync` 的 options（原生第二参） */
  const keyPairOptions = objAbs({
    modulusLength: { value: prim.num(), optional: true },
    publicExponent: { value: prim.num(), optional: true },
    namedCurve: { value: prim.str(), optional: true },
    passphrase: { value: unionOf(prim.str(), bufferBrand), optional: true },
    encoding: { value: prim.str(), optional: true },
  });

  /** `generateKeyPairSync` 的返回域（原生 = `{ publicKey, privateKey }`） */
  const keyPairInstance = brandOf("KeyPair", objAbs({
    publicKey: keyObjectInstance,
    privateKey: keyObjectInstance,
  }));

  /** Sign / Verify 实例面（`createSign` / `createVerify` 的返回域） */
  const signInstance = brandOf("Sign", objAbs({
    update: envFn([unionOf(prim.str(), bufferBrand)], brandOf("Sign")),
    sign: envFn([unionOf(prim.str(), bufferBrand)], bufferBrand),
  }));
  const verifyInstance = brandOf("Verify", objAbs({
    update: envFn([unionOf(prim.str(), bufferBrand)], brandOf("Verify")),
    verify: envFn([unionOf(prim.str(), bufferBrand)], prim.bool()),
  }));

  /**
   * `scryptSync` 的实参域（宿主实测 Node v26.10.0）：
   * - `keylen < 0` ⇒ **RangeError**（ERR_OUT_OF_RANGE；keylen ∈ [0, 2^31-1]）；
   *   keylen **抽象** ⇒ 原生可能抛 ⇒ may-throw RangeError。
   * - `options.N` 必须是 **2 的幂**（N=1 ⇒ RangeError；N=0 原生**不抛**）；
   * - 内存闸 `128 * r * (N + p + 2) > maxmem` ⇒ **RangeError**
   *   （ERR_CRYPTO_INVALID_SCRYPT_PARAMS；默认 r=8 / p=1 / maxmem=32MB）。
   *
   * options 槽判不出 ⇒ 原生**可能**抛 ⇒ may-throw RangeError。
   */
  const scryptOptionsGuard = (
    args: Abs[],
    ret: Abs,
  ): AbsApplyResult | undefined => {
    const keylen = numOf(args[2]);
    if (keylen === undefined) {
      // 抽象 keylen ⇒ 原生可能抛（keylen < 0 ⇒ RangeError）
      return makeAbsApplyResult(ret, errBrand("RangeError"));
    }
    if (keylen < 0 || keylen > 0x7fffffff) {
      // 原生：keylen ∈ [0, 2^31-1] ⇒ 必抛 RangeError
      return makeAbsApplyResult(neverAbs, errBrand("RangeError"));
    }
    const options = args.length > 3 ? args[3] : undefined;
    if (options === undefined) {
      // 无 options ⇒ 默认 N=16384 / r=8 / p=1 / maxmem=32MB ⇒ 恒不抛
      return undefined;
    }
    const optShape = options.shape;
    if (optShape.k !== "obj") {
      // options 抽象（unknown / any / 非 obj）⇒ 原生可能抛
      return makeAbsApplyResult(ret, errBrand("RangeError"));
    }
    const slots = optShape.slots;
    /**
     * options 槽的三态：
     * - **缺省**（槽不存在）⇒ 原生用**默认值** ⇒ 可判定；
     * - **字面量** ⇒ 可判定；
     * - **抽象**（槽在、值判不出）⇒ 原生可能抛 ⇒ may-throw。
     */
    const numSlot = (key: string): number | undefined | null => {
      const slot = slots[key];
      if (!slot) return undefined; // 缺省 ⇒ 用默认值
      return numOf(slot.value) ?? null; // null = 抽象
    };
    const n = numSlot("N");
    const r = numSlot("r");
    const p = numSlot("p");
    const maxmem = numSlot("maxmem");
    if (n === null || r === null || p === null || maxmem === null) {
      // 有抽象槽 ⇒ 原生可能抛
      return makeAbsApplyResult(ret, errBrand("RangeError"));
    }
    // N：必须是 2 的幂（N=1 原生抛；N=0 原生不抛 ⇒ 只查 N>1）
    const effN = n ?? 16384;
    if (effN > 1 && (effN & (effN - 1)) !== 0) {
      return makeAbsApplyResult(neverAbs, errBrand("RangeError"));
    }
    // 内存闸：128 * r * (N + p + 2) > maxmem（默认值同原生）
    const effR = r ?? 8;
    const effP = p ?? 1;
    const effMax = maxmem ?? 32 * 1024 * 1024;
    if (128 * effR * (effN + effP + 2) > effMax) {
      return makeAbsApplyResult(neverAbs, errBrand("RangeError"));
    }
    return undefined;
  };

  const cryptoModule: Record<string, Abs> = {
    randomBytes: envFn(
      [prim.num()],
      bufferBrand,
      (args) => {
        const size = numOf(args[0]);
        if (size === undefined) {
          // 抽象实参：size 可能越界 ⇒ 原生可能抛
          return makeAbsApplyResult(bufferBrand, errBrand("RangeError"));
        }
        // 原生：size ∈ [0, 2^31-1]（小数截断，不抛）
        if (size < 0 || size > 0x7fffffff) {
          return makeAbsApplyResult(neverAbs, errBrand("RangeError"));
        }
        return bufferBrand;
      },
    ),
    randomUUID: envFn([], prim.str()),
    randomInt: envFn(
      [prim.num(), prim.num()],
      prim.num(),
      (args) => {
        // 原生签名 randomInt([min,] max)：max 必须 > min（randomInt(0) 也抛）
        const first = numOf(args[0]);
        const second = args.length > 1 ? numOf(args[1]) : undefined;
        if (first === undefined || (args.length > 1 && second === undefined)) {
          return makeAbsApplyResult(prim.num(), errBrand("RangeError"));
        }
        const min = args.length > 1 ? first : 0;
        const max = args.length > 1 ? second! : first;
        if (max <= min) {
          return makeAbsApplyResult(neverAbs, errBrand("RangeError"));
        }
        return prim.num();
      },
    ),
    // Hash/HMAC 实例：update 链式返回自身 brand（不是 unknown）
    createHash: envFn(
      [prim.str()],
      hashInstance,
      (args) => {
        const guard = digestNameGuard(
          args[0],
          cryptoDigestNames,
          cryptoDigestNames,
          hashInstance,
          "Error",
          "Error",
        );
        if (guard) return guard;
        return hashInstance;
      },
    ),
    // 族 61：HMAC 的 digest 名域**独立**于 `createHash`（原生拒 shake-* /
    // keccak-kmac* —— 8 个名字）。原生分两档错误：**不认识**的名字 ⇒
    // TypeError（ERR_CRYPTO_INVALID_DIGEST）；**认识但 HMAC 用不了** ⇒
    // Error（OpenSSL 错误）。
    createHmac: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand)],
      hmacInstance,
      (args) => {
        const guard = digestNameGuard(
          args[0],
          cryptoDigestNames,
          cryptoHmacDigestNames,
          hmacInstance,
          "TypeError",
          "Error",
        );
        if (guard) return guard;
        return hmacInstance;
      },
    ),
    // 族 61：cipher 名域（宿主：未知 cipher ⇒ Error "Unknown cipher"）。
    // key / iv 的**长度**校验未建模（env 的 Buffer 面不建模长度）⇒
    // 已知偏差，见报告。
    createCipheriv: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), unionOf(prim.str(), bufferBrand)],
      cipherInstance,
      (args) => {
        const guard = cipherNameGuard(args[0], cipherInstance);
        if (guard) return guard;
        return cipherInstance;
      },
    ),
    createDecipheriv: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), unionOf(prim.str(), bufferBrand)],
      decipherInstance,
      (args) => {
        const guard = cipherNameGuard(args[0], decipherInstance);
        if (guard) return guard;
        return decipherInstance;
      },
    ),
    // 族 61：Sign / Verify 与 createHash 同族（digest 名域）——原生对
    // 不支持的 digest 抛 **TypeError**（ERR_CRYPTO_INVALID_DIGEST）。
    createSign: envFn(
      [prim.str()],
      signInstance,
      (args) => {
        const guard = digestNameGuard(
          args[0],
          cryptoDigestNames,
          cryptoDigestNames,
          signInstance,
          "TypeError",
          "Error",
        );
        if (guard) return guard;
        return signInstance;
      },
    ),
    createVerify: envFn(
      [prim.str()],
      verifyInstance,
      (args) => {
        const guard = digestNameGuard(
          args[0],
          cryptoDigestNames,
          cryptoDigestNames,
          verifyInstance,
          "TypeError",
          "Error",
        );
        if (guard) return guard;
        return verifyInstance;
      },
    ),
    // 族 61：key type 域（原生：不支持的 type ⇒ TypeError
    // ERR_INVALID_ARG_VALUE）+ 返回域 `{ publicKey, privateKey }`。
    // options（modulusLength / namedCurve …）的域**未建模**（原生对
    // modulusLength < 512 抛 Error）⇒ 已知偏差，见报告。
    generateKeyPairSync: envFn(
      [prim.str(), keyPairOptions],
      keyPairInstance,
      (args) => {
        const type = absStrLit(args[0]);
        if (type === undefined) {
          // 抽象实参：key type 未知 ⇒ 原生可能抛
          return makeAbsApplyResult(keyPairInstance, errBrand("TypeError"));
        }
        if (!cryptoKeyTypes.has(type.toLowerCase())) {
          return makeAbsApplyResult(neverAbs, errBrand("TypeError"));
        }
        return keyPairInstance;
      },
      { params: ["type", "options?"] },
    ),
    pbkdf2Sync: envFn(
      [prim.str(), prim.str(), prim.num(), prim.num(), prim.str()],
      bufferBrand,
      (args) => {
        const iterations = numOf(args[2]);
        const keylen = numOf(args[3]);
        const digest = absStrLit(args[4]);
        if (iterations === undefined || keylen === undefined) {
          // 抽象实参：迭代次数 / 密钥长度可能越界 ⇒ 原生可能抛 RangeError
          return makeAbsApplyResult(bufferBrand, errBrand("RangeError"));
        }
        if (digest === undefined) {
          // 抽象 digest ⇒ 原生可能抛 TypeError [ERR_CRYPTO_INVALID_DIGEST]
          return makeAbsApplyResult(bufferBrand, errBrand("TypeError"));
        }
        // 原生：iterations ∈ [1, 2^31-1]；keylen ∈ [0, 2^31-1]
        if (iterations < 1 || iterations > 0x7fffffff) {
          return makeAbsApplyResult(neverAbs, errBrand("RangeError"));
        }
        if (keylen < 0 || keylen > 0x7fffffff) {
          return makeAbsApplyResult(neverAbs, errBrand("RangeError"));
        }
        if (!cryptoDigestNames.has(digest.toLowerCase())) {
          // 原生抛 TypeError [ERR_CRYPTO_INVALID_DIGEST] ⇒ 必抛
          return makeAbsApplyResult(neverAbs, errBrand("TypeError"));
        }
        return bufferBrand;
      },
    ),
    // 族 61：`scryptSync` 的**实参域**（原生 keylen ∈ [0, 2^31-1]；
    // options.N 必须是 2 的幂；内存闸 128*r*(N+p+2) ≤ maxmem）
    // —— 此前**恒不抛** ⇒ 必抛入口被放行（假绿）。
    // 声明（形参表 / 返回域）保持**逐字不变**：options 槽从**调用实参**
    // 里读（args[3]），不扩形参表 ⇒ 既有成员的声明面不动。
    scryptSync: envFn(
      [prim.str(), prim.str(), prim.num()],
      bufferBrand,
      (args) => {
        const guard = scryptOptionsGuard(args, bufferBrand);
        if (guard) return guard;
        return bufferBrand;
      },
    ),
    timingSafeEqual: envFn(
      [bufferBrand, bufferBrand],
      prim.bool(),
      (args) => {
        // 原生：两 buffer **长度不等** ⇒ RangeError
        // （ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH）
        const la = bufferLengthOf(args[0]);
        const lb = bufferLengthOf(args[1]);
        if (la !== undefined && lb !== undefined) {
          if (la !== lb) {
            return makeAbsApplyResult(neverAbs, errBrand("RangeError"));
          }
          return prim.bool();
        }
        // 长度判不出（env 的 Buffer 面不建模长度）⇒ 原生确实可能抛 ⇒ may-throw
        return makeAbsApplyResult(prim.bool(), errBrand("RangeError"));
      },
    ),
  };

  /**
   * ChildProcess 实例面（签名级）：stdio 是流、on/kill/pid 可解。
   * 副作用（真起进程 / 流上 data 何时到）仍 mock-required（limitations §2）。
   */
  const spawnOptions = objAbs({
    cwd: { value: prim.str(), optional: true },
    env: { value: openObjBrand("Record<string, string | undefined>", { key: prim.str(), value: unionOf(prim.str(), undef()) }), optional: true },
    stdio: { value: unionOf(prim.str(), arrOf(prim.str())), optional: true },
    shell: { value: unionOf(prim.bool(), prim.str()), optional: true },
    timeout: { value: prim.num(), optional: true },
    killSignal: { value: unionOf(prim.str(), prim.num()), optional: true },
  });
  const childProcessInstance = brandOf(
    "ChildProcess",
    objAbs({
      pid: prim.num(),
      connected: prim.bool(),
      killed: prim.bool(),
      exitCode: unionOf(prim.num(), nullLit()),
      signalCode: unionOf(prim.str(), nullLit()),
      stdin: brandOf("Writable", objAbs(streamIoMethods)),
      stdout: brandOf("Readable", objAbs(streamIoMethods)),
      stderr: brandOf("Readable", objAbs(streamIoMethods)),
      on: envFn([prim.str(), callbackFnBrand], brandOf("ChildProcess")),
      once: envFn([prim.str(), callbackFnBrand], brandOf("ChildProcess")),
      off: envFn([prim.str(), callbackFnBrand], brandOf("ChildProcess")),
      kill: envFn([unionOf(prim.str(), prim.num())], prim.bool(), undefined, {
        params: ["signal?"],
      }),
      ref: envFn([], brandOf("ChildProcess")),
      unref: envFn([], brandOf("ChildProcess")),
    }),
  );

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
    // Bug 931：返回域原先是**闭合 4 槽对象**（status / stdout / stderr / error）
    // ⇒ `pid` / `output` / `signal` 三个**真实成员**读出 **exact undefined**
    // （错值：原生 pid 是 number）⇒ `.output[0]` 落「在 undefined 上取下标」
    // ⇒ 引擎**证明**「必抛 TypeError」⇒ L2 门禁假红。
    // 原生 `Object.keys(spawnSync("ls", ["-la"]))` =
    //   ['status', 'signal', 'output', 'pid', 'stdout', 'stderr']
    // （`error` 只在 spawn 失败时出现——失败时原生**确实**带 error 键，故保留）。
    spawnSync: envFn(
      [prim.str(), arrOf(prim.str()), objAbs({
        encoding: { value: prim.str(), optional: true },
        timeout: { value: prim.num(), optional: true },
        maxBuffer: { value: prim.num(), optional: true },
        cwd: { value: prim.str(), optional: true },
      })],
      objAbs({
        pid: prim.num(),
        // output = [null, stdout, stderr]（stdio 未接管 stdout 时首项为 null）
        output: arrOf(unionOf(bufferBrand, nullLit())),
        status: unionOf(prim.num(), nullLit()),
        signal: unionOf(prim.str(), nullLit()),
        stdout: unionOf(prim.str(), bufferBrand),
        stderr: unionOf(prim.str(), bufferBrand),
        error: unionOf(brandOf("Error"), undef()),
      }),
      undefined,
      { params: ["command", "args", "options?"] },
    ),
    exec: envFn([prim.str(), callbackFnBrand], childProcessInstance, undefined, {
      params: ["command", "callback?"],
    }),
    execFile: envFn([prim.str(), arrOf(prim.str()), callbackFnBrand], childProcessInstance, undefined, {
      params: ["file", "args?", "callback?"],
    }),
    spawn: envFn([prim.str(), arrOf(prim.str()), spawnOptions], childProcessInstance, undefined, {
      params: ["command", "args", "options?"],
    }),
    fork: envFn([prim.str(), arrOf(prim.str()), spawnOptions], childProcessInstance, undefined, {
      params: ["modulePath", "args", "options?"],
    }),
  };

  const utilModule: Record<string, Abs> = {
    // HOF：callback 风格 fn → promise 风格 fn。真实 arity 由调用点决定，
    // 用角色 brand 表达（format 干净，不假装具体参数表）。
    //
    // Bug 882（env 侧）：这四个函数的**品牌形参**（CallbackFn / PromiseFn /
    // Function / Value）原先是 relation 面 ⇒ 调用时走 core 的 relation 实例化
    // （`bindTypeVars` 做类型变量绑定）。具名导入调用时实参可能是**裸宿主值**
    //（宿主函数 / 用户函数声明）⇒ 品牌形参参与绑定时会在代数解引用点炸掉
    // ⇒ 上层记「可能抛 TypeError」⇒ L2 门禁假红（原生必不抛）。
    //
    // env 侧的规避（core 侧另有 S6 的实参归一化 + 保护，两边互补）：
    // **给这四个函数加 apply** ⇒ 调用走 apply 面，**不再进入 relation 实例化**
    // ⇒ 品牌形参不参与类型变量绑定（建模侧规避），且不依赖实参是否已被归一化。
    // 签名（paramTypes / returnType）保持不变 ⇒ format 面不变。
    promisify: envFn([callbackFnBrand], promiseFnBrand, () => promiseFnBrand, {
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
    // HOF 与 promisify 对偶：promise fn → callback fn（Bug 882 env 侧：apply
    // 面 ⇒ 品牌形参不参与类型变量绑定）
    callbackify: envFn([promiseFnBrand], callbackFnBrand, () => callbackFnBrand),
    deprecate: envFn([anyParam, prim.str()], anyValueBrand),
    // Bug 882 env 侧：apply 面 ⇒ 品牌形参不参与类型变量绑定
    inherits: envFn(
      [brandOf("Function"), brandOf("Function")],
      undef(),
      () => undef(),
    ),
    isDeepStrictEqual: envFn(
      [anyValueBrand, anyValueBrand],
      prim.bool(),
      () => prim.bool(),
    ),
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
    // Bug 866：模块导出的构造器必须带 `ctor: true`——否则 `new TextEncoder()`
    // / `new TextDecoder("utf-8")` 落「fn 形 callee 构造性未知」⇒ 记
    // unknown-constructibility **假 may-throw**（原生一个都不抛）。
    //
    // ⚠ **已知限制（族 64 收尾时查清 · 未修）**：`util.TextEncoder` /
    // `util.TextDecoder` 与**全局**同名导出是**同一个 class**
    // （宿主实测 `require("util").TextEncoder === TextEncoder`）⇒ 裸调**必抛**
    // TypeError；但此处只有 `ctor: true`、**没有**类值标记的 rest 形参
    // ⇒ core 的 `isClassValueCallee` 不命中 ⇒ 裸调恒不抛 ⇒ **同族假绿**
    // （与**全局**面分叉 —— 全局面已由族 64 改成类值）。
    // 收口它要动 **core 的 `$new` env 构造器分支**（`exec/class/declare.ts`）：
    // 无 `apply` 的 env 构造器走 `$call` ⇒ 会命中类值判据 ⇒ **`new` 也抛**
    // ⇒ 必须挂 `apply`；而挂 `apply` 后实例面从 `obj` 变 `brand`
    // ⇒ 打破既有金标 `env-bug-866-module-ctor.test.ts`（`shape.k === "obj"`）。
    // ⇒ 收益窄（少见的裸调路径）＋ 代价越界到 core ⇒ **本波登记为已知限制**。
    TextEncoder: envFn(
      [],
      objAbs({
        encode: envFn([prim.str()], brandOf("Uint8Array", objAbs({
          length: prim.num(),
          buffer: brandOf("ArrayBuffer"),
        }))),
        encoding: prim.str(),
      }),
      undefined,
      { ctor: true },
    ),
    TextDecoder: envFn(
      [prim.str()],
      objAbs({
        decode: envFn([brandOf("Uint8Array", objAbs({ length: prim.num() }))], prim.str()),
        encoding: prim.str(),
      }),
      undefined,
      { params: ["encoding?"], ctor: true },
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
    name: "EventEmitter",
    ctor: true,
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

  const streamCtor = (brandName: string): Abs =>
    envFn(
      [objAbs({ ...streamBaseSlots, ...streamHooks })],
      brandOf(brandName, objAbs(streamIoMethods)),
      undefined,
      { params: ["options?"], name: brandName, ctor: true },
    );

  /**
   * stream: 实例面 + 用户钩子（transform/flush/read/write/final）可 refine。
   * 机器驱动 data 仍 mock-recommended（limitations §2）。
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
    promises: objAbs({
      pipeline: envFnVariadic(brandOf("Stream"), promiseOf(undef()), {
        restName: "...streams",
      }),
      finished: envFn([brandOf("Stream")], promiseOf(undef())),
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
  // ══════════════════════════════════════════════════════════════════════
  // Bug 879：`node:assert` 族**建模成永不抛** ⇒ L2 门禁假绿
  //
  // 原生 Node（v26 实测）：断言**失败必抛 AssertionError**——
  //   ok(false) / ok(0) / ok(undefined) ⇒ AssertionError
  //   strictEqual(1, 2) / deepStrictEqual({a:1},{a:2}) ⇒ AssertionError
  //   notStrictEqual(1, 1) ⇒ AssertionError
  //   match("abc", /z/) ⇒ AssertionError
  //   fail() / fail("boom") ⇒ AssertionError（**恒抛**）
  //   strictEqual(1)（缺参）⇒ TypeError [ERR_MISSING_ARGS]（不是 AssertionError）
  //
  // 旧建模：六个函数全是 relation 面（**恒不抛**）⇒ 六个必抛入口一次放行。
  //
  // 新建模（走 core 的 throws 通道，见 abs-helpers 的 envFn 契约）：
  // - 实参可判定且断言**失败** ⇒ **必抛**（abs 面 = never + AssertionError）；
  // - 实参可判定且断言**成立** ⇒ **零抛**（裸 Abs 返回）；
  // - 实参**判不出**（抽象值 / 抽象 pattern）⇒ **may-throw**（原生在该域上
  //   确实可能抛）；断言失败 ⇒ 必抛。
  // ══════════════════════════════════════════════════════════════════════
  const assertionError = errBrand("AssertionError");
  /** 缺参 ⇒ 原生 TypeError [ERR_MISSING_ARGS]（strictEqual / deepStrictEqual 族） */
  const missingArgsError = errBrand("TypeError");
  const assertModule: Record<string, Abs> = {
    ok: envFn(
      [anyParam, assertMessageArg],
      undef(),
      (args) => {
        const t = assertTruthiness(args[0]);
        // 假值 ⇒ 原生必抛 AssertionError
        if (t === "falsy") return makeAbsApplyResult(neverAbs, assertionError);
        // 判不出 ⇒ 原生可能抛
        if (t === "unknown") return makeAbsApplyResult(undef(), assertionError);
        return undef();
      },
      { params: ["value", "message?"] },
    ),
    strictEqual: envFn(
      [anyParam, anyParam, assertMessageArg],
      undef(),
      (args) => {
        if (args.length < 2) return makeAbsApplyResult(neverAbs, missingArgsError);
        const eq = assertStrictEquals(args[0], args[1]);
        if (eq === false) return makeAbsApplyResult(neverAbs, assertionError);
        if (eq === undefined) return makeAbsApplyResult(undef(), assertionError);
        return undef();
      },
      { params: ["actual", "expected", "message?"] },
    ),
    deepStrictEqual: envFn(
      [anyParam, anyParam, assertMessageArg],
      undef(),
      (args) => {
        if (args.length < 2) return makeAbsApplyResult(neverAbs, missingArgsError);
        const eq = assertDeepEquals(args[0], args[1]);
        if (eq === false) return makeAbsApplyResult(neverAbs, assertionError);
        if (eq === undefined) return makeAbsApplyResult(undef(), assertionError);
        return undef();
      },
      { params: ["actual", "expected", "message?"] },
    ),
    notStrictEqual: envFn(
      [anyParam, anyParam, assertMessageArg],
      undef(),
      (args) => {
        if (args.length < 2) return makeAbsApplyResult(neverAbs, missingArgsError);
        const eq = assertStrictEquals(args[0], args[1]);
        // 相等 ⇒ 断言失败 ⇒ 必抛
        if (eq === true) return makeAbsApplyResult(neverAbs, assertionError);
        if (eq === undefined) return makeAbsApplyResult(undef(), assertionError);
        return undef();
      },
      { params: ["actual", "expected", "message?"] },
    ),
    match: envFn(
      [prim.str(), brandOf("RegExp"), assertMessageArg],
      undef(),
      (args) => {
        const value = absStrLit(args[0]);
        const re = assertRegexpPattern(args[1]);
        if (value === undefined || re === undefined) {
          // 判不出（抽象字符串 / 抽象 pattern）⇒ 原生可能抛
          return makeAbsApplyResult(undef(), assertionError);
        }
        let matched = false;
        try {
          matched = new RegExp(re.source, re.flags).test(value);
        } catch {
          // 非法 pattern ⇒ 原生抛 SyntaxError（不是 AssertionError）
          return makeAbsApplyResult(neverAbs, errBrand("SyntaxError"));
        }
        if (!matched) return makeAbsApplyResult(neverAbs, assertionError);
        return undef();
      },
      { params: ["value", "regexp", "message?"] },
    ),
    fail: envFn(
      [assertMessageArg],
      prim.never,
      () => makeAbsApplyResult(neverAbs, assertionError),
      { params: ["message?"] },
    ),
  };

  // ══════════════════════════════════════════════════════════════════════
  // Bug 869 / 871：process 的三个流面（stdin / stdout / stderr）
  //
  // 原生 Node：三者都是 Socket（继承 EventEmitter）——on / once / off /
  // emit / addListener / removeListener / pipe / destroy / setEncoding /
  // pause / resume / read / isTTY / fd / readable / writable 一应俱全；
  // stdout / stderr 另有 write / end / cork / uncork。
  //
  // 旧面：stdin 只有 `{on}`、stdout/stderr 只有 `{write}` ⇒ 成员读出
  // **exact undefined** ⇒ 引擎**证明**「调用 undefined 必抛 TypeError」
  // ⇒ L2 `nudo:entry-may-throw` **假红**（原生这三行一个都不抛）。
  // ══════════════════════════════════════════════════════════════════════
  /** 流面基座（EventEmitter 面 + 流 I/O 面）——三个流共用一份形状 */
  const processStreamBase = (): Record<string, Abs> => ({
    on: envFn([prim.str(), callbackFnBrand], brandOf("Socket")),
    once: envFn([prim.str(), callbackFnBrand], brandOf("Socket")),
    off: envFn([prim.str(), callbackFnBrand], brandOf("Socket")),
    addListener: envFn([prim.str(), callbackFnBrand], brandOf("Socket")),
    removeListener: envFn([prim.str(), callbackFnBrand], brandOf("Socket")),
    emit: envFn([prim.str(), anyParam], prim.bool(), undefined, {
      params: ["event", "...args"],
    }),
    pipe: envFn([brandOf("Stream")], brandOf("Socket")),
    destroy: envFn([unionOf(brandOf("Error"), nullLit())], undef(), undefined, {
      params: ["error?"],
    }),
    setEncoding: envFn([prim.str()], brandOf("Socket")),
    pause: envFn([], brandOf("Socket")),
    resume: envFn([], brandOf("Socket")),
    read: envFn(
      [prim.num()],
      unionOf(prim.str(), bufferBrand, nullLit()),
      undefined,
      { params: ["size?"] },
    ),
    // 非 TTY 时原生是 undefined（管道 / 重定向）⇒ bool | undefined
    isTTY: unionOf(prim.bool(), undef()),
    fd: prim.num(),
    readable: prim.bool(),
    writable: prim.bool(),
  });

  /** process.stdin（Readable 面） */
  const processReadableStream = brandOf(
    "Socket",
    objAbs(processStreamBase()),
  );

  /** process.stdout / process.stderr（Writable 面） */
  const processWritableStream = brandOf(
    "Socket",
    objAbs({
      ...processStreamBase(),
      write: envFn(
        [unionOf(prim.str(), bufferBrand)],
        prim.bool(),
        undefined,
        { params: ["chunk"] },
      ),
      end: envFn(
        [unionOf(prim.str(), bufferBrand), callbackFnBrand],
        undef(),
        undefined,
        { params: ["chunk?", "callback?"] },
      ),
      cork: envFn([], brandOf("Socket")),
      uncork: envFn([], brandOf("Socket")),
    }),
  );

  // ══════════════════════════════════════════════════════════════════════
  // Bug 863：node 全局清单补齐
  //
  // 真实 Node v26（ESM 上下文）globalThis 上有 141 个非下划线全局；node env
  // 此前只声明 41 个（es 面 29 + node 面 12）。**未建模**的宿主构造器被
  // core 的 `$new` 兜底铸成**空 brand**（闭 obj 无槽）⇒ 成员读出 exact
  // undefined ⇒ 再链式读一次就成「定抛 TypeError」（假红）；未建模的**全局
  // 对象**（crypto / performance / navigator …）退化成 unknown + 误导诊断
  // `nudo:unknown-inference`（把引擎债指向用户代码）。
  //
  // 建模口径（**不把宿主内建遮蔽成比宿主更差的声明**）：
  // - core 已有**精确**建模的全局（URL / URLSearchParams / TextDecoder /
  //   Proxy / Error 族 / TypedArray 族 / Map / Set …）⇒ **不声明**——它们走
  //   宿主身份路由（ENV_SHADOW_SKIP_GLOBALS）或 core 的 `$new` 精确派发，
  //   env 声明反而会遮蔽精确的 throws 面（Bug 884 同族：遮蔽 ⇒ throws 面
  //   消失 ⇒ 假绿）。
  // - 宿主**可构造**的构造器 ⇒ `{ ctor: true }` + 实例面。
  // - 宿主**不可**构造的（Illegal constructor / abstract / 不能 new）⇒
  //   `{ ctor: false }`（原生 `new X()` 定抛 TypeError，同口径）+ 静态面。
  // - 全局对象 / 函数 ⇒ objAbs / envFn 合理签名。
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 宿主**可**构造的构造器声明（`{ctor:true}` + 实例面 + 可选静态面）。
   *
   * `opts.apply`（族 64 新增）：**类值**声明用的构造面——原生里「类」只有
   * `[[Construct]]` 面（裸调定抛 TypeError），core 的 Bug 272 判据是
   * `ctor: true` + 单一 rest 形参 `"_rest"`（`isClassValueCallee`）⇒ 裸调
   * 走 core 的类值分支（定抛 TypeError）；`apply` 返回**声明实例面** ⇒
   * `new X()` 仍拿到声明的实例面（不丢精度）。
   */
  const ctorOf = (
    name: string,
    paramTypes: Abs[],
    instance: Abs,
    opts?: { params?: string[]; slots?: Record<string, Abs>; apply?: EnvApplyImpl },
  ): Abs =>
    envFn(paramTypes, instance, opts?.apply, {
      name,
      ctor: true,
      ...(opts?.params ? { params: opts.params } : {}),
      ...(opts?.slots ? { slots: opts.slots } : {}),
    });

  /**
   * 宿主**不可**构造的构造器声明（{ctor:false}）。
   * 原生 `new X()` 定抛 TypeError（Illegal constructor / abstract / 不能
   * new）⇒ ctor:false 与原生同口径；静态面（abort / timeout / now …）照常。
   */
  const nonCtorOf = (
    name: string,
    instance: Abs,
    opts?: { params?: string[]; slots?: Record<string, Abs> },
  ): Abs =>
    envFn([], instance, undefined, {
      name,
      ctor: false,
      ...(opts?.params ? { params: opts.params } : {}),
      ...(opts?.slots ? { slots: opts.slots } : {}),
    });

  /** EventTarget 面（EventTarget / AbortSignal / MessagePort 共用） */
  const eventTargetSlots = {
    addEventListener: envFn([prim.str(), callbackFnBrand], undef(), undefined, {
      params: ["type", "listener"],
    }),
    removeEventListener: envFn([prim.str(), callbackFnBrand], undef(), undefined, {
      params: ["type", "listener"],
    }),
    dispatchEvent: envFn([prim.unknown], prim.bool()),
  };

  /** 流面（ReadableStream / WritableStream / TransformStream 家族） */
  const streamSlots = {
    locked: prim.bool(),
    cancel: envFn([prim.unknown], undef()),
    close: envFn([], undef()),
    abort: envFn([prim.unknown], undef()),
    getReader: envFn([], brandOf("ReadableStreamDefaultReader")),
    getWriter: envFn([], brandOf("WritableStreamDefaultWriter")),
    pipeThrough: envFn([brandOf("TransformStream")], brandOf("ReadableStream")),
    pipeTo: envFn([brandOf("WritableStream")], promiseOf(prim.unknown)),
    tee: envFn([], arrOf(brandOf("ReadableStream"))),
    values: envFn([], brandOf("ReadableStreamIterator")),
  };

  /**
   * Response 实例面（Bug 1044：构造器实例面 + 静态工厂返回面**同源**）。
   *
   * 静态工厂 `Response.json(...)` 返回的**就是**一个 Response 实例 ⇒ 静态面
   * 与实例面共用同一份槽表 ⇒ 读面与宿主一致（`.status` → number、`.then` →
   * exact `undefined`），也与 web env 的静态面（返回实例面）同源。
   */
  const ResponseInstance = brandOf(
    "Response",
    objAbs({
      type: prim.str(),
      url: prim.str(),
      redirected: prim.bool(),
      status: prim.num(),
      ok: prim.bool(),
      statusText: prim.str(),
      headers: brandOf("Headers"),
      body: prim.unknown,
      bodyUsed: prim.bool(),
      clone: envFn([], brandOf("Response")),
      arrayBuffer: envFn([], promiseOf(brandOf("ArrayBuffer"))),
      blob: envFn([], promiseOf(brandOf("Blob"))),
      formData: envFn([], promiseOf(brandOf("FormData"))),
      json: envFn([], promiseOf(prim.unknown)),
      text: envFn([], promiseOf(prim.str())),
    }),
  );

  /**
   * performance 成员表（全局对象面 + `Performance` 实例面**同源**）。
   *
   * Bug 1047：宿主真实成员（真 node v26.10.0 实测
   * `Object.getOwnPropertyNames(Object.getPrototypeOf(performance))`）——
   * 旧表只声明 9 个槽 ⇒ 缺的成员读出 **exact undefined**（确定的错值）
   * ⇒ 调用即「确定抛 TypeError」⇒ 合法 node 代码被判「必抛」（L2 门禁假红）。
   * web env 同一对象早已含 `clearResourceTimings` / `toJSON`（Bug 862）
   * ⇒ 两 env 收口不对称，这里补齐。
   */
  const performanceSlots = {
    timeOrigin: prim.num(),
    now: envFn([], prim.num()),
    mark: envFn([prim.str()], brandOf("PerformanceMark")),
    measure: envFn([prim.str()], brandOf("PerformanceMeasure")),
    clearMarks: envFn([prim.str()], undef()),
    clearMeasures: envFn([prim.str()], undef()),
    getEntries: envFn([], arrOf(brandOf("PerformanceEntry"))),
    getEntriesByName: envFn([prim.str()], arrOf(brandOf("PerformanceEntry"))),
    getEntriesByType: envFn([prim.str()], arrOf(brandOf("PerformanceEntry"))),
    // Performance Level 2 标准面（浏览器 + node 都有）：
    clearResourceTimings: envFn([], undef()),
    toJSON: envFn([], prim.unknown),
    // perf_hooks（node 专有面，宿主实测存在）：
    // - `setResourceTimingBufferSize(n)` → undefined
    // - `eventLoopUtilization()` → `{ idle, active, utilization }`
    // - `nodeTiming` → 对象（**属性**，不是函数）
    // - `timerify(fn)` → **返回被包装的函数**（不是 undefined）
    setResourceTimingBufferSize: envFn([prim.num()], undef()),
    eventLoopUtilization: envFn(
      [],
      objAbs({
        idle: prim.num(),
        active: prim.num(),
        utilization: prim.num(),
      }),
    ),
    nodeTiming: objAbs({
      name: prim.str(),
      entryType: prim.str(),
      startTime: prim.num(),
      duration: prim.num(),
      nodeStart: prim.num(),
      v8Start: prim.num(),
      environment: prim.str(),
      loopStart: prim.num(),
      loopExit: prim.num(),
      bootstrapComplete: prim.num(),
      idleTime: prim.num(),
      uvMetricsInfo: prim.unknown,
    }),
    // `timerify(fn)` 原生返回**可调用**的包装函数 ⇒ 返回域给一个可调用面
    // （声明成 undefined 会让 `performance.timerify(f)(x)` 落「不可调用」）。
    timerify: envFn([prim.unknown], envFn([prim.unknown], prim.unknown)),
  };
  /** performance 对象面（全局 `performance` 与 `Performance` 实例共用一份槽表） */
  const performanceObj = objAbs(performanceSlots);

  /**
   * navigator 成员表（全局对象面 + `Navigator` 实例面**同源**）。
   *
   * Bug 1048：Web Locks API（**W3C 标准**，浏览器 + node 24+ 都有）——旧表
   * 只声明 5 个槽 ⇒ `navigator.locks` 读出 **exact undefined**（确定的错值，
   * 宿主上是 LockManager 对象）⇒ `navigator.locks.request(...)` 判「确定抛
   * TypeError」（L2 门禁假红）。宿主实测：`navigator.locks` 原型成员 =
   * `constructor, request, query`。
   */
  const navigatorSlots = {
    hardwareConcurrency: prim.num(),
    language: prim.str(),
    languages: arrOf(prim.str()),
    userAgent: prim.str(),
    platform: prim.str(),
    locks: brandOf(
      "LockManager",
      objAbs({
        query: envFn([], promiseOf(prim.unknown)),
        request: envFn([prim.unknown, prim.unknown], promiseOf(prim.unknown)),
      }),
    ),
  };
  /** navigator 对象面（全局 `navigator` 与 `Navigator` 实例共用一份槽表） */
  const navigatorObj = objAbs(navigatorSlots);

  /**
   * crypto.subtle 成员表（`crypto` 全局面 + `SubtleCrypto` 实例面**同源**）。
   *
   * Bug 1049：web env 的同名表缺 4 个标准 WebCrypto API（`deriveKey` /
   * `deriveBits` / `wrapKey` / `unwrapKey`）⇒ 合法浏览器代码被判「确定抛
   * TypeError」（L2 门禁假红）；node 侧已含前两个 ⇒ 两 env 自相矛盾。
   * 这里把 node 侧补齐 Level 2 的 `wrapKey` / `unwrapKey`（宿主实测存在）
   * ⇒ 两 env 的 `crypto.subtle` 成员集合同源。
   */
  const subtleCryptoSlots = {
    encrypt: envFn([prim.unknown, prim.unknown], promiseOf(prim.unknown)),
    decrypt: envFn([prim.unknown, prim.unknown], promiseOf(prim.unknown)),
    sign: envFn([prim.unknown, prim.unknown], promiseOf(prim.unknown)),
    verify: envFn([prim.unknown, prim.unknown], promiseOf(prim.bool())),
    digest: envFn([prim.unknown, prim.unknown], promiseOf(prim.unknown)),
    generateKey: envFn([prim.unknown, prim.unknown], promiseOf(prim.unknown)),
    deriveKey: envFn([prim.unknown, prim.unknown], promiseOf(prim.unknown)),
    deriveBits: envFn([prim.unknown, prim.unknown], promiseOf(prim.unknown)),
    wrapKey: envFn(
      [prim.unknown, prim.unknown, prim.unknown, prim.unknown],
      promiseOf(prim.unknown),
    ),
    unwrapKey: envFn(
      [prim.unknown, prim.unknown, prim.unknown, prim.unknown],
      promiseOf(prim.unknown),
    ),
    importKey: envFn(
      [prim.unknown, prim.unknown, prim.unknown, prim.unknown],
      promiseOf(prim.unknown),
    ),
    exportKey: envFn([prim.unknown, prim.unknown], promiseOf(prim.unknown)),
  };
  /** crypto.subtle 对象面（全局 `crypto.subtle` 与 `SubtleCrypto` 实例共用一份槽表） */
  const subtleCryptoObj = objAbs(subtleCryptoSlots);

  /**
   * 族 61：`node:crypto` 模块的 **webcrypto 面**（宿主实测 Node v26.10.0：
   * `require("node:crypto")` 自有键含 `webcrypto` / `subtle` / `getRandomValues`）。
   *
   * - `webcrypto` 是 **`Crypto` 实例**（原型面 = `constructor` / `subtle` /
   *   `getRandomValues` / `randomUUID`），不是 SubtleCrypto；
   * - `subtle` 是 `SubtleCrypto` 实例，且 `webcrypto.subtle === crypto.subtle`
   *   （宿主实测同一对象）⇒ 与全局 `crypto.subtle` **同源**（共用
   *   `subtleCryptoObj` 一份槽表 —— 族 35 的同源化口径）。
   *
   * 旧实现：三个名**未导出** ⇒ 走宿主路径（行为对、精度随 core）。
   */
  cryptoModule.webcrypto = brandOf(
    "Crypto",
    objAbs({
      randomUUID: envFn([], prim.str()),
      getRandomValues: envFn([arrOf(prim.unknown)], arrOf(prim.unknown)),
      subtle: brandOf("SubtleCrypto", subtleCryptoObj),
    }),
  );
  cryptoModule.subtle = brandOf("SubtleCrypto", subtleCryptoObj);
  cryptoModule.getRandomValues = envFn([arrOf(prim.unknown)], arrOf(prim.unknown));

  /**
   * `TextEncoder` 的**声明实例面**（族 64：类值声明要复用它 ⇒ 提成 const）。
   *
   * 宿主实测（node v26.10.0）：`new TextEncoder().encoding === "utf-8"`（字面量）、
   * `encode(s) → Uint8Array`、`encodeInto(s, buf) → { read, written }`。
   */
  const textEncoderInstance = brandOf(
    "TextEncoder",
    objAbs({
      encoding: prim.str(),
      encode: envFn([prim.str()], arrOf(prim.num())),
      encodeInto: envFn(
        [prim.str(), arrOf(prim.num())],
        objAbs({ read: prim.num(), written: prim.num() }),
      ),
    }),
  );

  const nodePlatformGlobals: Record<string, Abs> = {
    // ── Event 族 ───────────────────────────────────────────────
    EventTarget: ctorOf(
      "EventTarget",
      [],
      brandOf("EventTarget", objAbs(eventTargetSlots)),
      { params: [] },
    ),
    Event: ctorOf(
      "Event",
      [prim.str(), prim.unknown],
      brandOf(
        "Event",
        objAbs({
          type: prim.str(),
          target: prim.unknown,
          currentTarget: prim.unknown,
          bubbles: prim.bool(),
          cancelable: prim.bool(),
          composed: prim.bool(),
          defaultPrevented: prim.bool(),
          isTrusted: prim.bool(),
          timeStamp: prim.num(),
          preventDefault: envFn([], undef()),
          stopPropagation: envFn([], undef()),
          stopImmediatePropagation: envFn([], undef()),
        }),
      ),
      { params: ["type", "options?"] },
    ),
    CustomEvent: ctorOf(
      "CustomEvent",
      [prim.str(), prim.unknown],
      brandOf(
        "CustomEvent",
        objAbs({
          type: prim.str(),
          detail: prim.unknown,
          bubbles: prim.bool(),
          cancelable: prim.bool(),
          defaultPrevented: prim.bool(),
        }),
      ),
      { params: ["type", "options?"] },
    ),
    MessageEvent: ctorOf(
      "MessageEvent",
      [prim.str(), prim.unknown],
      brandOf(
        "MessageEvent",
        objAbs({
          type: prim.str(),
          data: prim.unknown,
          origin: prim.str(),
          lastEventId: prim.str(),
          source: prim.unknown,
          ports: arrOf(prim.unknown),
        }),
      ),
      { params: ["type", "options?"] },
    ),
    CloseEvent: ctorOf(
      "CloseEvent",
      [prim.str(), prim.unknown],
      brandOf(
        "CloseEvent",
        objAbs({
          type: prim.str(),
          code: prim.num(),
          reason: prim.str(),
          wasClean: prim.bool(),
        }),
      ),
      { params: ["type", "options?"] },
    ),
    ErrorEvent: ctorOf(
      "ErrorEvent",
      [prim.str(), prim.unknown],
      brandOf(
        "ErrorEvent",
        objAbs({
          type: prim.str(),
          message: prim.str(),
          filename: prim.str(),
          lineno: prim.num(),
          colno: prim.num(),
          error: prim.unknown,
        }),
      ),
      { params: ["type", "options?"] },
    ),
    DOMException: ctorOf(
      "DOMException",
      [prim.str(), prim.str()],
      brandOf(
        "DOMException",
        objAbs({
          name: prim.str(),
          message: prim.str(),
          code: prim.num(),
        }),
      ),
      { params: ["message?", "name?"] },
    ),
    QuotaExceededError: ctorOf(
      "QuotaExceededError",
      [prim.str(), prim.str()],
      brandOf(
        "QuotaExceededError",
        objAbs({
          name: prim.str(),
          message: prim.str(),
          code: prim.num(),
          quota: prim.num(),
          requested: prim.num(),
        }),
      ),
      { params: ["message?", "name?"] },
    ),
    SuppressedError: ctorOf(
      "SuppressedError",
      [prim.unknown, prim.unknown, prim.str()],
      brandOf(
        "SuppressedError",
        objAbs({
          name: prim.str(),
          message: prim.str(),
          error: prim.unknown,
          suppressed: prim.unknown,
        }),
      ),
      { params: ["error", "suppressed", "message?"] },
    ),

    // ── Abort 族 ───────────────────────────────────────────────
    AbortController: ctorOf(
      "AbortController",
      [],
      brandOf(
        "AbortController",
        objAbs({
          signal: brandOf(
            "AbortSignal",
            objAbs({
              aborted: prim.bool(),
              reason: prim.unknown,
              onabort: prim.unknown,
              throwIfAborted: envFn([], undef()),
              ...eventTargetSlots,
            }),
          ),
          abort: envFn([prim.unknown], undef(), undefined, { params: ["reason?"] }),
        }),
      ),
      { params: [] },
    ),
    AbortSignal: nonCtorOf(
      "AbortSignal",
      brandOf(
        "AbortSignal",
        objAbs({
          aborted: prim.bool(),
          reason: prim.unknown,
          onabort: prim.unknown,
          throwIfAborted: envFn([], undef()),
          ...eventTargetSlots,
        }),
      ),
      {
        slots: {
          abort: envFn([prim.unknown], brandOf("AbortSignal"), undefined, {
            params: ["reason?"],
          }),
          timeout: envFn([prim.num()], brandOf("AbortSignal")),
          any: brandOf("AbortSignal"),
        },
      },
    ),

    // ── Blob / File ────────────────────────────────────────────
    Blob: ctorOf(
      "Blob",
      [arrOf(prim.unknown), prim.unknown],
      brandOf(
        "Blob",
        objAbs({
          type: prim.str(),
          size: prim.num(),
          slice: envFn([prim.num(), prim.num(), prim.str()], brandOf("Blob")),
          arrayBuffer: envFn([], promiseOf(brandOf("ArrayBuffer"))),
          text: envFn([], promiseOf(prim.str())),
          bytes: envFn([], promiseOf(arrOf(prim.num()))),
          stream: envFn([], brandOf("ReadableStream")),
        }),
      ),
      { params: ["parts", "options?"] },
    ),
    File: ctorOf(
      "File",
      [arrOf(prim.unknown), prim.str(), prim.unknown],
      brandOf(
        "File",
        objAbs({
          name: prim.str(),
          lastModified: prim.num(),
          type: prim.str(),
          size: prim.num(),
          slice: envFn([prim.num(), prim.num(), prim.str()], brandOf("Blob")),
          arrayBuffer: envFn([], promiseOf(brandOf("ArrayBuffer"))),
          text: envFn([], promiseOf(prim.str())),
          stream: envFn([], brandOf("ReadableStream")),
        }),
      ),
      { params: ["parts", "name", "options?"] },
    ),

    // ── 流 族 ─────────────────────────────────────────────────
    ReadableStream: ctorOf(
      "ReadableStream",
      [prim.unknown, prim.unknown],
      brandOf("ReadableStream", objAbs(streamSlots)),
      { params: ["underlyingSource?", "strategy?"] },
    ),
    WritableStream: ctorOf(
      "WritableStream",
      [prim.unknown, prim.unknown],
      brandOf("WritableStream", objAbs(streamSlots)),
      { params: ["underlyingSink?", "strategy?"] },
    ),
    TransformStream: ctorOf(
      "TransformStream",
      [prim.unknown, prim.unknown],
      brandOf(
        "TransformStream",
        objAbs({
          readable: brandOf("ReadableStream", objAbs(streamSlots)),
          writable: brandOf("WritableStream", objAbs(streamSlots)),
        }),
      ),
      { params: ["transformer?", "writableStrategy?", "readableStrategy?"] },
    ),
    ByteLengthQueuingStrategy: ctorOf(
      "ByteLengthQueuingStrategy",
      [prim.unknown],
      brandOf(
        "ByteLengthQueuingStrategy",
        objAbs({ highWaterMark: prim.num(), size: envFn([prim.unknown], prim.num()) }),
      ),
      { params: ["init?"] },
    ),
    CountQueuingStrategy: ctorOf(
      "CountQueuingStrategy",
      [prim.unknown],
      brandOf(
        "CountQueuingStrategy",
        objAbs({ highWaterMark: prim.num(), size: envFn([prim.unknown], prim.num()) }),
      ),
      { params: ["init?"] },
    ),

    // ── 编码 / 压缩 流 ────────────────────────────────────────
    // 族 64（Bug 889 的 node 侧）：`TextEncoder` 是 **class** ⇒ 裸调**必抛**
    // TypeError（宿主实测 v26.10.0：`TextEncoder()` ⇒ TypeError
    // "Class constructor TextEncoder cannot be invoked without 'new'"）。
    // 旧声明是**普通 fn 面**（关系面）⇒ 裸调落「返回声明类型、**永不抛**」
    // ⇒ **L2 门禁假绿**（原生必抛的入口被判恒不抛）。
    //
    // 修法：**在 env 侧声明成类值**（core 的 Bug 272 判据：`ctor: true` +
    // 单一 rest 形参 `"_rest"` ⇒ `isClassValueCallee` 命中 ⇒ 裸调定抛
    // TypeError，**与原生同形**）；`apply` 返回**声明实例面** ⇒
    // `new TextEncoder()` 的实例面（encoding / encode / encodeInto）**不丢**
    // ——不像「删声明回落宿主」那样退成 `undefined`（那是**确定的错值**，
    // 宿主真值是 "utf-8"）。
    TextEncoder: ctorOf("TextEncoder", [], textEncoderInstance, {
      params: ["_rest"],
      apply: () => textEncoderInstance,
    }),
    TextEncoderStream: ctorOf(
      "TextEncoderStream",
      [],
      brandOf(
        "TextEncoderStream",
        objAbs({
          encoding: prim.str(),
          readable: brandOf("ReadableStream", objAbs(streamSlots)),
          writable: brandOf("WritableStream", objAbs(streamSlots)),
        }),
      ),
      { params: [] },
    ),
    TextDecoderStream: ctorOf(
      "TextDecoderStream",
      [prim.str(), prim.unknown],
      brandOf(
        "TextDecoderStream",
        objAbs({
          encoding: prim.str(),
          fatal: prim.bool(),
          ignoreBOM: prim.bool(),
          readable: brandOf("ReadableStream", objAbs(streamSlots)),
          writable: brandOf("WritableStream", objAbs(streamSlots)),
        }),
      ),
      { params: ["encoding?", "options?"] },
    ),
    CompressionStream: ctorOf(
      "CompressionStream",
      [prim.str()],
      brandOf(
        "CompressionStream",
        objAbs({
          readable: brandOf("ReadableStream", objAbs(streamSlots)),
          writable: brandOf("WritableStream", objAbs(streamSlots)),
        }),
      ),
      { params: ["format"] },
    ),
    DecompressionStream: ctorOf(
      "DecompressionStream",
      [prim.str()],
      brandOf(
        "DecompressionStream",
        objAbs({
          readable: brandOf("ReadableStream", objAbs(streamSlots)),
          writable: brandOf("WritableStream", objAbs(streamSlots)),
        }),
      ),
      { params: ["format"] },
    ),

    // ── 通道 族 ───────────────────────────────────────────────
    BroadcastChannel: ctorOf(
      "BroadcastChannel",
      [prim.str()],
      brandOf(
        "BroadcastChannel",
        objAbs({
          name: prim.str(),
          onmessage: prim.unknown,
          onmessageerror: prim.unknown,
          postMessage: envFn([prim.unknown], undef()),
          close: envFn([], undef()),
          ref: envFn([], undef()),
          unref: envFn([], undef()),
        }),
      ),
      { params: ["name"] },
    ),
    MessageChannel: ctorOf(
      "MessageChannel",
      [],
      brandOf(
        "MessageChannel",
        objAbs({
          port1: brandOf(
            "MessagePort",
            objAbs({
              postMessage: envFn([prim.unknown], undef()),
              start: envFn([], undef()),
              close: envFn([], undef()),
              ref: envFn([], undef()),
              unref: envFn([], undef()),
              hasRef: envFn([], prim.bool()),
              onmessage: prim.unknown,
              onmessageerror: prim.unknown,
              ...eventTargetSlots,
            }),
          ),
          port2: brandOf(
            "MessagePort",
            objAbs({
              postMessage: envFn([prim.unknown], undef()),
              start: envFn([], undef()),
              close: envFn([], undef()),
              ref: envFn([], undef()),
              unref: envFn([], undef()),
              hasRef: envFn([], prim.bool()),
              onmessage: prim.unknown,
              onmessageerror: prim.unknown,
              ...eventTargetSlots,
            }),
          ),
        }),
      ),
      { params: [] },
    ),
    MessagePort: nonCtorOf(
      "MessagePort",
      brandOf(
        "MessagePort",
        objAbs({
          postMessage: envFn([prim.unknown], undef()),
          start: envFn([], undef()),
          close: envFn([], undef()),
          ref: envFn([], undef()),
          unref: envFn([], undef()),
          hasRef: envFn([], prim.bool()),
          onmessage: prim.unknown,
          onmessageerror: prim.unknown,
          ...eventTargetSlots,
        }),
      ),
    ),

    // ── Fetch 族 ──────────────────────────────────────────────
    Headers: ctorOf(
      "Headers",
      [prim.unknown],
      brandOf(
        "Headers",
        objAbs({
          append: envFn([prim.str(), prim.str()], undef()),
          delete: envFn([prim.str()], undef()),
          get: envFn([prim.str()], unionOf(prim.str(), nullLit())),
          has: envFn([prim.str()], prim.bool()),
          set: envFn([prim.str(), prim.str()], undef()),
          getSetCookie: envFn([], arrOf(prim.str())),
          keys: envFn([], arrOf(prim.str())),
          values: envFn([], arrOf(prim.str())),
          entries: envFn([], arrOf(prim.str())),
          forEach: envFn([callbackFnBrand], undef()),
        }),
      ),
      { params: ["init?"] },
    ),
    FormData: ctorOf(
      "FormData",
      [prim.unknown],
      brandOf(
        "FormData",
        objAbs({
          append: envFn([prim.str(), prim.unknown], undef()),
          delete: envFn([prim.str()], undef()),
          get: envFn([prim.str()], prim.unknown),
          getAll: envFn([prim.str()], arrOf(prim.unknown)),
          has: envFn([prim.str()], prim.bool()),
          set: envFn([prim.str(), prim.unknown], undef()),
          keys: envFn([], arrOf(prim.str())),
          values: envFn([], arrOf(prim.unknown)),
          entries: envFn([], arrOf(prim.unknown)),
          forEach: envFn([callbackFnBrand], undef()),
        }),
      ),
      { params: ["form?"] },
    ),
    Request: ctorOf(
      "Request",
      [prim.unknown, prim.unknown],
      brandOf(
        "Request",
        objAbs({
          method: prim.str(),
          url: prim.str(),
          headers: brandOf("Headers"),
          body: prim.unknown,
          bodyUsed: prim.bool(),
          cache: prim.str(),
          credentials: prim.str(),
          destination: prim.str(),
          integrity: prim.str(),
          keepalive: prim.bool(),
          mode: prim.str(),
          redirect: prim.str(),
          referrer: prim.str(),
          referrerPolicy: prim.str(),
          signal: brandOf("AbortSignal"),
          clone: envFn([], brandOf("Request")),
          arrayBuffer: envFn([], promiseOf(brandOf("ArrayBuffer"))),
          blob: envFn([], promiseOf(brandOf("Blob"))),
          formData: envFn([], promiseOf(brandOf("FormData"))),
          json: envFn([], promiseOf(prim.unknown)),
          text: envFn([], promiseOf(prim.str())),
        }),
      ),
      { params: ["input", "init?"] },
    ),
    Response: ctorOf(
      "Response",
      [prim.unknown, prim.unknown],
      ResponseInstance,
      {
        params: ["body?", "init?"],
        slots: {
          error: envFn([], brandOf("Response")),
          // Bug 1044：静态 `Response.json` 是**构造**一个 Response（WHATWG
          // Fetch / undici：**同步**返回 `Response`，不是 promise）⇒ 旧声明
          // 写成 `promiseOf(prim.unknown)` ⇒ `.then(...)` 被判安全而宿主必抛
          // （`TypeError: Response.json(...).then is not a function`）⇒
          // **L2 门禁假绿**。
          //
          // 返回域改成**实例面**（`ResponseInstance`，brand "Response"）——
          // 与同表 `error` / `redirect` 同品牌、与 web env 静态面同源，且读面
          // 精确（`.status` → number、`.then` → exact `undefined`，与宿主一致）。
          // **实例面**的 `json`（读 body ⇒ 真 promise）保持不动。
          //
          // 已知偏差（core 侧，本包改不到）：core 的
          // `definitelyUncallableMember` 只判**平 obj 接收者**
          // （`if (s.k !== "obj") return false;`）⇒ brand 接收者的缺槽成员
          // （exact `undefined`）被调用时不记抛 ⇒ `Response.json(x).then(...)`
          // 仍不被 L2 门禁标出（web env 能标出，只因它把 Response 建成平 obj）。
          json: envFn([prim.unknown], ResponseInstance),
          redirect: envFn([prim.unknown, prim.num()], brandOf("Response")),
        },
      },
    ),

    // ── URL / WebSocket / Storage ─────────────────────────────
    URLPattern: ctorOf(
      "URLPattern",
      [prim.unknown, prim.str()],
      brandOf(
        "URLPattern",
        objAbs({
          protocol: prim.str(),
          username: prim.str(),
          password: prim.str(),
          hostname: prim.str(),
          port: prim.str(),
          pathname: prim.str(),
          search: prim.str(),
          hash: prim.str(),
          hasRegExpGroups: prim.bool(),
          exec: envFn([prim.unknown], prim.unknown),
          test: envFn([prim.unknown], prim.bool()),
        }),
      ),
      { params: ["input?", "baseURL?"] },
    ),
    WebSocket: ctorOf(
      "WebSocket",
      [prim.str(), prim.unknown],
      brandOf(
        "WebSocket",
        objAbs({
          readyState: prim.num(),
          url: prim.str(),
          protocol: prim.str(),
          extensions: prim.str(),
          binaryType: prim.str(),
          bufferedAmount: prim.num(),
          onopen: prim.unknown,
          onclose: prim.unknown,
          onerror: prim.unknown,
          onmessage: prim.unknown,
          close: envFn([prim.num(), prim.str()], undef(), undefined, {
            params: ["code?", "reason?"],
          }),
          send: envFn([prim.unknown], undef()),
          ...eventTargetSlots,
        }),
      ),
      { params: ["url", "protocols?"] },
    ),
    Storage: nonCtorOf(
      "Storage",
      brandOf(
        "Storage",
        objAbs({
          length: prim.num(),
          clear: envFn([], undef()),
          getItem: envFn([prim.str()], unionOf(prim.str(), nullLit())),
          key: envFn([prim.num()], unionOf(prim.str(), nullLit())),
          removeItem: envFn([prim.str()], undef()),
          setItem: envFn([prim.str(), prim.str()], undef()),
        }),
      ),
    ),
    Navigator: nonCtorOf(
      "Navigator",
      brandOf("Navigator", navigatorObj),
    ),

    // ── 加密 / 性能 族 ────────────────────────────────────────
    Crypto: nonCtorOf(
      "Crypto",
      brandOf(
        "Crypto",
        objAbs({
          randomUUID: envFn([], prim.str()),
          getRandomValues: envFn([arrOf(prim.unknown)], arrOf(prim.unknown)),
          subtle: brandOf("SubtleCrypto"),
        }),
      ),
    ),
    CryptoKey: nonCtorOf(
      "CryptoKey",
      brandOf(
        "CryptoKey",
        objAbs({
          type: prim.str(),
          extractable: prim.bool(),
          algorithm: prim.unknown,
          usages: arrOf(prim.str()),
        }),
      ),
    ),
    SubtleCrypto: nonCtorOf(
      "SubtleCrypto",
      brandOf("SubtleCrypto", subtleCryptoObj),
    ),
    Performance: nonCtorOf(
      "Performance",
      brandOf("Performance", performanceObj),
    ),
    PerformanceEntry: nonCtorOf(
      "PerformanceEntry",
      brandOf(
        "PerformanceEntry",
        objAbs({
          name: prim.str(),
          entryType: prim.str(),
          startTime: prim.num(),
          duration: prim.num(),
          toJSON: envFn([], prim.unknown),
        }),
      ),
    ),
    PerformanceMark: ctorOf(
      "PerformanceMark",
      [prim.str(), prim.unknown],
      brandOf(
        "PerformanceMark",
        objAbs({
          name: prim.str(),
          entryType: prim.str(),
          startTime: prim.num(),
          duration: prim.num(),
          detail: prim.unknown,
          toJSON: envFn([], prim.unknown),
        }),
      ),
      { params: ["name", "options?"] },
    ),
    PerformanceMeasure: nonCtorOf(
      "PerformanceMeasure",
      brandOf(
        "PerformanceMeasure",
        objAbs({
          name: prim.str(),
          entryType: prim.str(),
          startTime: prim.num(),
          duration: prim.num(),
          detail: prim.unknown,
          toJSON: envFn([], prim.unknown),
        }),
      ),
    ),
    PerformanceObserver: ctorOf(
      "PerformanceObserver",
      [callbackFnBrand],
      brandOf(
        "PerformanceObserver",
        objAbs({
          observe: envFn([prim.unknown], undef()),
          disconnect: envFn([], undef()),
          takeRecords: envFn([], arrOf(brandOf("PerformanceEntry"))),
        }),
      ),
      { params: ["callback"] },
    ),
    PerformanceObserverEntryList: nonCtorOf(
      "PerformanceObserverEntryList",
      brandOf(
        "PerformanceObserverEntryList",
        objAbs({
          getEntries: envFn([], arrOf(brandOf("PerformanceEntry"))),
          getEntriesByType: envFn([prim.str()], arrOf(brandOf("PerformanceEntry"))),
          getEntriesByName: envFn([prim.str()], arrOf(brandOf("PerformanceEntry"))),
        }),
      ),
    ),
    PerformanceResourceTiming: nonCtorOf(
      "PerformanceResourceTiming",
      brandOf(
        "PerformanceResourceTiming",
        objAbs({
          name: prim.str(),
          entryType: prim.str(),
          startTime: prim.num(),
          duration: prim.num(),
          toJSON: envFn([], prim.unknown),
        }),
      ),
    ),

    // ── 显式资源管理 ──────────────────────────────────────────
    DisposableStack: ctorOf(
      "DisposableStack",
      [prim.unknown],
      brandOf(
        "DisposableStack",
        objAbs({
          use: envFn([prim.unknown], prim.unknown),
          adopt: envFn([prim.unknown, prim.unknown], prim.unknown),
          defer: envFn([prim.unknown], undef()),
          move: envFn([], brandOf("DisposableStack")),
          dispose: envFn([], undef()),
          disposed: prim.bool(),
        }),
      ),
      { params: ["options?"] },
    ),
    AsyncDisposableStack: ctorOf(
      "AsyncDisposableStack",
      [prim.unknown],
      brandOf(
        "AsyncDisposableStack",
        objAbs({
          use: envFn([prim.unknown], prim.unknown),
          adopt: envFn([prim.unknown, prim.unknown], prim.unknown),
          defer: envFn([prim.unknown], undef()),
          move: envFn([], brandOf("AsyncDisposableStack")),
          disposeAsync: envFn([], promiseOf(prim.unknown)),
          disposed: prim.bool(),
        }),
      ),
      { params: ["options?"] },
    ),

    // ── 全局对象（宿主全局上的对象，不是构造器）────────────────
    crypto: objAbs({
      randomUUID: envFn([], prim.str()),
      getRandomValues: envFn([arrOf(prim.unknown)], arrOf(prim.unknown)),
      subtle: brandOf("SubtleCrypto", subtleCryptoObj),
    }),
    performance: performanceObj,
    navigator: navigatorObj,
    // localStorage：Node 需 --localstorage-file 才可用（无则 undefined）
    localStorage: unionOf(
      brandOf(
        "Storage",
        objAbs({
          length: prim.num(),
          clear: envFn([], undef()),
          getItem: envFn([prim.str()], unionOf(prim.str(), nullLit())),
          key: envFn([prim.num()], unionOf(prim.str(), nullLit())),
          removeItem: envFn([prim.str()], undef()),
          setItem: envFn([prim.str(), prim.str()], undef()),
        }),
      ),
      undef(),
    ),
    sessionStorage: brandOf(
      "Storage",
      objAbs({
        length: prim.num(),
        clear: envFn([], undef()),
        getItem: envFn([prim.str()], unionOf(prim.str(), nullLit())),
        key: envFn([prim.num()], unionOf(prim.str(), nullLit())),
        removeItem: envFn([prim.str()], undef()),
        setItem: envFn([prim.str(), prim.str()], undef()),
      }),
    ),
    // global：Node 的全局对象（=== globalThis）
    global: openObjBrand("NodeGlobal", { key: prim.str(), value: prim.unknown }),

    // ── WebAssembly / Temporal / fetch ────────────────────────
    WebAssembly: objAbs({
      validate: envFn([prim.unknown], prim.bool()),
      compile: envFn([prim.unknown], promiseOf(prim.unknown)),
      instantiate: envFn([prim.unknown], promiseOf(prim.unknown)),
      Module: brandOf("WebAssembly.Module"),
      Instance: brandOf("WebAssembly.Instance"),
      Memory: brandOf("WebAssembly.Memory"),
      Table: brandOf("WebAssembly.Table"),
      Global: brandOf("WebAssembly.Global"),
    }),
    Temporal: objAbs({
      Now: objAbs({
        instant: envFn([], brandOf("Temporal.Instant")),
        zonedDateTimeISO: envFn([prim.unknown], brandOf("Temporal.ZonedDateTime")),
        plainDateTimeISO: envFn([prim.unknown], brandOf("Temporal.PlainDateTime")),
        plainDateISO: envFn([prim.unknown], brandOf("Temporal.PlainDate")),
        plainTimeISO: envFn([prim.unknown], brandOf("Temporal.PlainTime")),
        instantEpochMilliseconds: envFn([prim.unknown], prim.num()),
      }),
      Instant: brandOf("Temporal.Instant"),
      PlainDate: brandOf("Temporal.PlainDate"),
      PlainTime: brandOf("Temporal.PlainTime"),
      PlainDateTime: brandOf("Temporal.PlainDateTime"),
      ZonedDateTime: brandOf("Temporal.ZonedDateTime"),
    }),
    // fetch：返回 Promise<Response>（宿主路径会因「宿主副作用」被拦截成
    // opaque unknown；声明面更贴近原生且不产生真实网络副作用）
    fetch: envFn(
      [unionOf(prim.str(), prim.unknown), prim.unknown],
      promiseOf(brandOf("Response")),
      undefined,
      { params: ["input", "init?"] },
    ),

    // ── Atomics / Iterator ─────────────────────────────────────
    // Atomics：原子操作族（add / and / or / xor / sub / exchange /
    // compareExchange / load / store / wait / notify / isLockFree）——
    // 开放键（族名随规范增补），成员面是「取回旧值」的 fn。
    Atomics: openObjBrand("Atomics", {
      key: prim.str(),
      value: envFn([prim.unknown, prim.num(), prim.num()], prim.num(), undefined, {
        params: ["typedArray", "index", "value"],
      }),
    }),
    // Iterator：迭代器助手基类（**抽象类**，原生不可直接 new ⇒ ctor:false）
    Iterator: nonCtorOf(
      "Iterator",
      brandOf(
        "Iterator",
        objAbs({
          next: envFn([], prim.unknown),
          return: envFn([prim.unknown], prim.unknown),
          throw: envFn([prim.unknown], prim.unknown),
          map: envFn([callbackFnBrand], prim.unknown),
          filter: envFn([callbackFnBrand], prim.unknown),
          take: envFn([prim.num()], prim.unknown),
          drop: envFn([prim.num()], prim.unknown),
          flatMap: envFn([callbackFnBrand], prim.unknown),
          reduce: envFn([callbackFnBrand], prim.unknown),
          toArray: envFn([], arrOf(prim.unknown)),
          forEach: envFn([callbackFnBrand], undef()),
          some: envFn([callbackFnBrand], prim.bool()),
          every: envFn([callbackFnBrand], prim.bool()),
          find: envFn([callbackFnBrand], prim.unknown),
        }),
      ),
    ),

    // ── 流 的 reader / writer / controller（宿主全局上的类）────
    ReadableStreamDefaultReader: ctorOf(
      "ReadableStreamDefaultReader",
      [brandOf("ReadableStream")],
      brandOf(
        "ReadableStreamDefaultReader",
        objAbs({
          closed: promiseOf(prim.unknown),
          read: envFn([], promiseOf(prim.unknown)),
          cancel: envFn([prim.unknown], promiseOf(prim.unknown)),
          releaseLock: envFn([], undef()),
        }),
      ),
      { params: ["stream"] },
    ),
    ReadableStreamBYOBReader: ctorOf(
      "ReadableStreamBYOBReader",
      [brandOf("ReadableStream")],
      brandOf(
        "ReadableStreamBYOBReader",
        objAbs({
          closed: promiseOf(prim.unknown),
          read: envFn([arrOf(prim.num())], promiseOf(prim.unknown)),
          cancel: envFn([prim.unknown], promiseOf(prim.unknown)),
          releaseLock: envFn([], undef()),
        }),
      ),
      { params: ["stream"] },
    ),
    WritableStreamDefaultWriter: ctorOf(
      "WritableStreamDefaultWriter",
      [brandOf("WritableStream")],
      brandOf(
        "WritableStreamDefaultWriter",
        objAbs({
          closed: promiseOf(prim.unknown),
          desiredSize: prim.num(),
          ready: promiseOf(prim.unknown),
          write: envFn([prim.unknown], promiseOf(prim.unknown)),
          close: envFn([], promiseOf(prim.unknown)),
          abort: envFn([prim.unknown], promiseOf(prim.unknown)),
          releaseLock: envFn([], undef()),
        }),
      ),
      { params: ["stream"] },
    ),
    // 四个 controller / request 原生**不可**构造（Illegal constructor）
    ReadableStreamDefaultController: nonCtorOf(
      "ReadableStreamDefaultController",
      brandOf(
        "ReadableStreamDefaultController",
        objAbs({
          desiredSize: prim.num(),
          close: envFn([], undef()),
          enqueue: envFn([prim.unknown], undef()),
          error: envFn([prim.unknown], undef()),
        }),
      ),
    ),
    ReadableByteStreamController: nonCtorOf(
      "ReadableByteStreamController",
      brandOf(
        "ReadableByteStreamController",
        objAbs({
          desiredSize: prim.num(),
          close: envFn([], undef()),
          enqueue: envFn([prim.unknown], undef()),
          error: envFn([prim.unknown], undef()),
          byobRequest: envFn([], prim.unknown),
        }),
      ),
    ),
    TransformStreamDefaultController: nonCtorOf(
      "TransformStreamDefaultController",
      brandOf(
        "TransformStreamDefaultController",
        objAbs({
          desiredSize: prim.num(),
          enqueue: envFn([prim.unknown], undef()),
          error: envFn([prim.unknown], undef()),
          terminate: envFn([], undef()),
        }),
      ),
    ),
    WritableStreamDefaultController: nonCtorOf(
      "WritableStreamDefaultController",
      brandOf(
        "WritableStreamDefaultController",
        objAbs({
          desiredSize: prim.num(),
          close: envFn([], undef()),
          error: envFn([prim.unknown], undef()),
        }),
      ),
    ),
    ReadableStreamBYOBRequest: nonCtorOf(
      "ReadableStreamBYOBRequest",
      brandOf(
        "ReadableStreamBYOBRequest",
        objAbs({
          respond: envFn([prim.num()], undef()),
          respondWithNewView: envFn([prim.unknown], undef()),
        }),
      ),
    ),
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
      // ── Bug 869 / 871：三个流共用 Socket 面（形状见上方 processStreamBase）──
      stdout: processWritableStream,
      stderr: processWritableStream,
      stdin: processReadableStream,
      // ── Bug 875：hrtime 是**可调用**的 ──
      // 原生 `process.hrtime()` ⇒ `[seconds, nanoseconds]` 数组；
      // `process.hrtime.bigint()` ⇒ bigint（挂在 hrtime 上的静态方法）。
      // 旧面把 hrtime 建成**不可调用**对象 ⇒ `process.hrtime()` 退化成
      // unknown + 误导诊断 nudo:unknown-inference（把引擎债指向用户代码）。
      hrtime: envFn([], arrOf(prim.num()), undefined, {
        name: "hrtime",
        slots: { bigint: envFn([], brandOf("bigint")) },
      }),
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

      // ── Bug 876：补 5 个真实成员 ──
      // emitWarning(warning, options?, type?) —— 原生签名，可选参用 `?` 标注
      emitWarning: envFn(
        [
          prim.str(),
          unionOf(
            prim.str(),
            objAbs({ type: prim.str(), code: prim.str(), detail: prim.str() }),
          ),
          prim.str(),
        ],
        undef(),
        undefined,
        { params: ["warning", "options?", "type?"] },
      ),
      // abort() —— 原生**永不返回**（进程当场退出）
      abort: envFn([], prim.never, undefined, { params: [] }),
      // kill(pid, signal?) —— 原生返回 true / 抛 ESRCH
      kill: envFn([prim.num(), prim.str()], prim.bool(), undefined, {
        params: ["pid", "signal?"],
      }),
      // release —— Node 发行信息对象
      release: objAbs({ name: prim.str() }),
      // features —— 编译期特性开关（键随构建而变 ⇒ 开放键；值域是
      // boolean | string | undefined——**不用 unknown**，否则
      // `process.features.icu` 退化成 unknown 并误报 nudo:unknown-inference）
      features: openObjBrand("ProcessFeatures", {
        key: prim.str(),
        value: unionOf(prim.bool(), prim.str(), undef()),
      }),

      // ── Bug 892：再补 7 个真实成员 ──
      umask: envFn([prim.num()], prim.num()),
      getActiveResourcesInfo: envFn([], arrOf(prim.str())),
      resourceUsage: envFn(
        [],
        objAbs({
          userCPUTime: prim.num(),
          systemCPUTime: prim.num(),
          maxRSS: prim.num(),
          sharedMemorySize: prim.num(),
          unsharedDataSize: prim.num(),
          unsharedStackSize: prim.num(),
          minorPageFault: prim.num(),
          majorPageFault: prim.num(),
          swappedOut: prim.num(),
          fsRead: prim.num(),
          fsWrite: prim.num(),
          ipcSent: prim.num(),
          ipcReceived: prim.num(),
          signalsCount: prim.num(),
          voluntaryContextSwitches: prim.num(),
          involuntaryContextSwitches: prim.num(),
        }),
      ),
      availableMemory: envFn([], prim.num()),
      // loadEnvFile(path) —— 原生对**不存在**的文件抛 ENOENT；此处只声明
      // 「不抛」的常规路径（错误路径属精度债，见交付报告），避免把
      // L2 may-throw 假红引回来。
      loadEnvFile: envFn([prim.str()], undef()),
      // getBuiltinModule(id) —— 返回模块命名空间对象
      getBuiltinModule: envFn(
        [prim.str()],
        openObjBrand("Module", { key: prim.str(), value: prim.unknown }),
      ),
      constrainedMemory: envFn([], prim.num()),
    }),

    // ── Bug 878：Buffer 是**构造器**（`new Buffer(size)` / `new Buffer(str)`）──
    // 旧面是 objAbs ⇒ `new Buffer(...)` 命中「obj 不可 new」的**硬抛**
    // TypeError ⇒ 假红（原生 `new Buffer(1)` 正常返回 length 1 的 Buffer）。
    // 静态面（from / alloc / of / …）挂 fn 的 slots —— 全部指向**同一个**
    // Buffer 实例形状（bufferBrand），不另造第二份 Buffer 形状。
    Buffer: envFn(
      [unionOf(prim.num(), prim.str(), bufferBrand)],
      bufferBrand,
      undefined,
      {
        name: "Buffer",
        ctor: true,
        params: ["sizeOrString"],
        slots: {
          from: envFn(
            [unionOf(prim.str(), arrOf(prim.num()), bufferBrand)],
            bufferBrand,
          ),
          alloc: envFn(
            [prim.num(), unionOf(prim.str(), prim.num(), bufferBrand), prim.str()],
            bufferBrand,
            undefined,
            { params: ["size", "fill?", "encoding?"] },
          ),
          allocUnsafe: envFn([prim.num()], bufferBrand),
          allocUnsafeSlow: envFn([prim.num()], bufferBrand),
          isBuffer: envFn([anyParam], prim.bool()),
          byteLength: envFn(
            [unionOf(prim.str(), bufferBrand)],
            prim.num(),
          ),
          concat: envFn([arrOf(bufferBrand)], bufferBrand),
          compare: envFn([bufferBrand, bufferBrand], prim.num()),
          compareBuffers: envFn([bufferBrand, bufferBrand], prim.num()),
          // ── Bug 874：静态 of 缺失 ⇒ `Buffer.of(1, 2)` 成员读出
          //    **exact undefined** ⇒ 引擎证明「调用 undefined 必抛
          //    TypeError」⇒ 假红（原生返回 Buffer）。of 是**变长**的
          //    （Buffer.of(1, 2, 3)），故用 envFnVariadic。
          of: envFnVariadic(prim.num(), bufferBrand, {
            required: [],
            restName: "...items",
            name: "Buffer.of",
          }),
          isUtf8: envFn([bufferBrand], prim.bool()),
          transcode: envFn(
            [
              unionOf(prim.str(), bufferBrand),
              unionOf(prim.str(), bufferBrand),
              prim.str(),
            ],
            bufferBrand,
          ),
          poolSize: prim.num(),
          constants: objAbs({
            MAX_LENGTH: prim.num(),
            MAX_STRING_LENGTH: prim.num(),
          }),
        },
      },
    ),

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

    // ── Bug 884 / Bug 888（node 侧）：structuredClone 与 queueMicrotask
    //    **刻意不声明** ──
    // 两者都是宿主内建（globalThis 上本来就有）。env 声明会**遮蔽**宿主
    // 路径 ⇒ 宿主那侧的 throws 面消失：structuredClone 对不可克隆值抛
    // DataCloneError、queueMicrotask 对非函数回调抛 TypeError，原生都抛，
    // env 声明却让引擎说「不抛」⇒ **假绿**。
    // 删掉声明 ⇒ 回落宿主路径 ⇒ throws 面回来（宿主抛什么就说什么）。
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
    globals: { ...esEnv.globals, ...nodeGlobals, ...nodePlatformGlobals },
    modules,
  };
}
