import { type NextRequest, NextResponse } from 'next/server';

const getApiUrl = () =>
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:8081';

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const apiUrl = getApiUrl();
  const targetUrl = `${apiUrl}/api/${path.join('/')}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  // Remove host header so the upstream doesn't reject the request
  headers.delete('host');

  let body: BodyInit | null = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.arrayBuffer();
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      // @ts-expect-error — Node.js fetch supports duplex
      duplex: 'half',
    });

    const resHeaders = new Headers(upstream.headers);
    // Strip encoding headers that Next.js will re-apply
    resHeaders.delete('content-encoding');
    resHeaders.delete('transfer-encoding');

    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: resHeaders,
    });
  } catch (err) {
    console.error(`[proxy] Failed to reach ${targetUrl}:`, err);
    return NextResponse.json(
      { error: 'Gateway unreachable', detail: String(err) },
      { status: 502 },
    );
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
