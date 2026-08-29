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

// ---- GoodbyeDPI version switch -------------------------------------------------
const GDPI_VERSIONS = {
	"0.2.3rc2": {
		label: "0.2.3rc2 (Recommended)",
		zipUrl: "https://github.com/ValdikSS/GoodbyeDPI/releases/download/0.2.3rc2/goodbyedpi-0.2.3rc2.zip",
	},
	"latest": {
		label: "Latest",
		zipUrl: null, // resolved dynamically via GitHub API
	},
};
const DEFAULT_GDPI_VERSION = "0.2.3rc2";
const GDPI_LATEST_RELEASE_API = "https://api.github.com/repos/ValdikSS/GoodbyeDPI/releases/latest";

// ---- Discord installer ----------------------------------------------------------
const DISCORD_INSTALLER_URL = "https://discord.com/api/downloads/distributions/app/installers/latest?channel=stable&platform=win&arch=x64";
const DISCORD_DOWNLOAD_PAGE_URL = "https://discord.com/download";

const MAX_LOG_LINES = 300;

function log(msg) {
	const panel = document.getElementById("debug-panel");
	if (panel) {
		panel.innerHTML += `> ${msg}<br/>`;

		// Trim old lines so the panel's DOM/string doesn't grow unbounded
		// over long-running sessions (repeated retries, re-configures, etc.)
		const lines = panel.innerHTML.split("<br/>");
		if (lines.length > MAX_LOG_LINES) {
			panel.innerHTML = lines.slice(lines.length - MAX_LOG_LINES).join("<br/>");
		}

		panel.scrollTop = panel.scrollHeight;
	}
}

async function getSelectedGdpiVersion() {
	try {
		const stored = await Neutralino.storage.getData("gdpiVersion");
		if (stored && GDPI_VERSIONS[stored]) {
			return stored;
		}
	} catch { }
	return DEFAULT_GDPI_VERSION;
}

async function setSelectedGdpiVersion(versionKey) {
	if (!GDPI_VERSIONS[versionKey]) return;
	await Neutralino.storage.setData("gdpiVersion", versionKey);
}

let cachedLatestZipUrl = null;
let cachedLatestZipUrlAt = 0;
const LATEST_CACHE_MS = 10 * 60 * 1000; // 10 minutes

async function resolveGdpiZipUrl(versionKey) {
	const versionInfo = GDPI_VERSIONS[versionKey] || GDPI_VERSIONS[DEFAULT_GDPI_VERSION];

	if (versionInfo.zipUrl) {
		return versionInfo.zipUrl;
	}

	// "latest" - ask GitHub API for the newest release's zip asset.
	// Cache briefly so repeated installs/reinstalls in a short window don't
	// hammer the (unauthenticated, rate-limited) GitHub API.
	const now = Date.now();
	if (cachedLatestZipUrl && (now - cachedLatestZipUrlAt) < LATEST_CACHE_MS) {
		log("Using cached 'latest' release URL.");
		return cachedLatestZipUrl;
	}

	log("Resolving latest GoodbyeDPI release...");
	const cmd = `powershell -Command "$ProgressPreference='SilentlyContinue'; $r = Invoke-RestMethod -Uri '${GDPI_LATEST_RELEASE_API}' -Headers @{ 'User-Agent' = 'EasyDPI' }; ($r.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1).browser_download_url"`;
	const res = await Neutralino.os.execCommand(cmd);
	const url = (res.stdOut || "").trim();

	if (!url) {
		throw new Error("Could not resolve the latest GoodbyeDPI release URL (GitHub may be rate-limiting - try again shortly).");
	}

	cachedLatestZipUrl = url;
	cachedLatestZipUrlAt = now;

	log(`Latest release resolved: ${url}`);
	return url;
}

async function getPaths(versionKey) {
	const localAppData = await Neutralino.os.getEnv("LOCALAPPDATA");
	const rootDir = `${localAppData}\\EasyDPI`;
	const targetDir = `${rootDir}\\gdpi_${versionKey}`;
	const zipPath = `${rootDir}\\gdpi_${versionKey}.zip`;
	return { rootDir, targetDir, zipPath };
}

