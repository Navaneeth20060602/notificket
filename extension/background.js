const ALARM_NAME = "notificket-watch";
const CHECK_INTERVAL_MINUTES = 15;

function to24Hour(value) {
  const match = value.match(/^(\d{1,2}):(\d{2})(AM|PM)$/);
  if (!match) return value.padStart(5, "0");
  let hour = Number(match[1]);
  if (match[3] === "PM" && hour < 12) hour += 12;
  if (match[3] === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

async function scanAndSaveShowtimes(tabId, watch) {
  try {
    const data = await chrome.tabs.sendMessage(tabId, { type: "scan-available-dates" });
    const showtimes = (data?.scans || []).flatMap((scan) => (scan.showtimes || []).map((item) => ({ ...item, date: scan.date, time: to24Hour(item.time), format: watch.format })));
    if (!showtimes.length) return { ok: true, message: "No available showtimes found in the current date strip." };
    const response = await fetch(`${watch.baseUrl}/api/integrations/browser-showtimes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-notificket-ingest-key": watch.key },
      body: JSON.stringify({ movieTitle: watch.movieTitle || data.title, city: "Hyderabad", showtimes }),
    });
    const result = await response.json();
    return { ok: response.ok, message: result.message || result.error || "Could not save showtimes." };
  } catch {
    return { ok: false, message: "Could not scan the monitored page." };
  }
}

async function checkWatches() {
  const { watches = [] } = await chrome.storage.local.get("watches");
  const updated = [];
  for (const watch of watches) {
    try {
      const tab = await chrome.tabs.get(watch.tabId);
      if (!tab.url?.startsWith(watch.urlPrefix)) continue;
      await chrome.tabs.reload(watch.tabId);
      updated.push({ ...watch, lastCheckedAt: new Date().toISOString(), lastMessage: "Refreshing showtime page…" });
    } catch {
      // A closed tab is deliberately removed. Reopen its normal ticket page and enable monitoring again.
    }
  }
  await chrome.storage.local.set({ watches: updated });
}

chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM_NAME) checkWatches(); });

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const { watches = [] } = await chrome.storage.local.get("watches");
  const watch = watches.find((item) => item.tabId === tabId);
  if (!watch) return;
  const result = await scanAndSaveShowtimes(tabId, watch);
  await chrome.storage.local.set({ watches: watches.map((item) => item.tabId === tabId ? { ...item, lastCheckedAt: new Date().toISOString(), lastMessage: result.message } : item) });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "enable-watch") {
    chrome.storage.local.get("watches").then(({ watches = [] }) => {
      const remaining = watches.filter((watch) => watch.tabId !== message.watch.tabId);
      chrome.storage.local.set({ watches: [...remaining, message.watch] }).then(async () => {
        const result = await scanAndSaveShowtimes(message.watch.tabId, message.watch);
        const { watches: savedWatches = [] } = await chrome.storage.local.get("watches");
        await chrome.storage.local.set({ watches: savedWatches.map((watch) => watch.tabId === message.watch.tabId ? { ...watch, lastCheckedAt: new Date().toISOString(), lastMessage: result.message } : watch) });
        sendResponse({ ok: true, message: result.message });
      });
    });
    return true;
  }
  if (message.type === "watch-status") {
    chrome.storage.local.get("watches").then(({ watches = [] }) => sendResponse({ watch: watches.find((watch) => watch.tabId === message.tabId) || null }));
    return true;
  }
});
