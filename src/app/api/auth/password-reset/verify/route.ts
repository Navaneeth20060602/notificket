import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email, code, password } = await req.json();
  if (typeof email !== "string" || typeof code !== "string" || typeof password !== "string" || password.length < 6) return NextResponse.json({ error: "Enter a valid email, code and password (at least 6 characters)." }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
  const otp = await prisma.passwordResetOtp.findFirst({ where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() }, }, orderBy: { createdAt: "desc" } });
  if (!otp || !(await bcrypt.compare(code, otp.codeHash))) return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
  await prisma.$transaction([prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } }), prisma.passwordResetOtp.update({ where: { id: otp.id }, data: { usedAt: new Date() } })]);
  return NextResponse.json({ ok: true });
}
