import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeName, requireAdmin } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

type OverpassElement = { tags?: { name?: string } };

// One small Hyderabad-only query. This is catalogue discovery, not ticket polling.
// Public Overpass instances are shared resources, so this route is deliberately
// admin-only and intended for occasional refreshes (not per-user page loads).
export async function POST() {
  try {
    await requireAdmin();
  } catch (res) {
    return res as NextResponse;
  }

  const hyderabad = await prisma.location.findFirst({ where: { name: { equals: "Hyderabad" } } });
  if (!hyderabad) return NextResponse.json({ error: "Hyderabad is not in the catalogue yet." }, { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const query = `[out:json][timeout:15];(nwr["amenity"="cinema"](17.20,78.20,17.62,78.72);nwr["amenity"="theatre"](17.20,78.20,17.62,78.72););out tags;`;
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Notificket catalogue sync/1.0 (contact: navaneethkrishna921133@gmail.com)" },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ error: "The theatre directory is temporarily unavailable. Try again later." }, { status: 502 });
    const payload = await response.json() as { elements?: OverpassElement[] };
    const names = [...new Set((payload.elements || []).map((element) => element.tags?.name?.trim()).filter((name): name is string => Boolean(name)))];
    const existing = await prisma.theatre.findMany({ where: { locationId: hyderabad.id }, select: { name: true } });
    const existingNames = new Set(existing.map((theatre) => normalizeName(theatre.name)));
    const newNames = names.filter((name) => !existingNames.has(normalizeName(name)));
    // SQLite does not support Prisma's skipDuplicates option; names are
    // pre-deduplicated above and the composite database constraint remains a safeguard.
    for (const name of newNames) {
      try {
        await prisma.theatre.create({ data: { name, locationId: hyderabad.id } });
      } catch {
        // A concurrent sync may have inserted it after our initial check.
      }
    }
    return NextResponse.json({ found: names.length, added: newNames.length, message: `Found ${names.length} Hyderabad venues; added ${newNames.length} new theatres.` });
  } catch {
    return NextResponse.json({ error: "Could not reach the theatre directory. Please try again later." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
