import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve, ServerType } from "@hono/node-server";
import { WebSocketServer, WebSocket } from "ws";
import { Executor } from "./executor";

export class ZeniServer {
  private app: Hono;
  private server: ServerType | null = null;
  private wss: WebSocketServer;
  private port: number;
  private clients = new Map<string, WebSocket>();
  private browsers = new Map<string, WebSocket>();

  constructor(port = 3000) {
    this.port = port;
    this.app = new Hono();

    // Enable CORS
    this.app.use("*", cors());

    // Health check routes
    this.app.get("/", (c) => c.json({ status: "ok", service: "Zeni WebSocket Server" }));
    this.app.get("/health", (c) => c.json({ status: "ok", service: "Zeni WebSocket Server" }));

    // Test execution API route
    this.app.post("/api/run-test", async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}));
        const { testCase, clientId } = body;

        if (!testCase || !clientId) {
          return c.json({ success: false, error: "Missing testCase or clientId" }, 400);
        }

        if (!this.clients.has(clientId)) {
          return c.json(
            { success: false, error: `No active proxy client connected for clientId: ${clientId}` },
            400
          );
        }

        console.log(`[Server] Running test case "${testCase.title}" for client ${clientId}`);

        // Connect Executor to this client session via local bridge
        const executor = new Executor(`ws://localhost:${this.port}/browser/${clientId}`);
        const report = await executor.run(testCase);

        return c.json(report);
      } catch (err: any) {
        console.error("[Server] Error executing test run:", err);
        return c.json({ success: false, error: err.message || String(err) }, 500);
      }
    });

    this.wss = new WebSocketServer({ noServer: true });
  }

  private attachWebSocketUpgrade(server: ServerType) {
    server.on("upgrade", (request, socket, head) => {
      const url = request.url || "";
      const pathname = url.split("?")[0];

      if (!pathname) {
        socket.destroy();
        return;
      }

      const clientMatch = pathname.match(/^\/client\/(.+)$/);
      const browserMatch = pathname.match(/^\/browser\/(.+)$/);

      if (clientMatch) {
        const clientId = clientMatch[1];
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          console.log(`[Server] Proxy Client connected: ${clientId}`);

          const existing = this.clients.get(clientId);
          if (existing) {
            existing.close();
          }
          this.clients.set(clientId, ws);

          ws.on("close", () => {
            console.log(`[Server] Proxy Client disconnected: ${clientId}`);
            if (this.clients.get(clientId) === ws) {
              this.clients.delete(clientId);
            }
            const browserWs = this.browsers.get(clientId);
            if (browserWs) {
              browserWs.close();
              this.browsers.delete(clientId);
            }
          });

          ws.on("error", (err) => {
            console.error(`[Server] Client WS error (${clientId}):`, err);
            ws.close();
          });

          this.bridgeIfBothConnected(clientId);
        });
        return;
      }

      if (browserMatch) {
        const clientId = browserMatch[1];
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          console.log(`[Server] Browser (Playwright) connecting for client: ${clientId}`);

          const existing = this.browsers.get(clientId);
          if (existing) {
            existing.close();
          }
          this.browsers.set(clientId, ws);

          ws.on("close", () => {
            console.log(`[Server] Browser (Playwright) disconnected: ${clientId}`);
            if (this.browsers.get(clientId) === ws) {
              this.browsers.delete(clientId);
            }
          });

          ws.on("error", (err) => {
            console.error(`[Server] Browser WS error (${clientId}):`, err);
            ws.close();
          });

          this.bridgeIfBothConnected(clientId);
        });
        return;
      }

      socket.destroy();
    });
  }

  private bridgeIfBothConnected(clientId: string) {
    const clientWs = this.clients.get(clientId);
    const browserWs = this.browsers.get(clientId);

    if (clientWs && browserWs) {
      console.log(
        `[Server] Bridging CDP tunnel for client ${clientId}. Client state: ${clientWs.readyState}, Browser state: ${browserWs.readyState}`
      );

      // Clear previous message listeners
      clientWs.removeAllListeners("message");
      browserWs.removeAllListeners("message");

      clientWs.on("message", (data, isBinary) => {
        const str = data.toString();
        console.log(
          `[Server Bridge] [Client -> Browser] data: ${str.slice(0, 150)}${str.length > 150 ? "..." : ""}`
        );
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(data, { binary: isBinary });
        }
      });

      browserWs.on("message", (data, isBinary) => {
        const str = data.toString();
        console.log(
          `[Server Bridge] [Browser -> Client] data: ${str.slice(0, 150)}${str.length > 150 ? "..." : ""}`
        );
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      });
    }
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = serve(
        {
          fetch: this.app.fetch,
          port: this.port,
        },
        (info) => {
          console.log(`[Server] Listening on http://localhost:${info.port}`);
          resolve();
        }
      );
      this.attachWebSocketUpgrade(this.server);
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close();
      if (this.server) {
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// Auto-run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 3000;
  const server = new ZeniServer(port);
  await server.start();
}

