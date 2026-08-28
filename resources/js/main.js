let dpiProcess = null;
let isRunning = false;

const debugLog = (msg) => {
	console.log(`[DBG] ${msg}`);
};

debugLog("main.js loaded");

const CONFIGS = [
	"-9 --set-ttl 7 --dns-addr 9.9.9.9", // t
	"-5 --set-ttl 5 --dns-addr 77.88.8.8 --dns-port 1253", // b
	"-5 --set-ttl 5 --dns-addr 1.1.1.1 --dnsv6-addr 2606:4700:4700::1111  --dnsv6-port 1111", // c
	"--set-ttl 7",
	"-9 --set-ttl 7",
	// "-9",
	// "-5",
	// "-1 -a"
];

const ZIP_URL = "https://github.com/ValdikSS/GoodbyeDPI/releases/download/0.2.3rc2/goodbyedpi-0.2.3rc2.zip";

function log(msg) {
	const panel = document.getElementById("debug-panel");
	if (panel) {
		panel.innerHTML += `> ${msg}<br/>`;
		panel.scrollTop = panel.scrollHeight;
	}
}

async function getPaths() {
	const localAppData = await Neutralino.os.getEnv("LOCALAPPDATA");
	const targetDir = `${localAppData}\\EasyDPI`;
	const exePath = `${targetDir}\\goodbyedpi-0.2.3rc2\\x86_64\\goodbyedpi.exe`;
	const zipPath = `${targetDir}\\goodbyedpi.zip`;
	return { targetDir, exePath, zipPath };
}

async function ensureInstalled() {
	const { targetDir, exePath, zipPath } = await getPaths();

	try {
		await Neutralino.filesystem.getStats(exePath);
		log("GoodbyeDPI binary found.");
	} catch {
		log("GoodbyeDPI not found. Downloading...");
		await Neutralino.filesystem.createDirectory(targetDir).catch(() => { });

		const downloadCmd = `powershell -Command "Invoke-WebRequest -Uri '${ZIP_URL}' -OutFile '${zipPath}'"`;
		await Neutralino.os.execCommand(downloadCmd);

		log("Extracting archive...");
		const extractCmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`;
		await Neutralino.os.execCommand(extractCmd);

		log("Installation complete.");
	}
}

async function killDpiProcess() {
	try {
		await Neutralino.os.execCommand(`taskkill /F /IM goodbyedpi.exe`);
	} catch { }
	dpiProcess = null;
}

async function killDiscordProcess() {
	try {
		await Neutralino.os.execCommand(`taskkill /F /IM Discord.exe`);
		log("Discord process terminated.");
	} catch {
		log("Discord process was not running.");
	}
}

async function deleteExistingInstallation() {
	const { targetDir } = await getPaths();
	log("Removing existing GoodbyeDPI installation...");
	try {
		// Powershell force remove directory
		const removeCmd = `powershell -Command "Remove-Item -Path '${targetDir}' -Recurse -Force"`;
		await Neutralino.os.execCommand(removeCmd);
		log("Old installation deleted successfully.");
	} catch (err) {
		log(`Failed to remove old installation: ${err.message || err}`);
	}
}

async function testDiscordConnection() {
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

async function startAutoConfig() {
	const { exePath } = await getPaths();
	await ensureInstalled();

	let savedConfig = null;
	try {
		savedConfig = await Neutralino.storage.getData("workingConfig");
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
			await Neutralino.storage.setData("workingConfig", flag);

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

// Toggle Main Button (ON / OFF)
document.getElementById("main-btn").addEventListener("click", async () => {
	debugLog("Main button clicked");
	const btn = document.getElementById("main-btn");

	if (!isRunning) {
		btn.disabled = true;
		btn.innerText = "TUNING...";
		log("Starting DPI bypass search...");

		const ok = await startAutoConfig();
		btn.disabled = false;

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
});

// Button: Close Discord & GoodbyeDPI
const closeAppsBtn = document.getElementById("close-apps-btn");
if (closeAppsBtn) {
	closeAppsBtn.addEventListener("click", async () => {
		log("Terminating Discord and GoodbyeDPI processes...");
		await killDpiProcess();
		await killDiscordProcess();

		isRunning = false;
		const mainBtn = document.getElementById("main-btn");
		if (mainBtn) {
			mainBtn.innerText = "OFF";
			mainBtn.classList.remove("active");
		}
	});
}

// Button: Delete existing, re-download, and re-configure
const reinstallBtn = document.getElementById("reinstall-btn");
if (reinstallBtn) {
	reinstallBtn.addEventListener("click", async () => {
		log("Starting clean re-installation flow...");

		// Stop process and reset UI state
		await killDpiProcess();
		isRunning = false;

		const mainBtn = document.getElementById("main-btn");
		if (mainBtn) {
			mainBtn.disabled = true;
			mainBtn.innerText = "TUNING...";
		}

		// Clear stored settings & wipe directory
		try {
			await Neutralino.storage.setData("workingConfig", "");
		} catch { }
		await deleteExistingInstallation();

		// Force download + config search
		const ok = await startAutoConfig();

		if (mainBtn) {
			mainBtn.disabled = false;
			if (ok) {
				isRunning = true;
				mainBtn.innerText = "ON";
				mainBtn.classList.add("active");
			} else {
				mainBtn.innerText = "OFF";
			}
		}
	});
}

Neutralino.init();

// Register event listener for the window close (X) button
Neutralino.events.on("windowClose", async () => {
	log("App closing... terminating background processes.");
	await killDpiProcess();
	Neutralino.app.exit();
});