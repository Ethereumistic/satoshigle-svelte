/**
 * Environment configuration with validation
 * Loads and validates environment variables for the application
 */
import { config } from 'dotenv';
import path from 'path';

// Load environment variables from .env file
config();

/**
 * Validate that required environment variables are set
 * @param variables List of required environment variables
 * @throws Error if any required variable is missing
 */
function validateEnv(variables: string[]): void {
  const missing = variables.filter(
    (variable) => !(variable in process.env)
  );
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

// Set defaults with proper typing
export interface EnvironmentConfig {
  // Server configuration
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  
  // CORS configuration
  CLIENT_URL: string;
  CLIENT_IP_URL: string;
  ALLOWED_ORIGINS: string[];
  
  // Redis configuration (for future use)
  REDIS_URL?: string;
  REDIS_ENABLED: boolean;
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  
  // WebRTC configuration
  TURN_SERVER_URL?: string;
  TURN_SERVER_USERNAME?: string;
  TURN_SERVER_CREDENTIAL?: string;
  
  // Socket.IO configuration
  SOCKET_PATH: string;
  CONNECTION_TIMEOUT_MS: number;
  MAX_DISCONNECTION_DURATION_MS: number;
}

// Default values
const DEFAULT_CONFIG: EnvironmentConfig = {
  NODE_ENV: (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
  PORT: parseInt(process.env.PORT || '3001', 10),
  
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  CLIENT_IP_URL: process.env.CLIENT_IP_URL || 'http://192.168.192.1:5173',
  ALLOWED_ORIGINS: [
    process.env.CLIENT_URL || 'http://localhost:5173',
    process.env.CLIENT_IP_URL || 'http://192.168.192.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000'
  ],
  
  REDIS_URL: process.env.REDIS_URL,
  REDIS_ENABLED: process.env.REDIS_ENABLED === 'true',
  
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  
  TURN_SERVER_URL: process.env.TURN_SERVER_URL,
  TURN_SERVER_USERNAME: process.env.TURN_SERVER_USERNAME,
  TURN_SERVER_CREDENTIAL: process.env.TURN_SERVER_CREDENTIAL,
  
  SOCKET_PATH: process.env.SOCKET_PATH || '/socket.io/',
  CONNECTION_TIMEOUT_MS: parseInt(process.env.CONNECTION_TIMEOUT_MS || '20000', 10),
  MAX_DISCONNECTION_DURATION_MS: parseInt(process.env.MAX_DISCONNECTION_DURATION_MS || '60000', 10),
};

// Required variables in production
if (DEFAULT_CONFIG.NODE_ENV === 'production') {
  validateEnv(['CLIENT_URL']);
}

// Export the configuration
export const env: EnvironmentConfig = DEFAULT_CONFIG; 