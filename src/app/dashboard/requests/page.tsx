"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { formatDate, toInputDate, todayInputDate, maxFutureInputDate } from "@/lib/date";

export default function RequestsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [theatres, setTheatres] = useState<any[]>([]);
  const [formats, setFormats] = useState<any[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  function toggle(values: string[], value: string, setValues: (values: string[]) => void) {
    setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  function parseIds(json: string | null | undefined): string[] {
    try {
      const value = JSON.parse(json || "[]");
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }

  function load() {
    fetch("/api/requests").then((r) => r.json()).then((d) => setRequests(d.requests || []));
  }

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (!d.user) router.replace("/login");
      else setUser(d.user);
    });
    fetch("/api/locations").then((r) => r.json()).then((d) => setLocations(d.locations || []));
    fetch("/api/theatres").then((r) => r.json()).then((d) => setTheatres(d.theatres || []));
    fetch("/api/formats").then((r) => r.json()).then((d) => setFormats(d.formats || []));
    load();
  }, [router]);

  async function cancelRequest(id: string) {
    if (!confirm("Cancel this alert request?")) return;
    await fetch(`/api/requests/${id}`, { method: "DELETE" });
    load();
  }

  function startEdit(req: any) {
    setEditError("");
    setEditingId(req.id);
    if (req.preRelease) {
      setEditState({
        locationId: req.locationId || "",
        theatreIds: parseIds(req.theatreIds),
      });
    } else {
      setEditState({
        locationId: req.locationId || "",
        theatreId: req.theatreId || "",
        formatId: req.formatId || "",
        date: toInputDate(req.date),
        timeFrom: req.timeFrom || "",
        timeTo: req.timeTo || "",
        maxPrice: req.maxPrice ?? "",
      });
    }
  }

  async function saveEdit(id: string) {
    if (editState.preRelease) {
      if (!editState.locationId || !editState.theatreIds?.length) {
        setEditError("Location and at least one theatre are required.");
        return;
      }
      setSaving(true);
      setEditError("");
      const res = await fetch(`/api/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: editState.locationId,
          theatreIds: editState.theatreIds,
        }),
      });
      setSaving(false);
      if (!res.ok) {
        const d = await res.json();
        if (d.alreadyShowingTheatreIds?.length > 0) {
          setEditState((prev: any) => ({
            ...prev,
            theatreIds: prev.theatreIds.filter((tid: string) => !d.alreadyShowingTheatreIds.includes(tid)),
          }));
        }
        setEditError(d.error || "Couldn't save changes");
        return;
      }
      setEditingId(null);
      load();
      return;
    }

    if (!editState.locationId || !editState.theatreId) {
      setEditError("Location and theatre are required.");
      return;
    }
    if (!editState.date) {
      setEditError("Date is required.");
      return;
    }
    setSaving(true);
    setEditError("");
    const res = await fetch(`/api/requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: editState.locationId || null,
        theatreId: editState.theatreId || null,
        formatId: editState.formatId || null,
        date: editState.date || null,
        timeFrom: editState.timeFrom || null,
        timeTo: editState.timeTo || null,
        maxPrice: editState.maxPrice ? Number(editState.maxPrice) : null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json();
      setEditError(d.error || "Couldn't save changes");
      return;
    }
    setEditingId(null);
    load();
  }

  if (!user) return null;

  const active = requests.filter((r) => r.status === "ACTIVE");
  const completed = requests.filter((r) => r.status !== "ACTIVE");

  return (
    <main className="min-h-screen bg-page">
      <Navbar userName={user.name} role={user.role} />
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-10">
        <section>
          <h2 className="text-lg font-medium mb-4">Active requests</h2>
          {active.length === 0 && <p className="text-muted text-sm">No active alert requests yet.</p>}
          <div className="space-y-3">
            {active.map((r) => (
              <div key={r.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {r.movie.title}
                      {r.preRelease && (
                        <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-300 border border-purple-700/50">
                          Release alert
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted mt-1">
                      {r.location?.name || "Location required"} &middot;{" "}
                      {r.preRelease
                        ? `${r.theatreNames?.length || 0} theatre${r.theatreNames?.length === 1 ? "" : "s"}`
                        : r.theatre?.name || "Theatre required"}
                      {!r.preRelease && <> &middot; {r.format?.name || "Any format"}</>}
                    </p>
                    <p className="text-xs text-muted">
                      {r.preRelease ? (
                        <span>
                          Waiting for release at: {(r.theatreNames || []).join(", ") || "selected theatres"}
                          {r.notifications?.length > 0 && ` (${r.notifications.length} already notified)`}
                        </span>
                      ) : (
                        <>
                          {r.date ? formatDate(r.date) : "Date required"}
                          {" \u00b7 "}
                          {r.timeFrom || "Any time"}{r.timeTo ? ` - ${r.timeTo}` : ""}
                          {r.maxPrice ? ` \u00b7 up to \u20b9${r.maxPrice}` : ""}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button className="btn-secondary !py-1 !px-3 text-xs" onClick={() => startEdit(r)}>Edit</button>
                    <button className="btn-secondary !py-1 !px-3 text-xs" onClick={() => cancelRequest(r.id)}>Cancel</button>
                  </div>
                </div>

                {editingId === r.id && r.preRelease && (
                  <div className="mt-4 pt-4 border-t border-subtle space-y-3">
                    <div>
                      <label className="text-xs text-muted">Location</label>
                      <select
                        className="input mt-1"
                        value={editState.locationId}
                        onChange={(e) =>
                          setEditState({ ...editState, locationId: e.target.value, theatreIds: [] })
                        }
                      >
                        <option value="">Select a location</option>
                        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs text-muted">
                        Theatres <span className="text-brand-400">(select one or more)</span>
                      </label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {theatres
                          .filter((t) => t.locationId === editState.locationId)
                          .map((t) => (
                            <label key={t.id} className="card px-3 py-2 text-sm flex gap-2 items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editState.theatreIds?.includes(t.id)}
                                onChange={() => toggle(editState.theatreIds || [], t.id, (v) => setEditState({ ...editState, theatreIds: v }))}
                              />
                              {t.name}
                            </label>
                          ))}
                        {editState.locationId && theatres.filter((t) => t.locationId === editState.locationId).length === 0 && (
                          <p className="text-xs text-muted">No theatres found for this location.</p>
                        )}
                      </div>
                    </div>

                    {editError && <p className="text-xs text-red-400">{editError}</p>}

                    <div className="flex gap-2 justify-end">
                      <button className="btn-secondary !py-1 !px-3 text-xs" onClick={() => setEditingId(null)}>Discard</button>
                      <button className="btn-primary !py-1 !px-3 text-xs" disabled={saving} onClick={() => saveEdit(r.id)}>
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                )}

                {editingId === r.id && !r.preRelease && (
                  <div className="mt-4 pt-4 border-t border-subtle space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted">Location</label>
                        <select className="input mt-1" value={editState.locationId}
                          onChange={(e) => setEditState({ ...editState, locationId: e.target.value })}>
                          <option value="">Select a location</option>
                          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted">Theatre</label>
                        <select className="input mt-1" value={editState.theatreId}
                          onChange={(e) => setEditState({ ...editState, theatreId: e.target.value })}>
                          <option value="">Select a theatre</option>
                          {theatres.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-muted">Format</label>
                      <select className="input mt-1" value={editState.formatId}
                        onChange={(e) => setEditState({ ...editState, formatId: e.target.value })}>
                        <option value="">Any format</option>
                        {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs text-muted">Date</label>
                      <input type="date" className="input mt-1" value={editState.date}
                        min={todayInputDate()} max={maxFutureInputDate()}
                        onChange={(e) => setEditState({ ...editState, date: e.target.value })} required />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-muted">Time from</label>
                          <input type="time" className="input mt-1" value={editState.timeFrom}
                            onChange={(e) => setEditState({ ...editState, timeFrom: e.target.value })} />
                        </div>
                        <div>
                          <label className="text-xs text-muted">Time to</label>
                          <input type="time" className="input mt-1" value={editState.timeTo}
                            onChange={(e) => setEditState({ ...editState, timeTo: e.target.value })} />
                        </div>
                      </div>

                    <div>
                      <label className="text-xs text-muted">Max price</label>
                      <input type="number" className="input mt-1" value={editState.maxPrice}
                        onChange={(e) => setEditState({ ...editState, maxPrice: e.target.value })} />
                    </div>

                    {editError && <p className="text-xs text-red-400">{editError}</p>}

                    <div className="flex gap-2 justify-end">
                      <button className="btn-secondary !py-1 !px-3 text-xs" onClick={() => setEditingId(null)}>Discard</button>
                      <button className="btn-primary !py-1 !px-3 text-xs" disabled={saving} onClick={() => saveEdit(r.id)}>
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-medium mb-4">Completed / past requests</h2>
          {completed.length === 0 && <p className="text-muted text-sm">Nothing here yet.</p>}
          <div className="space-y-3">
            {completed.map((r) => (
              <div key={r.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{r.movie.title}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    r.status === "COMPLETED" ? "bg-green-900 text-green-300" : "bg-gray-800 text-gray-400"
                  }`}>
                    {r.status}
                  </span>
                </div>
                {r.notifications?.map((n: any) => (
                  <p key={n.id} className="text-xs text-muted mt-1">{n.message}</p>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
