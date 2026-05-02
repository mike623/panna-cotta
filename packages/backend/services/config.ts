import { z } from "zod";
import { parse, stringify } from "@std/toml";

const buttonSchema = z.object({
  name: z.string(),
  type: z.enum(["browser", "system"]),
  icon: z.string(),
  action: z.string(),
});

export const configSchema = z.object({
  grid: z.object({
    rows: z.number().int().min(1),
    cols: z.number().int().min(1),
  }),
  buttons: z.array(buttonSchema).optional(),
});

export type StreamDeckConfig = z.infer<typeof configSchema>;

export const defaultConfig: StreamDeckConfig = {
  grid: {
    rows: 2,
    cols: 3,
  },
  buttons: [
    {
      name: "Calculator",
      type: "system",
      icon: "calculator",
      action: "Calculator",
    },
    {
      name: "Google",
      type: "browser",
      icon: "chrome",
      action: "https://google.com",
    },
  ],
};

export function configDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  return `${home}/.panna-cotta`;
}

export function configFilePath(): string {
  return `${configDir()}/stream-deck.config.toml`;
}

function profilesDir(): string {
  return `${configDir()}/profiles`;
}

function activeProfileFile(): string {
  return `${configDir()}/active-profile`;
}

function safeProfileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 64).trim() ||
    "Default";
}

function profilePath(name: string): string {
  return `${profilesDir()}/${safeProfileName(name)}.toml`;
}

async function getActiveProfileName(): Promise<string> {
  try {
    return (await Deno.readTextFile(activeProfileFile())).trim() || "Default";
  } catch {
    return "Default";
  }
}

async function setActiveProfileName(name: string): Promise<void> {
  await Deno.writeTextFile(activeProfileFile(), safeProfileName(name));
}

async function readProfile(name: string): Promise<StreamDeckConfig> {
  try {
    const raw = await Deno.readTextFile(profilePath(name));
    const parsed = configSchema.safeParse(parse(raw));
    if (parsed.success) return parsed.data;
  } catch { /* fall through */ }
  return { ...defaultConfig };
}

async function migrateOldConfig(): Promise<void> {
  const pDir = profilesDir();
  const defaultProfilePath = `${pDir}/Default.toml`;

  try {
    await Deno.stat(defaultProfilePath);
    return; // already migrated
  } catch { /* not yet */ }

  await Deno.mkdir(pDir, { recursive: true });

  try {
    const raw = await Deno.readTextFile(configFilePath());
    await Deno.writeTextFile(defaultProfilePath, raw);
  } catch {
    await Deno.writeTextFile(
      defaultProfilePath,
      stringify(defaultConfig as Record<string, unknown>),
    );
  }

  await setActiveProfileName("Default");
}

export async function listProfiles(): Promise<
  { name: string; isActive: boolean }[]
> {
  await migrateOldConfig();
  const active = await getActiveProfileName();
  const profiles: { name: string; isActive: boolean }[] = [];

  try {
    for await (const entry of Deno.readDir(profilesDir())) {
      if (entry.isFile && entry.name.endsWith(".toml")) {
        const name = entry.name.slice(0, -5);
        profiles.push({ name, isActive: name === active });
      }
    }
  } catch { /* profiles dir missing */ }

  if (profiles.length === 0) {
    profiles.push({ name: "Default", isActive: true });
  }

  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

export async function activateProfile(name: string): Promise<void> {
  const safe = safeProfileName(name);
  try {
    await Deno.stat(profilePath(safe));
  } catch {
    throw new Error(`Profile "${safe}" not found`);
  }
  await setActiveProfileName(safe);
}

export async function createProfile(
  name: string,
  config?: StreamDeckConfig,
): Promise<void> {
  await migrateOldConfig();
  const safe = safeProfileName(name);
  const path = profilePath(safe);

  try {
    await Deno.stat(path);
    throw new Error(`Profile "${safe}" already exists`);
  } catch (e) {
    if (e instanceof Error && e.message.includes("already exists")) throw e;
  }

  await Deno.mkdir(profilesDir(), { recursive: true });
  const cfg = config ?? defaultConfig;
  await Deno.writeTextFile(path, stringify(cfg as Record<string, unknown>));
}

export async function deleteProfile(name: string): Promise<void> {
  const profiles = await listProfiles();
  if (profiles.length <= 1) throw new Error("Cannot delete the last profile");
  const safe = safeProfileName(name);
  await Deno.remove(profilePath(safe));
  const active = await getActiveProfileName();
  if (active === safe) {
    const remaining = profiles.filter((p) => p.name !== safe);
    if (remaining.length > 0) await setActiveProfileName(remaining[0].name);
  }
}

export async function renameProfile(
  oldName: string,
  newName: string,
): Promise<void> {
  const oldSafe = safeProfileName(oldName);
  const newSafe = safeProfileName(newName);
  if (oldSafe === newSafe) return;
  const content = await Deno.readTextFile(profilePath(oldSafe));
  await Deno.mkdir(profilesDir(), { recursive: true });
  await Deno.writeTextFile(profilePath(newSafe), content);
  await Deno.remove(profilePath(oldSafe));
  const active = await getActiveProfileName();
  if (active === oldSafe) await setActiveProfileName(newSafe);
}

export async function useStreamDeckConfig(): Promise<StreamDeckConfig> {
  await migrateOldConfig();
  const active = await getActiveProfileName();
  return readProfile(active);
}

export async function saveStreamDeckConfig(
  config: StreamDeckConfig,
  filePath?: string,
): Promise<void> {
  const toml = stringify(config as Record<string, unknown>);
  if (filePath) {
    await Deno.writeTextFile(filePath, toml);
    return;
  }
  await migrateOldConfig();
  const active = await getActiveProfileName();
  await Deno.mkdir(profilesDir(), { recursive: true });
  await Deno.writeTextFile(profilePath(active), toml);
}
