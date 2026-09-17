import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import QuoteWall from "@/components/QuoteWall";

export default async function LandingPage() {
  const [quotes, user] = await Promise.all([prisma.quote.findMany(), getCurrentUser()]);

  return (
    <main>
      <Navbar userName={user?.name} role={user?.role as any} />

      {/* Hero / about us */}
      <section className="px-6 pt-16 pb-12 text-center max-w-2xl mx-auto">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Stop refreshing the <span className="brand-gradient-text">booking app.</span>
        </h1>
        <p className="mt-5 text-muted text-lg leading-relaxed">
          Notificket is a small tool built to solve one very specific, very
          annoying problem: sitting there hitting refresh, over and over,
          hoping tickets for the movie you actually care about finally go
          live. Tell us the movie, theatre, format and time you want. The
          moment tickets open, we tell you first &mdash; so you can go back
          to literally anything else with your evening.
        </p>
        {!user && (
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/register" className="btn-primary">Get started free</Link>
            <Link href="/login" className="btn-secondary">Log in</Link>
          </div>
        )}
        {user && (
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/dashboard" className="btn-primary">Go to dashboard</Link>
            <Link href="/dashboard" className="btn-secondary">Browse movies</Link>
          </div>
        )}
      </section>

      {/* Quote wall */}
      <section className="px-6 pb-20 max-w-5xl mx-auto">
        <p className="text-center text-xs uppercase tracking-widest text-faint mb-4">Iconic cinema dialogue wall</p>
        <QuoteWall quotes={quotes as any} />
      </section>

      {/* About + Contact footer */}
      <footer id="about" className="border-t border-subtle px-6 py-14 bg-surface">
        <div className="max-w-5xl mx-auto grid sm:grid-cols-3 gap-10">
          <div>
            <p className="font-semibold text-lg mb-2">
              Notif<span className="text-brand-500">icket</span>
            </p>
            <p className="text-sm text-muted leading-relaxed">
              A ticket-release alert tool for movie-goers who want to be first
              in line when tickets open.
            </p>
          </div>

          <div id="about-section">
            <p className="font-medium mb-2">About</p>
            <p className="text-sm text-muted leading-relaxed">
              Notificket tracks the movies, theatres and formats you care
              about and watches for new tickets to open, so you don't have
              to keep checking yourself.
            </p>
          </div>

          <div id="contact">
            <p className="font-medium mb-2">Contact</p>
            <p className="text-sm text-muted leading-relaxed">
              Questions, feedback, or just want to talk about the build?
              <br />
              <a href="mailto:navaneethkrishna921133@gmail.com" className="text-brand-400">
                navaneethkrishna921133@gmail.com
              </a>
            </p>
          </div>
        </div>
        <p className="text-center text-xs text-faint mt-10">&copy; {new Date().getFullYear()} Notificket.</p>
        <p className="text-center text-xs text-faint mt-2">Theatre directory data &copy; <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>.</p>
      </footer>
    </main>
  );
}
