import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, normalizeName } from "@/lib/api-helpers";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (res) {
    return res as NextResponse;
  }

  const { title, language, status, releaseDate, posterUrl } = await req.json();
  if (!title?.trim() || !language?.trim()) {
    return NextResponse.json({ error: "Title and language are required" }, { status: 400 });
  }

  const existing = await prisma.movie.findMany({ where: { language } });
  const clash = existing.find((m) => normalizeName(m.title) === normalizeName(title));
  if (clash) {
    return NextResponse.json(
      { error: `"${clash.title}" (${language}) already exists - can't add a duplicate.` },
      { status: 409 }
    );
  }

  const movie = await prisma.movie.create({
    data: {
      title: title.trim(),
      language,
      status: status === "RUNNING" ? "RUNNING" : "UPCOMING",
      releaseDate: releaseDate ? new Date(releaseDate) : null,
      posterUrl: posterUrl || null,
    },
  });
  return NextResponse.json({ movie });
}
