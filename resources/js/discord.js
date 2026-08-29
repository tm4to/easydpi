// Discord install check/download, process management, and the connectivity
// probe used to validate a GoodbyeDPI config.

import { DISCORD_INSTALLER_URL, DISCORD_DOWNLOAD_PAGE_URL } from "./config.js";
import { log } from "./ui.js";
import { getPaths, getSelectedGdpiVersion } from "./gdpi.js";

export async function killDiscordProcess() {
	try {
		await Neutralino.os.execCommand(`taskkill /F /IM Discord.exe`);
		log("Discord process terminated.");
	} catch {
		log("Discord process was not running.");
	}
}

export async function testDiscordConnection() {
	const targetUrl = "https://discord.com/api/v10/gateway";
	log(`[HTTP] Sending CLI request -> ${targetUrl}...`);

	try {
		const cmd = `cmd.exe /c "curl.exe -s -o NUL -w "%{http_code}" ${targetUrl}"`;
		const res = await Neutralino.os.execCommand(cmd);

		const statusCode = res.stdOut.trim();

		if (statusCode === "200") {
			log(`[HTTP SUCCESS] Received Status: ${statusCode} OK`);
			return true;
		} else {
			log(`[HTTP FAIL] Destination replied with Status: ${statusCode || "No Response"}`);
			return false;
		}
	} catch (err) {
		log(`[NETWORK ERROR] Command execution failed: ${err.message || err}`);
		return false;
	}
}

// Checks (best-effort) whether Discord is already installed for the current user,
// and if not, downloads and launches the official installer.
export async function ensureDiscordInstalled() {
	const localAppData = await Neutralino.os.getEnv("LOCALAPPDATA");
	const discordDir = `${localAppData}\\Discord`;

	try {
		const checkCmd = `powershell -Command "(Get-ChildItem -Path '${discordDir}' -Filter Discord.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName"`;
		const res = await Neutralino.os.execCommand(checkCmd);
		const found = (res.stdOut || "").trim();
		if (found) {
			log("Discord installation found.");
			return true;
		}
	} catch { }

	log("Discord not found. Downloading installer...");
	const { rootDir } = await getPaths(await getSelectedGdpiVersion());
	await Neutralino.filesystem.createDirectory(rootDir).catch(() => { });
	const installerPath = `${rootDir}\\DiscordSetup.exe`;

	try {
		const dlCmd = `powershell -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${DISCORD_INSTALLER_URL}' -OutFile '${installerPath}'"`;
		await Neutralino.os.execCommand(dlCmd);

		log("Discord installer downloaded. Launching setup...");
		await Neutralino.os.execCommand(`cmd.exe /c start "" "${installerPath}"`);
		return true;
	} catch (err) {
		log(`Discord installer download failed: ${err.message || err}. Opening download page instead...`);
		await Neutralino.os.execCommand(`cmd.exe /c start "" "${DISCORD_DOWNLOAD_PAGE_URL}"`).catch(() => { });
		return false;
	}
}
