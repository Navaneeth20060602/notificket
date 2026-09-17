# Notificket - movie ticket release alert app

A starter build of the app we planned: users save "alert me when tickets for
this movie open at this theatre/time/format/price" requests, and an admin
manages the movie/theatre/location/format catalog.

## What's real vs. what's a placeholder

**Fully working today:**
- Register / log in (first account you create automatically becomes admin)
- Light/dark mode toggle (top-right of the navbar), remembered across visits
- Landing page with an about-us intro and a multi-language auto-scrolling quote wall
- Browse "Active" (running) and "Upcoming" movies, search, filter by language
- View showtimes for a running movie
- Save an alert request for an upcoming movie (theatre, exact date, time range, format, price) - dates are validated so you can't pick something in the past
- View / fully edit (all fields, not just a few) / cancel your own requests
- Admin: add location / theatre / format / movie (blocks duplicates), fix wrong movie info
- Admin: view every user's requests (read-only, can't edit/respond - as you asked)
- The actual alert pipeline: when a showtime is added, everyone with a
  matching active request gets a Notification row + an email attempt
- All dates shown as DD/MM/YYYY consistently throughout the app

**Placeholder / stubbed (see the comments in the code for why):**
- `src/worker/poll.ts` - this is where automatic polling of BookMyShow/District
  would live. It's not connected to the real sites yet (see our earlier
  conversation about why that's fragile and needs to be built + tested from
  your own machine). For now, the admin dashboard has a **"Simulate a ticket
  release"** form that creates a real Showtime row and runs the exact same
  notification logic the real poller would - so you can test the whole alert
  flow today.
- Landing page quotes are placeholder text, not real movie dialogue (that's
  copyrighted - add your own via `npm run db:studio` once you've picked ones
  you're comfortable using).
- Emails: if you don't set SMTP credentials in `.env`, alerts are just logged
  to your terminal instead of actually sent - so nothing breaks with zero
  setup. Add real SMTP creds later (e.g. a free Resend.com account) to send
  real emails.
- Location auto-detect asks for browser permission but doesn't yet map your
  coordinates to a city (that needs a geocoding API) - so pick your city from
  the dropdown for now.

## Browser-assisted ticket detection

`extension/` contains an unpacked Chrome/Brave extension for portfolio and
local use. It does not automate ticketing sites or circumvent their controls.
Instead, after you open a movie page normally, it captures the showtimes you
can see and sends your verified selections to Notificket. New showtimes invoke
the same request-matching and email-alert path as any other source.

1. Add a random `SHOWTIME_INGEST_KEY` to `.env` (see `.env.example`).
2. In Chrome/Brave, open `chrome://extensions`, enable **Developer mode**, then
   click **Load unpacked** and select the `extension` folder in this project.
3. Open a BookMyShow/District movie page normally, open the extension, check
   the movie, theatre, date, format and selected times, then save.
4. The extension must use the same `SHOWTIME_INGEST_KEY` as `.env`; it is
   stored only in that browser profile. Do not publish the extension with a key.

## Setup (step by step)

You'll need [Node.js](https://nodejs.org) installed (version 18 or higher).

1. Unzip this project and open a terminal inside the folder.

2. Install dependencies:
   ```
   npm install
   ```

3. Create your `.env` file from the example:
   ```
   cp .env.example .env
   ```
   (On Windows, just copy `.env.example` and rename the copy to `.env`.)
   You don't need to change anything in it to get started - it uses a local
   SQLite database file, no separate database server needed.

4. Create the database tables:
   ```
   npm run db:migrate
   ```
   This also generates the Prisma Client automatically. If you ever see an
   error like `@prisma/client did not initialize yet`, just run:
   ```
   npx prisma generate
   ```
   and restart `npm run dev`.

5. Add sample data (a demo admin login, a few cities/theatres/formats, and
   two sample movies) so the app isn't empty:
   ```
   npm run db:seed
   ```

6. Start the app:
   ```
   npm run dev
   ```

7. Open [http://localhost:3000](http://localhost:3000)

**Demo login:** `admin@example.com` / `password123` (this account is an
admin - use the Admin link in the navbar). Or just register your own account
- remember, the very first account ever created on a fresh database
automatically becomes admin.

## Trying the full alert flow end to end

1. Log in as a normal (non-admin) user, or register a second account.
2. Go to an Upcoming movie, save an alert request (e.g. any theatre, no date limit).
3. Log in as admin (`admin@example.com`).
4. Go to Admin -> "Simulate a ticket release", pick that movie/theatre/format/date/time, submit.
5. Log back in as the user and check "My requests" - it should have moved to
   Completed, with the notification message shown. Check your terminal too -
   you'll see the "email" logged there.

## Useful commands

- `npm run db:studio` - opens a visual editor for your database (add quotes,
  inspect data, etc.) in the browser
- `npm run dev` - run the app locally
- `npm run build` - production build (checks for errors)

## Next steps (tell me what you want to tackle first)

- Wire up real polling against BookMyShow/District (`src/worker/poll.ts`)
- Real email sending (just needs SMTP credentials in `.env`)
- Switch from SQLite to PostgreSQL for production
- Deploy it somewhere (Railway/Render/VPS)
- Replace placeholder quotes with real ones + a nicer visual design pass
