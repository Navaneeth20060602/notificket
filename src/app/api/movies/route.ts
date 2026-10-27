import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// GET /api/movies?status=RUNNING|UPCOMING&search=...&language=...&locationId=...
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // RUNNING or UPCOMING
  const search = searchParams.get("search");
  const language = searchParams.get("language");
  const locationId = searchParams.get("locationId");

  const where: Prisma.MovieWhereInput = {};
  if (status === "RUNNING" || status === "UPCOMING") where.status = status;
  if (search) where.title = { contains: search };
  if (language) where.language = language;
  if (locationId) where.showtimes = { some: { theatre: { locationId } } };

  // Imported films are current catalogue entries. Actual Hyderabad availability
  // is added separately by the ticket-release provider integration.

  const movies = await prisma.movie.findMany({
    where,
    orderBy: status === "UPCOMING" ? { releaseDate: "asc" } : { title: "asc" },
  });

  return NextResponse.json({ movies });
}
