"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { formatDate } from "@/lib/date";

type Movie = {
  id: string;
  title: string;
  language: string;
  status: "RUNNING" | "UPCOMING";
  releaseDate: string | null;
  posterUrl: string | null;
};
type Location = { id: string; name: string };

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [tab, setTab] = useState<"RUNNING" | "UPCOMING">("RUNNING");
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [movies, setMovies] = useState<Movie[]>([]);
  const [locationAsked, setLocationAsked] = useState(false);

  // Load session; bounce to /login if not authenticated
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!data.user) {
          router.replace("/login");
          return;
        }
        setUser(data.user);
      });
  }, [router]);

  // Load locations, and ask for geolocation permission once (best-effort - see note below)
  useEffect(() => {
    fetch("/api/locations")
      .then((r) => r.json())
      .then((data) => setLocations(data.locations || []));

    if (!locationAsked && "geolocation" in navigator) {
      setLocationAsked(true);
      navigator.geolocation.getCurrentPosition(
        () => {
          // Permission granted. Note: matching raw coordinates to one of our
          // supported cities needs a reverse-geocoding API (e.g. Google/Mapbox),
          // which isn't wired up in this starter. For now we just confirm
          // permission and let the user pick their city below - swap in a
          // geocoding call here later to auto-select it.
        },
        () => {
          // Permission denied or unavailable - no problem, manual picker below covers it.
        },
        { timeout: 5000 }
      );
    }
  }, [locationAsked]);

  // Load movies whenever filters change
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("status", tab);
    if (search) params.set("search", search);
    if (language) params.set("language", language);
    if (tab === "RUNNING" && locationId) params.set("locationId", locationId);

    fetch(`/api/movies?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setMovies(data.movies || []));
  }, [tab, search, language, locationId]);

  if (!user) return null;

  const languages = ["Telugu", "Hindi", "English", "Tamil", "Kannada", "Malayalam", "Marathi", "Bengali"];

  return (
    <main>
      <Navbar userName={user.name} role={user.role} />

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <select
            className="input !w-auto"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          <input
            className="input !w-auto flex-1 min-w-[200px]"
            placeholder="Search movies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 mb-6 border-b border-subtle">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === "RUNNING" ? "border-brand-500 text-white" : "border-transparent text-muted"
            }`}
            onClick={() => setTab("RUNNING")}
          >
            Active movies
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === "UPCOMING" ? "border-brand-500 text-white" : "border-transparent text-muted"
            }`}
            onClick={() => setTab("UPCOMING")}
          >
            Upcoming movies
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
            <button
              className={`text-xs px-3 py-1 rounded-full border ${
                language === "" ? "border-brand-500 text-brand-400" : "border-subtle text-muted"
              }`}
              onClick={() => setLanguage("")}
            >
              All languages
            </button>
            {languages.map((l) => (
              <button
                key={l}
                className={`text-xs px-3 py-1 rounded-full border ${
                  language === l ? "border-brand-500 text-brand-400" : "border-subtle text-muted"
                }`}
                onClick={() => setLanguage(l)}
              >
                {l}
              </button>
            ))}
        </div>

        {movies.length === 0 && (
          <p className="text-muted text-sm">
            {tab === "RUNNING"
              ? "No running movies match that filter yet."
              : "No upcoming movies match that filter yet."}
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {movies.map((m) => (
            <Link key={m.id} href={`/dashboard/movie/${m.id}`} className="card overflow-hidden group">
              <div className="aspect-[2/3] bg-surface flex items-center justify-center text-faint text-xs">
                {m.posterUrl ? (
                  <img src={m.posterUrl} alt={m.title} className="w-full h-full object-cover" />
                ) : (
                  "No poster"
                )}
              </div>
              <div className="p-3">
                <p className="font-medium text-sm truncate group-hover:text-brand-400">{m.title}</p>
                <p className="text-xs text-muted">{m.language}</p>
                {m.status === "UPCOMING" && m.releaseDate && (
                  <p className="text-xs text-muted mt-1">
                    Releases {formatDate(m.releaseDate)}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
