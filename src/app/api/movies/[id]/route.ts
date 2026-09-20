import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/api-helpers";
import { syncMovieShowtimes } from "@/lib/showtime-sync";

export const dynamic = "force-dynamic";

// Opening a movie page auto-syncs when a platform is missing. For movies that are
// only on one platform that would run 4 Brave searches + scrapes on EVERY page view,
// so auto-sync at most once per movie per 10 minutes. "Refresh showtimes" (?sync=true) always syncs.
const lastAutoSync = new Map<string, number>();
const AUTO_SYNC_COOLDOWN_MS = 10 * 60_000;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  let movie = await prisma.movie.findUnique({
    where: { id: params.id },
    include: {
      showtimes: {
        include: { theatre: { include: { location: true } }, format: true },
        orderBy: [{ date: "asc" }, { time: "asc" }],
      },
    },
  });
  if (!movie) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const movieTitle = movie.title;
  const hasDistrict = movie.showtimes.some((s) => s.platform === "DISTRICT");
  const hasBms = movie.showtimes.some((s) => s.platform === "BMS");
  const autoSyncDue = Date.now() - (lastAutoSync.get(movie.id) ?? 0) > AUTO_SYNC_COOLDOWN_MS;
  const shouldSync =
    req.nextUrl.searchParams.get("sync") === "true" ||
    (autoSyncDue && (movie.showtimes.length === 0 || !hasDistrict || !hasBms));
  if (shouldSync) {
    lastAutoSync.set(movie.id, Date.now());
    try {
      const added = await syncMovieShowtimes(movie.id, movieTitle, movie.language);
      if (added > 0 || movie.showtimes.length === 0) {
        const refreshed = await prisma.movie.findUnique({
          where: { id: params.id },
          include: {
            showtimes: {
              include: { theatre: { include: { location: true } }, format: true },
              orderBy: [{ date: "asc" }, { time: "asc" }],
            },
          },
        });
        if (refreshed) movie = refreshed;
      }
    } catch (e) {
      console.warn("[movie-api] Auto-sync showtimes failed for:", movieTitle, e);
    }
  }

  return NextResponse.json({ movie });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
  } catch (res) {
    return res as NextResponse;
  }
  const body = await req.json();
  const { title, language, status, releaseDate, posterUrl } = body;

  const movie = await prisma.movie.update({
    where: { id: params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(language !== undefined && { language }),
      ...(status !== undefined && { status }),
      ...(releaseDate !== undefined && { releaseDate: releaseDate ? new Date(releaseDate) : null }),
      ...(posterUrl !== undefined && { posterUrl }),
    },
  });
  return NextResponse.json({ movie });
}