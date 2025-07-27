import { serveFile } from "https://deno.land/std/http/file_server.ts";

// Execute macOS commands
export const executeCommand = async (req: Request): Promise<Response> => {
  try {
    const { action, target } = await req.json();

    let commandOutput;
    switch (action) {
      case 'open-app':
        const openCmd = new Deno.Command("open", {
          args: ["-a", target],
        });
        commandOutput = await openCmd.output();
        break;

      case 'system-volume':
        const volumeCmd = new Deno.Command("osascript", {
          args: ["-e", `set volume output volume ${target}`],
        });
        commandOutput = await volumeCmd.output();
        break;

      case 'brightness':
        const brightnessCmd = new Deno.Command("brightness", {
          args: [target],
        });
        commandOutput = await brightnessCmd.output();
        break;

      default:
        return new Response(JSON.stringify({ success: false, message: "Invalid action" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    if (!commandOutput.success) {
      const stderr = new TextDecoder().decode(commandOutput.stderr);
      console.error(`Command execution failed for action '${action}': ${stderr}`);
      return new Response(JSON.stringify({ success: false, message: `Command failed: ${stderr}` }), { status: 500, headers: { "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    }
  } catch (error: any) {
    console.error(`Error in executeCommand: ${error.message}`);
    return new Response(JSON.stringify({ success: false, message: `Server error: ${error.message}` }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

// Get system status
export const getSystemStatus = async (req: Request): Promise<Response> => {
  const batteryCmd = new Deno.Command("pmset", {
    args: ["-g", "batt"],
  });
  const batteryOutput = await batteryCmd.output();
  const batteryText = new TextDecoder().decode(batteryOutput.stdout);

  const wifiCmd = new Deno.Command("networksetup", {
    args: ["-getairportpower", "en0"],
  });
  const wifiOutput = await wifiCmd.output();
  const wifiText = new TextDecoder().decode(wifiOutput.stdout);

  return new Response(JSON.stringify({ battery: batteryText, wifi: wifiText }), { headers: { "Content-Type": "application/json" } });
};

// Application launching
export const openApplication = async (req: Request): Promise<Response> => {
  try {
    const { appName } = await req.json();
    const cmd = new Deno.Command("open", {
      args: ["-a", appName],
    });
    const output = await cmd.output();
    if (!output.success) {
      console.error(`Error opening app: ${new TextDecoder().decode(output.stderr)}`);
    }
    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error(`Error in openApplication: ${error.message}`);
    return new Response(JSON.stringify({ success: false, message: `Server error: ${error.message}` }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
