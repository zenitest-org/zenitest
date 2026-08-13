import { Hono } from "hono";
import { WebSocket } from "ws";
import { createExecutionsRouter } from "./executions";
import { createAuthRouter } from "./auth";
import { createCheckoutRouter } from "./checkout";

export interface RegisterRoutesParams {
  app: Hono;
  clients: Map<string, WebSocket>;
  port: number;
}

export function registerRoutes({ app, clients, port }: RegisterRoutesParams) {
  // Mount auth routes under /api/auth
  const authRouter = createAuthRouter();
  app.route("/api/auth", authRouter);

  // Mount checkout routes under /api/checkout
  const checkoutRouter = createCheckoutRouter();
  app.route("/api/checkout", checkoutRouter);

  // Mount CRUD & Execution Runner operations for Executions & Execution Details under /api/executions
  const executionsRouter = createExecutionsRouter({ clients, port });
  app.route("/api/executions", executionsRouter);
}

export { createExecutionsRouter, createAuthRouter, createCheckoutRouter };

