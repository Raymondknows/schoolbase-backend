/**
 * Authentication Middleware
 * Verifies JWT tokens and attaches user to request
 */

import { Request, Response, NextFunction } from "express";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "your-secret-key");

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export async function verifyAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.substring(7);

    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      req.user = payload;
      next();
    } catch (error) {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  } catch (error) {
    res.status(500).json({ error: "Authentication error" });
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

export default verifyAuth;
