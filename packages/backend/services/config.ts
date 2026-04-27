import { loadConfig } from "c12";
import { z } from "zod";
import { stringify } from "@std/toml";

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

const defaultConfig: StreamDeckConfig = {
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

function configDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  return `${home}/.panna-cotta`;
}

export function configFilePath(): string {
  return `${configDir()}/stream-deck.config.toml`;
}

export async function useStreamDeckConfig(): Promise<StreamDeckConfig> {
  const cfgFile = configFilePath();
  const { config, configFile } = await loadConfig<StreamDeckConfig>({
    name: "stream-deck",
    defaultConfig,
    rcFile: cfgFile,
    cwd: "/",
  });

  if (configFile) {
    console.log(`Loading configuration from: ${configFile}`);
  } else {
    console.log(`Using default configuration. Config will be saved to: ${cfgFile}`);
  }

  const parsedConfig = configSchema.safeParse(config);

  if (!parsedConfig.success) {
    console.error("Invalid configuration, using default config");
    return defaultConfig;
  }

  return parsedConfig.data;
}

export async function saveStreamDeckConfig(
  config: StreamDeckConfig,
  filePath = configFilePath(),
): Promise<void> {
  await Deno.mkdir(configDir(), { recursive: true });
  const toml = stringify(config as Record<string, unknown>);
  await Deno.writeTextFile(filePath, toml);
}
