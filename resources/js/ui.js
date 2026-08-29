// Logging + job-lock/rate-limiting for the debug panel and action buttons.

import { MAX_LOG_LINES, COOLDOWN_MS, ACTION_BUTTON_IDS } from "./config.js";

export const debugLog = (msg) => {
	console.log(`[DBG] ${msg}`);
};

export function log(msg) {
	const panel = document.getElementById("debug-panel");
	if (!panel) return;

	const line = document.createElement("div");
	line.textContent = `> ${msg}`;
	panel.appendChild(line);

	// Keep the panel bounded so it doesn't grow forever over long sessions.
	// (Manipulating innerHTML strings here is a trap: browsers normalize
	// "<br/>" to "<br>" on read-back, so a string-split trim silently stops
	// matching after the first append. Real DOM nodes avoid that entirely.)
	while (panel.childNodes.length > MAX_LOG_LINES) {
		panel.removeChild(panel.firstChild);
	}

	panel.scrollTop = panel.scrollHeight;
}

// ---- Job lock / rate limiting ----------------------------------------------------
// Only one job (main toggle, close-apps, reinstall) may run at a time, and all
// action controls are disabled while it runs. After a job finishes, controls stay
// disabled for a short cooldown so a user mashing buttons can't fire off overlapping
// installs/downloads or spam the GitHub API.
let jobRunning = false;
let cooldownUntil = 0;

function setControlsDisabled(disabled) {
	ACTION_BUTTON_IDS.forEach((id) => {
		const el = document.getElementById(id);
		if (el) el.disabled = disabled;
	});
	const versionSelect = document.getElementById("gdpi-version-select");
	if (versionSelect) versionSelect.disabled = disabled;
}

// Wraps a button click handler so clicks are ignored (with a log message)
// while a job is running or during the post-job cooldown, instead of
// spawning overlapping installs/downloads/API calls.
export function withJobLock(handler) {
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
