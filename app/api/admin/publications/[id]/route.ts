import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!requireAdmin(request.headers)) {
    return unauthorized();
  }

  const { id } = await context.params;
  const formData = await request.formData();
  const action = formData.get("action");
  const reason = String(formData.get("reason") ?? "").trim();

  if (action !== "hide" && action !== "restore") {
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.verifiedAccount.update({
      where: { id },
      data:
        action === "hide"
          ? {
              hiddenByModeration: true,
              moderationReason: reason || "Sin razón indicada",
              moderationUpdatedAt: new Date(),
            }
          : {
              hiddenByModeration: false,
              moderationReason: null,
              moderationUpdatedAt: new Date(),
            },
    }),
    prisma.adminAudit.create({
      data: {
        action: action === "hide" ? "HIDE_PUBLICATION" : "RESTORE_PUBLICATION",
        targetId: id,
        reason: reason || null,
      },
    }),
  ]);

  return NextResponse.redirect(new URL("/admin", request.url));
}
