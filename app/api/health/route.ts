import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness probe used by the Docker HEALTHCHECK. Does not touch external services. */
export function GET() {
    return NextResponse.json({ status: 'ok' });
}
