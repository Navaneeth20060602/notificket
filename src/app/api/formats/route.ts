import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const formats = await prisma.format.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ formats });
}
