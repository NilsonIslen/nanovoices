import { NextResponse, type NextRequest } from "next/server";
import { explorerAccountUrl } from "@/lib/env";
import { rawToXno } from "@/lib/nano/amount";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q")?.trim().toLowerCase() ?? "";
    const page = Math.max(Number(searchParams.get("page") ?? "1"), 1);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "25"), 1), 100);

    const accounts = await prisma.verifiedAccount.findMany({
      where: {
        hiddenByModeration: false,
        ...(query
          ? {
              OR: [
                { nanoAddress: { contains: query, mode: "insensitive" } },
                { currentMessage: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        nanoAddress: true,
        currentMessage: true,
        showBalance: true,
        cachedBalanceRaw: true,
        verifiedAt: true,
        updatedAt: true,
      },
    });

    const ranked = accounts
      .sort((a, b) => {
        const balanceDiff = BigInt(b.cachedBalanceRaw) - BigInt(a.cachedBalanceRaw);
        if (balanceDiff !== 0n) return balanceDiff > 0n ? 1 : -1;
        return a.verifiedAt.getTime() - b.verifiedAt.getTime();
      })
      .map((account, index) => ({
        id: account.id,
        rank: index + 1,
        nanoAddress: account.nanoAddress,
        message: account.currentMessage,
        updatedAt: account.updatedAt.toISOString(),
        verifiedAt: account.verifiedAt.toISOString(),
        explorerUrl: explorerAccountUrl(account.nanoAddress),
        publicUrl: `${request.nextUrl.origin}/p/${account.id}`,
        balance: account.showBalance
          ? {
              raw: account.cachedBalanceRaw,
              xno: rawToXno(account.cachedBalanceRaw),
            }
          : null,
        balanceHidden: !account.showBalance,
      }));

    const offset = (page - 1) * limit;

    return NextResponse.json({
      items: ranked.slice(offset, offset + limit),
      page,
      limit,
      total: ranked.length,
      hasMore: offset + limit < ranked.length,
    });
  } catch (error) {
    console.error("No se pudo cargar el ranking", error);
    return NextResponse.json(
      {
        error:
          "No se pudo cargar el ranking. Revisa que PostgreSQL esté encendido y migrado.",
        items: [],
        page: 1,
        limit: 25,
        total: 0,
        hasMore: false,
      },
      { status: 503 },
    );
  }
}
