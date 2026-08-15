import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve, ServerType } from "@hono/node-server";
import { WebSocketServer, WebSocket } from "ws";
import { registerRoutes } from "./routes";
import { startAppiumServer, stopAppiumServer } from "./appium-launcher";

export class ZeniServer {
  private app: Hono;
  private server: ServerType | null = null;
  private wss: WebSocketServer;
  private port: number;
  private clients = new Map<string, WebSocket>();

  constructor(port = Number(process.env.PORT) || 3001) {
    this.port = port;
    this.app = new Hono();

    // Enable CORS
    this.app.use("*", cors());

    // Health check routes
    this.app.get("/", (c) => c.json({ status: "ok", service: "Zeni API Server" }));
    this.app.get("/health", (c) => c.json({ status: "ok", service: "Zeni API Server" }));

    // Register modular routes (Executions CRUD & Test Runner)
    registerRoutes({
      app: this.app,
      clients: this.clients,
      port: this.port,
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

      if (clientMatch) {
        const clientId = clientMatch[1];
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          console.log(`[Server] Client Executor connected: ${clientId}`);

          const existing = this.clients.get(clientId);
          if (existing) {
            existing.close();
          }
          this.clients.set(clientId, ws);

          ws.on("close", () => {
            console.log(`[Server] Client Executor disconnected: ${clientId}`);
            if (this.clients.get(clientId) === ws) {
              this.clients.delete(clientId);
            }
          });

          ws.on("error", (err) => {
            console.error(`[Server] Client WS error (${clientId}):`, err);
            ws.close();
          });
        });
        return;
      }

      socket.destroy();
    });
  }

  public async start(): Promise<void> {
    // Launch Appium server concurrently
    await startAppiumServer();

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

  public async stop(): Promise<void> {
    stopAppiumServer();
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
  const port = Number(process.env.PORT) || 3001;
  const server = new ZeniServer(port);
  server.start().catch((err) => console.error(err));
}
