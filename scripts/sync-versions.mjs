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

const rootPackagePath = resolve(root, "package.json");
const rootPackage = readFileSync(rootPackagePath, "utf8").replace(
  /^(\s*"version"\s*:\s*)"[^"]+"/m,
  `$1"${version}"`,
);
writeFileSync(rootPackagePath, rootPackage);
console.log(`package.json → ${version}`);

const desktopPackagePath = resolve(root, "packages/desktop/package.json");
const desktopPackage = readFileSync(desktopPackagePath, "utf8").replace(
  /^(\s*"version"\s*:\s*)"[^"]+"/m,
  `$1"${version}"`,
);
writeFileSync(desktopPackagePath, desktopPackage);
console.log(`packages/desktop/package.json → ${version}`);

const cargoTomlPath = resolve(root, "packages/desktop/src-tauri/Cargo.toml");
const cargoToml = readFileSync(cargoTomlPath, "utf8").replace(
  /(^\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
  `$1"${version}"`,
);
writeFileSync(cargoTomlPath, cargoToml);
console.log(`Cargo.toml → ${version}`);

const tauriConfPath = resolve(
  root,
  "packages/desktop/src-tauri/tauri.conf.json",
);
const tauriConf = readFileSync(tauriConfPath, "utf8").replace(
  /^(\s*"version"\s*:\s*)"[^"]+"/m,
  `$1"${version}"`,
);
writeFileSync(tauriConfPath, tauriConf);
console.log(`tauri.conf.json → ${version}`);
