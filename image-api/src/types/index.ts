export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  role: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface StorageSummary {
  totalFiles: number;
  totalBytes: number;
  totalCapacity: number;
  byFileType: Record<string, { files: number; bytes: number }>;
  byCamera: Array<{
    cameraId: string;
    cameraName: string;
    files: number;
    bytes: number;
  }>;
  snapshotDate: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
