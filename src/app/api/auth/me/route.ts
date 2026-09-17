import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null });

  // include city as a Location-friendly string, and whether they have one set
  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, city: user.city },
  });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const { city } = await req.json();
  const updated = await prisma.user.update({ where: { id: user.id }, data: { city } });
  return NextResponse.json({ user: { id: updated.id, city: updated.city } });
}
