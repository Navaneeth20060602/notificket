import { pollAllTrackedMovies } from "./poll";

const intervalMinutes = Number(process.env.MONITOR_INTERVAL_MINUTES || 20);
async function cycle() {
  try { const result = await pollAllTrackedMovies(); console.log(`[monitor] tracked=${result.tracked} checked=${result.checked} added=${result.added}`); }
  catch (error) { console.error("[monitor] cycle failed", error); }
}
console.log(`[monitor] started; checking due tracked movies every ${intervalMinutes} minutes`);
cycle();
setInterval(cycle, intervalMinutes * 60_000);
