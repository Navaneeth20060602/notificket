import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try { await requireAdmin(); } catch (res) { return res as NextResponse; }
  const jobs = await prisma.monitorJob.findMany({
    include: { movie: true, location: true },
    orderBy: [{ nextCheckAt: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ jobs });
}
