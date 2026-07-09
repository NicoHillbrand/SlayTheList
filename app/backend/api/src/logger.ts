import type { Request, Response, NextFunction } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
}

export function errorLogger(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error("[api] unhandled error", err);
  res.status(500).json({ error: "internal server error" });
}
