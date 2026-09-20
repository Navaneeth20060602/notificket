import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api-helpers";
import { matchShowtimeAgainstRequests } from "@/lib/matching";
import { isPreReleaseWindowOpen, theatreIdsShowingNow } from "@/lib/pre-release";

function parseIds(json: string | null | undefined): string[] {
  try {
    const value = JSON.parse(json || "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

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

  // Resolve every theatre a request covers (theatreIds is a JSON array) in one query
  const allTheatreIds = new Set<string>();
  for (const r of requests) parseIds(r.theatreIds).forEach((id) => allTheatreIds.add(id));
  const theatreRows = allTheatreIds.size
    ? await prisma.theatre.findMany({ where: { id: { in: [...allTheatreIds] } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(theatreRows.map((t) => [t.id, t.name]));

  return NextResponse.json({
    requests: requests.map((r) => ({
      ...r,
      theatreNames: parseIds(r.theatreIds)
        .map((id) => nameById.get(id))
        .filter((n): n is string => Boolean(n)),
    })),
  });
}

const schema = z.object({
  movieId: z.string(),
  locationId: z.string().min(1),
  theatreIds: z.array(z.string()).min(1),
  formatIds: z.array(z.string()).min(1),
  languages: z.array(z.string()).min(1),
  date: z.string().optional().nullable(),
  timeFrom: z.string().optional().nullable(),
  timeTo: z.string().optional().nullable(),
  maxPrice: z.number().optional().nullable(),
  // true = "notify me when this running movie reaches these theatres"
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

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const theatreIds = [...new Set(data.theatreIds)];

  const theatreCount = await prisma.theatre.count({ where: { id: { in: theatreIds }, locationId: data.locationId } });
  if (theatreCount !== theatreIds.length) {
    return NextResponse.json({ error: "Choose theatres from the selected location" }, { status: 400 });
  }
  const formatCount = await prisma.format.count({ where: { id: { in: data.formatIds } } });
  if (formatCount !== new Set(data.formatIds).size) {
    return NextResponse.json({ error: "One or more selected formats are unavailable" }, { status: 400 });
  }

  if (data.preRelease) {
    // --- Release alert for an already-running movie ---
    const movie = await prisma.movie.findUnique({
      where: { id: data.movieId },
      select: { id: true, releaseDate: true },
    });
    if (!movie) {
      return NextResponse.json({ error: "Movie not found" }, { status: 404 });
    }

    // Option only exists until release day
    if (!isPreReleaseWindowOpen(movie.releaseDate)) {
      return NextResponse.json(
        { error: "Release day has passed for this movie, so release alerts are closed." },
        { status: 400 },
      );
    }

    // Which theatres already list the movie (any platform, today or later)?
    const recentShowtimes = await prisma.showtime.findMany({
      where: { movieId: data.movieId, date: { gte: new Date(Date.now() - 2 * 86_400_000) } },
      select: { theatreId: true, date: true },
    });
    const showingNow = theatreIdsShowingNow(recentShowtimes);
    if (showingNow.size === 0) {
      return NextResponse.json(
        { error: "This movie has no showtimes yet. Check back once it's on sale on at least one platform." },
        { status: 400 },
      );
    }

    // Reject if the movie is already at any selected theatre
    const alreadyShowing = theatreIds.filter((id) => showingNow.has(id));
    if (alreadyShowing.length > 0) {
      const names = await prisma.theatre.findMany({
        where: { id: { in: alreadyShowing } },
        select: { name: true },
      });
      return NextResponse.json(
        {
          error: `Already showing at: ${names.map((t) => t.name).join(", ")}. Pick only theatres where it hasn't released yet.`,
          alreadyShowingTheatreIds: alreadyShowing,
        },
        { status: 400 },
      );
    }
  } else if (data.date) {
    // Regular alert: date can't be in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(data.date) < today) {
      return NextResponse.json({ error: "Date can't be in the past" }, { status: 400 });
    }
  }

  // One active alert per movie per kind (a release alert doesn't block a normal alert and vice versa)
  const duplicate = await prisma.request.findFirst({
    where: { userId: user.id, movieId: data.movieId, status: "ACTIVE", preRelease: data.preRelease },
  });
  if (duplicate) {
    return NextResponse.json(
      {
        error: data.preRelease
          ? "You already have an active release alert for this movie. Cancel it from My requests to create a new one."
          : "You already have an active alert for this movie. You can update it from My requests.",
      },
      { status: 409 },
    );
  }

  const request = await prisma.request.create({
    data: {
      userId: user.id,
      movieId: data.movieId,
      locationId: data.locationId,
      theatreId: theatreIds[0],
      formatId: data.formatIds[0],
      theatreIds: JSON.stringify(theatreIds),
      formatIds: JSON.stringify([...new Set(data.formatIds)]),
      languages: JSON.stringify([...new Set(data.languages)]),
      // Release alerts ignore date/time/price - they fire on the first matching show at each theatre
      date: !data.preRelease && data.date ? new Date(data.date) : null,
      timeFrom: !data.preRelease ? data.timeFrom || null : null,
      timeTo: !data.preRelease ? data.timeTo || null : null,
      maxPrice: !data.preRelease ? data.maxPrice ?? null : null,
      preRelease: data.preRelease,
    },
  });

  // A request also activates the server-side monitor. One shared job covers
  // every user following the same movie in the same city.
  await prisma.monitorJob.upsert({
    where: { movieId_locationId: { movieId: data.movieId, locationId: data.locationId } },
    update: { status: "ACTIVE", nextCheckAt: new Date(), lastMessage: "Queued by a new ticket alert request." },
    create: { movieId: data.movieId, locationId: data.locationId, status: "ACTIVE", lastMessage: "Queued by a new ticket alert request." },
  });

  // Regular alerts: a matching showtime may already exist (tickets released
  // moments before this request was saved), so check immediately too.
  // Release alerts skip this - the theatres were just verified to have no shows.
  if (!data.preRelease) {
    const existingMatches = await prisma.showtime.findMany({
      where: { movieId: data.movieId },
      select: { id: true },
    });
    for (const s of existingMatches) {
      await matchShowtimeAgainstRequests(s.id);
    }
  }

  return NextResponse.json({ request });
}
