import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api-helpers";
import { matchShowtimeAgainstRequests } from "@/lib/matching";

// GET: the logged-in user's own requests (active + completed), most recent first
export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (res) {
    return res as NextResponse;
  }

  const requests = await prisma.request.findMany({
    where: { userId: user.id },
    include: {
      movie: true,
      location: true,
      theatre: true,
      format: true,
      notifications: { include: { showtime: { include: { theatre: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ requests });
}

const schema = z.object({
  movieId: z.string(),
  locationId: z.string().min(1),
  theatreIds: z.array(z.string()).min(1),
  formatIds: z.array(z.string()).min(1),
  languages: z.array(z.string()).min(1),
  date: z.string().min(1),
  timeFrom: z.string().optional().nullable(),
  timeTo: z.string().optional().nullable(),
  maxPrice: z.number().optional().nullable(),
  preRelease: z.boolean().optional().default(false),
});

// POST: create a new alert request ("notify me when tickets matching this open")
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch (res) {
    return res as NextResponse;
  }

  const body = await req.json();
  const {
    movieId,
    locationId,
    theatreIds,
    formatIds,
    languages,
    date,
    timeFrom,
    timeTo,
    maxPrice,
    preRelease = false,
  } = body;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (!data.preRelease) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(data.date) < today) {
      return NextResponse.json({ error: "Date can't be in the past" }, { status: 400 });
    }
  }

  // Validate pre-release: movie must already exist on at least one platform
  if (data.preRelease) {
    const movie = await prisma.movie.findUnique({
      where: { id: data.movieId },
      include: { showtimes: { select: { theatreId: true, platform: true } } },
    });
    if (!movie || movie.showtimes.length === 0) {
      return NextResponse.json({ error: "This movie has no showtimes yet. Check back when it's available on at least one platform." }, { status: 400 });
    }
    // Get all theatres where movie is already showing (any platform)
    const existingTheatres = new Set(movie.showtimes.map((s) => s.theatreId));
    // Find theatres in request where movie is already showing
    const alreadyShowing = data.theatreIds.filter((id) => existingTheatres.has(id));
    if (alreadyShowing.length > 0) {
      const names = await prisma.theatre.findMany({
        where: { id: { in: alreadyShowing } },
        select: { name: true },
      });
      return NextResponse.json({ 
        error: `Already showing at: ${names.map((t) => t.name).join(", ")}. Request only for theatres where it's not released yet.`,
        alreadyShowingTheatreIds: alreadyShowing,
      }, { status: 400 });
    }
  }

  const theatreCount = await prisma.theatre.count({ where: { id: { in: data.theatreIds }, locationId: data.locationId } });
  if (theatreCount !== data.theatreIds.length) {
    return NextResponse.json({ error: "Choose theatres from the selected location" }, { status: 400 });
  }
  const formatCount = await prisma.format.count({ where: { id: { in: data.formatIds } } });
  if (formatCount !== data.formatIds.length) {
    return NextResponse.json({ error: "One or more selected formats are unavailable" }, { status: 400 });
  }
  const duplicate = await prisma.request.findFirst({ where: { userId: user.id, movieId: data.movieId, status: "ACTIVE" } });
  if (duplicate) {
    return NextResponse.json({ error: "You already have an active alert for this movie. You can update it from My requests." }, { status: 409 });
  }

  const request = await prisma.request.create({
    data: {
      userId: user.id,
      movieId: data.movieId,
      locationId: data.locationId,
      theatreId: data.theatreIds[0],
      formatId: data.formatIds[0],
      theatreIds: JSON.stringify([...new Set(data.theatreIds)]),
      formatIds: JSON.stringify([...new Set(data.formatIds)]),
      languages: JSON.stringify([...new Set(data.languages)]),
      date: new Date(data.date),
      timeFrom: data.timeFrom || null,
      timeTo: data.timeTo || null,
      maxPrice: data.maxPrice ?? null,
      preRelease: data.preRelease ?? false,
    },
  });

  // A request also activates the server-side monitor. One shared job covers
  // every user following the same movie in the same city.
  await prisma.monitorJob.upsert({
    where: { movieId_locationId: { movieId: data.movieId, locationId: data.locationId } },
    update: { status: "ACTIVE", nextCheckAt: new Date(), lastMessage: "Queued by a new ticket alert request." },
    create: { movieId: data.movieId, locationId: data.locationId, status: "ACTIVE", lastMessage: "Queued by a new ticket alert request." },
  });

  // In case a matching showtime already exists (e.g. tickets released
  // moments before this request was saved), check immediately too.
  const existingMatches = await prisma.showtime.findMany({
    where: { movieId: data.movieId },
    select: { id: true },
  });
  for (const s of existingMatches) {
    await matchShowtimeAgainstRequests(s.id);
  }

  return NextResponse.json({ request });
}
