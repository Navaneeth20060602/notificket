import { prisma } from "./db";
import { normalizeName } from "./api-helpers";
import { matchShowtimeAgainstRequests } from "./matching";

const CITY = "Hyderabad";
const TOI_CITY_SLUG = "hyderabad";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_SERP_KEY = ""; // no working fallback - SERP_SEARCH_API_KEY must be set in Railway

export type ScrapedShowtime = {
  theatreName: string;
  date: string;
  time: string;
  format: string;
  language: string | null;
  price?: number | null;
  seatsAvailable?: number | null;
  platform: "BMS" | "DISTRICT";
};

function parseTo24h(timeStr: string): string | null {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const min = match[2];
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${min}`;
}

function extractLanguageFromUrlOrText(str: string): string | null {
  const lMatch = str.match(/\b(Telugu|Hindi|English|Tamil|Kannada|Malayalam|Marathi|Bengali)\b/i);
  if (lMatch) return lMatch[1];
  return null;
}

// District has two page types per movie:
//   info page     /movies/<slug>-in-<city>-movie-tickets-MV<id>   (cast, reviews - NO showtimes)
//   booking page  /movies/<slug>-movie-tickets-in-<city>-MV<id>   (showtimes)
// Search results can return either, or the city-less form. Parse any of them.
const DISTRICT_CITIES = "delhi-ncr|bengaluru|mumbai|hyderabad|kolkata|chandigarh|ahmedabad|pune|chennai";
const DISTRICT_MOVIE_URL_RE = new RegExp(
  `^https?://(?:www\\.)?district\\.in/movies/([a-z0-9-]+?)-movie-tickets(?:-in-(?:${DISTRICT_CITIES}))?-(MV\\d+)(?:[/?#].*)?$`,
  "i",
);
function parseDistrictMovieUrl(url: string): { slug: string; mvId: string } | null {
  const m = url.match(DISTRICT_MOVIE_URL_RE);
  if (!m) return null; // city hubs, "cinemas-in-...", "upcoming-..." lists, etc.
  // Info-page form carries "-in-<city>" inside the slug; strip only known city suffixes
  // so titles like "sex-in-the-city" stay intact.
  const slug = m[1].toLowerCase().replace(new RegExp(`-in-(?:${DISTRICT_CITIES})$`), "");
  return { slug, mvId: m[2].toUpperCase() };
}
function districtBookingUrl(url: string, citySlug: string): string | null {
  const p = parseDistrictMovieUrl(url);
  return p ? `https://www.district.in/movies/${p.slug}-movie-tickets-in-${citySlug}-${p.mvId}` : null;
}

