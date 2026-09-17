// ============================================================================
// THIS FILE IS A PLACEHOLDER / STARTING POINT - NOT A FINISHED SCRAPER.
// ============================================================================
//
// In the real product, this file would run on a schedule (cron, or a queue
// worker) and would:
//   1. Look up every DISTINCT movie that has at least one ACTIVE Request
//      (no point checking movies nobody is tracking).
//   2. For each one, call BookMyShow's / District's internal endpoints to
//      get the current list of live shows for that movie.
//   3. Compare that list against what's already in our `Showtime` table.
//   4. For every show that's new, insert it as a `Showtime` row and call
//      matchShowtimeAgainstRequests() from ../lib/matching.ts - that's what
//      actually notifies users.
//
// WHY THIS ISN'T WIRED UP TO A REAL SITE YET:
//   - BookMyShow/District don't offer a public API - integrating with them
//     means reverse-engineering their current internal endpoints, which
//     change over time and are easy to get blocked calling too aggressively
//     (see the conversation for the full explanation of that risk).
//   - That has to be done and tested from your own machine/network, not from
//     this sandbox, since it depends on live, changing endpoints.
//
// WHAT TO DO NEXT: once you tell me you want to wire up real polling, we'll
// write the actual fetch logic here, with rate limiting and backoff built in.
//
// For now, use the admin dashboard's "Add showtime" action (or the seed
// script) to simulate "tickets going live" - it calls the exact same
// matchShowtimeAgainstRequests() function this would call, so the alert
// pipeline is fully real and testable today. Only the "detect it
// automatically from BookMyShow" step is stubbed out.

import { prisma } from "../lib/db";
import { matchShowtimeAgainstRequests } from "../lib/matching";

export async function pollAllTrackedMovies() {
  const trackedMovieIds = await prisma.request.findMany({
    where: { status: "ACTIVE" },
    select: { movieId: true },
    distinct: ["movieId"],
  });

  console.log(`[poll] would check ${trackedMovieIds.length} movie(s) against the real ticketing site here.`);
  console.log("[poll] this is a stub - see the comment at the top of this file.");

  return { checked: trackedMovieIds.length };
}
