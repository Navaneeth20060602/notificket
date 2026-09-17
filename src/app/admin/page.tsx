"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { todayInputDate, maxFutureInputDate } from "@/lib/date";

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  const [locations, setLocations] = useState<any[]>([]);
  const [theatres, setTheatres] = useState<any[]>([]);
  const [formats, setFormats] = useState<any[]>([]);
  const [movies, setMovies] = useState<any[]>([]);
  const [allRequests, setAllRequests] = useState<any[]>([]);
  const [monitorJobs, setMonitorJobs] = useState<any[]>([]);

  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [syncingTheatres, setSyncingTheatres] = useState(false);
  const [syncingMovies, setSyncingMovies] = useState(false);
  const [syncingShowtimes, setSyncingShowtimes] = useState(false);

  function flash(type: "ok" | "err", text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  function refreshAll() {
    fetch("/api/locations").then((r) => r.json()).then((d) => setLocations(d.locations || []));
    fetch("/api/theatres").then((r) => r.json()).then((d) => setTheatres(d.theatres || []));
    fetch("/api/formats").then((r) => r.json()).then((d) => setFormats(d.formats || []));
    fetch("/api/movies?status=RUNNING").then((r) => r.json()).then((d1) =>
      fetch("/api/movies?status=UPCOMING").then((r) => r.json()).then((d2) =>
        setMovies([...(d1.movies || []), ...(d2.movies || [])])
      )
    );
    fetch("/api/admin/requests").then((r) => r.json()).then((d) => setAllRequests(d.requests || []));
    fetch("/api/admin/monitor-jobs").then((r) => r.json()).then((d) => setMonitorJobs(d.jobs || []));
  }

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (!d.user) { router.replace("/login"); return; }
      if (d.user.role !== "ADMIN") { router.replace("/dashboard"); return; }
      setUser(d.user);
    });
    refreshAll();
  }, [router]);

  // ---- Add Location ----
  async function syncHyderabadTheatres() {
    setSyncingTheatres(true);
    const res = await fetch("/api/admin/import/hyderabad-theatres", { method: "POST" });
    const data = await res.json();
    setSyncingTheatres(false);
    flash(res.ok ? "ok" : "err", data.message || data.error || "Theatre sync failed");
    if (res.ok) refreshAll();
  }

  async function syncTmdbMovies() {
    setSyncingMovies(true);
    const res = await fetch("/api/admin/import/tmdb-movies", { method: "POST" });
    const data = await res.json();
    setSyncingMovies(false);
    flash(res.ok ? "ok" : "err", data.message || data.error || "Movie sync failed");
    if (res.ok) refreshAll();
  }

  async function syncHyderabadShowtimes() {
    setSyncingShowtimes(true);
    const res = await fetch("/api/admin/import/hyderabad-showtimes", { method: "POST" });
    const data = await res.json();
    setSyncingShowtimes(false);
    flash(res.ok ? "ok" : "err", data.message || data.error || "Showtime sync failed");
    if (res.ok) refreshAll();
  }

  const [locName, setLocName] = useState("");
  async function addLocation(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/locations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: locName }),
    });
    const d = await res.json();
    if (!res.ok) return flash("err", d.error);
    setLocName("");
    flash("ok", `Added location "${d.location.name}"`);
    refreshAll();
  }

  // ---- Add Theatre ----
  const [theatreName, setTheatreName] = useState("");
  const [theatreLocationId, setTheatreLocationId] = useState("");
  async function addTheatre(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/theatres", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: theatreName, locationId: theatreLocationId }),
    });
    const d = await res.json();
    if (!res.ok) return flash("err", d.error);
    setTheatreName("");
    flash("ok", `Added theatre "${d.theatre.name}"`);
    refreshAll();
  }

  // ---- Add Format ----
  const [formatName, setFormatName] = useState("");
  async function addFormat(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/formats", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: formatName }),
    });
    const d = await res.json();
    if (!res.ok) return flash("err", d.error);
    setFormatName("");
    flash("ok", `Added format "${d.format.name}"`);
    refreshAll();
  }

  // ---- Add Movie ----
  const [movieTitle, setMovieTitle] = useState("");
  const [movieLang, setMovieLang] = useState("Telugu");
  const [movieStatus, setMovieStatus] = useState("UPCOMING");
  const [movieRelease, setMovieRelease] = useState("");
  async function addMovie(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/movies", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: movieTitle, language: movieLang, status: movieStatus,
        releaseDate: movieRelease || null,
      }),
    });
    const d = await res.json();
    if (!res.ok) return flash("err", d.error);
    setMovieTitle(""); setMovieRelease("");
    flash("ok", `Added movie "${d.movie.title}"`);
    refreshAll();
  }

  // ---- Edit existing movie (fix wrong info) ----
  const [editMovieId, setEditMovieId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editLang, setEditLang] = useState("");
  useEffect(() => {
    const m = movies.find((mv) => mv.id === editMovieId);
    if (m) { setEditTitle(m.title); setEditLang(m.language); }
  }, [editMovieId, movies]);
  async function saveMovieEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editMovieId) return;
    const res = await fetch(`/api/movies/${editMovieId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle, language: editLang }),
    });
    const d = await res.json();
    if (!res.ok) return flash("err", d.error || "Failed to update");
    flash("ok", "Movie updated");
    refreshAll();
  }

  // ---- Simulate ticket release (stands in for the automatic poller) ----
  const [relMovieId, setRelMovieId] = useState("");
  const [relTheatreId, setRelTheatreId] = useState("");
  const [relFormatId, setRelFormatId] = useState("");
  const [relDate, setRelDate] = useState("");
  const [relTime, setRelTime] = useState("");
  const [relPrice, setRelPrice] = useState("");
  async function releaseShowtime(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/showtimes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movieId: relMovieId, theatreId: relTheatreId, formatId: relFormatId,
        date: relDate, time: relTime, price: relPrice ? Number(relPrice) : null,
      }),
    });
    const d = await res.json();
    if (!res.ok) return flash("err", d.error || "Failed");
    flash("ok", `Showtime added - ${d.notificationsSent} user(s) alerted`);
    refreshAll();
  }

  if (!user) return null;

  return (
    <main>
      <Navbar userName={user.name} role={user.role} />
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-semibold">Admin</h1>

        {msg && (
          <div className={`text-sm p-3 rounded-lg ${msg.type === "ok" ? "bg-green-950 text-green-300" : "bg-red-950 text-red-300"}`}>
            {msg.text}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-6">
          <section className="card p-5 space-y-3 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">Hyderabad theatre directory</h2>
                <p className="text-xs text-muted mt-1">Automatically finds cinemas and theatres from OpenStreetMap. It never replaces existing entries.</p>
              </div>
              <button className="btn-primary !py-1.5" disabled={syncingTheatres} onClick={syncHyderabadTheatres}>{syncingTheatres ? "Syncing..." : "Sync Hyderabad theatres"}</button>
            </div>
          </section>
          <section className="card p-5 space-y-3 sm:col-span-2">
            <div>
              <h2 className="font-medium">Always-on ticket monitor</h2>
              <p className="text-xs text-muted mt-1">The separate Railway monitor checks only movies with active user requests. It discovers a public Hyderabad ticket page, scans newly available dates and showtimes, and backs off if the source needs verification.</p>
            </div>
            {monitorJobs.length === 0 ? <p className="text-sm text-muted">No monitor jobs yet. A job starts automatically when a user saves an alert request.</p> : (
              <div className="space-y-2">
                {monitorJobs.slice(0, 8).map((job) => <div key={job.id} className="rounded-lg border border-subtle px-3 py-2 text-sm flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span>{job.movie.title} &middot; {job.location.name}</span>
                  <span className={job.failureCount ? "text-amber-300" : "text-green-300"}>{job.lastMessage || job.status}</span>
                </div>)}
              </div>
            )}
          </section>
          <section className="card p-5 space-y-3 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">Hyderabad running-movie showtimes</h2>
                <p className="text-xs text-muted mt-1">Checks the current movie catalogue for Hyderabad showtimes, then automatically adds newly discovered theatres, formats and showtimes. This consumes one provider search per active movie.</p>
              </div>
              <button className="btn-primary !py-1.5" disabled={syncingShowtimes} onClick={syncHyderabadShowtimes}>{syncingShowtimes ? "Syncing showtimes..." : "Sync Hyderabad showtimes"}</button>
            </div>
          </section>
          <section className="card p-5 space-y-3 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">Current & upcoming movies</h2>
                <p className="text-xs text-muted mt-1">Imports Indian current and upcoming films, release dates and posters from TMDB. Existing movies are updated, never duplicated.</p>
              </div>
              <button className="btn-primary !py-1.5" disabled={syncingMovies} onClick={syncTmdbMovies}>{syncingMovies ? "Syncing..." : "Sync movies from TMDB"}</button>
            </div>
          </section>

          <form onSubmit={addLocation} className="card p-5 space-y-3">
            <h2 className="font-medium">Add location</h2>
            <input className="input" placeholder="e.g. Hyderabad" value={locName} onChange={(e) => setLocName(e.target.value)} required />
            <button className="btn-primary w-full !py-1.5">Add</button>
          </form>

          <form onSubmit={addTheatre} className="card p-5 space-y-3">
            <h2 className="font-medium">Add theatre</h2>
            <input className="input" placeholder="e.g. PVR Banjara Hills" value={theatreName} onChange={(e) => setTheatreName(e.target.value)} required />
            <select className="input" value={theatreLocationId} onChange={(e) => setTheatreLocationId(e.target.value)} required>
              <option value="">Select location</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <button className="btn-primary w-full !py-1.5">Add</button>
          </form>

          <form onSubmit={addFormat} className="card p-5 space-y-3">
            <h2 className="font-medium">Add format</h2>
            <input className="input" placeholder="e.g. IMAX" value={formatName} onChange={(e) => setFormatName(e.target.value)} required />
            <button className="btn-primary w-full !py-1.5">Add</button>
          </form>

          <form onSubmit={addMovie} className="card p-5 space-y-3">
            <h2 className="font-medium">Add movie</h2>
            <input className="input" placeholder="Title" value={movieTitle} onChange={(e) => setMovieTitle(e.target.value)} required />
            <select className="input" value={movieLang} onChange={(e) => setMovieLang(e.target.value)}>
              {["Telugu","Hindi","English","Tamil","Kannada","Malayalam","Marathi","Bengali"].map((l) => <option key={l}>{l}</option>)}
            </select>
            <select className="input" value={movieStatus} onChange={(e) => setMovieStatus(e.target.value)}>
              <option value="UPCOMING">Upcoming</option>
              <option value="RUNNING">Running</option>
            </select>
            <input type="date" className="input" value={movieRelease} min={todayInputDate()} max={maxFutureInputDate()} onChange={(e) => setMovieRelease(e.target.value)} />
            <button className="btn-primary w-full !py-1.5">Add</button>
          </form>
        </div>

        <form onSubmit={saveMovieEdit} className="card p-5 space-y-3">
          <h2 className="font-medium">Fix movie info</h2>
          <select className="input" value={editMovieId} onChange={(e) => setEditMovieId(e.target.value)}>
            <option value="">Select a movie to edit</option>
            {movies.map((m) => <option key={m.id} value={m.id}>{m.title} ({m.language})</option>)}
          </select>
          {editMovieId && (
            <>
              <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              <select className="input" value={editLang} onChange={(e) => setEditLang(e.target.value)}>
                {["Telugu","Hindi","English","Tamil","Kannada","Malayalam","Marathi","Bengali"].map((l) => <option key={l}>{l}</option>)}
              </select>
              <button className="btn-primary w-full !py-1.5">Save changes</button>
            </>
          )}
        </form>

        <form onSubmit={releaseShowtime} className="card p-5 space-y-3">
          <h2 className="font-medium">Simulate a ticket release</h2>
          <p className="text-xs text-muted -mt-1">
            Stands in for the automatic poller detecting new tickets - use this to test the alert pipeline end to end.
          </p>
          <select className="input" value={relMovieId} onChange={(e) => setRelMovieId(e.target.value)} required>
            <option value="">Movie</option>
            {movies.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          <select className="input" value={relTheatreId} onChange={(e) => setRelTheatreId(e.target.value)} required>
            <option value="">Theatre</option>
            {theatres.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="input" value={relFormatId} onChange={(e) => setRelFormatId(e.target.value)} required>
            <option value="">Format</option>
            {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <div className="grid grid-cols-3 gap-2">
            <input type="date" className="input" value={relDate} min={todayInputDate()} max={maxFutureInputDate()} onChange={(e) => setRelDate(e.target.value)} required />
            <input type="time" className="input" value={relTime} onChange={(e) => setRelTime(e.target.value)} required />
            <input type="number" className="input" placeholder="Price" value={relPrice} onChange={(e) => setRelPrice(e.target.value)} />
          </div>
          <button className="btn-primary w-full !py-1.5">Release tickets</button>
        </form>

        <div>
          <h2 className="font-medium mb-3">All user requests (read-only)</h2>
          <div className="space-y-2">
            {allRequests.map((r) => (
              <div key={r.id} className="card p-3 text-sm flex justify-between">
                <span>{r.user.name} &middot; {r.movie.title}</span>
                <span className="text-muted">{r.status}</span>
              </div>
            ))}
            {allRequests.length === 0 && <p className="text-muted text-sm">No requests yet.</p>}
          </div>
        </div>
      </div>
    </main>
  );
}
