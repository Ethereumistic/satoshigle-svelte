/**
 * Main application entry point
 * This is the central export point for the application
 */

// Import environment configuration first to ensure it's loaded
import { env } from './config/environment';

// Import and re-export all application components
export * from './models/types';
export * from './services/UserManager';
export * from './services/SignalingService';
export * from './services/ChatService';
export * from './services/MonitoringService';
export * from './middleware/security';
export * from './utils/logger';
export { env };

// Import server (this will start the application)
import './server';