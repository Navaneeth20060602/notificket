import { chromium } from "playwright-core";
import { prisma } from "../lib/db";
import { matchShowtimeAgainstRequests } from "../lib/matching";
import { normalizeName } from "../lib/api-helpers";

type VisibleShowtime = { theatreName: string; time: string; date: string; format: string };
const CHECK_EVERY_MINUTES = Number(process.env.MONITOR_INTERVAL_MINUTES || 20);
const MAX_JOBS_PER_CYCLE = Number(process.env.MONITOR_MAX_JOBS_PER_CYCLE || 3);
const nextCheck = (minutes = CHECK_EVERY_MINUTES) => new Date(Date.now() + minutes * 60_000);

function extractUrls(value: unknown, found = new Set<string>()): string[] {
  if (typeof value === "string" && /^https:\/\/in\.bookmyshow\.com\/movies\/hyderabad\//i.test(value)) found.add(value);
  else if (Array.isArray(value)) value.forEach((entry) => extractUrls(entry, found));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => extractUrls(entry, found));
  return [...found];
}

async function discoverBookMyShowUrl(title: string) {
  const key = process.env.SERP_SEARCH_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const query = `${title} Hyderabad site:in.bookmyshow.com/movies/hyderabad`;
    const response = await fetch(`https://api.serpsearch.com/api/v1/search?${new URLSearchParams({ query, gl: "in", hl: "en" })}`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: controller.signal });
    if (!response.ok) return null;
    const urls = extractUrls(await response.json());
    const slug = normalizeName(title).replace(/\s+/g, "-");
    return urls.find((url) => normalizeName(url).includes(slug)) || urls[0] || null;
  } catch { return null; } finally { clearTimeout(timeout); }
}

function dateFromUrl(url: string) {
  const compact = new URL(url).pathname.match(/\/(20\d{6})(?:\/|$)/)?.[1];
  return compact ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : null;
}

