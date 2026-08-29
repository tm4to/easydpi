// Static configuration - flags, URLs, tunables. No logic lives here.

export const CONFIGS = [
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
export const GDPI_VERSIONS = {
	"0.2.3rc2": {
		label: "0.2.3rc2 (Recommended)",
		zipUrl: "https://github.com/ValdikSS/GoodbyeDPI/releases/download/0.2.3rc2/goodbyedpi-0.2.3rc2.zip",
	},
	"latest": {
		label: "Latest",
		zipUrl: null, // resolved dynamically via GitHub API
	},
};
export const DEFAULT_GDPI_VERSION = "0.2.3rc2";
export const GDPI_LATEST_RELEASE_API = "https://api.github.com/repos/ValdikSS/GoodbyeDPI/releases/latest";
export const LATEST_CACHE_MS = 10 * 60 * 1000; // 10 minutes

// ---- Discord installer ----------------------------------------------------------
export const DISCORD_INSTALLER_URL = "https://discord.com/api/downloads/distributions/app/installers/latest?channel=stable&platform=win&arch=x64";
export const DISCORD_DOWNLOAD_PAGE_URL = "https://discord.com/download";

// ---- UI tunables ------------------------------------------------------------------
export const MAX_LOG_LINES = 300;
export const COOLDOWN_MS = 4000;
export const ACTION_BUTTON_IDS = ["main-btn", "close-apps-btn", "reinstall-btn"];
