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

  const all = await prisma.location.findMany();
  const clash = all.find((l) => normalizeName(l.name) === normalizeName(name));
  if (clash) {
    return NextResponse.json(
      { error: `"${clash.name}" already exists - can't add a duplicate.` },
      { status: 409 }
    );
  }

  const location = await prisma.location.create({ data: { name: name.trim() } });
  return NextResponse.json({ location });
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (res) {
    return res as NextResponse;
  }
  const { id, name } = await req.json();
  const location = await prisma.location.update({ where: { id }, data: { name } });
  return NextResponse.json({ location });
}
