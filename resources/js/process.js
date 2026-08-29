// GoodbyeDPI process control and the auto-config search loop.

import { CONFIGS } from "./config.js";
import { log } from "./ui.js";
import { getSelectedGdpiVersion, ensureInstalled } from "./gdpi.js";
import { testDiscordConnection, ensureDiscordInstalled } from "./discord.js";

export async function killDpiProcess() {
	try {
		await Neutralino.os.execCommand(`taskkill /F /IM goodbyedpi.exe`);
	} catch { }
}

export async function startAutoConfig() {
	const versionKey = await getSelectedGdpiVersion();
	const exePath = await ensureInstalled(versionKey);

	const configStorageKey = `workingConfig_${versionKey}`;
	let savedConfig = null;
	try {
		savedConfig = await Neutralino.storage.getData(configStorageKey);
	} catch { }

	const testList = savedConfig ? [savedConfig, ...CONFIGS.filter(c => c !== savedConfig)] : CONFIGS;

	for (const flag of testList) {
		log(`Testing flags: ${flag}`);

		await killDpiProcess();
		await new Promise(r => setTimeout(r, 500));

		const nonHiddenCmd = `cmd.exe /c start "" "${exePath}" ${flag}`;
		await Neutralino.os.execCommand(nonHiddenCmd);

		await new Promise(r => setTimeout(r, 2500));

		const success = await testDiscordConnection();

		if (success) {
			log(`Success! Active config: ${flag}`);
			await Neutralino.storage.setData(configStorageKey, flag);

			// A working DPI bypass is confirmed - make sure Discord itself is installed.
			await ensureDiscordInstalled();

			Neutralino.os.execCommand("start discord://").catch(() => { });
			return true;
		} else {
			log(`Config failed: ${flag}`);
			await killDpiProcess();
		}
	}

	log("Error: No working configuration found.");
	await killDpiProcess();
	return false;
}
