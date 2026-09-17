import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api-helpers";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (res) {
    return res as NextResponse;
  }

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    include: { showtime: { include: { movie: true, theatre: true, format: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ notifications });
}

export async function PATCH(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch (res) {
    return res as NextResponse;
  }
  const { id } = await req.json();
  const notif = await prisma.notification.findUnique({ where: { id } });
  if (!notif || notif.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.notification.update({ where: { id }, data: { read: true } });
  return NextResponse.json({ ok: true });
}
