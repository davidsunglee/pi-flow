export interface PiFlowCorePackage {
  /** realpath of the package root directory */
  root: string;
  /** package.json "name" (expected "@aphotic/pi-flow-core") */
  name: string;
  /** package.json "version" */
  version: string;
}

export {
  realpathOrNull,
  packageRootFromBin,
  readPiFlowCorePackage,
  findEnclosingCoreRoot,
} from "./lib/effective-package.mjs";
