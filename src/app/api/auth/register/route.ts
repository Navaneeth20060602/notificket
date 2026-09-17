import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, signSession, setSessionCookie } from "@/lib/auth";

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  // First registered user in the whole app becomes ADMIN automatically,
  // so there's always at least one admin without manual DB editing.
  const userCount = await prisma.user.count();
  const role = userCount === 0 ? "ADMIN" : "USER";

  const user = await prisma.user.create({
    data: { name, email, passwordHash, role },
  });

  const token = signSession({ id: user.id, email: user.email, name: user.name, role: user.role as "USER" | "ADMIN" });
  setSessionCookie(token);

  return NextResponse.json({ id: user.id, name: user.name, email: user.email, role: user.role });
}
