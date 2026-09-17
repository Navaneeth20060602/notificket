import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// Read-only: admin can see every user's requests, in order, but has no
// edit/respond endpoint here on purpose - matches "admin cannot modify or
// answer user requests" from the spec.
export async function GET() {
  try {
    await requireAdmin();
  } catch (res) {
    return res as NextResponse;
  }

  const requests = await prisma.request.findMany({
    include: { user: true, movie: true, location: true, theatre: true, format: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ requests });
}
