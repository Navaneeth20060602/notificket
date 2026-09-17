import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const locations = await prisma.location.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ locations });
}
