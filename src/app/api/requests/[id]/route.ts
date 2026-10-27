import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api-helpers";
import { theatreIdsShowingNow } from "@/lib/pre-release";

async function assertOwnership(userId: string, requestId: string) {
  const request = await prisma.request.findUnique({ where: { id: requestId } });
  if (!request || request.userId !== userId) return null;
  return request;
}

// PATCH: modify an existing ACTIVE request (theatre, date/time range, format, price)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch (res) {
    return res as NextResponse;
  }

  const { id } = await params;
  const owned = await assertOwnership(user.id, id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (owned.status !== "ACTIVE") {
    return NextResponse.json({ error: "Only active requests can be modified" }, { status: 400 });
  }
  const body = await req.json();

  if (owned.preRelease) {
    // Release alerts only expose location + theatre list for editing.
    const { locationId, theatreIds } = body;
    if (!locationId || !Array.isArray(theatreIds) || theatreIds.length === 0) {
      return NextResponse.json({ error: "Location and at least one theatre are required" }, { status: 400 });
    }
    const uniqueTheatreIds = [...new Set(theatreIds as string[])];

    const theatreCount = await prisma.theatre.count({ where: { id: { in: uniqueTheatreIds }, locationId } });
    if (theatreCount !== uniqueTheatreIds.length) {
      return NextResponse.json({ error: "Choose theatres from the selected location" }, { status: 400 });
    }

    const recentShowtimes = await prisma.showtime.findMany({
      where: { movieId: owned.movieId, date: { gte: new Date(Date.now() - 2 * 86_400_000) } },
      select: { theatreId: true, date: true },
    });
    const showingNow = theatreIdsShowingNow(recentShowtimes);
    const alreadyShowing = uniqueTheatreIds.filter((id) => showingNow.has(id));
    if (alreadyShowing.length > 0) {
      const names = await prisma.theatre.findMany({ where: { id: { in: alreadyShowing } }, select: { name: true } });
      return NextResponse.json(
        {
          error: `Already showing at: ${names.map((t) => t.name).join(", ")}. Pick only theatres where it hasn't released yet.`,
          alreadyShowingTheatreIds: alreadyShowing,
        },
        { status: 400 },
      );
    }

    const updated = await prisma.request.update({
      where: { id },
      data: {
        locationId,
        theatreId: uniqueTheatreIds[0],
        theatreIds: JSON.stringify(uniqueTheatreIds),
      },
    });

    if (locationId !== owned.locationId) {
      await prisma.monitorJob.upsert({
        where: { movieId_locationId: { movieId: owned.movieId, locationId } },
        update: { status: "ACTIVE", nextCheckAt: new Date(), lastMessage: "Queued by an updated release alert." },
        create: { movieId: owned.movieId, locationId, status: "ACTIVE", lastMessage: "Queued by an updated release alert." },
      });
    }

    return NextResponse.json({ request: updated });
  }

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
    where: { id },
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
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch (res) {
    return res as NextResponse;
  }

  const { id } = await params;
  const owned = await assertOwnership(user.id, id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.request.update({ where: { id }, data: { status: "CANCELLED" } });
  return NextResponse.json({ ok: true });
}
