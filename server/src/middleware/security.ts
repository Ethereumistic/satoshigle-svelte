/**
 * Security middleware for the application
 * Includes rate limiting, CORS, and other security features
 */
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { env } from '../config/environment.js';
import logger from '../utils/logger.js';

// Note: The following packages need to be installed:
// npm install rate-limiter-flexible helmet

// For now, let's define a simplified version of RateLimiterMemory
// until the actual package is installed
class RateLimiterMemory {
  private points: number;
  private duration: number;
  private ips: Map<string, { points: number, resetTime: number }> = new Map();

  constructor(options: { points: number, duration: number }) {
    this.points = options.points;
    this.duration = options.duration;
  }

  async consume(key: string): Promise<any> {
    const now = Date.now();
    const record = this.ips.get(key) || { points: 0, resetTime: now + (this.duration * 1000) };
    
    // Reset if expired
    if (now > record.resetTime) {
      record.points = 0;
      record.resetTime = now + (this.duration * 1000);
    }
    
    record.points += 1;
    this.ips.set(key, record);
    
    if (record.points > this.points) {
      throw new Error('Rate limit exceeded');
    }
    
    return { remainingPoints: this.points - record.points };
  }
}

// Configure rate limiter
const apiLimiter = new RateLimiterMemory({
  points: env.RATE_LIMIT_MAX_REQUESTS, // Number of requests
  duration: env.RATE_LIMIT_WINDOW_MS / 1000, // Per second
});

// Simplified helmet middleware until the actual package is installed
const helmet = (options?: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Set some basic security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    
    if (options?.contentSecurityPolicy) {
      res.setHeader('Content-Security-Policy', "default-src 'self'");
    }
    
    next();
  };
};

/**
 * Rate limiting middleware for API requests
 */
export const rateLimiter = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Use IP address as key for rate limiting
    const key = req.ip || 'unknown';
    
    // Consume points
    await apiLimiter.consume(key);
    next();
  } catch (err) {
    logger.warn('Rate limit exceeded', { 
      ip: req.ip, 
      path: req.path 
    });
    
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please try again later',
    });
  }
};

/**
 * CORS configuration middleware
 */
export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check against allowlist
    if (env.ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    
    // Log rejected origins in development
    if (env.NODE_ENV === 'development') {
      logger.warn('CORS blocked request', { origin });
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
  credentials: true,
  maxAge: 86400, // 24 hours
});

/**
 * Security headers middleware using Helmet
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production',
  crossOriginEmbedderPolicy: false, // Needed for WebRTC
  crossOriginOpenerPolicy: false,   // Needed for WebRTC
  crossOriginResourcePolicy: {      // Needed for WebRTC
    policy: 'cross-origin'
  }
});

/**
 * Request validation middleware
 * Checks for required headers, validates input, etc.
 */
export const validateRequest = (req: Request, res: Response, next: NextFunction) => {
  // Add validation logic as needed
  // For now, just passing through
  next();
};

/**
 * Socket.IO connection limiter
 * Limits the number of connections from a single IP
 */
export class SocketConnectionLimiter {
  private connectionCounts: Map<string, number> = new Map();
  private readonly MAX_CONNECTIONS_PER_IP = 5;

  /**
   * Check if a connection should be allowed
   * @param ip IP address
   * @returns true if allowed, false if denied
   */
  public checkConnection(ip: string): boolean {
    const count = this.connectionCounts.get(ip) || 0;
    
    if (count >= this.MAX_CONNECTIONS_PER_IP) {
      logger.warn('Socket connection limit exceeded', { ip, count });
      return false;
    }
    
    this.connectionCounts.set(ip, count + 1);
    return true;
  }

  /**
   * Release a connection when it closes
   * @param ip IP address
   */
  public releaseConnection(ip: string): void {
    const count = this.connectionCounts.get(ip) || 0;
    
    if (count > 0) {
      this.connectionCounts.set(ip, count - 1);
    }
  }
} 