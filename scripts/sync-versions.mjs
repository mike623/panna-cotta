import { readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import process from "node:process";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/sync-versions.mjs <version>");
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const tauriConfPath = resolve(
  root,
  "packages/desktop/src-tauri/tauri.conf.json",
);
const conf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
conf.version = version;
writeFileSync(tauriConfPath, JSON.stringify(conf, null, 2) + "\n");
console.log(`tauri.conf.json → ${version}`);

const versionTsPath = resolve(root, "packages/backend/services/version.ts");
const ts = readFileSync(versionTsPath, "utf8").replace(
  /CURRENT_VERSION = ".*"/,
  `CURRENT_VERSION = "${version}"`,
);
writeFileSync(versionTsPath, ts);
console.log(`version.ts → ${version}`);
