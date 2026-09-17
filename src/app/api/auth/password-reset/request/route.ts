import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { sendAlertEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  const user = typeof email === "string" ? await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } }) : null;
  // This neutral reply prevents email-address discovery.
  if (!user) return NextResponse.json({ ok: true });
  await prisma.passwordResetOtp.deleteMany({ where: { userId: user.id, usedAt: null } });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await prisma.passwordResetOtp.create({ data: { userId: user.id, codeHash: await bcrypt.hash(code, 10), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
  await sendAlertEmail(user.email, "Your Notificket password reset code", `Your verification code is ${code}. It expires in 10 minutes.`);
  return NextResponse.json({ ok: true });
}
