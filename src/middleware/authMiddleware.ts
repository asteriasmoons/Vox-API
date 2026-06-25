import { NextFunction, Request, Response } from "express";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    username?: string;
  };
}

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const expectedApiKey = process.env.LUMEY_API_KEY;

  if (!expectedApiKey) {
    return res.status(500).json({
      error: "Server is missing LUMEY_API_KEY.",
    });
  }

  const providedApiKey = getApiKeyFromRequest(req);

  if (!providedApiKey || providedApiKey !== expectedApiKey) {
    return res.status(401).json({
      error: "Unauthorized.",
    });
  }

  const userID = getOptionalHeader(req, "x-lumey-user-id");
  const email = getOptionalHeader(req, "x-lumey-user-email");
  const username = getOptionalHeader(req, "x-lumey-username");

  if (userID) {
    req.user = {
      id: userID,
      ...(email ? { email } : {}),
      ...(username ? { username } : {}),
    };
  }

  next();
}

function getApiKeyFromRequest(req: Request): string | undefined {
  const authorization = req.headers.authorization;

  if (authorization?.startsWith("Bearer ")) {
    return authorization.replace("Bearer ", "").trim();
  }

  return getOptionalHeader(req, "x-api-key");
}

function getOptionalHeader(req: Request, key: string): string | undefined {
  const value = req.headers[key];

  if (Array.isArray(value)) {
    return value[0]?.trim();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
}
