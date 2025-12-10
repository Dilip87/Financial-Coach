export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface LogEntry {
  timestamp: Date;
  type: 'user' | 'agent' | 'tool' | 'system';
  message: string;
}

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}