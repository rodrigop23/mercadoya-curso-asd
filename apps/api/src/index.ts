import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { auth } from "./auth.js";

const signUpSchema = z
	.object({
		name: z.string().min(1),
		email: z.email(),
		password: z.string().min(8).max(128),
		image: z.string().optional(),
		callbackURL: z.string().optional(),
	})
	.strict();

const signInSchema = z
	.object({
		email: z.email(),
		password: z.string().min(8).max(128),
		rememberMe: z.boolean().optional(),
		callbackURL: z.string().optional(),
	})
	.strict();

function requestWithValidatedBody(request: Request, body: unknown) {
	const headers = new Headers(request.headers);
	headers.delete("content-length");
	headers.set("content-type", "application/json");

	return new Request(request.url, {
		method: request.method,
		headers,
		body: JSON.stringify(body),
	});
}

const app = new Hono();

app.use("/api/*", cors({ origin: "http://localhost:5173", credentials: true }));

app.get("/", (c) => {
	return c.text("MercadoYa API está lista.");
});

app.post("/api/auth/sign-up/email", zValidator("json", signUpSchema), (c) => {
	return auth.handler(requestWithValidatedBody(c.req.raw, c.req.valid("json")));
});

app.post("/api/auth/sign-in/email", zValidator("json", signInSchema), (c) => {
	return auth.handler(requestWithValidatedBody(c.req.raw, c.req.valid("json")));
});

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.get("/api/me", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });

	if (!session) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	return c.json(session);
});

serve(
	{
		fetch: app.fetch,
		port: Number(process.env.PORT ?? 3001),
	},
	(info) => {
		console.log(`MercadoYa API listening on http://localhost:${info.port}`);
	},
);
