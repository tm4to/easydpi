// Entry point: wires up DOM elements and app state. All actual logic lives
// in the other modules (config, ui, gdpi, discord, process).

import { GDPI_VERSIONS } from "./config.js";
import { log, debugLog, withJobLock } from "./ui.js";
import { getSelectedGdpiVersion, setSelectedGdpiVersion, deleteExistingInstallation } from "./gdpi.js";
import { killDiscordProcess } from "./discord.js";
import { killDpiProcess, startAutoConfig } from "./process.js";

let isRunning = false;

debugLog("main.js loaded");

// GDPI version <select>
const versionSelect = document.getElementById("gdpi-version-select");
if (versionSelect) {
	(async () => {
		const current = await getSelectedGdpiVersion();
		versionSelect.value = current;
	})();

	versionSelect.addEventListener("change", async () => {
		await setSelectedGdpiVersion(versionSelect.value);
		log(`GoodbyeDPI version set to: ${GDPI_VERSIONS[versionSelect.value].label}`);
	});
}

// Toggle Main Button (ON / OFF)
document.getElementById("main-btn").addEventListener("click", withJobLock(async () => {
	debugLog("Main button clicked");
	const btn = document.getElementById("main-btn");

	if (!isRunning) {
		btn.innerText = "TUNING...";
		log("Starting DPI bypass search...");

		const ok = await startAutoConfig();

		if (ok) {
			isRunning = true;
			btn.innerText = "ON";
			btn.classList.add("active");
		} else {
			btn.innerText = "OFF";
		}
	} else {
		log("Stopping GoodbyeDPI...");
		await killDpiProcess();
		isRunning = false;
		btn.innerText = "OFF";
		btn.classList.remove("active");
	}
}));

// Button: Close Discord & GoodbyeDPI
const closeAppsBtn = document.getElementById("close-apps-btn");
if (closeAppsBtn) {
	closeAppsBtn.addEventListener("click", withJobLock(async () => {
		log("Terminating Discord and GoodbyeDPI processes...");
		await killDpiProcess();
		await killDiscordProcess();

		isRunning = false;
		const mainBtn = document.getElementById("main-btn");
		if (mainBtn) {
			mainBtn.innerText = "OFF";
			mainBtn.classList.remove("active");
		}
	}));
}

// Button: Delete existing, re-download, and re-configure
const reinstallBtn = document.getElementById("reinstall-btn");
if (reinstallBtn) {
	reinstallBtn.addEventListener("click", withJobLock(async () => {
		log("Starting clean re-installation flow...");

		const versionKey = await getSelectedGdpiVersion();

		// Stop process and reset UI state
		await killDpiProcess();
		isRunning = false;

		const mainBtn = document.getElementById("main-btn");
		if (mainBtn) {
			mainBtn.innerText = "TUNING...";
		}

		// Clear stored settings & wipe directory
		try {
			await Neutralino.storage.setData(`workingConfig_${versionKey}`, "");
		} catch { }
		await deleteExistingInstallation(versionKey);

		// Force download + config search
		const ok = await startAutoConfig();

		if (mainBtn) {
			if (ok) {
				isRunning = true;
				mainBtn.innerText = "ON";
				mainBtn.classList.add("active");
			} else {
				mainBtn.innerText = "OFF";
			}
		}
	}));
}

Neutralino.init();

// Defensive cleanup: if the app previously crashed or was force-closed, a
// goodbyedpi.exe from that session could still be running. Clear it out so
// we never end up with two competing instances.
killDpiProcess().catch(() => { });

// Register event listener for the window close (X) button
Neutralino.events.on("windowClose", async () => {
	log("App closing... terminating background processes.");
	await killDpiProcess();
	Neutralino.app.exit();
});
