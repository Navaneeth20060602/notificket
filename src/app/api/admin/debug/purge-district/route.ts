import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/api-helpers";

// One-off maintenance endpoint - admin only. Wipes District showtimes so the
// next sync re-scrapes them cleanly with the fixed city-scoping logic.
export async function POST() {
  try {
    await requireAdmin();
  } catch (res) {
    return res as NextResponse;
  }

  const result = await prisma.showtime.deleteMany({ where: { platform: "DISTRICT" } });
  return NextResponse.json({ deleted: result.count });
}
