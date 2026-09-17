const TIME_PATTERN = /\b(?:(?:1[0-2]|0?[1-9]):[0-5]\d\s?(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)\b/i;
const TIME_GLOBAL_PATTERN = /\b(?:(?:1[0-2]|0?[1-9]):[0-5]\d\s?(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)\b/gi;
const NON_VENUE = /^(?:non-?cancell?able|cancellation available|m-?ticket|food \& beverages|barco|dolby|laser|recliner|\d+d|\d+k|\d+\s*(?:seats?|left)|(?:late night|early morning) shows?)$/i;

function isVisible(element) {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && element.getClientRects().length > 0;
}

function linesFor(element) {
  return (element.innerText || element.textContent || "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function likelyVenue(lines) {
  // A BookMyShow theatre card puts its venue name before its showtime buttons.
  // This intentionally does not use a fixed chain-name list: independent cinemas work too.
  return lines.find((line) => {
    if (TIME_PATTERN.test(line) || NON_VENUE.test(line) || line.length < 4 || line.length > 140) return false;
    if (!/[a-z]/i.test(line) || !/^[\w&'().,:/\-\s]+$/i.test(line)) return false;
    return /(cinema|theatre|theater|multiplex|pvr|inox|cinepolis|screens?|70mm|a\/c|dts|:)/i.test(line);
  }) || null;
}

function extractShowtimes() {
  const found = [];
  // We inspect only already-rendered page text. No ticketing request is made from the extension.
  for (const element of document.querySelectorAll("button, a, [role='button'], div, span")) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
    const ownText = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    if (!TIME_PATTERN.test(ownText) || ownText.length > 90) continue;

    let theatreName = null;
    for (let parent = element; parent && parent !== document.body; parent = parent.parentElement) {
      theatreName = likelyVenue(linesFor(parent));
      if (theatreName) break;
    }
    if (!theatreName) continue;

    for (const time of ownText.match(TIME_GLOBAL_PATTERN) || []) {
      found.push({ theatreName, time: time.toUpperCase().replace(/\s/g, "") });
    }
  }

  const seen = new Set();
  return found.filter((item) => {
    const key = `${item.theatreName.toLowerCase()}|${item.time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 150);
}

function selectedDate() {
  // BookMyShow includes the selected ticket date in the URL, for example /20260918.
  // This is more reliable than the visual date picker and avoids using the computer's date.
  const compactDate = location.pathname.match(/\/(20\d{6})(?:\/|$)/)?.[1];
  if (compactDate) return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
  return null;
}

const MONTH_PATTERN = /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:UARY|RUARY|CH|IL|E|Y|UST|TEMBER|OBER|EMBER)?\b/i;

function normalText(element) {
  return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
}

function dateControls() {
  const seen = new Set();
  return [...document.querySelectorAll("button, a, [role='button'], [tabindex], div")]
    .filter((element) => element instanceof HTMLElement && isVisible(element))
    .map((element) => ({ element, label: normalText(element) }))
    .filter(({ label }) => label.length <= 36 && MONTH_PATTERN.test(label) && /\b\d{1,2}\b/.test(label))
    .filter(({ label }) => {
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function scanAvailableDates() {
  // BookMyShow shows a finite date strip. We use it exactly as a person would:
  // select each date already offered on the page, wait for its theatre rows,
  // then read those visible rows. Future checks see newly opened dates.
  const labels = dateControls().map((entry) => entry.label);
  const scans = [];
  for (const label of labels) {
    const control = dateControls().find((entry) => entry.label === label)?.element;
    if (!control) continue;
    control.click();
    await wait(1300);
    const date = selectedDate();
    const showtimes = extractShowtimes();
    if (date && showtimes.length) scans.push({ date, showtimes });
  }
  return scans;
}

async function respondToScan(sendResponse) {
  const heading = document.querySelector("h1")?.textContent?.trim();
  const title = (heading || document.title).replace(/\s*-\s*\([^)]*\)\s*$/, "").replace(/\s+Movie\s+Showtimes\s+in\s+.+$/i, "").replace(/\s*[-|].*$/, "").trim();
  const scans = await scanAvailableDates();
  sendResponse({ title, scans, url: location.href });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "scan-available-dates") {
    respondToScan(sendResponse).catch(() => sendResponse({ title: "", scans: [], url: location.href }));
    return true;
  }
  if (message.type !== "extract-showtimes") return;
  const heading = document.querySelector("h1")?.textContent?.trim();
  const title = (heading || document.title).replace(/\s*-\s*\([^)]*\)\s*$/, "").replace(/\s+Movie\s+Showtimes\s+in\s+.+$/i, "").replace(/\s*[-|].*$/, "").trim();
  sendResponse({ title, date: selectedDate(), showtimes: extractShowtimes(), url: location.href });
});
