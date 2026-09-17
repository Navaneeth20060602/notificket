import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeName, requireAdmin } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

type TmdbMovie = { id: number; title?: string; original_language?: string; release_date?: string; poster_path?: string | null };
const LANGUAGE: Record<string, string> = { te: "Telugu", hi: "Hindi", ta: "Tamil", kn: "Kannada", ml: "Malayalam", mr: "Marathi", bn: "Bengali", en: "English" };

async function fetchTmdb(path: string, credential: string, bearerToken?: string): Promise<TmdbMovie[]> {
  let lastError = "TMDB did not respond";
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const separator = path.includes("?") ? "&" : "?";
      const auth = bearerToken ? "" : `api_key=${encodeURIComponent(credential)}&`;
      const url = `https://api.themoviedb.org/3${path}${separator}${auth}region=IN`;
      const response = await fetch(url, { cache: "no-store", signal: controller.signal, headers: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {} });
      if (!response.ok) throw new Error(`TMDB returned ${response.status}`);
      return ((await response.json()) as { results?: TmdbMovie[] }).results || [];
    } catch (error) {
      lastError = error instanceof Error ? error.message : "TMDB request failed";
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(lastError);
}

export async function POST() {
  try { await requireAdmin(); } catch (res) { return res as NextResponse; }
  const key = process.env.TMDB_API_KEY;
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  if (!key && !token) return NextResponse.json({ error: "Add TMDB_API_KEY or TMDB_READ_ACCESS_TOKEN to .env, then restart the dev server." }, { status: 400 });

  try {
    const credential = key || token!;
    const results = await Promise.allSettled([fetchTmdb("/movie/now_playing?language=en-US&page=1", credential, token), fetchTmdb("/movie/upcoming?language=en-US&page=1", credential, token)]);
    const [currentResult, upcomingResult] = results;
    if (currentResult.status === "rejected" && upcomingResult.status === "rejected") throw new Error("both current and upcoming requests failed");
    const current = currentResult.status === "fulfilled" ? currentResult.value : [];
    const upcoming = upcomingResult.status === "fulfilled" ? upcomingResult.value : [];
    const seen = new Set<number>();
    let added = 0; let updated = 0; let skipped = 0;
    for (const [status, entries] of [["RUNNING", current], ["UPCOMING", upcoming]] as const) {
      for (const item of entries) {
        if (seen.has(item.id) || !item.title) continue;
        seen.add(item.id);
        const language = LANGUAGE[item.original_language || ""];
        if (!language) { skipped++; continue; }
        const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
        const releaseDate = item.release_date ? new Date(`${item.release_date}T12:00:00`) : null;
        const byTmdb = await prisma.movie.findUnique({ where: { tmdbId: item.id } });
        const byTitle = byTmdb ? null : await prisma.movie.findFirst({ where: { language, title: { equals: item.title } } });
        if (byTmdb || byTitle) {
          await prisma.movie.update({ where: { id: (byTmdb || byTitle)!.id }, data: { tmdbId: item.id, status, releaseDate, posterUrl } });
          updated++;
        } else {
          const sameNormalisedTitle = await prisma.movie.findMany({ where: { language } }).then((movies) => movies.find((movie) => normalizeName(movie.title) === normalizeName(item.title!)));
          if (sameNormalisedTitle) { skipped++; continue; }
          await prisma.movie.create({ data: { tmdbId: item.id, title: item.title, language, status, releaseDate, posterUrl } });
          added++;
        }
      }
    }
    const unavailable = [currentResult.status === "rejected" ? "current" : "", upcomingResult.status === "rejected" ? "upcoming" : ""].filter(Boolean);
    return NextResponse.json({ message: `TMDB sync complete: ${added} added, ${updated} updated, ${skipped} unsupported-language entries skipped.${unavailable.length ? ` ${unavailable.join(" and ")} listings were temporarily unavailable; try sync again later.` : ""}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `TMDB sync failed: ${message}` }, { status: 502 });
  }
}
