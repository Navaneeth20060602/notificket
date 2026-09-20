import { prisma } from "./db";
import { normalizeName } from "./api-helpers";
import { matchShowtimeAgainstRequests } from "./matching";

const CITY = "Hyderabad";
const TOI_CITY_SLUG = "hyderabad";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_SERP_KEY = "gt_live_553d3b6148d2d13e60d97ef9b5d5019630712fd1";

export async function findToiShowtimeUrl(movieTitle: string, movieLanguage?: string, serpKey?: string): Promise<string | null> {
  const key = serpKey || process.env.SERP_SEARCH_API_KEY || DEFAULT_SERP_KEY;
  const queries = [
    `${movieTitle} movie show time in ${CITY}`,
    ...(movieLanguage ? [`${movieTitle} ${movieLanguage} movie showtimes ${CITY}`] : []),
    `${movieTitle} movie showtimes ${CITY} site:timesofindia.indiatimes.com`,
  ];

  for (const query of queries) {
    const params = new URLSearchParams({
      query,
      location: `${CITY}, Telangana, India`,
      gl: "in",
      hl: "en",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(`https://api.serpsearch.com/api/v1/search?${params}`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { organic_results?: { url?: string }[] };
      const organic = data.organic_results || [];
      const found = organic.find(
        (r) =>
          r.url?.includes("timesofindia.indiatimes.com") &&
          r.url?.includes("movie-showtimes") &&
          r.url?.toLowerCase().includes(TOI_CITY_SLUG),
      );
      if (found?.url) return found.url;
    } catch {
      // Continue to next query
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

function guessFormat(name: string): string {
  if (/\b4DX\b/i.test(name)) return "4DX";
  if (/\bIMAX\b/i.test(name)) return "IMAX";
  if (/\bScreenX\b/i.test(name)) return "ScreenX";
  if (/\bDolby\s*Atmos\b/i.test(name)) return "Dolby Atmos";
  if (/\b3D\b/i.test(name)) return "3D";
  return "2D";
}

export type ScrapedShowtime = { theatreName: string; date: string; time: string; format: string };

export async function scrapeToiShowtimes(toiUrl: string): Promise<ScrapedShowtime[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(toiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();

    const scriptPattern = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    const results: ScrapedShowtime[] = [];
    let match: RegExpExecArray | null;

    while ((match = scriptPattern.exec(html)) !== null) {
      try {
        const json = JSON.parse(match[1]) as {
          "@type"?: string;
          startDate?: string;
          location?: { name?: string };
        };
        if (json["@type"] !== "Event" || !json.startDate || !json.location?.name) continue;

        const dt = new Date(json.startDate);
        if (Number.isNaN(dt.valueOf())) continue;

        const date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
        const time = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
        const theatreName = json.location.name.trim();
        results.push({ theatreName, date, time, format: guessFormat(theatreName) });
      } catch {
        // Skip invalid JSON-LD
      }
    }
    return results;
  } catch (err) {
    console.warn("[showtime-sync] Failed to scrape TOI showtimes:", err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function syncMovieShowtimes(movieId: string, movieTitle: string, movieLanguage?: string): Promise<number> {
  // Ensure Hyderabad location exists
  let location = await prisma.location.findFirst({ where: { name: CITY } });
  if (!location) {
    location = await prisma.location.create({ data: { name: CITY } });
  }

  // 1. Discover TOI showtimes URL
  const toiUrl = await findToiShowtimeUrl(movieTitle, movieLanguage);
  if (!toiUrl) {
    console.warn(`[showtime-sync] No TOI showtimes URL discovered for ${movieTitle}`);
    return 0;
  }

  // 2. Scrape showtime events
  const showtimes = await scrapeToiShowtimes(toiUrl);
  if (showtimes.length === 0) {
    console.log(`[showtime-sync] ${movieTitle}: no active Hyderabad showtimes listed on TOI`);
    return 0;
  }

  // 3. Persist showtimes to database
  let added = 0;
  const formatCache = new Map<string, { id: string; name: string }>();

  async function getOrCreateFormat(name: string) {
    if (formatCache.has(name)) return formatCache.get(name)!;
    const fmt = await prisma.format.upsert({ where: { name }, update: {}, create: { name } });
    formatCache.set(name, fmt);
    return fmt;
  }

  const existingTheatres = await prisma.theatre.findMany({ where: { locationId: location.id } });

  for (const item of showtimes) {
    const date = new Date(`${item.date}T00:00:00`);
    if (!/^\d{2}:\d{2}$/.test(item.time) || Number.isNaN(date.valueOf())) continue;

    let theatre = existingTheatres.find(
      (t) => normalizeName(t.name) === normalizeName(item.theatreName),
    );
    if (!theatre) {
      theatre = await prisma.theatre.create({
        data: { name: item.theatreName, locationId: location.id },
      });
      existingTheatres.push(theatre);
    }

    const format = await getOrCreateFormat(item.format || "2D");

    const existing = await prisma.showtime.findUnique({
      where: {
        movieId_theatreId_formatId_date_time: {
          movieId,
          theatreId: theatre.id,
          formatId: format.id,
          date,
          time: item.time,
        },
      },
    });

    if (!existing) {
      const created = await prisma.showtime.create({
        data: {
          movieId,
          theatreId: theatre.id,
          formatId: format.id,
          date,
          time: item.time,
        },
      });
      try {
        await matchShowtimeAgainstRequests(created.id);
      } catch (matchErr) {
        console.warn("[showtime-sync] Match error:", matchErr);
      }
      added++;
    }
  }

  // Mark movie as RUNNING
  await prisma.movie.update({
    where: { id: movieId },
    data: { status: "RUNNING" },
  });

  console.log(`[showtime-sync] ${movieTitle}: added ${added} new showtimes (out of ${showtimes.length} scraped)`);
  return added;
}
