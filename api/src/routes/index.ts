import { Hono } from "hono";
import { WebSocket } from "ws";
import { createExecutionsRouter } from "./executions";

export interface RegisterRoutesParams {
  app: Hono;
  clients: Map<string, WebSocket>;
  port: number;
}

export function registerRoutes({ app, clients, port }: RegisterRoutesParams) {
  // Mount CRUD & Execution Runner operations for Executions & Execution Details under /api/executions
  const executionsRouter = createExecutionsRouter({ clients, port });
  app.route("/api/executions", executionsRouter);
}

export { createExecutionsRouter };
