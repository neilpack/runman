// Types shared between the frontend and backend.
// Put API request/response shapes here so both sides stay in sync.

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
  storage: 'dynamodb' | 'memory';
}

export interface Item {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface CreateItemRequest {
  name: string;
  description?: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
