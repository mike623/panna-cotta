#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform, Writable } from 'node:stream';

const CASK_TOKEN = 'panna-cotta';
const GITHUB_REPO = 'mike623/panna-cotta';
const APP_NAME = 'Panna Cotta';

function usage() {
  return `Usage: node scripts/generate-homebrew-cask.mjs <version> [--out <path>]\n\nGenerates the Homebrew cask for a Panna Cotta GitHub release.\n\nArguments:\n  <version>     Release version without a leading v, for example 0.1.13\n\nOptions:\n  --out <path>  Write cask content to a file instead of stdout\n  --help        Show this help message`;
}

function parseArgs(argv) {
  const positional = [];
  let outPath;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }

    if (arg === '--out') {
      if (outPath) {
        throw new Error('Received --out more than once.');
      }

      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('Missing path after --out.');
      }

      outPath = next;
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new Error('Expected exactly one version argument.');
  }

  const [version] = positional;
  if (version.startsWith('v')) {
    throw new Error(`Version must not start with "v". Use "${version.slice(1)}" instead.`);
  }

  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid version "${version}". Expected a release version like 0.1.13 without a leading v.`);
  }

  return { version, outPath };
}

function releaseAssetUrl(version, arch) {
  return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/Panna.Cotta_${version}_${arch}.dmg`;
}

async function sha256ForUrl(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error(`Failed to read ${url}: response body was empty.`);
  }

  const hash = createHash('sha256');
  const hashStream = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  const discardStream = new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body), hashStream, discardStream);
  } catch (error) {
    throw new Error(`Failed to compute SHA-256 for ${url}: ${error.message}`);
  }

  return hash.digest('hex');
}

function renderCask(version, checksums) {
  return `cask "${CASK_TOKEN}" do
  version "${version}"

  on_arm do
    sha256 "${checksums.aarch64}"

    url "https://github.com/${GITHUB_REPO}/releases/download/v#{version}/Panna.Cotta_#{version}_aarch64.dmg"
  end
  on_intel do
    sha256 "${checksums.x64}"

    url "https://github.com/${GITHUB_REPO}/releases/download/v#{version}/Panna.Cotta_#{version}_x64.dmg"
  end

  name "${APP_NAME}"
  desc "Web-based Stream Deck for controlling computers from your network"
  homepage "https://github.com/${GITHUB_REPO}"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on :macos

  app "${APP_NAME}.app"

  zap trash: [
    "~/.panna-cotta",
    "~/.panna-cotta.port",
    "~/Library/Application Support/io.mwong.panna-cotta",
    "~/Library/Caches/io.mwong.panna-cotta",
    "~/Library/Logs/io.mwong.panna-cotta",
    "~/Library/Preferences/io.mwong.panna-cotta.plist",
  ]
end
`;
}

async function writeOutput(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return;
  }

  const assets = {
    aarch64: releaseAssetUrl(args.version, 'aarch64'),
    x64: releaseAssetUrl(args.version, 'x64'),
  };

  const [aarch64, x64] = await Promise.all([
    sha256ForUrl(assets.aarch64),
    sha256ForUrl(assets.x64),
  ]);

  const cask = renderCask(args.version, { aarch64, x64 });

  if (args.outPath) {
    await writeOutput(args.outPath, cask);
    return;
  }

  process.stdout.write(cask);
}

main().catch((error) => {
  console.error(error.message);
  console.error('');
  console.error(usage());
  process.exitCode = 1;
});
