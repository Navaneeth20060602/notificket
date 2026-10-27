import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/api-helpers";
import { matchShowtimeAgainstRequests } from "@/lib/matching";

export const dynamic = "force-dynamic";

const showtimeSchema = z.object({
  theatreName: z.string().trim().min(1).max(160),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid calendar date."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  format: z.string().trim().max(40).optional(),
  price: z.number().finite().nonnegative().nullable().optional(),
  platform: z.enum(["BMS", "DISTRICT"]).optional(),
});

const bodySchema = z.object({
  movieTitle: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  showtimes: z.array(showtimeSchema).min(1).max(50),
});

function validKey(received: string | null, expected: string) {
  if (!received || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  const secret = process.env.SHOWTIME_INGEST_KEY;
  if (!secret) return NextResponse.json({ error: "SHOWTIME_INGEST_KEY is not configured on this Notificket server." }, { status: 503 });
  if (!validKey(req.headers.get("x-notificket-ingest-key"), secret)) return NextResponse.json({ error: "Invalid extension key." }, { status: 401 });

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid showtime data.", details: parsed.error.flatten() }, { status: 400 });
  }
  const { movieTitle, city, showtimes } = parsed.data;
  const location = await prisma.location.findFirst({ where: { name: { equals: city } } });
  if (!location) return NextResponse.json({ error: `Unsupported city: ${city}` }, { status: 400 });
  const movies = await prisma.movie.findMany();
  const movie = movies.find((item) => normalizeName(item.title) === normalizeName(movieTitle));
  if (!movie) return NextResponse.json({ error: `“${movieTitle}” is not in the Notificket catalogue. Sync movies first or use the exact title shown in Browse.` }, { status: 404 });

  let added = 0;
  let notified = 0;
  const theatres = await prisma.theatre.findMany({ where: { locationId: location.id } });
  const theatreByName = new Map(theatres.map((item) => [normalizeName(item.name), item]));
  const formats = await prisma.format.findMany();
  const formatByName = new Map(formats.map((item) => [normalizeName(item.name), item]));

  for (const incoming of showtimes) {
    const date = new Date(`${incoming.date}T00:00:00.000Z`);
    const theatreKey = normalizeName(incoming.theatreName);
    let theatre = theatreByName.get(theatreKey);
    if (!theatre) {
      theatre = await prisma.theatre.create({ data: { name: incoming.theatreName, locationId: location.id } });
      theatreByName.set(theatreKey, theatre);
    }
    const formatName = incoming.format || "2D";
    const formatKey = normalizeName(formatName);
    let format = formatByName.get(formatKey);
    if (!format) {
      format = await prisma.format.create({ data: { name: formatName } });
      formatByName.set(formatKey, format);
    }
    const platform = incoming.platform || "BMS";
    const exists = await prisma.showtime.findUnique({ where: { movieId_theatreId_formatId_date_time_platform: { movieId: movie.id, theatreId: theatre.id, formatId: format.id, date, time: incoming.time, platform } } });
    if (exists) continue;
    const showtime = await prisma.showtime.create({ data: { movieId: movie.id, theatreId: theatre.id, formatId: format.id, date, time: incoming.time, price: incoming.price ?? null, platform } });
    await prisma.movie.update({ where: { id: movie.id }, data: { status: "RUNNING" } });
    notified += (await matchShowtimeAgainstRequests(showtime.id)).length;
    added++;
  }
  return NextResponse.json({ added, notified, message: `${added} new showtime${added === 1 ? "" : "s"} saved; ${notified} matching alert${notified === 1 ? "" : "s"} sent.` });
}
