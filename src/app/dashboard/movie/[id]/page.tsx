"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { formatDate, toInputDate, todayInputDate, maxFutureInputDate } from "@/lib/date";
import { isPreReleaseWindowOpen, theatreIdsShowingNow } from "@/lib/pre-release";

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
  const [selectedPlatform, setSelectedPlatform] = useState<"BMS" | "DISTRICT">("BMS");
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
  const [showReleaseForm, setShowReleaseForm] = useState(false);
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
        preRelease: movie?.status === "RUNNING",
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const d = await res.json();
      if (d.alreadyShowingTheatreIds?.length > 0) {
        // Auto-deselect theatres where movie is already showing
        setTheatreIds((prev) => prev.filter((id) => !d.alreadyShowingTheatreIds.includes(id)));
        setError(d.error);
      } else {
        setError(d.error || "Something went wrong");
      }
      return;
    }
    setSubmitted(true);
  }

  if (!user || !movie) return null;

  const isRunning = movie.status === "RUNNING";

  // Theatres that already list this movie today or later (any platform)
  const showingTheatreIds = theatreIdsShowingNow(movie.showtimes || []);

  // Release alert is offered only while the movie is running, on sale somewhere,
  // and release day has not passed
  const showReleaseAlertOption =
    isRunning && showingTheatreIds.size > 0 && isPreReleaseWindowOpen(movie.releaseDate);

  // Upcoming movies always show the request form; running movies only show it
  // once the person opens the release-alert section
  const showRequestForm = isRunning ? showReleaseAlertOption && showReleaseForm : true;

  // "Remaining" = every theatre in the chosen city that doesn't list the movie yet
  const remainingTheatres = theatres.filter((t) => !showingTheatreIds.has(t.id));
  const allRemainingSelected =
    remainingTheatres.length > 0 && remainingTheatres.every((t) => theatreIds.includes(t.id));

  const nowDate = todayInputDate();
  const nowTime = new Date().toTimeString().slice(0, 5);

  // All valid current and future shows across all platforms
  const allCurrentShowtimes = (movie.showtimes || []).filter((s: any) => {
    return toInputDate(s.date) >= nowDate;
  });

  // Calculate distinct theatres available on each platform
  const bmsShowsAll = allCurrentShowtimes.filter((s: any) => !s.platform || s.platform.includes("BMS"));
  const distShowsAll = allCurrentShowtimes.filter((s: any) => s.platform?.includes("DISTRICT"));

  const bmsTheatresCount = new Set(bmsShowsAll.map((s: any) => s.theatreId)).size;
  const distTheatresCount = new Set(distShowsAll.map((s: any) => s.theatreId)).size;

  // Active platform showtimes
  const platformShows = selectedPlatform === "DISTRICT" ? distShowsAll : bmsShowsAll;

  // Available dates specifically for the selected platform
  const showtimeDates: string[] = Array.from(
    new Set<string>(platformShows.map((s: any) => toInputDate(s.date)))
  ).sort();

  // Active date (if current showtimeDate not in this platform's dates, pick the first one)
  const activeDate = showtimeDates.includes(showtimeDate) ? showtimeDate : (showtimeDates[0] || "");

  // Available languages specifically for the selected platform on this date or overall
  const availableLanguages: string[] = Array.from(
    new Set<string>(platformShows.map((s: any) => s.language).filter(Boolean))
  );

  // Filter shows by date, language, completion, and search
  const visibleShowtimes = platformShows
    .filter((s: any) => toInputDate(s.date) === activeDate)
    .filter((s: any) => !selectedLanguage || s.language === selectedLanguage)
    .filter((s: any) => !hideCompleted || (toInputDate(s.date) === nowDate ? s.time > nowTime : true))
    .filter((s: any) => s.theatre.name.toLowerCase().includes(showtimeTheatreSearch.trim().toLowerCase()))
    .sort((a: any, b: any) => a.time.localeCompare(b.time) || a.theatre.name.localeCompare(b.theatre.name));

  // Group visible showtimes by theatre
  const grouped = new Map<string, { theatre: any; showtimes: any[] }>();
  for (const s of visibleShowtimes) {
    if (!grouped.has(s.theatre.id)) grouped.set(s.theatre.id, { theatre: s.theatre, showtimes: [] });
    grouped.get(s.theatre.id)!.showtimes.push(s);
  }
  const groupedTheatres = Array.from(grouped.values());

  const filteredTheatres = theatres.filter((theatre) =>
    theatre.name.toLowerCase().includes(theatreSearch.toLowerCase())
  );
  const selectedTheatreNames = theatres
    .filter((theatre) => theatreIds.includes(theatre.id))
    .map((theatre) => theatre.name);

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

        {isRunning && (
          <div className="mt-8 space-y-4">
            {/* Header + Refresh */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Showtimes</h2>
              <button
                type="button"
                onClick={() => loadMovie(true)}
                disabled={syncing}
                className="text-xs text-brand-400 hover:text-brand-300 disabled:text-muted transition-colors flex items-center gap-1 font-medium"
              >
                {syncing ? "Refreshing showtimes..." : "🔄 Refresh showtimes"}
              </button>
            </div>

            {/* Independent Platform Switcher: BookMyShow vs District */}
            <div className="flex items-center gap-2 p-1.5 bg-surface rounded-xl border border-subtle w-fit">
              <button
                type="button"
                onClick={() => {
                  setSelectedPlatform("BMS");
                  setSelectedLanguage("");
                }}
                className={`px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
                  selectedPlatform === "BMS"
                    ? "bg-red-600 text-white shadow-md font-semibold"
                    : "text-muted hover:text-white"
                }`}
              >
                <span>🎟 BookMyShow</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-black/30 border border-white/20 text-white/90">
                  {bmsTheatresCount} {bmsTheatresCount === 1 ? "theatre" : "theatres"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedPlatform("DISTRICT");
                  setSelectedLanguage("");
                }}
                className={`px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
                  selectedPlatform === "DISTRICT"
                    ? "bg-purple-600 text-white shadow-md font-semibold"
                    : "text-muted hover:text-white"
                }`}
              >
                <span>🎬 District</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-black/30 border border-white/20 text-white/90">
                  {distTheatresCount} {distTheatresCount === 1 ? "theatre" : "theatres"}
                </span>
              </button>
            </div>

            {/* If no shows on this platform */}
            {platformShows.length === 0 && (
              <div className="card p-6 text-center">
                <p className="text-muted text-sm">
                  {syncing
                    ? `Searching ${selectedPlatform === "BMS" ? "BookMyShow" : "District"} for tickets...`
                    : `No showtimes found on ${selectedPlatform === "BMS" ? "BookMyShow" : "District"} for this movie.`}
                </p>
              </div>
            )}

            {platformShows.length > 0 && (
              <>
                {/* Dates for this platform */}
                <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Choose showtime date">
                  {showtimeDates.map((availableDate) => (
                    <button
                      key={availableDate}
                      type="button"
                      onClick={() => setShowtimeDate(availableDate)}
                      className={
                        activeDate === availableDate
                          ? "btn-primary whitespace-nowrap px-4 py-2 text-sm"
                          : "card whitespace-nowrap px-4 py-2 text-sm hover:border-brand-400"
                      }
                    >
                      {formatDate(availableDate)}
                    </button>
                  ))}
                </div>

                {/* Multilingual filter tabs if multiple languages exist on this platform */}
                {availableLanguages.length > 1 && (
                  <div className="flex items-center gap-2 overflow-x-auto py-1" aria-label="Filter by language">
                    <span className="text-xs text-muted font-medium shrink-0">Language:</span>
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
                    placeholder={`Search ${selectedPlatform === "BMS" ? "BookMyShow" : "District"} theatres...`}
                    aria-label="Search theatres for selected date"
                  />
                  {activeDate === nowDate && (
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

                {/* Empty results with active filter */}
                {visibleShowtimes.length === 0 && (
                  <p className="text-muted text-sm py-4">
                    No theatres match that filter on {formatDate(activeDate)}
                    {selectedLanguage ? ` for ${selectedLanguage}` : ""} on{" "}
                    {selectedPlatform === "BMS" ? "BookMyShow" : "District"}.
                  </p>
                )}

                {/* Theatres and Showtimes for this platform */}
                <div className="space-y-3">
                  {groupedTheatres.map(({ theatre, showtimes: times }) => (
                    <div key={theatre.id} className="card p-4">
                      <div className="mb-3 flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-base">{theatre.name}</p>
                            <span
                              className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                                selectedPlatform === "DISTRICT"
                                  ? "bg-purple-900/50 text-purple-300 border-purple-700/50"
                                  : "bg-red-900/50 text-red-300 border-red-700/50"
                              }`}
                            >
                              {selectedPlatform === "DISTRICT" ? "District" : "BookMyShow"}
                            </span>
                          </div>
                          <p className="text-xs text-muted mt-0.5">
                            {theatre.location?.name || "Hyderabad"}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {times.map((s: any) => {
                          const isEnded = toInputDate(s.date) === nowDate && s.time <= nowTime;
                          return (
                            <div
                              key={s.id}
                              className={`inline-flex flex-col items-center border rounded-lg px-3.5 py-2 text-xs transition-all ${
                                isEnded
                                  ? "bg-surface/40 border-subtle/50 opacity-40"
                                  : "bg-surface border-subtle hover:border-brand-400"
                              }`}
                              title={isEnded ? "This show has already started or ended" : "Available show"}
                            >
                              <span
                                className={`font-semibold text-sm ${
                                  isEnded ? "line-through text-muted" : "text-white"
                                }`}
                              >
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
                                <span className="text-[10px] text-muted mt-0.5">Ended</span>
                              ) : s.seatsAvailable != null ? (
                                <span className="text-[10px] text-emerald-400 font-medium mt-0.5">
                                  {s.seatsAvailable} seats available
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted mt-0.5">
                                  {s.platform === "BMS" ? "Check seats on BookMyShow" : "Available"}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Release alert entry point - running movies only, until release day */}
        {showReleaseAlertOption && !submitted && !showReleaseForm && (
          <div className="card p-4 mt-6 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-sm">Not showing at your theatre yet?</p>
              <p className="text-xs text-muted mt-0.5">
                Get notified when it reaches theatres that don&apos;t have it yet. Available until release day.
              </p>
            </div>
            <button
              type="button"
              className="btn-primary !py-2 !px-4 text-sm shrink-0"
              onClick={() => setShowReleaseForm(true)}
            >
              Notify me
            </button>
          </div>
        )}

        {submitted ? (
          <div className="card p-6 mt-8">
            <p className="font-medium">You&apos;re all set.</p>
            <p className="text-muted text-sm mt-1">
              {isRunning
                ? "We'll alert you as soon as this movie is on sale at the theatres you picked. "
                : "We'll alert you the moment matching tickets go live on BookMyShow or District. "}
              Manage this anytime from{" "}
              <a href="/dashboard/requests" className="text-brand-400">
                My requests
              </a>
              .
            </p>
          </div>
        ) : showRequestForm ? (
          <form onSubmit={submitRequest} className="card p-6 mt-8 space-y-4">
            <h2 className="text-lg font-medium">
              {isRunning ? "Notify me when it reaches my theatre" : "Tell us what you want"}
            </h2>
            <p className="text-sm text-muted -mt-2">
              {isRunning
                ? "Pick theatres that don't have this movie yet. We'll alert you when it goes on sale there on BookMyShow or District."
                : "Select the theatres, formats and languages you want us to watch across BookMyShow and District."}
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
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm text-muted">
                  Theatres <span className="text-brand-400">(select one or more)</span>
                </label>
                {isRunning && locationId && remainingTheatres.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-brand-400"
                    onClick={() =>
                      setTheatreIds(allRemainingSelected ? [] : remainingTheatres.map((t) => t.id))
                    }
                  >
                    {allRemainingSelected ? "Clear selection" : `Select all remaining (${remainingTheatres.length})`}
                  </button>
                )}
              </div>
              {isRunning && locationId && theatres.length > 0 && remainingTheatres.length === 0 && (
                <p className="text-xs text-muted mt-1">
                  This movie is already showing at every theatre in this city.
                </p>
              )}
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
                        {filteredTheatres.map((theatre) => {
                          const alreadyShowing = isRunning && showingTheatreIds.has(theatre.id);
                          return (
                            <label
                              key={theatre.id}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                                alreadyShowing ? "opacity-50 cursor-not-allowed" : "hover:bg-surface cursor-pointer"
                              }`}
                            >
                              <input
                                type="checkbox"
                                disabled={alreadyShowing}
                                checked={theatreIds.includes(theatre.id)}
                                onChange={() => toggle(theatreIds, theatre.id, setTheatreIds)}
                              />
                              <span className="flex-1">{theatre.name}</span>
                              {alreadyShowing && <span className="text-[10px] text-muted">Already showing</span>}
                            </label>
                          );
                        })}
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

            {!isRunning && (
              <div>
                <label className="text-sm text-muted">Date</label>
                <input
                  type="date"
                  className="input mt-1"
                  value={date}
                  min={todayInputDate()}
                  max={maxFutureInputDate()}
                  onChange={(e) => setDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker?.();
                    } catch {
                      // showPicker() throws NotAllowedError if the browser doesn't
                      // treat this event as a user gesture — safe to ignore, the
                      // native date picker still opens on click regardless.
                    }
                  }}
                />
              </div>
            )}

            {!isRunning && (
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
            )}

            {!isRunning && (
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
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              className="btn-primary w-full"
              disabled={submitting || !locationId || !theatreIds.length || !formatIds.length || !languages.length}
            >
              {submitting ? "Saving..." : isRunning ? "Notify me when it releases there" : "Alert me when tickets are live"}
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}