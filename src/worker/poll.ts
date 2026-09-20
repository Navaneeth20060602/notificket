import { prisma } from "../lib/db";
import { syncMovieShowtimes } from "../lib/showtime-sync";

const CHECK_EVERY_MINUTES = Number(process.env.MONITOR_INTERVAL_MINUTES || 20);
const MAX_JOBS_PER_CYCLE = Number(process.env.MONITOR_MAX_JOBS_PER_CYCLE || 3);
const nextCheck = (minutes = CHECK_EVERY_MINUTES) => new Date(Date.now() + minutes * 60_000);

export async function pollAllTrackedMovies() {
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
      await prisma.monitorJob.update({
        where: { id: job.id },
        data: {
          lastCheckedAt: new Date(),
          nextCheckAt: nextCheck(),
          failureCount: fastAdded > 0 ? 0 : job.failureCount,
          lastMessage: fastAdded > 0
            ? `${fastAdded} new showtimes added via TOI.`
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
