import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized } from "@/lib/admin-auth";
import { normalizeNanoAddress } from "@/lib/nano/address";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest, context: { params: Promise<{ address: string }> }) {
  if (!requireAdmin(request.headers)) {
    return unauthorized();
  }

  const { address } = await context.params;
  const account = await prisma.verifiedAccount.findUnique({
    where: { nanoAddress: normalizeNanoAddress(decodeURIComponent(address)) },
    include: { histories: { orderBy: { publishedAt: "desc" } } },
  });

  if (!account) {
    return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });
  }

  return NextResponse.json({ account, histories: account.histories });
}
