"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // If you're already logged in and land here (e.g. via browser back), bounce
  // straight to the dashboard instead of showing the form again.
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
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong");
      return;
    }
    // replace (not push) so the login page isn't left in browser history -
    // pressing back from the dashboard won't land you back on this form.
    router.replace("/dashboard");
    router.refresh();
  }

  if (checking) return null;

  return (
    <main className="min-h-screen bg-page"><Navbar />
      <div className="min-h-[calc(100vh-73px)] flex items-center justify-center px-4"><form onSubmit={onSubmit} className="card p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-6">Welcome back</h1>

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
          required
        />

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <button className="btn-primary w-full" disabled={loading}>
          {loading ? "Logging in..." : "Log in"}
        </button>

        <p className="text-sm text-muted mt-5 text-center">
          No account? <Link href="/register" className="text-brand-400">Sign up</Link>
        </p>
        <p className="text-sm text-muted mt-3 text-center"><Link href="/forgot-password" className="text-brand-400">Forgot password?</Link></p>
      </form>
      </div>
    </main>
  );
}
