"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { formatDate, toInputDate, todayInputDate, maxFutureInputDate } from "@/lib/date";

const TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const suffix = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 || 12;
  return { value, label: `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}` };
});

export default function MovieDetailPage() {
  const params = useParams();
  const router = useRouter();
  const movieId = params.id as string;

  const [user, setUser] = useState<any>(null);
  const [movie, setMovie] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [theatres, setTheatres] = useState<any[]>([]);
  const [formats, setFormats] = useState<any[]>([]);
  const [showtimeDate, setShowtimeDate] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [hideCompleted, setHideCompleted] = useState(false);
  const [showtimeTheatreSearch, setShowtimeTheatreSearch] = useState("");

  // request form state
  const [locationId, setLocationId] = useState("");
  const [theatreIds, setTheatreIds] = useState<string[]>([]);
  const [theatreSearch, setTheatreSearch] = useState("");
  const [theatreMenuOpen, setTheatreMenuOpen] = useState(false);
  const [formatIds, setFormatIds] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const [syncing, setSyncing] = useState(false);

  function loadMovie(sync = false) {
    if (sync) setSyncing(true);
    fetch(`/api/movies/${movieId}${sync ? "?sync=true" : ""}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.movie) {
          setMovie(d.movie);
          if (d.movie.language) setLanguages([d.movie.language]);
        }
      })
      .finally(() => {
        if (sync) setSyncing(false);
      });
  }

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (!d.user) router.replace("/login");
      else setUser(d.user);
    });
    loadMovie();
    fetch("/api/locations").then((r) => r.json()).then((d) => setLocations(d.locations || []));
    fetch("/api/formats").then((r) => r.json()).then((d) => setFormats(d.formats || []));
  }, [movieId, router]);

  useEffect(() => {
    if (!locationId) {
      setTheatres([]);
      setTheatreMenuOpen(false);
      return;
    }
    fetch(`/api/theatres?locationId=${locationId}`).then((r) => r.json()).then((d) => setTheatres(d.theatres || []));
  }, [locationId]);

  useEffect(() => {
    if (!movie) return;
    const nowDate = todayInputDate();
    const validDates = (movie.showtimes || [])
      .filter((s: any) => toInputDate(s.date) >= nowDate)
      .map((s: any) => toInputDate(s.date))
      .sort();
    const firstDate = validDates[0];
    if (firstDate && !validDates.includes(showtimeDate)) {
      setShowtimeDate(firstDate);
    }
  }, [movie, showtimeDate]);

  function toggle(values: string[], value: string, setValues: (values: string[]) => void) {
    setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movieId,
        locationId,
        theatreIds,
        formatIds,
        languages,
        date,
        timeFrom: timeFrom || null,
        timeTo: timeTo || null,
        maxPrice: maxPrice ? Number(maxPrice) : null,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const d = await res.json();
      setError(d.error || "Something went wrong");
      return;
    }
    setSubmitted(true);
  }

  if (!user || !movie) return null;

  const nowDate = todayInputDate();
  const nowTime = new Date().toTimeString().slice(0, 5);

  // 1. Exclude previous day shows (only keep today and future dates)
  const nonPastDayShowtimes = (movie.showtimes || []).filter((s: any) => {
    return toInputDate(s.date) >= nowDate;
  });

  // Extract all distinct languages available across all current showtimes
  const availableLanguages: string[] = Array.from(
    new Set<string>(
      nonPastDayShowtimes
        .map((s: any) => s.language)
        .filter(Boolean)
    )
  );

  const showtimeDates: string[] = Array.from(
    new Set<string>(nonPastDayShowtimes.map((s: any) => toInputDate(s.date)))
  ).sort();

  // Filter for the selected date and filters
  const visibleShowtimes = nonPastDayShowtimes
    .filter((s: any) => toInputDate(s.date) === showtimeDate)
    .filter((s: any) => !selectedLanguage || s.language === selectedLanguage)
    .filter((s: any) => !hideCompleted || (toInputDate(s.date) === nowDate ? s.time > nowTime : true))
    .filter((s: any) => s.theatre.name.toLowerCase().includes(showtimeTheatreSearch.trim().toLowerCase()))
    .sort((a: any, b: any) => a.time.localeCompare(b.time) || a.theatre.name.localeCompare(b.theatre.name));

  const filteredTheatres = theatres.filter((theatre) =>
    theatre.name.toLowerCase().includes(theatreSearch.toLowerCase())
  );
  const selectedTheatreNames = theatres
    .filter((theatre) => theatreIds.includes(theatre.id))
    .map((theatre) => theatre.name);

  // Group visible showtimes by theatre
  const grouped = new Map<string, { theatre: any; showtimes: any[] }>();
  for (const s of visibleShowtimes) {
    if (!grouped.has(s.theatre.id)) grouped.set(s.theatre.id, { theatre: s.theatre, showtimes: [] });
    grouped.get(s.theatre.id)!.showtimes.push(s);
  }
  const groupedTheatres = Array.from(grouped.values());

  // Derive which booking platforms have shows for this movie
  const platformSet = new Set<string>();
  nonPastDayShowtimes.forEach((s: any) => {
    if (s.platform) s.platform.split(",").forEach((p: string) => platformSet.add(p.trim()));
  });
  const hasBms = platformSet.has("BMS");
  const hasDistrict = platformSet.has("DISTRICT");

  return (
    <main className="min-h-screen bg-page">
      <Navbar userName={user.name} role={user.role} />
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-semibold">{movie.title}</h1>
        <p className="text-muted text-sm mt-1">
          {movie.language}
          {availableLanguages.length > 0 &&
            ` · Available in: ${Array.from(new Set([movie.language, ...availableLanguages])).join(", ")}`}
          {" · "}{movie.status === "RUNNING" ? "Now showing" : "Upcoming"}
        </p>
        {(hasBms || hasDistrict) && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-xs text-muted">Book on:</span>
            {hasBms && (
              <a
                href="https://in.bookmyshow.com/movies/hyderabad"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs bg-red-900/40 border border-red-700/50 text-red-300 rounded-full px-3 py-1 hover:bg-red-900/60 transition-colors"
              >
                🎟 BookMyShow
              </a>
            )}
            {hasDistrict && (
              <a
                href="https://www.district.in"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs bg-purple-900/40 border border-purple-700/50 text-purple-300 rounded-full px-3 py-1 hover:bg-purple-900/60 transition-colors"
              >
                🎬 District
              </a>
            )}
          </div>
        )}

        {movie.status === "RUNNING" ? (
          <div className="mt-8 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-medium">Showtimes</h2>
                <span className="text-xs text-muted">
                  ({groupedTheatres.length} {groupedTheatres.length === 1 ? "theatre" : "theatres"} showing)
                </span>
              </div>
              <button
                type="button"
                onClick={() => loadMovie(true)}
                disabled={syncing}
                className="text-xs text-brand-400 hover:text-brand-300 disabled:text-muted transition-colors flex items-center gap-1"
              >
                {syncing ? "Refreshing showtimes..." : "🔄 Refresh showtimes"}
              </button>
            </div>

            {nonPastDayShowtimes.length === 0 && (
              <p className="text-muted text-sm">
                {syncing ? "Fetching showtimes across all theatres..." : "No showtimes listed yet."}
              </p>
            )}

            {nonPastDayShowtimes.length > 0 && (
              <>
                {/* Date selection tabs */}
                <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Choose showtime date">
                  {showtimeDates.map((availableDate) => (
                    <button
                      key={availableDate}
                      type="button"
                      onClick={() => setShowtimeDate(availableDate)}
                      className={
                        showtimeDate === availableDate
                          ? "btn-primary whitespace-nowrap px-4 py-2 text-sm"
                          : "card whitespace-nowrap px-4 py-2 text-sm hover:border-brand-400"
                      }
                    >
                      {formatDate(availableDate)}
                    </button>
                  ))}
                </div>

                {/* Multilingual filter tabs if multiple languages */}
                {availableLanguages.length > 1 && (
                  <div className="flex items-center gap-2 overflow-x-auto py-1" aria-label="Filter by language">
                    <span className="text-xs text-muted font-medium">Language:</span>
                    <button
                      type="button"
                      onClick={() => setSelectedLanguage("")}
                      className={
                        selectedLanguage === ""
                          ? "btn-primary !py-1 px-3 text-xs"
                          : "card !py-1 px-3 text-xs hover:border-brand-400"
                      }
                    >
                      All
                    </button>
                    {availableLanguages.map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => setSelectedLanguage(lang)}
                        className={
                          selectedLanguage === lang
                            ? "btn-primary !py-1 px-3 text-xs"
                            : "card !py-1 px-3 text-xs hover:border-brand-400"
                        }
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                )}

                {/* Search bar + Completed shows toggle */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <input
                    type="search"
                    className="input flex-1"
                    value={showtimeTheatreSearch}
                    onChange={(e) => setShowtimeTheatreSearch(e.target.value)}
                    placeholder="Search theatres for the selected date..."
                    aria-label="Search theatres for selected date"
                  />
                  {showtimeDate === nowDate && (
                    <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none shrink-0 px-1">
                      <input
                        type="checkbox"
                        checked={hideCompleted}
                        onChange={(e) => setHideCompleted(e.target.checked)}
                        className="rounded"
                      />
                      Hide completed shows
                    </label>
                  )}
                </div>
              </>
            )}

            {nonPastDayShowtimes.length > 0 && visibleShowtimes.length === 0 && (
              <p className="text-muted text-sm">
                No theatres match that filter on {formatDate(showtimeDate)}
                {selectedLanguage ? ` for ${selectedLanguage}` : ""}.
              </p>
            )}

            {groupedTheatres.map(({ theatre, showtimes: times }) => (
              <div key={theatre.id} className="card p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <p className="font-medium">{theatre.name}</p>
                    <p className="text-xs text-muted">{theatre.location?.name}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {times.map((s: any) => {
                    const isEnded = toInputDate(s.date) === nowDate && s.time <= nowTime;
                    return (
                      <span
                        key={s.id}
                        className={`inline-flex flex-col items-center border rounded-lg px-3 py-2 text-xs transition-opacity ${
                          isEnded
                            ? "bg-surface/40 border-subtle/50 opacity-40"
                            : "bg-surface border-subtle hover:border-brand-400"
                        }`}
                        title={isEnded ? "This show has already started or ended" : "Upcoming show"}
                      >
                        <span className={`font-semibold text-sm ${isEnded ? "line-through text-muted" : ""}`}>
                          {s.time}
                        </span>
                        <span className="text-muted text-[11px] mt-0.5">
                          {s.language ? (
                            <span className="text-brand-300 font-medium">{s.language} · </span>
                          ) : null}
                          {s.format.name}
                          {s.price != null ? ` · ₹${s.price}` : ""}
                        </span>
                        {isEnded ? (
                          <span className="text-[10px] text-muted">Ended</span>
                        ) : s.seatsAvailable != null ? (
                          <span className="text-[10px] text-amber-400 font-medium">
                            {s.seatsAvailable} left
                          </span>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : submitted ? (
          <div className="card p-6 mt-8">
            <p className="font-medium">You&apos;re all set.</p>
            <p className="text-muted text-sm mt-1">
              We&apos;ll alert you the moment matching tickets go live. Manage this anytime from{" "}
              <a href="/dashboard/requests" className="text-brand-400">
                My requests
              </a>
              .
            </p>
          </div>
        ) : (
          <form onSubmit={submitRequest} className="card p-6 mt-8 space-y-4">
            <h2 className="text-lg font-medium">Tell us what you want</h2>
            <p className="text-sm text-muted -mt-2">
              Select the theatres, formats and languages you want us to watch.
            </p>

            <div>
              <label className="text-sm text-muted">Location</label>
              <select
                className="input mt-1"
                required
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setTheatreIds([]);
                  setTheatreSearch("");
                }}
              >
                <option value="">Select a city</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-muted">
                Theatres <span className="text-brand-400">(select one or more)</span>
              </label>
              {!locationId ? (
                <div className="input mt-1 text-muted cursor-not-allowed">Select a city first</div>
              ) : (
                <div className="relative mt-1">
                  <button
                    type="button"
                    className="input text-left flex items-center justify-between"
                    onClick={() => setTheatreMenuOpen(!theatreMenuOpen)}
                    aria-expanded={theatreMenuOpen}
                  >
                    <span
                      className={selectedTheatreNames.length ? "truncate pr-3" : "text-muted"}
                      title={selectedTheatreNames.join(", ")}
                    >
                      {selectedTheatreNames.length ? selectedTheatreNames.join(", ") : "Search and select theatres"}
                    </span>
                    <span className="text-muted">&#8964;</span>
                  </button>
                  {theatreMenuOpen && (
                    <div className="absolute z-20 mt-2 w-full card p-2 shadow-2xl">
                      <input
                        autoFocus
                        className="input"
                        placeholder="Search theatres in this city..."
                        value={theatreSearch}
                        onChange={(e) => setTheatreSearch(e.target.value)}
                      />
                      <div className="max-h-56 overflow-y-auto mt-2 space-y-1">
                        {filteredTheatres.map((theatre) => (
                          <label
                            key={theatre.id}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-surface cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={theatreIds.includes(theatre.id)}
                              onChange={() => toggle(theatreIds, theatre.id, setTheatreIds)}
                            />
                            {theatre.name}
                          </label>
                        ))}
                        {filteredTheatres.length === 0 && (
                          <p className="px-3 py-2 text-sm text-muted">No theatres match that search.</p>
                        )}
                      </div>
                      <div className="border-t border-subtle mt-2 pt-2 flex items-center justify-between">
                        <span className="text-xs text-muted">{theatreIds.length} selected</span>
                        <button type="button" className="text-xs text-brand-400" onClick={() => setTheatreMenuOpen(false)}>
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="text-sm text-muted">
                Formats <span className="text-brand-400">(select one or more)</span>
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {formats.map((f) => (
                  <label key={f.id} className="card px-3 py-2 text-sm flex gap-2 items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formatIds.includes(f.id)}
                      onChange={() => toggle(formatIds, f.id, setFormatIds)}
                    />
                    {f.name}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm text-muted">
                Languages <span className="text-brand-400">(select one or more)</span>
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {["Telugu", "Hindi", "English", "Tamil", "Kannada", "Malayalam", "Marathi", "Bengali"].map((language) => (
                  <label key={language} className="card px-3 py-2 text-sm flex gap-2 items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={languages.includes(language)}
                      onChange={() => toggle(languages, language, setLanguages)}
                    />
                    {language}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm text-muted">Date</label>
              <input
                type="date"
                className="input mt-1"
                value={date}
                min={todayInputDate()}
                max={maxFutureInputDate()}
                onChange={(e) => setDate(e.target.value)}
                onClick={(e) => e.currentTarget.showPicker?.()}
                onFocus={(e) => e.currentTarget.showPicker?.()}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-muted">Time from</label>
                <select className="input mt-1" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)}>
                  <option value="">Any time</option>
                  {TIME_OPTIONS.map((time) => (
                    <option key={time.value} value={time.value}>
                      {time.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-muted">Time to</label>
                <select className="input mt-1" value={timeTo} onChange={(e) => setTimeTo(e.target.value)}>
                  <option value="">Any time</option>
                  {TIME_OPTIONS.map((time) => (
                    <option key={time.value} value={time.value}>
                      {time.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm text-muted">Max price</label>
              <input
                type="number"
                className="input mt-1"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                min={0}
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              className="btn-primary w-full"
              disabled={submitting || !locationId || !date || !theatreIds.length || !formatIds.length || !languages.length}
            >
              {submitting ? "Saving..." : "Alert me when tickets are live"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}