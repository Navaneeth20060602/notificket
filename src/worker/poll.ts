import { prisma } from "../lib/db";
import { syncMovieShowtimes } from "../lib/showtime-sync";

const CHECK_EVERY_MINUTES = Number(process.env.MONITOR_INTERVAL_MINUTES || 20);
const MAX_JOBS_PER_CYCLE = Number(process.env.MONITOR_MAX_JOBS_PER_CYCLE || 3);
const nextCheck = (minutes = CHECK_EVERY_MINUTES) => new Date(Date.now() + minutes * 60_000);

export async function pollAllTrackedMovies() {
  // 1. Ensure a monitor job exists for every active request's movie+location
  //    This covers BOTH running and upcoming movies with user alert requests.
  const tracked = await prisma.request.findMany({
    where: { status: "ACTIVE" },
    select: { movieId: true, locationId: true },
    distinct: ["movieId", "locationId"],
  });

  for (const target of tracked) {
    if (target.locationId) {
      await prisma.monitorJob.upsert({
        where: { movieId_locationId: { movieId: target.movieId, locationId: target.locationId } },
        update: { status: "ACTIVE" },
        create: { movieId: target.movieId, locationId: target.locationId, lastMessage: "Queued from an active ticket request." },
      });
    }
  }

  // 2. Also queue all RUNNING movies in Hyderabad for continuous showtime sync
  const hyderabad = await prisma.location.findFirst({ where: { name: "Hyderabad" }, select: { id: true } });
  let runningMovieCount = 0;
  if (hyderabad) {
    const runningMovies = await prisma.movie.findMany({ where: { status: "RUNNING" }, select: { id: true } });
    runningMovieCount = runningMovies.length;
    for (const movie of runningMovies) {
      await prisma.monitorJob.upsert({
        where: { movieId_locationId: { movieId: movie.id, locationId: hyderabad.id } },
        update: { status: "ACTIVE" },
        create: { movieId: movie.id, locationId: hyderabad.id, lastMessage: "Queued for Hyderabad running-movie catalogue sync." },
      });
    }
  }

  // 3. Execute due monitor jobs (handles both RUNNING movies and UPCOMING movies with requests)
  //    For UPCOMING movies: syncMovieShowtimes searches BMS + District + TOI — if tickets are
  //    found on either platform, shows are saved, movie status becomes RUNNING, and users are notified.
  const jobs = await prisma.monitorJob.findMany({
    where: { status: "ACTIVE", nextCheckAt: { lte: new Date() } },
    include: { movie: true },
    orderBy: { nextCheckAt: "asc" },
    take: MAX_JOBS_PER_CYCLE,
  });

  let added = 0;
  for (const job of jobs) {
    try {
      const fastAdded = await syncMovieShowtimes(job.movieId, job.movie.title, job.movie.language);
      added += fastAdded;

      const isUpcoming = job.movie.status === "UPCOMING";
      const ticketsFound = fastAdded > 0;

      await prisma.monitorJob.update({
        where: { id: job.id },
        data: {
          lastCheckedAt: new Date(),
          nextCheckAt: nextCheck(),
          failureCount: ticketsFound ? 0 : job.failureCount,
          lastMessage: ticketsFound
            ? `${fastAdded} new showtimes added via BMS + District + TOI.`
            : isUpcoming
            ? "No tickets yet on BookMyShow or District; will check again next cycle."
            : "No new showtimes found; will retry next cycle.",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected monitor failure.";
      console.warn(`[monitor] ${job.movie.title}: ${message}`);
      await prisma.monitorJob.update({
        where: { id: job.id },
        data: {
          lastCheckedAt: new Date(),
          nextCheckAt: nextCheck(Math.min(720, 30 * Math.max(1, job.failureCount + 1))),
          failureCount: { increment: 1 },
          lastMessage: message,
        },
      });
    }
  }

  return { tracked: tracked.length, running: runningMovieCount, checked: jobs.length, added };
}
