import { loadConfig } from "c12";
import { z } from "zod";

const buttonSchema = z.object({
  name: z.string(),
  type: z.enum(["browser", "system"]),
  icon: z.string(),
  action: z.string(),
});

const configSchema = z.object({
  grid: z.object({
    rows: z.number(),
    cols: z.number(),
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
    { name: "Calculator", type: "system", icon: "calculator", action: "Calculator" },
    { name: "Google", type: "browser", icon: "chrome", action: "https://google.com" },
  ]
};

export async function useStreamDeckConfig() {
  const root = new URL('../../', import.meta.url).pathname;
  const { config } = await loadConfig<StreamDeckConfig>({
    name: "stream-deck",
    defaultConfig,
    rcFile: "stream-deck.config.toml",
    // cwd: root,
  });

  const parsedConfig = configSchema.safeParse(config);

  if (!parsedConfig.success) {
    console.error("Invalid configuration, using default config");
    return defaultConfig;
  }

  return parsedConfig.data;
}
