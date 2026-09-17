import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api-helpers";

export async function POST(req: NextRequest) {
  let user; try { user = await requireUser(); } catch (res) { return res as NextResponse; }
  const { message } = await req.json();
  if (typeof message !== "string" || message.trim().length < 5) return NextResponse.json({ error: "Please share at least a few words of feedback." }, { status: 400 });
  await prisma.feedback.create({ data: { userId: user.id, message: message.trim() } });
  return NextResponse.json({ ok: true });
}
