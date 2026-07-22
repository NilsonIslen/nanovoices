import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  if (!requireAdmin(request.headers)) {
    return unauthorized();
  }

  const payments = await prisma.payment.findMany({
    where: { status: { not: "PROCESSED" } },
    orderBy: { detectedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ items: payments });
}