// Loose-but-safe title key for "is this page the movie we're tracking?".
// Exact match only (after case/punctuation/leading "The" are ignored): a wrong
// rejection shows up in the logs, a wrong acceptance silently corrupts showtimes.
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019`]/g, "") // "I'm" -> "im" (BookMyShow slug: im-game)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "")
    .replace(/ /g, ""); // "i m game" (District slug) and "im game" now compare equal
}

// Set SHOWTIME_DIAG=1 in the environment to dump District serverState shapes.
const DIAG = process.env.SHOWTIME_DIAG === "1";

// 1. Scrape BookMyShow via Jina Reader (bypasses Cloudflare cleanly without browser)
export async function scrapeBmsViaJina(
  buyticketsUrl: string,
  dateStr: string,
  detectedLanguage?: string | null,
): Promise<ScrapedShowtime[]> {
  try {
    const jinaUrl = `https://r.jina.ai/${buyticketsUrl}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35_000);

    const res = await fetch(jinaUrl, {
      headers: { Accept: "text/event-stream" },
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return [];
    const raw = await res.text();

    // Streaming mode sends the page as a series of growing snapshots as
    // BookMyShow's lazy-loaded theatre list keeps rendering - each "data:"
    // event is more complete than the last. The final event is the fully
    // loaded page (all theatres); non-streaming mode was returning the
    // very first, mostly-empty snapshot instead.
    const events = raw
      .split("\n\n")
      .map((e) => e.replace(/^data:\s?/, "").trim())
      .filter(Boolean);
    const text = events.length > 0 ? events[events.length - 1] : raw;
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    const results: ScrapedShowtime[] = [];
    let currentCinema: string | null = null;
    let currentCinemaLang: string | null = detectedLanguage || null;
    let currentFormat = "2D";
    let linesSinceCinema = 0;
    const timeRegex = /^(?:0?[1-9]|1[0-2]):[0-5]\d\s*(?:AM|PM)$/i;
    const priceRegex = /₹\s?(\d{2,4})/;
    const seatsRegex = /(\d{1,4})\s*seats?\s*(available|left)/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      linesSinceCinema++;

      if (line.includes("bookmyshow.com/cinemas/hyderabad/")) {
        const nextLine = lines[i + 1]
          ? lines[i + 1]
              .replace(/!\[Image[^\]]*\]/g, "")
              .replace(/\([^)]+\)/g, "")
              .trim()
          : "";
        if (nextLine && !nextLine.startsWith("http") && !nextLine.startsWith("!")) {
          currentCinema = nextLine;
          currentCinemaLang = extractLanguageFromUrlOrText(nextLine) || detectedLanguage || null;
          currentFormat = "2D";
          linesSinceCinema = 0;
          if (/\bIMAX\b/i.test(currentCinema)) currentFormat = "IMAX";
          else if (/\b4DX\b/i.test(currentCinema)) currentFormat = "4DX";
          else if (/\bATMOS\b/i.test(currentCinema) || /\bDolby\b/i.test(currentCinema))
            currentFormat = "Dolby Atmos";
        }
      } else if (timeRegex.test(line) && currentCinema) {
        if (linesSinceCinema > 25) continue;

        const time24 = parseTo24h(line);
        let fmt = currentFormat;
        const lookahead = lines.slice(i + 1, i + 5).join(" ");
        if (/\bIMAX\b/i.test(lookahead)) fmt = "IMAX";
        else if (/\b4DX\b/i.test(lookahead)) fmt = "4DX";
        else if (/\bATMOS\b/i.test(lookahead) || /\bDolby\b/i.test(lookahead)) fmt = "Dolby Atmos";
        else if (/\b3D\b/i.test(lookahead)) fmt = "3D";

        const priceMatch = lookahead.match(priceRegex);
        const seatsMatch = lookahead.match(seatsRegex);

        if (time24) {
          results.push({
            theatreName: currentCinema,
            date: dateStr,
            time: time24,
            format: fmt,
            language: currentCinemaLang,
            price: priceMatch ? Number(priceMatch[1]) : null,
            seatsAvailable: seatsMatch ? Number(seatsMatch[1]) : null,
            platform: "BMS",
          });
        }
      }
    }
    return results;
  } catch (err) {
    console.warn("[showtime-sync] BMS Jina scrape failed:", err);
    return [];
  }
}

