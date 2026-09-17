"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function RegisterPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (d.user) router.replace("/dashboard");
      else setChecking(false);
    });
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  if (checking) return null;

  return (
    <main className="min-h-screen bg-page"><Navbar />
      <div className="min-h-[calc(100vh-73px)] flex items-center justify-center px-4"><form onSubmit={onSubmit} className="card p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Create your account</h1>
        <p className="text-sm text-muted mb-6">The first account created becomes the admin.</p>

        <label className="text-sm text-muted">Name</label>
        <input className="input mt-1 mb-4" value={name} onChange={(e) => setName(e.target.value)} required />

        <label className="text-sm text-muted">Email</label>
        <input
          type="email"
          className="input mt-1 mb-4"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label className="text-sm text-muted">Password</label>
        <input
          type="password"
          className="input mt-1 mb-4"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <button className="btn-primary w-full" disabled={loading}>
          {loading ? "Creating..." : "Sign up"}
        </button>

        <p className="text-sm text-muted mt-5 text-center">
          Already have an account? <Link href="/login" className="text-brand-400">Log in</Link>
        </p>
      </form>
      </div>
    </main>
  );
}
