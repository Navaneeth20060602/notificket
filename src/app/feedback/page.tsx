"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
export default function FeedbackPage() {
 const router = useRouter(); const [user, setUser] = useState<any>(); const [message, setMessage] = useState(""); const [status, setStatus] = useState("");
 useEffect(() => { fetch("/api/auth/me").then((r) => r.json()).then((d) => d.user ? setUser(d.user) : router.replace("/login")); }, [router]);
 async function submit(e: React.FormEvent) { e.preventDefault(); const r = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) }); setStatus(r.ok ? "Thanks — your feedback has been recorded." : "Please try again."); if (r.ok) setMessage(""); }
 if (!user) return null; return <main className="min-h-screen bg-page"><Navbar userName={user.name} role={user.role} /><div className="max-w-xl mx-auto px-6 py-12"><div className="card p-6"><h1 className="text-2xl font-semibold">Feedback</h1><p className="text-muted text-sm mt-2">Tell us what would make Notificket better.</p><form className="mt-6 space-y-4" onSubmit={submit}><textarea className="input min-h-36" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Your feedback" required minLength={5} /><button className="btn-primary">Send feedback</button>{status && <p className="text-sm text-brand-400">{status}</p>}</form></div></div></main>;
}
