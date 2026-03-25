import type { NextFunction, Request, Response } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(`[cloud-social] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
  });
  next();
}

export function errorLogger(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error("[cloud-social] unhandled error", err);
  res.status(500).json({ error: "internal server error" });
}
