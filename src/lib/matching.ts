import { prisma } from "./db";
import { sendAlertEmail } from "./email";
import { formatDate } from "./date";

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export async function matchShowtimeAgainstRequests(showtimeId: string) {
  const showtime = await prisma.showtime.findUnique({
    where: { id: showtimeId },
    include: { movie: true, theatre: { include: { location: true } }, format: true },
  });
  if (!showtime) return [];

  const results: Awaited<ReturnType<typeof prisma.notification.create>>[] = [];

  // Release alerts ("tell me when this running movie reaches my theatre").
  // One notification per theatre; the request completes once every selected theatre has been notified.
  const preReleaseRequests = await prisma.request.findMany({
    where: {
      movieId: showtime.movieId,
      status: "ACTIVE",
      preRelease: true,
    },
    include: {
      user: true,
      notifications: { include: { showtime: { select: { theatreId: true } } } },
    },
  });

  for (const req of preReleaseRequests) {
    const theatreIds: string[] = JSON.parse(req.theatreIds || "[]");
    const formatIds: string[] = JSON.parse(req.formatIds || "[]");
    const languages: string[] = JSON.parse(req.languages || "[]");

    if (!theatreIds.includes(showtime.theatreId)) continue;
    if (req.locationId && req.locationId !== showtime.theatre.locationId) continue;
    if (formatIds.length && !formatIds.includes(showtime.formatId)) continue;
    const effectiveLang = showtime.language || showtime.movie.language;
    if (languages.length && !languages.includes(effectiveLang)) continue;

    // Already told this user about this theatre?
    const notifiedTheatres = new Set(req.notifications.map((n) => n.showtime.theatreId));
    if (notifiedTheatres.has(showtime.theatreId)) continue;

    const langStr = showtime.language ? `${showtime.language} ` : "";
    const platStr = showtime.platform === "DISTRICT" ? "District" : "BookMyShow";
    const message = `${showtime.movie.title} has released at ${showtime.theatre.name} (${showtime.theatre.location.name})! Tickets are live on ${platStr} (${langStr}${showtime.format.name}) from ${formatDate(showtime.date)} at ${showtime.time}.`;

    const notification = await prisma.notification.create({
      data: {
        userId: req.userId,
        requestId: req.id,
        showtimeId: showtime.id,
        message,
      },
    });

    try {
      const emailResult = await sendAlertEmail(
        req.user.email,
        `Now showing at ${showtime.theatre.name}: ${showtime.movie.title}`,
        message,
      );
      if (emailResult.sent) {
        await prisma.notification.update({ where: { id: notification.id }, data: { emailSent: true } });
      }
    } catch (emailErr) {
      console.warn("[matching] release-alert email failed:", emailErr);
    }

    results.push(notification);

    // Every selected theatre notified -> the request is done
    notifiedTheatres.add(showtime.theatreId);
    if (theatreIds.every((id) => notifiedTheatres.has(id))) {
      await prisma.request.update({ where: { id: req.id }, data: { status: "COMPLETED" } });
    }
  }

  // Handle regular requests (match against showtime details)
  const candidateRequests = await prisma.request.findMany({
    where: {
      movieId: showtime.movieId,
      status: "ACTIVE",
      preRelease: false, // Only match non-pre-release requests
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
    const effectiveLang = showtime.language || showtime.movie.language;
    if (languages.length && !languages.includes(effectiveLang)) return false;
    if (req.date && !isSameDay(req.date, showtime.date)) return false;
    if (req.timeFrom && showtime.time < req.timeFrom) return false;
    if (req.timeTo && showtime.time > req.timeTo) return false;
    if (req.maxPrice && showtime.price != null && showtime.price > req.maxPrice) return false;
    return true;
  });

  for (const req of matched) {
    const langStr = showtime.language ? `${showtime.language} ` : "";
    const platStr = showtime.platform === "DISTRICT" ? "District" : "BookMyShow";
    const message = `${showtime.movie.title} (${langStr}${showtime.format.name}) tickets are live on ${platStr} at ${showtime.theatre.name} (${showtime.theatre.location.name}) on ${formatDate(showtime.date)} at ${showtime.time}.`;

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

    await prisma.request.update({ where: { id: req.id }, data: { status: "COMPLETED" } });

    results.push(notification);
  }

  return results;
}