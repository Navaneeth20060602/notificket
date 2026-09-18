import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/api-helpers";
import { syncMovieShowtimes } from "@/lib/showtime-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    await requireAdmin();
  } catch (res) {
    return res as NextResponse;
  }

  const movies = await prisma.movie.findMany({
    where: { status: "RUNNING" },
    select: { id: true, title: true },
  });

  let totalAdded = 0;
  let checked = 0;
  const failures: string[] = [];

  for (const movie of movies) {
    try {
      const added = await syncMovieShowtimes(movie.id, movie.title);
      totalAdded += added;
      checked++;
    } catch (err) {
      console.warn(`[admin-showtime-sync] Failed for ${movie.title}:`, err);
      failures.push(movie.title);
    }
  }

  const message = `Showtime sync checked ${checked}/${movies.length} active movies and added ${totalAdded} new Hyderabad showtimes.${
    failures.length ? ` Failed for: ${failures.join(", ")}.` : ""
  }`;

  return NextResponse.json({ message });
}
