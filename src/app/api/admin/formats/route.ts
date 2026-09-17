import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, normalizeName } from "@/lib/api-helpers";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (res) {
    return res as NextResponse;
  }
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const all = await prisma.format.findMany();
  const clash = all.find((f) => normalizeName(f.name) === normalizeName(name));
  if (clash) {
    return NextResponse.json(
      { error: `"${clash.name}" already exists - can't add a duplicate.` },
      { status: 409 }
    );
  }

  const format = await prisma.format.create({ data: { name: name.trim() } });
  return NextResponse.json({ format });
}
