import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/api-helpers";
import { matchShowtimeAgainstRequests } from "@/lib/matching";

export const dynamic = "force-dynamic";

type IncomingShowtime = { theatreName: string; date: string; time: string; format?: string; price?: number | null; platform?: string };

function validKey(received: string | null, expected: string) {
  if (!received || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  const secret = process.env.SHOWTIME_INGEST_KEY;
  if (!secret) return NextResponse.json({ error: "SHOWTIME_INGEST_KEY is not configured on this Notificket server." }, { status: 503 });
  if (!validKey(req.headers.get("x-notificket-ingest-key"), secret)) return NextResponse.json({ error: "Invalid extension key." }, { status: 401 });

  const body = await req.json() as { movieTitle?: string; city?: string; showtimes?: IncomingShowtime[] };
  if (!body.movieTitle?.trim() || !body.city?.trim() || !Array.isArray(body.showtimes) || !body.showtimes.length) {
    return NextResponse.json({ error: "movieTitle, city and at least one showtime are required." }, { status: 400 });
  }
  const location = await prisma.location.findFirst({ where: { name: { equals: body.city.trim() } } });
  if (!location) return NextResponse.json({ error: `Unsupported city: ${body.city}` }, { status: 400 });
  const movies = await prisma.movie.findMany();
  const movie = movies.find((item) => normalizeName(item.title) === normalizeName(body.movieTitle!));
  if (!movie) return NextResponse.json({ error: `“${body.movieTitle}” is not in the Notificket catalogue. Sync movies first or use the exact title shown in Browse.` }, { status: 404 });

  let added = 0; let notified = 0;
  for (const incoming of body.showtimes.slice(0, 50)) {
    if (!incoming.theatreName?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(incoming.date || "") || !/^\d{2}:\d{2}$/.test(incoming.time || "")) continue;
    const date = new Date(`${incoming.date}T00:00:00`);
    if (Number.isNaN(date.valueOf())) continue;
    const theatres = await prisma.theatre.findMany({ where: { locationId: location.id } });
    let theatre = theatres.find((item) => normalizeName(item.name) === normalizeName(incoming.theatreName));
    if (!theatre) theatre = await prisma.theatre.create({ data: { name: incoming.theatreName.trim(), locationId: location.id } });
    const formatName = incoming.format?.trim() || "2D";
    let format = await prisma.format.findFirst({ where: { name: { equals: formatName } } });
    if (!format) format = await prisma.format.create({ data: { name: formatName } });
    const platform = incoming.platform || "BMS";
    const exists = await prisma.showtime.findUnique({ where: { movieId_theatreId_formatId_date_time_platform: { movieId: movie.id, theatreId: theatre.id, formatId: format.id, date, time: incoming.time, platform } } });
    if (exists) continue;
    const showtime = await prisma.showtime.create({ data: { movieId: movie.id, theatreId: theatre.id, formatId: format.id, date, time: incoming.time, price: typeof incoming.price === "number" ? incoming.price : null, platform } });
    await prisma.movie.update({ where: { id: movie.id }, data: { status: "RUNNING" } });
    notified += (await matchShowtimeAgainstRequests(showtime.id)).length;
    added++;
  }
  return NextResponse.json({ added, notified, message: `${added} new showtime${added === 1 ? "" : "s"} saved; ${notified} matching alert${notified === 1 ? "" : "s"} sent.` });
}
