# Task Notes: pi-flow-ux Scaffold — Preflight Evidence

Task: Plan task 1 — scaffold `pi-flow-ux` and resolve Pi package preflight decisions  
Plan: `docs/plans/2026-05-19-ux-package.md`  
Pi package inspected: `packages/pi-flow-ux/node_modules/@earendil-works/pi-coding-agent` v0.75.3

---

## V1 — Extension and Theme Manifest Field Names

**Chosen field names:**

| Resource type | `pi` key    | Value type                                           |
|---------------|-------------|------------------------------------------------------|
| Extensions    | `extensions`| Array of paths to `.ts` or `.js` files              |
| Themes        | `themes`    | Array of paths (directories or `.json` files)        |

**Authoritative source — `package-manager.js`:**

File path (relative to repo root):
```
packages/pi-flow-ux/node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js
```

Key lines confirming field names:

- **Line 59** — canonical resource type list, which is the complete set of valid `pi` sub-keys:
  ```js
  const RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"];
  ```

- **Lines 350–358** — `readPiManifestFile()` reads `pkg.pi` from `package.json`:
  ```js
  function readPiManifestFile(packageJsonPath) {
      const content = readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);
      return pkg.pi ?? null;
  }
  ```

- **Lines 362–364** — `resolveExtensionEntries()` uses `manifest?.extensions`:
  ```js
  const manifest = readPiManifestFile(packageJsonPath);
  if (manifest?.extensions?.length) {
      for (const extPath of manifest.extensions) {
  ```

- **Lines 1726–1738** — `readPiManifest()` (method) also reads `pkg.pi`:
  ```js
  readPiManifest(packageRoot) {
      const content = readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);
      return pkg.pi ?? null;
  }
  ```

- **Lines 1651–1658** — `collectPackageResources()` iterates all four resource types from the manifest:
  ```js
  const manifest = this.readPiManifest(packageRoot);
  if (manifest) {
      for (const resourceType of RESOURCE_TYPES) {
          const entries = manifest[resourceType];
          this.addManifestEntries(entries, packageRoot, resourceType, ...);
      }
      return true;
  }
  ```

**Conclusion for themes:** `pi.themes` entries are paths (file or directory). A directory path causes Pi to scan it for `.json` files (see `loadThemesFromDir()` at lines 557–585). The current manifest uses `"themes"` as a directory path, which is correct.

---

## V2 — TypeScript Loading Decision

**Decision: ship `.ts` entry points.** Pi loads `.ts` extensions natively via jiti; no compilation step is required.

**Evidence:**

1. **`core/extensions/loader.js` lines 1–4** — module-level comment is unambiguous:
   ```
   /**
    * Extension loader - loads TypeScript extension modules using jiti.
    *
    */
   ```
   File path:
   ```
   packages/pi-flow-ux/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js
   ```

2. **`loader.js` line 14** — jiti is imported from static entry (Bun-compatible):
   ```js
   import { createJiti } from "jiti/static";
   ```

3. **`package-manager.js` line 61** — `FILE_PATTERNS` for extensions includes `.ts`:
   ```js
   const FILE_PATTERNS = {
       extensions: /\.(ts|js)$/,
   ```

4. **`package-manager.js` lines 377–382** — `resolveExtensionEntries()` prefers `index.ts` over `index.js` for auto-discovery:
   ```js
   const indexTs = join(dir, "index.ts");
   const indexJs = join(dir, "index.js");
   if (existsSync(indexTs)) {
       return [indexTs];
   }
   ```

5. **`@earendil-works/pi-coding-agent` `package.json` dependencies** — jiti v2.7.0 is a runtime dependency, not a devDependency:
   ```json
   "jiti": "^2.7.0"
   ```

**Manifest entries in `packages/pi-flow-ux/package.json` use `.ts` paths:**
```json
"pi": {
  "extensions": ["extensions/footer.ts", "extensions/working/index.ts"],
  "themes": ["themes"]
}
```

No compiled `.js` entry points are needed. No build or prepublish step is required for Pi to load these extensions.

---

## Source path used for Pi inspection

```
packages/pi-flow-ux/node_modules/@earendil-works/pi-coding-agent/
```

Installed via `pnpm install` from repo root after adding `@earendil-works/pi-coding-agent: "*"` to `devDependencies` in `packages/pi-flow-ux/package.json`.

Pi version inspected: **0.75.3**
