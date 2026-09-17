import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api-helpers";

async function assertOwnership(userId: string, requestId: string) {
  const request = await prisma.request.findUnique({ where: { id: requestId } });
  if (!request || request.userId !== userId) return null;
  return request;
}

// PATCH: modify an existing ACTIVE request (theatre, date/time range, format, price)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireUser();
  } catch (res) {
    return res as NextResponse;
  }

  const owned = await assertOwnership(user.id, params.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (owned.status !== "ACTIVE") {
    return NextResponse.json({ error: "Only active requests can be modified" }, { status: 400 });
  }

  const body = await req.json();
  const { locationId, theatreId, formatId, date, timeFrom, timeTo, maxPrice } = body;

  if (locationId === "" || theatreId === "" || date === "") {
    return NextResponse.json({ error: "Location, theatre and date are required" }, { status: 400 });
  }

  if (date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(date) < today) {
      return NextResponse.json({ error: "Date can't be in the past" }, { status: 400 });
    }
  }

  const updated = await prisma.request.update({
    where: { id: params.id },
    data: {
      // "" from a cleared dropdown means "any" -> store as null, not the empty string
      locationId: locationId !== undefined ? (locationId || null) : owned.locationId,
      theatreId: theatreId !== undefined ? (theatreId || null) : owned.theatreId,
      formatId: formatId !== undefined ? (formatId || null) : owned.formatId,
      date: date !== undefined ? (date ? new Date(date) : null) : owned.date,
      timeFrom: timeFrom !== undefined ? (timeFrom || null) : owned.timeFrom,
      timeTo: timeTo !== undefined ? (timeTo || null) : owned.timeTo,
      maxPrice: maxPrice !== undefined ? (maxPrice ?? null) : owned.maxPrice,
    },
  });

  return NextResponse.json({ request: updated });
}

// DELETE: cancel a request
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireUser();
  } catch (res) {
    return res as NextResponse;
  }

  const owned = await assertOwnership(user.id, params.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.request.update({ where: { id: params.id }, data: { status: "CANCELLED" } });
  return NextResponse.json({ ok: true });
}
