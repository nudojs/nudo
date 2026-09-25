/**
 * `@nudojs/harvester` — `@types` / `.d.ts` → Abs env harvesting.
 *
 * Low-level dts→Abs harvester (`harvestDts`) plus the orchestration layer
 * (package / auto / disk / json / to-abs / node) used by env-package authoring
 * and analysis auto-fill. Harvest is not a product CLI verb.
 */

export {
  harvestDts,
  emitEnvModule,
  type HarvestedEnv,
} from "./harvest-dts.ts";

export {
  dtsToContractDraft,
  dtsPathToContractDraft,
  formatDtsContractDraft,
  type DtsContractDraft,
  type DtsExportDraft,
} from "./dts-contract-draft.ts";

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
