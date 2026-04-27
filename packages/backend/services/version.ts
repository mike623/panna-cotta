import { compare, parse } from "@std/semver";

export const CURRENT_VERSION = "0.1.2";

const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/mike623/panna-cotta/releases/latest";
const CACHE_TTL_MS = 60 * 60 * 1000;

interface VersionCache {
  latest: string;
  releaseUrl: string;
  ts: number;
}

let cache: VersionCache | null = null;

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
}

async function fetchLatest(): Promise<VersionCache | null> {
  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        "User-Agent": "panna-cotta",
        "Accept": "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { tag_name?: string; html_url?: string };
    const tag = (data.tag_name ?? "").replace(/^v/, "");
    if (!tag) return null;
    return {
      latest: tag,
      releaseUrl: data.html_url ?? GITHUB_RELEASES_URL,
      ts: Date.now(),
    };
  } catch {
    return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  try {
    return compare(parse(latest), parse(current)) > 0;
  } catch {
    return latest !== current;
  }
}

export async function getVersionInfo(): Promise<VersionInfo> {
  const now = Date.now();
  if (!cache || now - cache.ts > CACHE_TTL_MS) {
    const fresh = await fetchLatest();
    if (fresh) cache = fresh;
  }
  const latest = cache?.latest ?? null;
  return {
    current: CURRENT_VERSION,
    latest,
    updateAvailable: latest !== null && isNewer(latest, CURRENT_VERSION),
    releaseUrl: cache?.releaseUrl ?? null,
  };
}
