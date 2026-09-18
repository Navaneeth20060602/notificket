import { chromium } from "playwright-core";
import { prisma } from "../lib/db";
import { matchShowtimeAgainstRequests } from "../lib/matching";
import { normalizeName } from "../lib/api-helpers";
import { syncMovieShowtimes } from "../lib/showtime-sync";

type VisibleShowtime = { theatreName: string; time: string; date: string; format: string };
const CHECK_EVERY_MINUTES = Number(process.env.MONITOR_INTERVAL_MINUTES || 20);
const MAX_JOBS_PER_CYCLE = Number(process.env.MONITOR_MAX_JOBS_PER_CYCLE || 3);
const nextCheck = (minutes = CHECK_EVERY_MINUTES) => new Date(Date.now() + minutes * 60_000);

async function discoverBookMyShowUrl(title: string) {
  // Use BookMyShow's public website flow instead of a search-engine result.
  // Search results commonly point to a stale movie-info or multimedia page,
  // while the site's visible “Book tickets” action resolves the correct
  // city/language-specific ET code (for example Sardar 2 Telugu).
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({ locale: "en-IN", timezoneId: "Asia/Kolkata" });
    await page.goto("https://in.bookmyshow.com/explore/movies-hyderabad", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(700);
    const initialText = ((await page.title()) + " " + (await page.locator("body").innerText().catch(() => "")).slice(0, 800)).toLowerCase();
    if (/captcha|access denied|just a moment/.test(initialText)) throw new Error("Ticketing site requested verification; monitoring backed off without bypassing it.");

    await page.getByRole("button", { name: "Search for Movies, Events, Plays, Sports and Activities" }).click({ timeout: 8_000 });
    const searchBox = page.locator("input:visible, [role='textbox']:visible").first();
    await searchBox.fill(title, { timeout: 8_000 });
    await page.waitForTimeout(900);
    const result = page.getByText(title, { exact: true }).first();
    if (!(await result.isVisible().catch(() => false))) return null;
    await result.click({ timeout: 8_000 });
    await page.waitForTimeout(700);
    const bookTickets = page.getByText("Book tickets", { exact: true }).first();
    if (!(await bookTickets.isVisible().catch(() => false))) return null;
    await bookTickets.click({ timeout: 8_000 });
    await page.waitForTimeout(1_000);
    return /\/buytickets\//i.test(page.url()) ? page.url() : null;
  } finally {
    await browser.close();
  }
}

function dateFromUrl(url: string) {
  const compact = new URL(url).pathname.match(/\/(20\d{6})(?:\/|$)/)?.[1];
  return compact ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : null;
}

function dateFromLabel(label: string) {
  const match = label.toUpperCase().match(/\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\w*\b/);
  if (!match) return null;
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(match[2]);
  if (month < 0) return null;
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month, Number(match[1]));
  // A ticketing page never offers dates long in the past; a January strip
  // viewed in December belongs to the following year.
  if (candidate.getTime() < new Date(year, now.getMonth(), now.getDate() - 2).getTime()) year++;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
}

type ScanResult = {
  showtimes: VisibleShowtime[];
  finalUrl: string;
  visibleTimeCount: number;
  looksLikeBookingPage: boolean;
};

