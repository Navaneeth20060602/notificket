import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // --- Locations ---
  const cityNames = ["Hyderabad", "Bengaluru", "Chennai", "Mumbai"];
  const locations: Record<string, string> = {};
  for (const name of cityNames) {
    const loc = await prisma.location.upsert({
      where: { name }, update: {}, create: { name },
    });
    locations[name] = loc.id;
  }

  // --- Theatres ---
  const theatreSeed: [string, string][] = [
    ["PVR Banjara Hills", "Hyderabad"],
    ["AMB Cinemas", "Hyderabad"],
    ["PVR Forum Mall", "Bengaluru"],
    ["INOX Chennai Citi Centre", "Chennai"],
    ["PVR Phoenix Marketcity", "Mumbai"],
  ];
  const theatres: Record<string, string> = {};
  for (const [name, city] of theatreSeed) {
    const t = await prisma.theatre.upsert({
      where: { name_locationId: { name, locationId: locations[city] } },
      update: {},
      create: { name, locationId: locations[city] },
    });
    theatres[name] = t.id;
  }

  // --- Formats ---
  const formatNames = ["2D", "3D", "IMAX", "4DX"];
  const formats: Record<string, string> = {};
  for (const name of formatNames) {
    const f = await prisma.format.upsert({ where: { name }, update: {}, create: { name } });
    formats[name] = f.id;
  }

  // --- Movies: a couple currently running (with showtimes), a couple upcoming (no showtimes yet) ---
  const runningMovie = await prisma.movie.upsert({
    where: { title_language: { title: "Sample Running Movie", language: "Telugu" } },
    update: {},
    create: { title: "Sample Running Movie", language: "Telugu", status: "RUNNING" },
  });
  await prisma.showtime.upsert({
    where: {
      movieId_theatreId_formatId_date_time_platform: {
        movieId: runningMovie.id,
        theatreId: theatres["PVR Banjara Hills"],
        formatId: formats["2D"],
        date: new Date(new Date().toDateString()),
        time: "19:30",
        platform: "BMS",
      },
    },
    update: {},
    create: {
      movieId: runningMovie.id,
      theatreId: theatres["PVR Banjara Hills"],
      formatId: formats["2D"],
      date: new Date(new Date().toDateString()),
      time: "19:30",
      price: 220,
      seatsAvailable: 84,
    },
  });

  const upcomingDate = new Date();
  upcomingDate.setDate(upcomingDate.getDate() + 14);
  await prisma.movie.upsert({
    where: { title_language: { title: "Sample Upcoming Movie", language: "Hindi" } },
    update: {},
    create: {
      title: "Sample Upcoming Movie",
      language: "Hindi",
      status: "UPCOMING",
      releaseDate: upcomingDate,
    },
  });

  // --- Original sample copy for the landing page quote wall ---
  // Replaced as a set so repeated seeds keep the wall current and consistent.
  const wallQuotes: { text: string; movie: string; language: string }[] = [
    { text: "Some stories deserve the biggest screen.", movie: "Notificket · Original", language: "English" },
    { text: "Make room for one more movie night.", movie: "Notificket · Original", language: "English" },
    { text: "Good company. Great stories. A seat saved just in time.", movie: "Notificket · Original", language: "English" },
    { text: "The best part of a movie night is being there for the opening scene.", movie: "Notificket · Original", language: "English" },
    { text: "Pick a film, find your seats, and enjoy the show.", movie: "Notificket · Original", language: "English" },
  ];
  await prisma.quote.deleteMany();
  await prisma.quote.createMany({ data: wallQuotes });

  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
