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
      movieId_theatreId_formatId_date_time: {
        movieId: runningMovie.id,
        theatreId: theatres["PVR Banjara Hills"],
        formatId: formats["2D"],
        date: new Date(new Date().toDateString()),
        time: "19:30",
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

  // --- Curated iconic dialogue wall for the landing page ---
  // Replaced as a set so repeated seeds keep the wall current and consistent.
  const wallQuotes: { text: string; movie: string; language: string }[] = [
    { text: "Okka sari commit ayithe naa maata nene vinanu…", movie: "Pokiri · Mahesh Babu", language: "Telugu" },
    { text: "Naaku konchem tikkundi… kaani daanikoka lekkundi.", movie: "Gabbar Singh · Pawan Kalyan", language: "Telugu" },
    { text: "Cutout chusi konni konni nammeyyali dude.", movie: "Mirchi · Prabhas", language: "Telugu" },
    { text: "Mokke kada ani peekeste peeka kostha.", movie: "Indra · Chiranjeevi", language: "Telugu" },
    { text: "Taggede le!", movie: "Pushpa: The Rise · Allu Arjun", language: "Telugu" },
    { text: "Mere paas maa hai.", movie: "Deewaar · Amitabh Bachchan", language: "Hindi" },
    { text: "Bade bade deshon mein aisi chhoti chhoti baatein hoti rehti hain, Senorita.", movie: "DDLJ · Shah Rukh Khan", language: "Hindi" },
    { text: "Ek baar jo maine commitment kar di…", movie: "Wanted · Salman Khan", language: "Hindi" },
    { text: "All is well!", movie: "3 Idiots · Aamir Khan", language: "Hindi" },
    { text: "Tareekh pe tareekh!", movie: "Damini · Sunny Deol", language: "Hindi" },
    { text: "Naan oru thadava sonna, nooru thadava sonna madhiri.", movie: "Baasha · Rajinikanth", language: "Tamil" },
    { text: "Naalu perukku nalladhuna, edhuvum thappilla.", movie: "Nayakan · Kamal Haasan", language: "Tamil" },
    { text: "I'm waiting.", movie: "Mersal · Vijay", language: "Tamil" },
    { text: "Yaaru nu theriyuma?", movie: "Singam · Suriya", language: "Tamil" },
    { text: "Violence, violence, violence. I don't like it. I avoid it. But violence likes me.", movie: "KGF: Chapter 1 · Yash", language: "Kannada" },
    { text: "Tagaru banthu tagaru.", movie: "Tagaru · Shiva Rajkumar", language: "Kannada" },
    { text: "Appu andre Appu.", movie: "Appu · Puneeth Rajkumar", language: "Kannada" },
    { text: "Nee po mone Dinesha!", movie: "Narasimham · Mohanlal", language: "Malayalam" },
    { text: "Chanduvine tholpikkan ningalkkavilla, makkale!", movie: "Oru Vadakkan Veeragatha · Mammootty", language: "Malayalam" },
    { text: "Ormayundo ee mukham?", movie: "Commissioner · Suresh Gopi", language: "Malayalam" },
    { text: "Aata majhi satakli!", movie: "Singham · Nana Patekar", language: "Marathi" },
    { text: "Mi Shivajiraje Bhosale boltoy!", movie: "Mi Shivajiraje Bhosale Boltoy · Subodh Bhave", language: "Marathi" },
    { text: "Amake amar moto thakte dao.", movie: "Autograph · Prosenjit Chatterjee", language: "Bengali" },
    { text: "Feluda.", movie: "Sonar Kella · Soumitra Chatterjee", language: "Bengali" },
    { text: "I'll be back.", movie: "The Terminator · Arnold Schwarzenegger", language: "English" },
    { text: "Why so serious?", movie: "The Dark Knight · Heath Ledger", language: "English" },
    { text: "Say hello to my little friend!", movie: "Scarface · Al Pacino", language: "English" },
    { text: "Yo, Adrian!", movie: "Rocky · Sylvester Stallone", language: "English" },
    { text: "I know kung fu.", movie: "The Matrix · Keanu Reeves", language: "English" },
  ];
  await prisma.quote.deleteMany();
  await prisma.quote.createMany({ data: wallQuotes });

  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
