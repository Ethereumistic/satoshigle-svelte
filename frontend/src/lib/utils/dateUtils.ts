/**
 * Format a timestamp into a relative time string (e.g., "2m ago", "just now")
 * @param timestamp - Timestamp in milliseconds
 * @returns Formatted relative time string
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const seconds = Math.floor((now - timestamp) / 1000);
  
  // Just now for < 10 seconds
  if (seconds < 10) {
    return 'just now';
  }
  
  // Less than a minute
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  
  // Less than an hour
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  
  // Less than a day
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  
  // Less than a month
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  
  // Format as date for older messages
  const date = new Date(timestamp);
  return date.toLocaleDateString();
}

/**
 * Format a timestamp into a time string (e.g., "14:23")
 * @param timestamp - Timestamp in milliseconds
 * @returns Formatted time string
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false
  });
}

/**
 * Format a timestamp into a date string (e.g., "Apr 15, 2023")
 * @param timestamp - Timestamp in milliseconds
 * @returns Formatted date string
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Format a timestamp into a datetime string (e.g., "Apr 15, 2023 14:23")
 * @param timestamp - Timestamp in milliseconds
 * @returns Formatted datetime string
 */
export function formatDateTime(timestamp: number): string {
  return `${formatDate(timestamp)} ${formatTime(timestamp)}`;
} 