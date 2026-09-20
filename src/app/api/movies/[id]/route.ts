import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/api-helpers";
import { syncMovieShowtimes } from "@/lib/showtime-sync";

export const dynamic = "force-dynamic";

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
  const shouldSync = movie.showtimes.length === 0 || req.nextUrl.searchParams.get("sync") === "true";
  if (shouldSync) {
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