# Notificket

Notificket helps moviegoers track movie ticket availability. Users can request alerts for a movie, location, theatre, date, time range, format, and price. When a matching showtime is added, the app records a notification and can send an email.

This repository contains a Next.js app, Prisma database schema, and an optional unpacked Chrome/Brave extension for capturing showtimes visible in a browser tab.

## Features

- Register, log in, reset passwords, and choose light or dark theme
- Browse and filter running and upcoming movies
- Create, edit, and cancel ticket alert requests
- Admin pages for managing movies, theatres, locations, formats, showtimes, and feedback
- Match showtimes to active requests and create in-app notifications
- Optional email delivery through Brevo
- Optional browser extension for capturing visible showtimes

## Project status

This is a portfolio project, not a production ticketing integration. Automatic polling is not connected to BookMyShow or District. Monitor and catalogue-import flows depend on configured services and credentials. The browser extension reads showtimes visible on a page you open yourself; it does not book tickets or bypass site controls. Review captured details before submitting them.

The sample database seed adds cities, theatres, formats, movies, showtimes, and original sample quotes. It does not create a user account. On a fresh database, the first registered account becomes an administrator.

## Requirements

- Node.js 20 or newer
- npm
- SQLite for local development

## Run locally

1. Clone the repository and enter the project directory:

   ~~~sh
   git clone https://github.com/Navaneeth20060602/notificket.git
   cd notificket
   ~~~

2. Install dependencies and create a local environment file:

   ~~~sh
   npm ci
   cp .env.example .env
   ~~~

   In Windows PowerShell, use Copy-Item .env.example .env if needed.

3. Apply the checked-in database migrations and generate Prisma Client:

   ~~~sh
   npm run db:migrate
   ~~~

4. Optionally add sample catalogue data, then start the app:

   ~~~sh
   npm run db:seed
   npm run dev
   ~~~

5. Open http://localhost:3000 and register. The first account on an empty database receives the administrator role; later registrations are regular users.

## Environment variables

Use the checked-in .env.example for local development. Keep real credentials in .env or your deployment provider's secret settings; never commit them.

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | Prisma database connection; the example uses a local SQLite file. |
| JWT_SECRET | Session signing secret. Production requires a random value of at least 32 characters; it may be blank for local development. |
| TMDB_API_KEY / TMDB_READ_ACCESS_TOKEN | Optional TMDB credentials for catalogue imports. |
| SERP_SEARCH_API_KEY | Optional Bright Data API token for the Hyderabad showtime search flow. |
| BRIGHTDATA_ZONE | Bright Data zone used by that search flow. |
| SHOWTIME_INGEST_KEY | Shared secret required by the browser extension ingestion endpoint. |
| MONITOR_INTERVAL_MINUTES / MONITOR_MAX_JOBS_PER_CYCLE | Optional monitor worker settings. |
| BREVO_API_KEY | Optional Brevo API key for alert and password reset emails. Without it, email content is logged locally. |
| SMTP_FROM | Verified sender email configured in Brevo. Delivery uses Brevo's HTTPS API, not SMTP; this variable name is retained for compatibility. |

Generate a random secret with Node.js:

~~~sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
~~~

## Browser extension

1. Set SHOWTIME_INGEST_KEY in the server environment and restart the app.
2. In Chrome or Brave, open chrome://extensions, enable **Developer mode**, and choose **Load unpacked**. Select this repository's extension folder.
3. Open a supported BookMyShow or District showtime page normally. Open the extension and review the detected movie, theatre, date, format, and times.
4. Enter the app URL and the same ingestion key, then submit the selected showtimes.

Treat the ingestion key like a password. Do not share it or publish a configured browser profile. The extension defaults to http://localhost:3000.

## Useful commands

| Command | Description |
| --- | --- |
| npm run dev | Start the development server |
| npm run build | Build the Next.js app |
| npm run start | Run the production server after a build |
| npx prisma migrate dev | Apply local development migrations |
| npm run db:generate | Generate Prisma Client |
| npm run db:seed | Add sample catalogue and quote data |
| npm run db:studio | Open Prisma Studio |
| npm run monitor | Start the monitor worker |

## Deployment notes

The included Dockerfile and railway.toml are configured for Railway with PostgreSQL. Configure the database URL and required secrets in Railway before deployment. Local development uses SQLite; the Docker build generates a PostgreSQL Prisma client. Review the deployment configuration and database migration strategy before using it with real users or data.

## License

No license file is included. Public visibility alone does not grant permission to reuse, modify, or distribute this code. Add a license that matches your intent before inviting contributions or reuse.
