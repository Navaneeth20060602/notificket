const $ = (id) => document.getElementById(id);
$("date").value = new Date().toISOString().slice(0, 10);
let detected = [];
let activeTab = null;

chrome.storage.local.get(["baseUrl", "key"], (saved) => { $("baseUrl").value = saved.baseUrl || "http://localhost:3000"; $("key").value = saved.key || ""; });
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab?.id) return;
  activeTab = tab;
  chrome.runtime.sendMessage({ type: "watch-status", tabId: tab.id }, (data) => {
    if (!data?.watch) return;
    $("monitor").textContent = "Automatic monitoring enabled";
    $("monitorStatus").className = "ok";
    $("monitorStatus").textContent = data.watch.lastMessage || "This open tab is checked every 15 minutes.";
  });
  chrome.tabs.sendMessage(tab.id, { type: "extract-showtimes" }, (data) => {
    if (chrome.runtime.lastError || !data) {
      $("shows").textContent = "Could not read this tab yet. Reload the BookMyShow page after reloading this extension, then open this popup again.";
      return;
    }
    $("movieTitle").value = data.title || "";
    if (data.date) $("date").value = data.date;
    detected = data.showtimes || [];
    $("shows").textContent = "";
    if (!detected.length) { $("shows").textContent = "No theatre rows found. Make sure the theatre list is visible, then reopen this popup."; return; }
    detected.forEach((showtime, index) => {
      const label = document.createElement("label"); label.className = "show";
      const check = document.createElement("input"); check.type = "checkbox"; check.checked = true; check.value = String(index);
      label.append(check, `${showtime.theatreName} — ${showtime.time}`); $("shows").append(label);
    });
  });
});
function to24Hour(value) { const match = value.match(/^(\d{1,2}):(\d{2})(AM|PM)$/); if (!match) return value.padStart(5, "0"); let hour = Number(match[1]); if (match[3] === "PM" && hour < 12) hour += 12; if (match[3] === "AM" && hour === 12) hour = 0; return `${String(hour).padStart(2, "0")}:${match[2]}`; }
$("send").addEventListener("click", async () => {
  const baseUrl = $("baseUrl").value.replace(/\/$/, ""); const key = $("key").value; const movieTitle = $("movieTitle").value.trim(); const date = $("date").value; const format = $("format").value.trim() || "2D";
  const showtimes = [...document.querySelectorAll("#shows input:checked")].map((input) => detected[Number(input.value)]).filter(Boolean).map((item) => ({ ...item, time: to24Hour(item.time), date, format }));
  const status = $("status"); status.className = "";
  if (!baseUrl || !key || !movieTitle || !date || !showtimes.length) { status.textContent = "Fill in the key, confirm movie/date, and select at least one detected showtime."; status.className = "error"; return; }
  chrome.storage.local.set({ baseUrl, key });
  try { const response = await fetch(`${baseUrl}/api/integrations/browser-showtimes`, { method: "POST", headers: { "Content-Type": "application/json", "x-notificket-ingest-key": key }, body: JSON.stringify({ movieTitle, city: "Hyderabad", showtimes }) }); const data = await response.json(); status.textContent = data.message || data.error || "Could not save showtimes."; status.className = response.ok ? "ok" : "error"; } catch { status.textContent = "Could not reach Notificket. Is npm run dev running?"; status.className = "error"; }
});

$("monitor").addEventListener("click", () => {
  const baseUrl = $("baseUrl").value.replace(/\/$/, "");
  const key = $("key").value;
  const movieTitle = $("movieTitle").value.trim();
  const format = $("format").value.trim() || "2D";
  const monitorStatus = $("monitorStatus");
  monitorStatus.className = "";
  if (!activeTab?.id || !activeTab.url?.startsWith("https://")) {
    monitorStatus.textContent = "Open the normal BookMyShow or District movie showtime page first.";
    return;
  }
  if (!baseUrl || !key || !movieTitle) {
    monitorStatus.textContent = "Enter the Notificket URL, extension key, and movie title first.";
    return;
  }
  chrome.storage.local.set({ baseUrl, key });
  chrome.runtime.sendMessage({
    type: "enable-watch",
    watch: {
      tabId: activeTab.id,
      urlPrefix: activeTab.url.split("?")[0],
      baseUrl,
      key,
      movieTitle,
      format,
      lastCheckedAt: null,
      lastMessage: "Monitoring enabled. The first automatic check follows the next page refresh.",
    },
  }, (result) => {
    if (!result?.ok) { monitorStatus.textContent = "Could not enable monitoring."; return; }
    $("monitor").textContent = "Automatic monitoring enabled";
    monitorStatus.className = "ok";
    monitorStatus.textContent = result.message || "Enabled. Keep this ticketing tab open; it will refresh and sync every 15 minutes.";
  });
});
