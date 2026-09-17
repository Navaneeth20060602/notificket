import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";

// Use inside any API route that requires a logged-in user.
// Returns the user, or throws a Response you should immediately `return`.
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return user;
}

// Normalizes a name for duplicate checking: lowercase + collapse whitespace.
// "PVR  Banjara Hills " and "pvr banjara hills" both normalize the same way.
export function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
