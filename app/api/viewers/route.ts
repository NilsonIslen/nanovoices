export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ViewerConnection = {
  id: string;
  send: (count: number) => void;
};

type PresenceState = {
  connections: Set<ViewerConnection>;
};

const globalPresence = globalThis as typeof globalThis & {
  nanoVoicesPresence?: PresenceState;
};

const presence =
  globalPresence.nanoVoicesPresence ??
  (globalPresence.nanoVoicesPresence = {
    connections: new Set(),
  });

function viewerCount() {
  return new Set([...presence.connections].map((connection) => connection.id)).size;
}

function broadcastViewerCount() {
  const count = viewerCount();

  for (const connection of presence.connections) {
    connection.send(count);
  }
}

export async function GET(request: Request) {
  const viewerId = new URL(request.url).searchParams.get("id")?.trim().slice(0, 100);

  if (!viewerId) {
    return Response.json({ error: "Falta el identificador del visitante." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let connection: ViewerConnection;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      connection = {
        id: viewerId,
        send(count) {
          if (closed) return;

          try {
            controller.enqueue(encoder.encode(`data: ${count}\n\n`));
          } catch {
            cleanup();
          }
        },
      };

      presence.connections.add(connection);
      broadcastViewerCount();

      heartbeat = setInterval(() => {
        if (closed) return;

        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          cleanup();
        }
      }, 20000);

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);

    if (connection && presence.connections.delete(connection)) {
      broadcastViewerCount();
    }
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
