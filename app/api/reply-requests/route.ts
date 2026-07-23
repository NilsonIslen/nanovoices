import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Este flujo fue reemplazado. Usa /api/publication-requests con parentId y paga antes de escribir el mensaje.",
    },
    { status: 410 },
  );
}