// 2. Scrape District.in (Multi-language & Multi-date support)
export async function scrapeDistrictShowtimes(
  districtUrl: string,
  fallbackLang?: string | null,
  expectedTitle?: string | null,
): Promise<ScrapedShowtime[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    const res = await fetch(districtUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return [];
    const html = await res.text();
    const idx = html.indexOf('id="__NEXT_DATA__"');
    if (idx === -1) return [];
    const start = html.indexOf(">", idx) + 1;
    const end = html.indexOf("</script>", start);
    const data = JSON.parse(html.slice(start, end));

    const serverState = data.props?.pageProps?.data?.serverState;
    const movieContents = serverState?.movieContents || {};

    if (DIAG) {
      console.log(`[showtime-sync][DIAG] ${districtUrl} serverState keys:`, Object.keys(serverState || {}));
    }

    // Not a movie page with sessions (info-only page or a hub/listing page):
    // nothing to scrape, and no point spending extra requests on it.
    if (!Object.keys(movieContents).length && !Object.keys(serverState?.movieSessions || {}).length) {
      console.log(`[showtime-sync] skip ${districtUrl}: no session data (keys: ${Object.keys(serverState || {}).join(",") || "none"})`);
      return [];
    }

    // Identity gate: search results routinely surface other movies' pages
    // (similar titles, "now showing" links). Only accept the page if it is
    // actually the movie being tracked.
    if (expectedTitle) {
      const wanted = titleKey(expectedTitle);
      const pageTitles: string[] = Object.values(movieContents)
        .map((mc: any) => (typeof mc?.name === "string" ? mc.name : ""))
        .filter(Boolean);
      if (!pageTitles.some((t) => titleKey(t) === wanted)) {
        console.log(
          `[showtime-sync] skip ${districtUrl}: page is ${JSON.stringify(pageTitles)}, tracking "${expectedTitle}"`,
        );
        return [];
      }
    }

    // 1. Discover all languages and format groups from movieContents
    const langGroups: { language: string; fmtGrpId: string; number_of_sessions?: number }[] = [];
    for (const contentId of Object.keys(movieContents)) {
      const mc = movieContents[contentId];
      if (Array.isArray(mc?.languageFormatGroups)) {
        langGroups.push(...mc.languageFormatGroups);
      }
    }

    const results: ScrapedShowtime[] = [];
    const seen = new Set<string>();

    function extractFromMovieSessions(sessionsMap: any, groupLang: string) {
      if (!sessionsMap || typeof sessionsMap !== "object") return;
      for (const k of Object.keys(sessionsMap)) {
        const item = sessionsMap[k];
        const arranged = item?.arrangedSessions || (Array.isArray(item) ? item : []);
        for (const c of arranged) {
          const theatreName = (c.entityName || "").replace(/\s+/g, " ").trim();
          if (!theatreName) continue;
          for (const s of c.sessions || []) {
            if (!s.showTime || s.showTime.length < 16) continue;

            const rawDate = s.showTime.slice(0, 10); // "YYYY-MM-DD"
            const rawTime = s.showTime.slice(11, 16); // "HH:MM"
            const [y, mo, d] = rawDate.split("-").map(Number);
            const [h, mi] = rawTime.split(":").map(Number);
            if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) continue;

            // District's raw showTime is UTC - shift +5:30 to IST, by hand
            // (not via `new Date(s.showTime)`, which failed to parse this format).
            const totalMinutes = h * 60 + mi + 330;
            const dayOverflow = Math.floor(totalMinutes / 1440);
            const minutesInDay = totalMinutes % 1440;
            const istHour = Math.floor(minutesInDay / 60);
            const istMinute = minutesInDay % 60;

            const baseDate = new Date(Date.UTC(y, mo - 1, d));
            baseDate.setUTCDate(baseDate.getUTCDate() + dayOverflow);
            const date = baseDate.toISOString().slice(0, 10);
            const time = `${String(istHour).padStart(2, "0")}:${String(istMinute).padStart(2, "0")}`;

            let format = s.scrnFmt || "2D";
            if (/\bIMAX\b/i.test(theatreName)) format = "IMAX";
            else if (/\b4DX\b/i.test(theatreName)) format = "4DX";
            else if (/\bDolby\b/i.test(theatreName)) format = "Dolby Atmos";

            const minPrice = s.areas?.length
              ? Math.min(...s.areas.map((a: any) => a.price).filter(Boolean))
              : null;
            const seatsAvailable = s.avail ?? null;

            const key = `${theatreName}|${date}|${time}|${format}|${groupLang}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                theatreName,
                date,
                time,
                format,
                language: groupLang,
                price: minPrice,
                seatsAvailable,
                platform: "DISTRICT",
              });
            }
          }
        }
      }
    }

    // Process initial movieSessions in page
    const initialMovieSessions = serverState?.movieSessions || {};
    const fmtToLang: Record<string, string> = {};
    langGroups.forEach((g) => {
      if (g.fmtGrpId) fmtToLang[g.fmtGrpId.toLowerCase()] = g.language;
    });

    for (const key of Object.keys(initialMovieSessions)) {
      const assignedLang = fmtToLang[key.toLowerCase()] || fallbackLang || "Telugu";
      extractFromMovieSessions({ [key]: initialMovieSessions[key] }, assignedLang);
    }

    // Fetch other language format groups
    const baseUrl = districtUrl.split("?")[0];
    const initialKeys = Object.keys(initialMovieSessions).map((k) => k.toLowerCase());

    for (const g of langGroups) {
      if (!g.fmtGrpId) continue;
      if (!initialKeys.includes(g.fmtGrpId.toLowerCase())) {
        try {
          const subRes = await fetch(`${baseUrl}?frmtid=${g.fmtGrpId}`, {
            headers: {
              "User-Agent": USER_AGENT,
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            cache: "no-store",
          });
          if (subRes.ok) {
            const subHtml = await subRes.text();
            const subIdx = subHtml.indexOf('id="__NEXT_DATA__"');
            if (subIdx !== -1) {
              const subStart = subHtml.indexOf(">", subIdx) + 1;
              const subEnd = subHtml.indexOf("</script>", subStart);
              const subData = JSON.parse(subHtml.slice(subStart, subEnd));
              const subMovieSessions = subData.props?.pageProps?.data?.serverState?.movieSessions || {};
              extractFromMovieSessions(subMovieSessions, g.language);
            }
          }
        } catch {
          // ignore sub-language fetch failure
        }
      }
    }

    // Also fetch tomorrow's date for District so upcoming showtimes are listed
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    for (const g of langGroups.length ? langGroups : [{ language: fallbackLang || "Telugu", fmtGrpId: "" }]) {
      try {
        const dateUrl = g.fmtGrpId
          ? `${baseUrl}?frmtid=${g.fmtGrpId}&fromdate=${tomorrowStr}`
          : `${baseUrl}?fromdate=${tomorrowStr}`;
        const dateRes = await fetch(dateUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          cache: "no-store",
        });
        if (dateRes.ok) {
          const dateHtml = await dateRes.text();
          const dIdx = dateHtml.indexOf('id="__NEXT_DATA__"');
          if (dIdx !== -1) {
            const dStart = dateHtml.indexOf(">", dIdx) + 1;
            const dEnd = dateHtml.indexOf("</script>", dStart);
            const dData = JSON.parse(dateHtml.slice(dStart, dEnd));
            const dateMovieSessions = dData.props?.pageProps?.data?.serverState?.movieSessions || {};
            extractFromMovieSessions(dateMovieSessions, g.language);
          }
        }
      } catch {
        // ignore tomorrow fetch failure
      }
    }

    return results;
  } catch (err) {
    console.warn("[showtime-sync] District scrape failed:", err);
    return [];
  }
}

// 3. Scrape Times of India HTML body + JSON-LD (tagged as BMS so it augments BookMyShow)
export async function scrapeToiShowtimes(
  toiUrl: string,
  fallbackLang?: string | null,
): Promise<ScrapedShowtime[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    const res = await fetch(toiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return [];
    const html = await res.text();

    const urlLang = extractLanguageFromUrlOrText(toiUrl) || fallbackLang || null;
    let pageDate = new Date().toISOString().slice(0, 10);
    const jsonLdDate = html.match(/"startDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/)?.[1];
    if (jsonLdDate) pageDate = jsonLdDate;

    const results: ScrapedShowtime[] = [];
    const seen = new Set<string>();

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
      const lMatch = extractLanguageFromUrlOrText(langFmt);
      if (lMatch) language = lMatch;

      let format = "2D";
      if (/\bIMAX\b/i.test(langFmt) || /\bIMAX\b/i.test(theatreName)) format = "IMAX";
      else if (/\b4DX\b/i.test(langFmt) || /\b4DX\b/i.test(theatreName)) format = "4DX";
      else if (/\bScreenX\b/i.test(langFmt) || /\bScreenX\b/i.test(theatreName)) format = "ScreenX";
      else if (/\bDolby\b/i.test(langFmt) || /\bDolby\b/i.test(theatreName)) format = "Dolby Atmos";
      else if (/\b3D\b/i.test(langFmt) || /\b3D\b/i.test(theatreName)) format = "3D";

      const timeRegex = /<(?:span|a)[^>]*class="[^"]*timing_box[^"]*"[^>]*>([^<]+)<\/(?:span|a)>/gi;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = timeRegex.exec(block)) !== null) {
        const time24 = parseTo24h(tMatch[1]);
        if (time24) {
          const key = `${theatreName}|${pageDate}|${time24}|${format}|${language}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ theatreName, date: pageDate, time: time24, format, language, platform: "BMS" });
          }
        }
      }
    }
    return results;
  } catch (err) {
    console.warn("[showtime-sync] TOI scrape failed:", err);
    return [];
  }
}

