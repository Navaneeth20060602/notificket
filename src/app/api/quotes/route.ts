import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const quotes = await prisma.quote.findMany();
  return NextResponse.json({ quotes });
}