// Locate goodbyedpi.exe inside targetDir regardless of the zip's internal folder layout
// (this differs between the pinned build and whatever "latest" happens to ship).
async function findGdpiExecutable(targetDir) {
	const cmd = `powershell -Command "(Get-ChildItem -Path '${targetDir}' -Filter goodbyedpi.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName"`;
	const res = await Neutralino.os.execCommand(cmd);
	const path = (res.stdOut || "").trim();
	return path || null;
}

async function ensureInstalled(versionKey) {
	const { rootDir, targetDir, zipPath } = await getPaths(versionKey);

	let exePath = await findGdpiExecutable(targetDir).catch(() => null);
	if (exePath) {
		log(`GoodbyeDPI binary found (${versionKey}).`);
		return exePath;
	}

	log(`GoodbyeDPI (${versionKey}) not found. Downloading...`);
	await Neutralino.filesystem.createDirectory(rootDir).catch(() => { });
	await Neutralino.filesystem.createDirectory(targetDir).catch(() => { });

	const zipUrl = await resolveGdpiZipUrl(versionKey);

	const downloadCmd = `powershell -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${zipUrl}' -OutFile '${zipPath}'"`;
	await Neutralino.os.execCommand(downloadCmd);

	log("Extracting archive...");
	const extractCmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`;
	await Neutralino.os.execCommand(extractCmd);

	log("Installation complete.");

	exePath = await findGdpiExecutable(targetDir);
	if (!exePath) {
		throw new Error(`Could not locate goodbyedpi.exe after extracting version "${versionKey}".`);
	}
	return exePath;
}

async function killDpiProcess() {
	try {
		await Neutralino.os.execCommand(`taskkill /F /IM goodbyedpi.exe`);
	} catch { }
}

async function killDiscordProcess() {
	try {
		await Neutralino.os.execCommand(`taskkill /F /IM Discord.exe`);
		log("Discord process terminated.");
	} catch {
		log("Discord process was not running.");
	}
}

async function deleteExistingInstallation(versionKey) {
	const { targetDir } = await getPaths(versionKey);
	log(`Removing existing GoodbyeDPI installation (${versionKey})...`);
	try {
		// Powershell force remove directory
		const removeCmd = `powershell -Command "Remove-Item -Path '${targetDir}' -Recurse -Force -ErrorAction SilentlyContinue"`;
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

// Checks (best-effort) whether Discord is already installed for the current user,
// and if not, downloads and launches the official installer.
async function ensureDiscordInstalled() {
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

async function startAutoConfig() {
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

// ---- Job lock / rate limiting ----------------------------------------------------
// Only one job (main toggle, close-apps, reinstall) may run at a time, and all
// action controls are disabled while it runs. After a job finishes, controls stay
// disabled for a short cooldown so a user mashing buttons can't fire off overlapping
// installs/downloads or spam the GitHub API.
let jobRunning = false;
let cooldownUntil = 0;
const COOLDOWN_MS = 4000;
const ACTION_BUTTON_IDS = ["main-btn", "close-apps-btn", "reinstall-btn"];

function setControlsDisabled(disabled) {
	ACTION_BUTTON_IDS.forEach((id) => {
		const el = document.getElementById(id);
		if (el) el.disabled = disabled;
	});
	if (versionSelect) versionSelect.disabled = disabled;
}

// Wraps a button click handler so clicks are ignored (with a log message)
// while a job is running or during the post-job cooldown, instead of
// spawning overlapping installs/downloads/API calls.
function withJobLock(handler) {
	return async (...args) => {
		const now = Date.now();

		if (jobRunning) {
			log("Please wait - a job is already in progress.");
			return;
		}
		if (now < cooldownUntil) {
			log(`Please wait ${Math.ceil((cooldownUntil - now) / 1000)}s before trying again.`);
			return;
		}

		jobRunning = true;
		setControlsDisabled(true);

		try {
			await handler(...args);
		} finally {
			jobRunning = false;
			cooldownUntil = Date.now() + COOLDOWN_MS;
			setControlsDisabled(false);
		}
	};
}

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