// Unified multi-source sync engine
export async function syncMovieShowtimes(
  movieId: string,
  movieTitle: string,
  movieLanguage?: string,
): Promise<number> {
  let location = await prisma.location.findFirst({ where: { name: CITY } });
  if (!location) {
    location = await prisma.location.create({ data: { name: CITY } });
  }

  const key = process.env.SERP_SEARCH_API_KEY || DEFAULT_SERP_KEY;
  const queries = [
    `${movieTitle} movie show time in ${CITY}`,
    `${movieTitle} Telugu movie BookMyShow ${CITY}`,
    `${movieTitle} movie District ${CITY}`,
    ...(movieLanguage ? [`${movieTitle} ${movieLanguage} movie showtimes ${CITY}`] : []),
  ];

  const loggedBmsSkips = new Set<string>();
  const bmsUrls: { url: string; language: string | null }[] = [];
  const districtUrls: string[] = [];
  const toiUrls: string[] = [];

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const dateCompact = `${yyyy}${mm}${dd}`;

  for (const query of queries) {
    const params = new URLSearchParams({
      query,
      location: `${CITY}, Telangana, India`,
      gl: "in",
      hl: "en",
    });
    try {
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=in`;
      const res = await fetch("https://api.brightdata.com/request", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          zone: process.env.BRIGHTDATA_ZONE,
          url: googleUrl,
          format: "raw",
          data_format: "parsed_light",
        }),
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn(`[showtime-sync] Bright Data search failed for "${query}": HTTP ${res.status} ${await res.text().catch(() => "")}`);
        continue;
      }
      const rawText = await res.text();
      if (!rawText) {
        console.warn(`[showtime-sync] Bright Data returned an empty body for "${query}"`);
        continue;
      }
      let data: { organic?: { title?: string; link?: string; description?: string }[] };
      try {
        data = JSON.parse(rawText);
      } catch {
        console.warn(`[showtime-sync] Bright Data returned non-JSON for "${query}": ${rawText.slice(0, 200)}`);
        continue;
      }
      for (const r of (data.organic || []).map((o) => ({ title: o.title, url: o.link, description: o.description }))) {
        if (!r.url) continue;

        // BookMyShow match - Hyderabad pages for this exact movie only
        const bmsMatch = r.url.match(/^https?:\/\/in\.bookmyshow\.com\/movies\/hyderabad\/([a-z0-9-]+)\/buytickets\/(ET\d+)/i);
        if (bmsMatch) {
          const bmsSlug = bmsMatch[1];
          const etCode = bmsMatch[2].toUpperCase();
          if (titleKey(bmsSlug.replace(/-/g, " ")) !== titleKey(movieTitle)) {
            if (!loggedBmsSkips.has(bmsSlug)) {
              loggedBmsSkips.add(bmsSlug);
              console.log(`[showtime-sync] skip BMS slug "${bmsSlug}": not "${movieTitle}" (${r.url})`);
            }
          } else {
            const buyticketsUrl = `https://in.bookmyshow.com/movies/hyderabad/${bmsSlug}/buytickets/${etCode}/${dateCompact}`;
            if (!bmsUrls.some((b) => b.url === buyticketsUrl)) {
              bmsUrls.push({ url: buyticketsUrl, language: movieLanguage || null });
            }
          }
        }

        // District.in match - always rewritten to the Hyderabad BOOKING page (the one with showtimes)
        if (r.url.includes("district.in/movies/")) {
          const parsed = parseDistrictMovieUrl(r.url);
          if (parsed) {
            const bookingUrl = districtBookingUrl(r.url, "hyderabad")!;
            if (!districtUrls.some((u) => parseDistrictMovieUrl(u)?.mvId === parsed.mvId)) {
              districtUrls.push(bookingUrl);
              if (bookingUrl !== r.url) {
                console.log(`[showtime-sync] District URL: ${r.url} -> ${bookingUrl}`);
              }
            }
          }
        }

        // Times of India match
        if (
          r.url.includes("timesofindia.indiatimes.com") &&
          r.url.includes("movie-showtimes") &&
          r.url.toLowerCase().includes(TOI_CITY_SLUG) &&
          !toiUrls.includes(r.url)
        ) {
          toiUrls.push(r.url);
        }
      }
    } catch (err) {
      console.warn(`[showtime-sync] SERP search threw for "${query}":`, err);
    }
  }

  console.log(`[showtime-sync] ${movieTitle}: discovered ${bmsUrls.length} BMS url(s), ${districtUrls.length} District url(s), ${toiUrls.length} TOI url(s)`);
  // Scrape across all discovered sources concurrently
  const scrapedAll: ScrapedShowtime[] = [];

  for (const bms of bmsUrls) {
    let bmsCount = 0;
    for (let offset = 0; offset < 4; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      const dCompact = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      const dDash = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const dateUrl = bms.url.replace(/\/\d{8}$/, `/${dCompact}`);
      const shows = await scrapeBmsViaJina(dateUrl, dDash, bms.language);
      scrapedAll.push(...shows);
      bmsCount += shows.length;
    }
    console.log(`[showtime-sync] ${movieTitle}: BMS ${bms.url} -> ${bmsCount} showtime(s) over 4 days`);
  }

  for (const distUrl of districtUrls) {
    const shows = await scrapeDistrictShowtimes(distUrl, movieLanguage, movieTitle);
    scrapedAll.push(...shows);
    console.log(`[showtime-sync] ${movieTitle}: District ${distUrl} -> ${shows.length} showtime(s)`);
  }

  for (const toiUrl of toiUrls) {
    const shows = await scrapeToiShowtimes(toiUrl, movieLanguage);
    scrapedAll.push(...shows);
    console.log(`[showtime-sync] ${movieTitle}: TOI ${toiUrl} -> ${shows.length} showtime(s)`);
  }

  if (scrapedAll.length === 0) {
    console.log(`[showtime-sync] ${movieTitle}: no showtimes found across BMS or District`);
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

  for (const item of scrapedAll) {
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
    const platform = item.platform || "BMS";

    const existing = await prisma.showtime.findUnique({
      where: {
        movieId_theatreId_formatId_date_time_platform: {
          movieId,
          theatreId: theatre.id,
          formatId: format.id,
          date,
          time: item.time,
          platform,
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
          price: item.price ?? null,
          seatsAvailable: item.seatsAvailable ?? null,
          platform,
        },
      });
      try {
        await matchShowtimeAgainstRequests(created.id);
      } catch (matchErr) {
        console.warn("[showtime-sync] Match error:", matchErr);
      }
      totalAdded++;
    } else {
      // Update missing language, price or seats if newly discovered
      const updates: any = {};
      if (item.language && existing.language !== item.language) updates.language = item.language;
      if (existing.price == null && item.price != null) updates.price = item.price;
      if (existing.seatsAvailable == null && item.seatsAvailable != null) updates.seatsAvailable = item.seatsAvailable;

      if (Object.keys(updates).length > 0) {
        await prisma.showtime.update({ where: { id: existing.id }, data: updates });
      }
    }
  }

  await prisma.movie.update({
    where: { id: movieId },
    data: { status: "RUNNING" },
  });

  console.log(
    `[showtime-sync] ${movieTitle}: added ${totalAdded} new showtimes (out of ${scrapedAll.length} scraped across BMS/District)`,
  );
  return totalAdded;
}