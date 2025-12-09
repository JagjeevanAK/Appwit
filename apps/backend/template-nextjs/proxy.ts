import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
    // Example: Add request timing header
    const response = NextResponse.next();
    response.headers.set("x-request-time", Date.now().toString());

    // Example: Log API requests
    if (request.nextUrl.pathname.startsWith("/api")) {
        console.log(`[API] ${request.method} ${request.nextUrl.pathname}`);
    }

    return response;
}

export const config = {
    matcher: ["/api/:path*"],
};
