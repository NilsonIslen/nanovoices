import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  const authorization = request.headers.get("authorization");

  if (!expectedUser || !expectedPassword || !authorization?.startsWith("Basic ")) {
    return unauthorized();
  }

  const decoded = atob(authorization.slice("Basic ".length));
  const separator = decoded.indexOf(":");
  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  if (user !== expectedUser || password !== expectedPassword) {
    return unauthorized();
  }

  return NextResponse.next();
}

function unauthorized() {
  return new NextResponse("Autenticación requerida", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="NanoVoices Admin"',
    },
  });
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
