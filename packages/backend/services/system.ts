// Execute macOS commands
export const executeCommand = async (req: Request): Promise<Response> => {
  try {
    const { action, target } = await req.json();

    let commandOutput;
    switch (action) {
      case "open-app": {
        const openCmd = new Deno.Command("open", {
          args: ["-a", target],
        });
        commandOutput = await openCmd.output();
        break;
      }
      case "system-volume": {
        const volumeCmd = new Deno.Command("osascript", {
          args: ["-e", `set volume output volume ${target}`],
        });
        commandOutput = await volumeCmd.output();
        break;
      }
      case "brightness": {
        const brightnessCmd = new Deno.Command("brightness", {
          args: [target],
        });
        commandOutput = await brightnessCmd.output();
        break;
      }
      default:
        return Response.json(
          { success: false, message: "Invalid action" },
          { status: 400 },
        );
    }

    if (!commandOutput.success) {
      const stderr = new TextDecoder().decode(commandOutput.stderr);
      console.error(`Command failed for '${action}': ${stderr}`);
      return Response.json(
        { success: false, message: `Command failed: ${stderr}` },
        { status: 500 },
      );
    }

    return Response.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error in executeCommand: ${message}`);
    return Response.json(
      { success: false, message: `Server error: ${message}` },
      { status: 500 },
    );
  }
};

// Get system status
export const getSystemStatus = async (_req: Request): Promise<Response> => {
  try {
    const batteryCmd = new Deno.Command("pmset", { args: ["-g", "batt"] });
    const batteryOutput = await batteryCmd.output();
    const battery = new TextDecoder().decode(batteryOutput.stdout);

    const wifiCmd = new Deno.Command("networksetup", {
      args: ["-getairportpower", "en0"],
    });
    const wifiOutput = await wifiCmd.output();
    const wifi = new TextDecoder().decode(wifiOutput.stdout);

    return Response.json({ battery, wifi });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { success: false, message: `Server error: ${message}` },
      { status: 500 },
    );
  }
};

// Application launching
export const openApplication = async (req: Request): Promise<Response> => {
  try {
    const { appName } = await req.json();
    const cmd = new Deno.Command("open", { args: ["-a", appName] });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      console.error(`Error opening app: ${stderr}`);
      return Response.json(
        { success: false, message: stderr },
        { status: 500 },
      );
    }
    return Response.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error in openApplication: ${message}`);
    return Response.json(
      { success: false, message: `Server error: ${message}` },
      { status: 500 },
    );
  }
};

export const openUrl = async (req: Request): Promise<Response> => {
  try {
    const { url } = await req.json();
    const cmd = new Deno.Command("open", { args: [url] });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      console.error(`Error opening URL: ${stderr}`);
      return Response.json(
        { success: false, message: stderr },
        { status: 500 },
      );
    }
    return Response.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error in openUrl: ${message}`);
    return Response.json(
      { success: false, message: `Server error: ${message}` },
      { status: 500 },
    );
  }
};
