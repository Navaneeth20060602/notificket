import { prisma } from "./db";
import { sendAlertEmail } from "./email";
import { formatDate } from "./date";

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// THE CORE LOGIC OF THE WHOLE APP.
// Call this every time a new Showtime is created (i.e. "tickets just went live"
// for some movie/theatre/date/time/format combo). It finds every ACTIVE
// Request that matches this showtime and creates a Notification for it
// (plus attempts an email).
//
// In production, this is what a scheduled worker would call after polling
// BookMyShow/District and detecting a genuinely new showtime. See
// src/worker/poll.ts for where that would plug in.
export async function matchShowtimeAgainstRequests(showtimeId: string) {
  const showtime = await prisma.showtime.findUnique({
    where: { id: showtimeId },
    include: { movie: true, theatre: { include: { location: true } }, format: true },
  });
  if (!showtime) return [];

  const candidateRequests = await prisma.request.findMany({
    where: {
      movieId: showtime.movieId,
      status: "ACTIVE",
    },
    include: { user: true },
  });

  const matched = candidateRequests.filter((req) => {
    const theatreIds: string[] = JSON.parse(req.theatreIds || "[]");
    const formatIds: string[] = JSON.parse(req.formatIds || "[]");
    const languages: string[] = JSON.parse(req.languages || "[]");
    if (req.locationId && req.locationId !== showtime.theatre.locationId) return false;
    if (theatreIds.length ? !theatreIds.includes(showtime.theatreId) : req.theatreId !== showtime.theatreId) return false;
    if (formatIds.length ? !formatIds.includes(showtime.formatId) : req.formatId !== showtime.formatId) return false;
    if (languages.length && !languages.includes(showtime.movie.language)) return false;
    if (req.date && !isSameDay(req.date, showtime.date)) return false;
    if (req.timeFrom && showtime.time < req.timeFrom) return false;
    if (req.timeTo && showtime.time > req.timeTo) return false;
    if (req.maxPrice && showtime.price != null && showtime.price > req.maxPrice) return false;
    return true;
  });

  const results = [];
  for (const req of matched) {
    const message = `${showtime.movie.title} tickets are live at ${showtime.theatre.name} (${showtime.theatre.location.name}) on ${formatDate(showtime.date)} at ${showtime.time}, ${showtime.format.name}.`;

    const notification = await prisma.notification.create({
      data: {
        userId: req.userId,
        requestId: req.id,
        showtimeId: showtime.id,
        message,
      },
    });

    const emailResult = await sendAlertEmail(
      req.user.email,
      `Tickets live: ${showtime.movie.title}`,
      message
    );

    if (emailResult.sent) {
      await prisma.notification.update({ where: { id: notification.id }, data: { emailSent: true } });
    }

    // Mark the request completed - it found its match. (If you want
    // "notify every new matching show, not just the first", skip this line.)
    await prisma.request.update({ where: { id: req.id }, data: { status: "COMPLETED" } });

    results.push(notification);
  }

  return results;
}
