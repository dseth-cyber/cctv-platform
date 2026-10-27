export interface Camera {
  id: string;
  name: string;
  description?: string;
  ipAddress: string;
  smbSharePath: string;
  smbDomain?: string;
  smbUsername: string;
  smbPasswordEncrypted?: string;
  smbSubdirectoryPattern?: string;
  status: 'active' | 'inactive' | 'error' | 'maintenance';
  pollIntervalSeconds: number;
  timezone?: string;
  captureMode: 'periodic' | 'on_demand' | 'continuous';
  retentionPolicyId: string;
  enabled: boolean;
  lastPolledAt?: string;
  lastImageAt?: string;
  totalImagesCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImageRecord {
  id: string;
  cameraId: string;
  camera?: Camera;
  originalFilename: string;
  fileSizeBytes: number;
  checksumMd5: string;
  checksumSha256?: string;
  width?: number;
  height?: number;
  bitDepth?: number;
  colorSpace?: string;
  compression?: string;
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed';
  capturedAt: string;
  processedAt?: string;
  tags?: Record<string, string>;
  storagePath?: string;
  thumbnailPath?: string;
  pngPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RetentionPolicy {
  id: string;
  name: string;
  description?: string;
  rawRetentionDays: number;
  processedRetentionDays: number;
  thumbnailRetentionDays: number;
  archiveEnabled: boolean;
  archiveRawDays?: number;
  coldStorageClass?: string;
  cameras?: Camera[];
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingLog {
  id: string;
  imageId: string;
  jobType: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'retrying' | 'dead_letter';
  workerId?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  errorMessage?: string;
  retryCount?: number;
  image?: ImageRecord;
  createdAt: string;
  updatedAt: string;
}

export interface StorageSummary {
  totalFiles: number;
  totalBytes: number;
  byFileType: Record<string, { bytes: number; files: number }>;
  byCamera: Array<{ cameraId: string; cameraName: string; bytes: number; files: number }>;
}

export interface StorageGrowth {
  date: string;
  bytesAdded: number;
  imagesAdded: number;
}

export interface OverviewData {
  totalImages: number;
  activeCameras: number;
  inactiveCameras: number;
  errorCameras: number;
  storageUsed: string;
  processingRate: string;
  imagesToday: number;
  recentActivity: Array<{ label: string; value: number }>;
  storageGrowth: Array<{ label: string; value: number }>;
  imagesByCamera: Array<{ name: string; value: number }>;
  storageByType: Array<{ name: string; value: number }>;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface Alert {
  id: string;
  alertType: string;
  severity: 'info' | 'warning' | 'critical';
  source: string;
  title: string;
  message: string;
  resolved: boolean;
  createdAt: string;
}
