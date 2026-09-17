import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/api-helpers";
import { matchShowtimeAgainstRequests } from "@/lib/matching";

// Admin action that stands in for "the automatic poller just detected tickets
// went live". Creates the Showtime AND runs the exact same matching/alert
// pipeline the real poller would trigger - so you can test the full alert
// flow end to end today, without a live BookMyShow/District integration.
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (res) {
    return res as NextResponse;
  }

  const { movieId, theatreId, formatId, date, time, price, seatsAvailable } = await req.json();
  if (!movieId || !theatreId || !formatId || !date || !time) {
    return NextResponse.json({ error: "movieId, theatreId, formatId, date and time are required" }, { status: 400 });
  }

  const showtime = await prisma.showtime.create({
    data: {
      movieId,
      theatreId,
      formatId,
      date: new Date(date),
      time,
      price: price ?? null,
      seatsAvailable: seatsAvailable ?? null,
    },
  });

  // If this movie was UPCOMING, its first showtime flips it to RUNNING -
  // this is effectively "tickets have now been released".
  await prisma.movie.update({ where: { id: movieId }, data: { status: "RUNNING" } });

  const notifications = await matchShowtimeAgainstRequests(showtime.id);

  return NextResponse.json({ showtime, notificationsSent: notifications.length });
}