async function scanTicketPage(sourceUrl: string) {
  // Normal Chromium only: no CAPTCHA solving, proxy rotation, or site-control bypass.
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ locale: "en-IN", timezoneId: "Asia/Kolkata" });
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2_000);
    const pageText = ((await page.title()) + " " + (await page.locator("body").innerText().catch(() => "")).slice(0, 600)).toLowerCase();
    if (/captcha|access denied|just a moment/.test(pageText)) throw new Error("Ticketing site requested verification; monitoring backed off without bypassing it.");

    const selector = "button, a, [role='button'], [tabindex]";
    const controls = await page.locator(selector).evaluateAll((nodes) => nodes.map((node, index) => ({ index, label: (node.textContent || "").replace(/\s+/g, " ").trim(), visible: node instanceof HTMLElement && node.offsetParent !== null }))
      .filter(({ label, visible }) => visible && label.length <= 36 && /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\w*\b/i.test(label) && /\b\d{1,2}\b/.test(label)));
    const dates = controls.length ? controls.slice(0, 14) : [{ index: -1, label: "current" }];
    const shows: VisibleShowtime[] = [];

    for (const control of dates) {
      if (control.index >= 0) {
        await page.locator(selector).nth(control.index).click({ timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(1_200);
      }
      const date = dateFromUrl(page.url());
      if (!date) continue;
      const found = await page.locator("body").evaluate((body) => {
        const timeGlobal = /\b(?:(?:1[0-2]|0?[1-9]):[0-5]\d\s?(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)\b/gi;
        const timeOne = /\b(?:(?:1[0-2]|0?[1-9]):[0-5]\d\s?(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)\b/i;
        const venueHint = /(cinema|theatre|theater|multiplex|pvr|inox|cinepolis|screens?|70mm|a\/c|dts|:)/i;
        const output: { theatreName: string; time: string }[] = [];
        for (const node of body.querySelectorAll("button, a, [role='button'], div, span")) {
          if (!(node instanceof HTMLElement) || node.offsetParent === null) continue;
          const own = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
          if (!timeOne.test(own) || own.length > 90) continue;
          let venue = "";
          for (let parent: HTMLElement | null = node; parent && parent !== body; parent = parent.parentElement) {
            const lines = (parent.innerText || "").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
            venue = lines.find((line) => !timeOne.test(line) && line.length >= 4 && line.length <= 140 && venueHint.test(line)) || "";
            if (venue) break;
          }
          for (const time of own.match(timeGlobal) || []) if (venue) output.push({ theatreName: venue, time: time.toUpperCase().replace(/\s/g, "") });
        }
        return output;
      });
      shows.push(...found.map((item) => ({ ...item, date, format: "2D" })));
    }
    const deduped = new Map(shows.map((show) => [`${normalizeName(show.theatreName)}|${show.date}|${show.time}`, show]));
    return [...deduped.values()].slice(0, 250);
  } finally { await browser.close(); }
}

async function saveShowtimes(job: { movieId: string; locationId: string }, showtimes: VisibleShowtime[]) {
  let added = 0;
  for (const item of showtimes) {
    const date = new Date(`${item.date}T00:00:00`);
    const amPm = item.time.match(/^(\d{1,2}):(\d{2})(AM|PM)$/);
    let time = item.time;
    if (amPm) { let hour = Number(amPm[1]); if (amPm[3] === "PM" && hour < 12) hour += 12; if (amPm[3] === "AM" && hour === 12) hour = 0; time = `${String(hour).padStart(2, "0")}:${amPm[2]}`; }
    if (!/^\d{2}:\d{2}$/.test(time) || Number.isNaN(date.valueOf())) continue;
    const existingTheatres = await prisma.theatre.findMany({ where: { locationId: job.locationId } });
    const theatre = existingTheatres.find((entry) => normalizeName(entry.name) === normalizeName(item.theatreName)) || await prisma.theatre.create({ data: { name: item.theatreName, locationId: job.locationId } });
    const format = await prisma.format.upsert({ where: { name: item.format || "2D" }, update: {}, create: { name: item.format || "2D" } });
    const exists = await prisma.showtime.findUnique({ where: { movieId_theatreId_formatId_date_time: { movieId: job.movieId, theatreId: theatre.id, formatId: format.id, date, time } } });
    if (exists) continue;
    const showtime = await prisma.showtime.create({ data: { movieId: job.movieId, theatreId: theatre.id, formatId: format.id, date, time } });
    await prisma.movie.update({ where: { id: job.movieId }, data: { status: "RUNNING" } });
    await matchShowtimeAgainstRequests(showtime.id);
    added++;
  }
  return added;
}

export async function pollAllTrackedMovies() {
  const tracked = await prisma.request.findMany({ where: { status: "ACTIVE" }, select: { movieId: true, locationId: true }, distinct: ["movieId", "locationId"] });
  for (const target of tracked) if (target.locationId) await prisma.monitorJob.upsert({ where: { movieId_locationId: { movieId: target.movieId, locationId: target.locationId } }, update: { status: "ACTIVE" }, create: { movieId: target.movieId, locationId: target.locationId, lastMessage: "Queued from an active ticket request." } });
  // Running movies are also kept current for Browse. This is intentionally
  // limited to Hyderabad and processed in small batches below, so the worker
  // does not try to crawl an entire national catalogue in one burst.
  const hyderabad = await prisma.location.findFirst({ where: { name: "Hyderabad" }, select: { id: true } });
  let runningMovieCount = 0;
  if (hyderabad) {
    const runningMovies = await prisma.movie.findMany({ where: { status: "RUNNING" }, select: { id: true } });
    runningMovieCount = runningMovies.length;
    for (const movie of runningMovies) {
      await prisma.monitorJob.upsert({
        where: { movieId_locationId: { movieId: movie.id, locationId: hyderabad.id } },
        // Do not overwrite nextCheckAt: staggered due times keep the shared
        // worker within its conservative request budget.
        update: { status: "ACTIVE" },
        create: { movieId: movie.id, locationId: hyderabad.id, lastMessage: "Queued for Hyderabad running-movie catalogue sync." },
      });
    }
  }
  const jobs = await prisma.monitorJob.findMany({ where: { status: "ACTIVE", nextCheckAt: { lte: new Date() } }, include: { movie: true }, orderBy: { nextCheckAt: "asc" }, take: MAX_JOBS_PER_CYCLE });
  let added = 0;
  for (const job of jobs) {
    try {
      const sourceUrl = job.sourceUrl || await discoverBookMyShowUrl(job.movie.title);
      if (!sourceUrl) { await prisma.monitorJob.update({ where: { id: job.id }, data: { lastCheckedAt: new Date(), nextCheckAt: nextCheck(180), failureCount: { increment: 1 }, lastMessage: "No matching Hyderabad ticket page found; will search again later." } }); continue; }
      const showtimes = await scanTicketPage(sourceUrl);
      const newlyAdded = await saveShowtimes(job, showtimes); added += newlyAdded;
      await prisma.monitorJob.update({ where: { id: job.id }, data: { sourceUrl, lastCheckedAt: new Date(), nextCheckAt: nextCheck(), failureCount: 0, lastMessage: `${showtimes.length} visible showtimes scanned; ${newlyAdded} new entries added.` } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected monitor failure.";
      await prisma.monitorJob.update({ where: { id: job.id }, data: { lastCheckedAt: new Date(), nextCheckAt: nextCheck(Math.min(720, 30 * Math.max(1, job.failureCount + 1))), failureCount: { increment: 1 }, lastMessage: message } });
    }
  }
  return { tracked: tracked.length, running: runningMovieCount, checked: jobs.length, added };
}
