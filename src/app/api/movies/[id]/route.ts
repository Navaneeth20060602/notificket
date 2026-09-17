import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/api-helpers";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const movie = await prisma.movie.findUnique({
    where: { id: params.id },
    include: {
      showtimes: {
        include: { theatre: { include: { location: true } }, format: true },
        orderBy: [{ date: "asc" }, { time: "asc" }],
      },
    },
  });
  if (!movie) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ movie });
}

// Admin-only: fix incorrect info (title, language, status, release date, poster)
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
