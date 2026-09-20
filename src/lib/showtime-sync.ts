import { prisma } from "./db";
import { normalizeName } from "./api-helpers";
import { matchShowtimeAgainstRequests } from "./matching";

const CITY = "Hyderabad";
const TOI_CITY_SLUG = "hyderabad";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_SERP_KEY = "gt_live_553d3b6148d2d13e60d97ef9b5d5019630712fd1";

function parseTo12hTo24h(timeStr: string): string | null {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const min = match[2];
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${min}`;
}

function extractLanguageFromUrl(url: string): string | null {
  const match = url.match(/\/entertainment\/([a-z]+)\/movie-details\//i);
  if (!match) return null;
  const slug = match[1].toLowerCase();
  const map: Record<string, string> = {
    telugu: "Telugu",
    hindi: "Hindi",
    english: "English",
    tamil: "Tamil",
    kannada: "Kannada",
    malayalam: "Malayalam",
    marathi: "Marathi",
    bengali: "Bengali",
  };
  return map[slug] || null;
}

export async function findToiShowtimeUrls(
  movieTitle: string,
  movieLanguage?: string,
  serpKey?: string,
): Promise<string[]> {
  const key = serpKey || process.env.SERP_SEARCH_API_KEY || DEFAULT_SERP_KEY;
  const queries = [
    `${movieTitle} movie show time in ${CITY}`,
    ...(movieLanguage ? [`${movieTitle} ${movieLanguage} movie showtimes ${CITY}`] : []),
    ...(movieLanguage !== "Telugu" ? [`${movieTitle} Telugu movie showtimes ${CITY}`] : []),
    `${movieTitle} movie showtimes ${CITY} site:timesofindia.indiatimes.com`,
  ];

  const foundUrls: string[] = [];

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
      for (const r of organic) {
        if (
          r.url?.includes("timesofindia.indiatimes.com") &&
          r.url?.includes("movie-showtimes") &&
          r.url?.toLowerCase().includes(TOI_CITY_SLUG)
        ) {
          if (!foundUrls.includes(r.url)) {
            foundUrls.push(r.url);
          }
        }
      }
      if (foundUrls.length >= 3) break;
    } catch {
      // Continue to next query
    } finally {
      clearTimeout(timeout);
    }
  }
  return foundUrls;
}

// Kept for backward compatibility
export async function findToiShowtimeUrl(
  movieTitle: string,
  movieLanguage?: string,
  serpKey?: string,
): Promise<string | null> {
  const urls = await findToiShowtimeUrls(movieTitle, movieLanguage, serpKey);
  return urls[0] || null;
}

export type ScrapedShowtime = {
  theatreName: string;
  date: string;
  time: string;
  format: string;
  language: string | null;
};

export async function scrapeToiShowtimes(toiUrl: string, fallbackLang?: string): Promise<ScrapedShowtime[]> {
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

    const urlLang = extractLanguageFromUrl(toiUrl) || fallbackLang || null;
    let pageDate = new Date().toISOString().slice(0, 10);
    const jsonLdDate = html.match(/"startDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/)?.[1];
    if (jsonLdDate) pageDate = jsonLdDate;

    const results: ScrapedShowtime[] = [];
    const seen = new Set<string>();

    // 1. Primary: Parse all <div class="trObj"> blocks from HTML body
    const trRegex = /<div class="trObj">([\s\S]*?)<\/div><\/div>/gi;
    let match: RegExpExecArray | null;

    while ((match = trRegex.exec(html)) !== null) {
      const block = match[1];
      const nameMatch = block.match(/^([^<]+)/);
      const theatreName = nameMatch ? nameMatch[1].trim() : "";
      if (!theatreName) continue;

      const smallMatch = block.match(/<small>([^<]*)<\/small>/i);
      const langFmt = smallMatch ? smallMatch[1].trim() : "";

      let language = urlLang;
      const lMatch = langFmt.match(/\b(Telugu|Hindi|English|Tamil|Kannada|Malayalam|Marathi|Bengali)\b/i);
      if (lMatch) language = lMatch[1];

      let format = "2D";
      if (/\bIMAX\b/i.test(langFmt) || /\bIMAX\b/i.test(theatreName)) format = "IMAX";
      else if (/\b4DX\b/i.test(langFmt) || /\b4DX\b/i.test(theatreName)) format = "4DX";
      else if (/\bScreenX\b/i.test(langFmt) || /\bScreenX\b/i.test(theatreName)) format = "ScreenX";
      else if (/\bDolby\b/i.test(langFmt) || /\bDolby\b/i.test(theatreName)) format = "Dolby Atmos";
      else if (/\b3D\b/i.test(langFmt) || /\b3D\b/i.test(theatreName)) format = "3D";

      const timeRegex = /<(?:span|a)[^>]*class="[^"]*timing_box[^"]*"[^>]*>([^<]+)<\/(?:span|a)>/gi;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = timeRegex.exec(block)) !== null) {
        const time24 = parseTo12hTo24h(tMatch[1]);
        if (time24) {
          const key = `${theatreName}|${pageDate}|${time24}|${format}|${language}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ theatreName, date: pageDate, time: time24, format, language });
          }
        }
      }
    }

    // 2. Fallback: Parse JSON-LD events if trObj gave 0 results
    if (results.length === 0) {
      const scriptPattern = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
      let sMatch: RegExpExecArray | null;
      while ((sMatch = scriptPattern.exec(html)) !== null) {
        try {
          const json = JSON.parse(sMatch[1]) as {
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

          let format = "2D";
          if (/\bIMAX\b/i.test(theatreName)) format = "IMAX";
          else if (/\b4DX\b/i.test(theatreName)) format = "4DX";
          else if (/\b3D\b/i.test(theatreName)) format = "3D";

          const key = `${theatreName}|${date}|${time}|${format}|${urlLang}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ theatreName, date, time, format, language: urlLang });
          }
        } catch {}
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

export async function syncMovieShowtimes(
  movieId: string,
  movieTitle: string,
  movieLanguage?: string,
): Promise<number> {
  // Ensure Hyderabad location exists
  let location = await prisma.location.findFirst({ where: { name: CITY } });
  if (!location) {
    location = await prisma.location.create({ data: { name: CITY } });
  }

  // 1. Discover all TOI showtimes URLs (could be multiple languages)
  const toiUrls = await findToiShowtimeUrls(movieTitle, movieLanguage);
  if (toiUrls.length === 0) {
    console.warn(`[showtime-sync] No TOI showtimes URL discovered for ${movieTitle}`);
    return 0;
  }

  let totalAdded = 0;
  const formatCache = new Map<string, { id: string; name: string }>();

  async function getOrCreateFormat(name: string) {
    if (formatCache.has(name)) return formatCache.get(name)!;
    const fmt = await prisma.format.upsert({ where: { name }, update: {}, create: { name } });
    formatCache.set(name, fmt);
    return fmt;
  }

  const existingTheatres = await prisma.theatre.findMany({ where: { locationId: location.id } });

  for (const toiUrl of toiUrls) {
    const showtimes = await scrapeToiShowtimes(toiUrl, movieLanguage);
    if (showtimes.length === 0) continue;

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
            language: item.language || movieLanguage || null,
            date,
            time: item.time,
          },
        });
        try {
          await matchShowtimeAgainstRequests(created.id);
        } catch (matchErr) {
          console.warn("[showtime-sync] Match error:", matchErr);
        }
        totalAdded++;
      } else if (!existing.language && item.language) {
        // Backfill language on existing showtime
        await prisma.showtime.update({
          where: { id: existing.id },
          data: { language: item.language },
        });
      }
    }
  }

  // Mark movie as RUNNING
  await prisma.movie.update({
    where: { id: movieId },
    data: { status: "RUNNING" },
  });

  console.log(`[showtime-sync] ${movieTitle}: added ${totalAdded} new showtimes across ${toiUrls.length} pages`);
  return totalAdded;
}