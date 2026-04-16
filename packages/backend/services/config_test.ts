import { assertEquals, assertExists } from "@std/assert";
import { saveStreamDeckConfig, useStreamDeckConfig } from "./config.ts";
import type { StreamDeckConfig } from "./config.ts";

Deno.test("useStreamDeckConfig returns valid config with grid and buttons", async () => {
  const config = await useStreamDeckConfig();

  assertExists(config.grid);
  assertEquals(typeof config.grid.rows, "number");
  assertEquals(typeof config.grid.cols, "number");
  assertEquals(config.grid.rows > 0, true);
  assertEquals(config.grid.cols > 0, true);

  assertExists(config.buttons);
  assertEquals(Array.isArray(config.buttons), true);
});

Deno.test("useStreamDeckConfig buttons have required fields", async () => {
  const config = await useStreamDeckConfig();

  for (const button of config.buttons || []) {
    assertExists(button.name);
    assertExists(button.type);
    assertExists(button.icon);
    assertExists(button.action);
    assertEquals(
      button.type === "browser" || button.type === "system",
      true,
      `Invalid button type: ${button.type}`,
    );
  }
});

Deno.test("saveStreamDeckConfig writes valid TOML to file", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = `${tempDir}/test-config.toml`;

  const config: StreamDeckConfig = {
    grid: { rows: 3, cols: 4 },
    buttons: [
      { name: "Test", type: "browser", icon: "globe", action: "https://example.com" },
    ],
  };

  try {
    await saveStreamDeckConfig(config, filePath);

    const content = await Deno.readTextFile(filePath);
    assertEquals(content.includes("[grid]"), true);
    assertEquals(content.includes("rows = 3"), true);
    assertEquals(content.includes("cols = 4"), true);
    assertEquals(content.includes('name = "Test"'), true);
    assertEquals(content.includes("[[buttons]]"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