async function scanTicketPage(sourceUrl: string): Promise<ScanResult> {
  // Normal Chromium only: no CAPTCHA solving, proxy rotation, or site-control bypass.
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ locale: "en-IN", timezoneId: "Asia/Kolkata" });
    // Establish an ordinary Hyderabad browsing context before opening the
    // booking URL. This is navigation, not a bypass of a challenge or access
    // control, and lets BookMyShow apply the city normally.
    await page.goto("https://in.bookmyshow.com/explore/home/hyderabad", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2_000);
    const pageText = ((await page.title()) + " " + (await page.locator("body").innerText().catch(() => "")).slice(0, 600)).toLowerCase();
    if (/captcha|access denied|just a moment/.test(pageText)) throw new Error("Ticketing site requested verification; monitoring backed off without bypassing it.");

    const selector = "button, a, [role='button'], [tabindex]";
    const controls = await page.locator(selector).evaluateAll((nodes) => nodes.map((node, index) => ({ index, label: (node.textContent || "").replace(/\s+/g, " ").trim(), visible: node instanceof HTMLElement && node.offsetParent !== null }))
      .filter(({ label, visible }) => visible && label.length <= 36 && /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\w*\b/i.test(label) && /\b\d{1,2}\b/.test(label)));
    const dates = controls.length ? controls.slice(0, 14) : [{ index: -1, label: "current" }];
    const shows: VisibleShowtime[] = [];
    let visibleTimeCount = 0;

    for (const control of dates) {
      if (control.index >= 0) {
        await page.locator(selector).nth(control.index).click({ timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(1_200);
      }
      const date = dateFromUrl(page.url()) || dateFromLabel(control.label);
      if (!date) continue;
      const found = await page.locator("body").evaluate((body) => {
        const timeGlobal = /\b(?:(?:1[0-2]|0?[1-9]):[0-5]\d\s?(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)\b/gi;
        const timeOne = /\b(?:(?:1[0-2]|0?[1-9]):[0-5]\d\s?(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)\b/i;
        const venueHint = /(cinema|theatre|theater|multiplex|pvr|inox|cinepolis|screens?|70mm|a\/c|dts|:)/i;
        const output: { theatreName: string; time: string }[] = [];
        const allTimes = new Set<string>();

        // BookMyShow currently marks every cinema card with a public cinema
        // link. Its alt text is the theatre name. Stop at the first ancestor
        // that holds exactly one such link, so times cannot spill into the
        // following theatre card in the virtualized list.
        for (const cinema of body.querySelectorAll("a[href*='/cinemas/']")) {
          if (!(cinema instanceof HTMLElement) || cinema.offsetParent === null) continue;
          const theatreName = cinema.getAttribute("alt")?.trim();
          if (!theatreName) continue;
          let card: HTMLElement | null = cinema;
          while (card && card !== body) {
            const currentCard: HTMLElement = card;
            card = currentCard.parentElement;
            const cardText = (currentCard.innerText || currentCard.textContent || "").replace(/\s+/g, " ").trim();
            if (currentCard.querySelectorAll("a[href*='/cinemas/']").length !== 1 || !timeOne.test(cardText)) continue;
            for (const time of cardText.match(timeGlobal) || []) {
              const normalizedTime = time.toUpperCase().replace(/\s/g, "");
              allTimes.add(normalizedTime);
              output.push({ theatreName, time: normalizedTime });
            }
            break;
          }
        }

        // Fallback for a future layout which does not expose cinema links.
        if (output.length === 0) {
        for (const node of body.querySelectorAll("button, a, [role='button'], div, span")) {
          if (!(node instanceof HTMLElement) || node.offsetParent === null) continue;
          const own = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
          if (!timeOne.test(own) || own.length > 150) continue;
          for (const time of own.match(timeGlobal) || []) allTimes.add(time.toUpperCase().replace(/\s/g, ""));
          let venue = "";
          for (let parent: HTMLElement | null = node; parent && parent !== body; parent = parent.parentElement) {
            // Keep this logic inline: Playwright serializes the evaluate
            // callback into the remote page, where TypeScript's generated
            // helper names for nested functions do not exist.
            const raw = (parent.innerText || parent.textContent || "").replace(/\u00a0/g, " ").trim();
            const lines = raw.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
            const separateLine = lines.find((line) => !timeOne.test(line) && line.length >= 4 && line.length <= 140 && venueHint.test(line));
            if (separateLine) venue = separateLine;
            else {
              const firstTime = raw.search(timeOne);
              if (firstTime > 3) {
                const prefix = raw.slice(0, firstTime).replace(/\s+/g, " ").trim();
                if (prefix.length >= 4 && prefix.length <= 160 && !/^(movies|price range|language|format|date|showtimes?)$/i.test(prefix)) venue = prefix;
              }
            }
            if (venue) break;
          }
          for (const time of own.match(timeGlobal) || []) if (venue) output.push({ theatreName: venue, time: time.toUpperCase().replace(/\s/g, "") });
        }
        }
        return { output, visibleTimeCount: allTimes.size };
      });
      visibleTimeCount = Math.max(visibleTimeCount, found.visibleTimeCount);
      shows.push(...found.output.map((item) => ({ ...item, date, format: "2D" })));
    }
    const deduped = new Map(shows.map((show) => [`${normalizeName(show.theatreName)}|${show.date}|${show.time}`, show]));
    return {
      showtimes: [...deduped.values()].slice(0, 250),
      finalUrl: page.url(),
      visibleTimeCount,
      looksLikeBookingPage: /\/buytickets\//i.test(page.url()),
    };
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
      const fastAdded = await syncMovieShowtimes(job.movieId, job.movie.title);
      if (fastAdded > 0) {
        added += fastAdded;
        await prisma.monitorJob.update({
          where: { id: job.id },
          data: {
            lastCheckedAt: new Date(),
            nextCheckAt: nextCheck(),
            failureCount: 0,
            lastMessage: `Showtimes synced successfully; ${fastAdded} new entries added.`,
          },
        });
        continue;
      }

      const discoveredUrl = job.sourceUrl || await discoverBookMyShowUrl(job.movie.title);
      if (!discoveredUrl) {
        console.warn(`[monitor] ${job.movie.title}: no matching Hyderabad ticket page found.`);
        await prisma.monitorJob.update({ where: { id: job.id }, data: { lastCheckedAt: new Date(), nextCheckAt: nextCheck(180), failureCount: { increment: 1 }, lastMessage: "No matching Hyderabad ticket page found; will search again later." } });
        continue;
      }
      const sourceUrl = discoveredUrl;
      const scan = await scanTicketPage(sourceUrl);
      const newlyAdded = await saveShowtimes(job, scan.showtimes); added += newlyAdded;
      console.log(`[monitor] ${job.movie.title}: bookingPage=${scan.looksLikeBookingPage} visibleTimes=${scan.visibleTimeCount} scanned=${scan.showtimes.length} added=${newlyAdded} url=${scan.finalUrl}`);
      const noRowsMessage = scan.visibleTimeCount === 0
        ? "The discovered page had no visible showtime buttons; it will be rediscovered next cycle."
        : "Showtime buttons were visible but no theatre rows could be identified; will retry.";
      await prisma.monitorJob.update({ where: { id: job.id }, data: { sourceUrl: scan.showtimes.length ? sourceUrl : null, lastCheckedAt: new Date(), nextCheckAt: nextCheck(), failureCount: 0, lastMessage: scan.showtimes.length ? `${scan.showtimes.length} visible showtimes scanned; ${newlyAdded} new entries added.` : noRowsMessage } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected monitor failure.";
      console.warn(`[monitor] ${job.movie.title}: ${message}`);
      await prisma.monitorJob.update({ where: { id: job.id }, data: { lastCheckedAt: new Date(), nextCheckAt: nextCheck(Math.min(720, 30 * Math.max(1, job.failureCount + 1))), failureCount: { increment: 1 }, lastMessage: message } });
    }
  }
  return { tracked: tracked.length, running: runningMovieCount, checked: jobs.length, added };
}
