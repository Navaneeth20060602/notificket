"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "./ThemeProvider";

export default function Navbar({
  userName,
  role,
}: {
  userName?: string | null;
  role?: "USER" | "ADMIN" | null;
}) {
  const router = useRouter();
  const { theme, toggle } = useTheme();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    // replace, not push - once logged out there's nothing useful to "go back" to
    router.replace("/");
    router.refresh();
  }

  return (
    <nav className="sticky top-0 z-30 flex items-center justify-between px-6 py-4 border-b border-subtle bg-page">
      <Link href="/" className="font-semibold text-lg tracking-tight">
        Notif<span className="text-brand-500">icket</span>
      </Link>
      <div className="flex items-center gap-5 text-sm">
        <Link href="/" className="hover:text-brand-400 hidden sm:inline">Home</Link>
        <Link href="/#contact" className="hover:text-brand-400 hidden sm:inline">Contact</Link>
        {userName ? (
          <>
            <Link href="/dashboard" className="hover:text-brand-400">Browse</Link>
            <Link href="/dashboard/requests" className="hover:text-brand-400">My requests</Link>
            <Link href="/feedback" className="hover:text-brand-400">Feedback</Link>
            {role === "ADMIN" && (
              <Link href="/admin" className="hover:text-brand-400">Admin</Link>
            )}
            <span className="text-muted hidden md:inline">Hi, {userName}</span>
            <button onClick={logout} className="btn-secondary !py-1.5 !px-3">Log out</button>
          </>
        ) : (
          <>
            <Link href="/login" className="hover:text-brand-400">Log in</Link>
            <Link href="/register" className="btn-primary !py-1.5 !px-3">Sign up</Link>
          </>
        )}
        <button
          onClick={toggle}
          aria-label="Toggle light/dark mode"
          className="btn-secondary !py-1.5 !px-2.5"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? "\u2600\ufe0f" : "\ud83c\udf19"}
        </button>
      </div>
    </nav>
  );
}
