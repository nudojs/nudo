/**
 * `@nudojs/service/harvest` — `@types` → Abs env harvesting.
 *
 * Harvest is an env-package authoring / analysis auto-fill path, not a
 * product CLI verb. These APIs package, cache, and materialize harvested
 * signatures as Abs modules.
 */
export {
  harvestPackage,
  collectDtsFromEntry,
  formatHarvestSummary,
  lookupHarvested,
  resolvePackageRoot,
  type PackageHarvest,
} from "./harvest-package.ts";

export {
  barePackageName,
  collectBarePackages,
  autoHarvestModules,
  harvestPackageCached,
  clearHarvestCache,
  getHarvestCacheSize,
} from "./harvest-auto.ts";

export {
  depsCacheRoot,
  dtsClosureHash,
  harvestPackageWithDisk,
  loadHarvestEnvFromDisk,
  readHarvestDisk,
  writeHarvestDisk,
} from "./harvest-disk.ts";

export {
  absToHarvestSig,
  harvestSigToAbs,
  serializeHarvestJson,
  materializeHarvestJson,
  harvestCacheKey,
  type HarvestJson,
  type HarvestSig,
} from "./harvest-json.ts";

export {
  harvestToAbsModules,
  packageHarvestToAbsModules,
  bareSpecToAbsModules,
  harvestedValueToAbs,
} from "./harvest-to-abs.ts";

export {
  harvestNodeTypes,
  handwrittenNodeEnv,
  summarizeNodeEnv,
  clearNodeHarvestCache,
  getNodeHarvestCacheSize,
  isHarvestNodeDisabled,
  HARVEST_NODE_DEFAULT_MAX_FILES,
  HARVEST_NODE_DEFAULT_MAX_MS,
  type NodeEnvResult,
  type HarvestNodeStats,
} from "./harvest-node.ts";
