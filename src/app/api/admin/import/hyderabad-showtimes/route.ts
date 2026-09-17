import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeName, requireAdmin } from "@/lib/api-helpers";
import { matchShowtimeAgainstRequests } from "@/lib/matching";

export const dynamic = "force-dynamic";

type ProviderShowtime = { date?: string; time?: string; theater?: string; format?: string; timestamp?: number };
type ProviderMovie = { title?: string; showtimes?: ProviderShowtime[] };
type ProviderResponse = { movies?: { movies?: ProviderMovie[] } };

function asTime(value?: string) {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = match[3]?.toUpperCase();
  if (suffix === "PM" && hour < 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function asDate(showtime: ProviderShowtime) {
  const source = showtime.timestamp ? new Date(showtime.timestamp * 1000) : showtime.date ? new Date(showtime.date) : null;
  if (!source || Number.isNaN(source.valueOf())) return null;
  // Showtime dates are calendar days; normalizing prevents repeated imports
  // creating duplicates because a provider's timestamp has a time component.
  return new Date(source.getFullYear(), source.getMonth(), source.getDate());
}

async function searchShowtimes(title: string, key: string) {
  const params = new URLSearchParams({ query: `${title} movie showtimes`, location: "Hyderabad, Telangana, India", gl: "in", hl: "en" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`https://api.serpsearch.com/api/v1/search?${params}`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);
    return await response.json() as ProviderResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST() {
  try { await requireAdmin(); } catch (res) { return res as NextResponse; }
  const key = process.env.SERP_SEARCH_API_KEY;
  if (!key) return NextResponse.json({ error: "SERP_SEARCH_API_KEY is missing from .env." }, { status: 400 });

  const location = await prisma.location.findFirst({ where: { name: "Hyderabad" } });
  if (!location) return NextResponse.json({ error: "Add Hyderabad to the location catalogue first." }, { status: 400 });
  const movies = await prisma.movie.findMany({ where: { status: "RUNNING" }, select: { id: true, title: true } });
  let added = 0; let checked = 0; const failures: string[] = [];

  for (const movie of movies) {
    try {
      const response = await searchShowtimes(movie.title, key);
      checked++;
      const providerMovie = response.movies?.movies?.find((item) => item.title && normalizeName(item.title) === normalizeName(movie.title));
      for (const item of providerMovie?.showtimes || []) {
        const name = item.theater?.trim(); const time = asTime(item.time); const date = asDate(item);
        if (!name || !time || !date) continue;
        let theatre = await prisma.theatre.findFirst({ where: { locationId: location.id, name: { equals: name } } });
        if (!theatre) {
          const candidates = await prisma.theatre.findMany({ where: { locationId: location.id } });
          theatre = candidates.find((candidate) => normalizeName(candidate.name) === normalizeName(name)) || null;
        }
        if (!theatre) theatre = await prisma.theatre.create({ data: { name, locationId: location.id } });
        const formatName = item.format?.trim() || "2D";
        let format = await prisma.format.findFirst({ where: { name: { equals: formatName } } });
        if (!format) format = await prisma.format.create({ data: { name: formatName } });
        const existing = await prisma.showtime.findUnique({ where: { movieId_theatreId_formatId_date_time: { movieId: movie.id, theatreId: theatre.id, formatId: format.id, date, time } } });
        if (!existing) {
          const created = await prisma.showtime.create({ data: { movieId: movie.id, theatreId: theatre.id, formatId: format.id, date, time } });
          await matchShowtimeAgainstRequests(created.id);
          added++;
        }
      }
    } catch {
      failures.push(movie.title);
    }
  }
  return NextResponse.json({ message: `Showtime sync checked ${checked}/${movies.length} active movies and added ${added} new Hyderabad showtimes.${failures.length ? ` Could not check: ${failures.slice(0, 3).join(", ")}${failures.length > 3 ? ` and ${failures.length - 3} more` : ""}.` : ""}` });
}
