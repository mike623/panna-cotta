import { assertEquals, assertExists } from "@std/assert";
import { useStreamDeckConfig } from "./config.ts";

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
