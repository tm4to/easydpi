// GoodbyeDPI version selection, install/reinstall, and path resolution.
// Depends on the global `Neutralino` object provided by js/neutralino.js.

import { GDPI_VERSIONS, DEFAULT_GDPI_VERSION, GDPI_LATEST_RELEASE_API, LATEST_CACHE_MS } from "./config.js";
import { log } from "./ui.js";

export async function getSelectedGdpiVersion() {
	try {
		const stored = await Neutralino.storage.getData("gdpiVersion");
		if (stored && GDPI_VERSIONS[stored]) {
			return stored;
		}
	} catch { }
	return DEFAULT_GDPI_VERSION;
}

export async function setSelectedGdpiVersion(versionKey) {
	if (!GDPI_VERSIONS[versionKey]) return;
	await Neutralino.storage.setData("gdpiVersion", versionKey);
}

let cachedLatestZipUrl = null;
let cachedLatestZipUrlAt = 0;

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

export async function getPaths(versionKey) {
	const localAppData = await Neutralino.os.getEnv("LOCALAPPDATA");
	const rootDir = `${localAppData}\\EasyDPI`;
	const targetDir = `${rootDir}\\gdpi_${versionKey}`;
	const zipPath = `${rootDir}\\gdpi_${versionKey}.zip`;
	return { rootDir, targetDir, zipPath };
}

// Locate goodbyedpi.exe inside targetDir regardless of the zip's internal folder layout
// (this differs between the pinned build and whatever "latest" happens to ship).
export async function findGdpiExecutable(targetDir) {
	const cmd = `powershell -Command "(Get-ChildItem -Path '${targetDir}' -Filter goodbyedpi.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName"`;
	const res = await Neutralino.os.execCommand(cmd);
	const path = (res.stdOut || "").trim();
	return path || null;
}

export async function ensureInstalled(versionKey) {
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

export async function deleteExistingInstallation(versionKey) {
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
