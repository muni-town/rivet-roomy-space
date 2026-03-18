import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { registry } from "./actors";

const app = new Hono();
app.all("/api/rivet/*", (c) => registry.handler(c.req.raw));

const port = 3000;
serve({ fetch: app.fetch, port });
console.log(`listening on port ${port}`);
