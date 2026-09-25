/**
 * Browser stub for `@nudojs/harvester`.
 *
 * The real package pulls `typescript` + `node:fs` (d.ts harvest). The playground
 * only needs `bareSpecToAbsModules` as a last-resort fallback for bare package
 * specs — returning `undefined` is the documented "harvest failed ≠ missing"
 * behavior. Keeps the analysis engine free of the TS compiler in the browser.
 */
import type { AbsModuleExports } from "@nudojs/core";

export function bareSpecToAbsModules(
  _spec: string,
  _fromFile: string,
): AbsModuleExports | undefined {
  return undefined;
}

// Remaining barrel surface — never reached from the playground path, but keep
// the module shape so accidental imports fail loudly instead of crashing load.
function unreachable(name: string): never {
  throw new Error(`@nudojs/harvester.${name} is not available in the browser bundle`);
}

export const harvestDts = () => unreachable("harvestDts");
export const emitEnvModule = () => unreachable("emitEnvModule");
export const dtsToContractDraft = () => unreachable("dtsToContractDraft");
export const dtsPathToContractDraft = () => unreachable("dtsPathToContractDraft");
export const formatDtsContractDraft = () => unreachable("formatDtsContractDraft");
export const harvestPackage = () => unreachable("harvestPackage");
export const collectDtsFromEntry = () => unreachable("collectDtsFromEntry");
export const formatHarvestSummary = () => unreachable("formatHarvestSummary");
export const lookupHarvested = () => unreachable("lookupHarvested");
export const resolvePackageRoot = () => unreachable("resolvePackageRoot");
export const barePackageName = () => unreachable("barePackageName");
export const collectBarePackages = () => unreachable("collectBarePackages");
export const autoHarvestModules = () => unreachable("autoHarvestModules");
export const harvestPackageCached = () => unreachable("harvestPackageCached");
export const clearHarvestCache = () => unreachable("clearHarvestCache");
export const getHarvestCacheSize = () => unreachable("getHarvestCacheSize");
export const harvestedValueToAbs = () => unreachable("harvestedValueToAbs");
export const harvestToAbsModules = () => unreachable("harvestToAbsModules");
