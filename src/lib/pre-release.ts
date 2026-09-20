// Shared by the API routes, the matching engine and the movie page.
// Pure functions only (no Prisma / Node imports) so client components can use it too.

export const APP_TIME_ZONE = "Asia/Kolkata";

// Calendar day ("YYYY-MM-DD") of any instant, as seen in India.
// Release dates and showtime dates are stored at different clock times
// (TMDB import = noon, admin form = UTC midnight, scraper = local midnight),
// so comparing them by calendar day in one fixed zone keeps everything consistent.
export function calendarDayInIndia(value: Date | string | number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

// True from now until the END of the movie's release day (release day included).
// No release date -> false, so the option is never offered without a known deadline.
export function isPreReleaseWindowOpen(
  releaseDate: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!releaseDate) return false;
  if (Number.isNaN(new Date(releaseDate).getTime())) return false;
  return calendarDayInIndia(now) <= calendarDayInIndia(releaseDate);
}

// Theatres that list this movie today or later (on ANY platform).
// Past-dated showtimes are ignored so an old preview show doesn't count as "showing".
export function theatreIdsShowingNow(
  showtimes: { theatreId: string; date: Date | string }[],
  now: Date = new Date(),
): Set<string> {
  const today = calendarDayInIndia(now);
  const ids = new Set<string>();
  for (const s of showtimes) {
    if (calendarDayInIndia(s.date) >= today) ids.add(s.theatreId);
  }
  return ids;
}
