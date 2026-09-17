import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, normalizeName } from "@/lib/api-helpers";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (res) {
    return res as NextResponse;
  }

  const { name, locationId } = await req.json();
  if (!name?.trim() || !locationId) {
    return NextResponse.json({ error: "Name and location are required" }, { status: 400 });
  }

  const existing = await prisma.theatre.findMany({ where: { locationId } });
  const clash = existing.find((t) => normalizeName(t.name) === normalizeName(name));
  if (clash) {
    return NextResponse.json(
      { error: `"${clash.name}" already exists in this location - can't add a duplicate.` },
      { status: 409 }
    );
  }

  const theatre = await prisma.theatre.create({ data: { name: name.trim(), locationId } });
  return NextResponse.json({ theatre });
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (res) {
    return res as NextResponse;
  }
  const { id, name, locationId } = await req.json();
  const theatre = await prisma.theatre.update({
    where: { id },
    data: { ...(name && { name }), ...(locationId && { locationId }) },
  });
  return NextResponse.json({ theatre });
}
