import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const locationId = new URL(req.url).searchParams.get("locationId");
  const theatres = await prisma.theatre.findMany({
    where: locationId ? { locationId } : undefined,
    orderBy: { name: "asc" },
    include: { location: true },
  });
  return NextResponse.json({ theatres });
}
