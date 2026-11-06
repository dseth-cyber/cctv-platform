import api from '@/lib/axios';

const BASE = '/image-service/api/v1';

export function createImageServiceApi(api: any) {
  return {

    getTopIncidentCauses: (params: { days?: number }, options?: { silent403?: boolean }) =>
      api.get(`${BASE}/cameras/incidents/top-causes`, { params, ...options }).then((r: any) => r.data),
    getIncidentMonthlyTrend: (params?: { months?: number }, options?: { silent403?: boolean }) =>
      api.get(`${BASE}/cameras/incidents/monthly-trend`, { params, ...options }).then((r: any) => r.data),

    // Cameras
    getCameras: (params?: { status?: string; enabled?: boolean; limit?: number; page?: number }) =>
      api.get(`${BASE}/cameras`, { params }).then((r: any) => r.data),

    getCamera: (id: string) => api.get(`${BASE}/cameras/${id}`).then((r: any) => r.data),

    getCameraEvents: (id: string, params?: { since?: string; until?: string; limit?: number }) =>
      api.get(`${BASE}/cameras/${id}/events`, { params }).then((r: any) => r.data),

    getCameraFavorites: (): Promise<string[]> =>
      api.get(`${BASE}/cameras/favorites`).then((r: any) => r.data),
    addCameraFavorite: (id: string) =>
      api.put(`${BASE}/cameras/${id}/favorite`),
    removeCameraFavorite: (id: string) =>
      api.delete(`${BASE}/cameras/${id}/favorite`),

    requestSnapshots: (ids: string[]) =>
      api.post(`${BASE}/snapshots/request`, { ids }).then((r: any) => r.data),
    getSnapshotImage: (id: string): Promise<Blob> =>
      api.get(`${BASE}/snapshots/image/${id}`, { responseType: 'blob' }).then((r: any) => r.data),
    getSnapshotSettings: () =>
      api.get(`${BASE}/snapshots/settings`).then((r: any) => r.data),
    getSnapshotAdvice: (params: Record<string, string>) =>
      api.get(`${BASE}/snapshots/advice`, { params }).then((r: any) => r.data),

    getCameraGroups: () =>
      api.get(`${BASE}/camera-groups`).then((r: any) => r.data),
    createCameraGroup: (data: Record<string, unknown>) =>
      api.post(`${BASE}/camera-groups`, data).then((r: any) => r.data),
    updateCameraGroup: (id: string, data: Record<string, unknown>) =>
      api.patch(`${BASE}/camera-groups/${id}`, data).then((r: any) => r.data),
    deleteCameraGroup: (id: string) =>
      api.delete(`${BASE}/camera-groups/${id}`),

    createCamera: (data: Record<string, unknown>) =>
      api.post(`${BASE}/cameras`, data).then((r: any) => r.data),
    // Opens the stream to find brand/port/channel (and checks the login); see stream-detect.service.ts.
    detectCameraStream: (data: { ipAddress: string; username: string; password?: string; brand?: string; port?: number; channel?: number; cameraId?: string }) =>
      api.post(`${BASE}/cameras/detect-stream`, data, { timeout: 90_000 }).then((r: any) => r.data),

    updateCamera: (id: string, data: Record<string, unknown>) =>
      api.patch(`${BASE}/cameras/${id}`, data).then((r: any) => r.data),

    // Camera Templates
    getCameraTemplates: () =>
      api.get(`${BASE}/camera-templates`).then((r: any) => r.data),

    getCameraTemplate: (id: string) =>
      api.get(`${BASE}/camera-templates/${id}`).then((r: any) => r.data),

    createCameraTemplate: (data: Record<string, unknown>) =>
      api.post(`${BASE}/camera-templates`, data).then((r: any) => r.data),

    updateCameraTemplate: (id: string, data: Record<string, unknown>) =>
      api.patch(`${BASE}/camera-templates/${id}`, data).then((r: any) => r.data),

    deleteCameraTemplate: (id: string) =>
      api.delete(`${BASE}/camera-templates/${id}`).then((r: any) => r.data),

    deactivateCamera: (id: string) => api.delete(`${BASE}/cameras/${id}`),

    deleteCamera: (id: string, password: string) =>
      api.delete(`${BASE}/cameras/${id}`, { data: { password } }).then((r: any) => r.data),

    getCameraDeletionImpact: (ids: string[]): Promise<any> =>
      api.post(`${BASE}/cameras/deletion-impact`, { ids }).then((r: any) => r.data),
    deleteCameraPermanent: (id: string, password: string) =>
      api.delete(`${BASE}/cameras/${id}/permanent`, { data: { password } }).then((r: any) => r.data),

    getDeletedCameras: () =>
      api.get(`${BASE}/cameras/trash`).then((r: any) => r.data),

    restoreCamera: (id: string) =>
      api.post(`${BASE}/cameras/${id}/restore`).then((r: any) => r.data),

    emptyCameraTrash: (password: string) =>
      api.post(`${BASE}/cameras/trash/empty`, { password }).then((r: any) => r.data),

    getCameraStream: (id: string, params?: { profile?: 'main' | 'sub' }) =>
      api.get(`${BASE}/cameras/${id}/stream`, { params }).then((r: any) => r.data),

    // CCTV Devices (DVR / NVR / IP Cam)
    getDevices: (params?: { deviceType?: string; siteId?: string; enabled?: boolean }) =>
      api.get(`${BASE}/devices`, { params }).then((r: any) => r.data),

    getDevice: (id: string) =>
      api.get(`${BASE}/devices/${id}`).then((r: any) => r.data),

    createDevice: (data: Record<string, unknown>) =>
      api.post(`${BASE}/devices`, data).then((r: any) => r.data),

    updateDevice: (id: string, data: Record<string, unknown>) =>
      api.patch(`${BASE}/devices/${id}`, data).then((r: any) => r.data),

    deleteDevice: (id: string) =>
      api.delete(`${BASE}/devices/${id}`).then((r: any) => r.data),

    provisionDeviceChannels: (id: string) =>
      api.post(`${BASE}/devices/${id}/provision-channels`).then((r: any) => r.data),

    getDeviceTemplates: () =>
      api.get(`${BASE}/devices/templates`).then((r: any) => r.data),

    getDashboardSummary: () =>
      api.get(`${BASE}/devices/dashboard-summary`).then((r: any) => r.data),

    probeDevice: (data: { ipAddress: string; rtspPort?: number; httpPort?: number }) =>
      api.post(`${BASE}/devices/probe`, data).then((r: any) => r.data),

    bulkImportDevices: (devices: any[]) =>
      api.post(`${BASE}/devices/bulk-import`, { devices }).then((r: any) => r.data),

    // Physical Sites & Zones
    getSites: () =>
      api.get(`${BASE}/sites`).then((r: any) => r.data),

    getSite: (id: string) =>
      api.get(`${BASE}/sites/${id}`).then((r: any) => r.data),

    createSite: (data: Record<string, unknown>) =>
      api.post(`${BASE}/sites`, data).then((r: any) => r.data),

    updateSite: (id: string, data: Record<string, unknown>) =>
      api.patch(`${BASE}/sites/${id}`, data).then((r: any) => r.data),

    deleteSite: (id: string) =>
      api.delete(`${BASE}/sites/${id}`).then((r: any) => r.data),

    createZone: (data: Record<string, unknown>) =>
      api.post(`${BASE}/sites/zones`, data).then((r: any) => r.data),

    updateZone: (id: string, data: Record<string, unknown>) =>
      api.patch(`${BASE}/sites/zones/${id}`, data).then((r: any) => r.data),

    deleteZone: (id: string) =>
      api.delete(`${BASE}/sites/zones/${id}`).then((r: any) => r.data),

    // Camera Analytics
    getCameraAnalytics: (id: string, period?: string) =>
      api.get(`${BASE}/cameras/${id}/analytics`, { params: { period } }).then((r: any) => r.data),

    getCameraComparison: (period?: string, options?: { silent403?: boolean }) =>
      api.get(`${BASE}/cameras/analytics/comparison`, { params: { period }, ...options }).then((r: any) => r.data),

    // Camera Incidents
    getIncidents: (params?: { cameraId?: string; status?: string; page?: number; limit?: number }) =>
      api.get(`${BASE}/cameras/incidents`, { params }).then((r: any) => r.data),

    getIncident: (id: string) =>
      api.get(`${BASE}/cameras/incidents/${id}`).then((r: any) => r.data),
    deleteIncident: (id: string) =>
      api.delete(`${BASE}/cameras/incidents/${id}`).then((r: any) => r.data),

    resolveIncident: (id: string, data: Record<string, unknown>) =>
      api.post(`${BASE}/cameras/incidents/${id}/resolve`, data).then((r: any) => r.data),

    updateIncidentWorkflow: (id: string, data: { assignedTo?: string | null; workflowStage?: string; acknowledge?: boolean }) =>
      api.patch(`${BASE}/cameras/incidents/${id}/workflow`, data).then((r: any) => r.data),

    getIncidentOptions: (options?: { silent403?: boolean }) =>
      api.get(`${BASE}/cameras/incidents/options`, { ...options }).then((r: any) => r.data),

    searchIncidents: (params?: any) =>
      api.get(`${BASE}/cameras/incidents/search`, { params }).then((r: any) => r.data),

    getIncidentDetail: (id: string) =>
      api.get(`${BASE}/cameras/incidents/${id}`).then((r: any) => r.data),

    getRelatedIncidents: (id: string) =>
      api.get(`${BASE}/cameras/incidents/${id}/related`).then((r: any) => r.data),

    getResolutionStats: (params?: any) =>
      api.get(`${BASE}/cameras/incidents/resolution-stats`, { params }).then((r: any) => r.data),

    createWorkOrder: (id: string) =>
      api.post(`${BASE}/cameras/incidents/${id}/work-order`).then((r: any) => r.data),

    updateWorkOrderStatus: (id: string, status: string) =>
      api.patch(`${BASE}/cameras/incidents/${id}/work-order`, { status }).then((r: any) => r.data),

    getIncidentAttachmentBlob: (filename: string) =>
      api.get(`${BASE}/cameras/incidents/attachments/${filename}`, { responseType: 'blob' }).then((r: any) => r.data),

    clearAllIncidents: (password: string, retentionYears?: number) =>
      api.post(`${BASE}/cameras/incidents/clear-all`, { password, retentionYears }).then((r: any) => r.data),

    uploadIncidentAttachment: (incidentId: string, file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`${BASE}/cameras/incidents/${incidentId}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r: any) => r.data);
    },

    // Retention Policies
    getRetentionPolicies: (options?: { silent403?: boolean }) =>
      api.get(`${BASE}/retention-policies`, { ...options }).then((r: any) => r.data),

    getRetentionPolicy: (id: string) =>
      api.get(`${BASE}/retention-policies/${id}`).then((r: any) => r.data),

    createRetentionPolicy: (data: Record<string, unknown>) =>
      api.post(`${BASE}/retention-policies`, data).then((r: any) => r.data),

    updateRetentionPolicy: (id: string, data: Record<string, unknown>) =>
      api.patch(`${BASE}/retention-policies/${id}`, data).then((r: any) => r.data),

    deleteRetentionPolicy: (id: string) =>
      api.delete(`${BASE}/retention-policies/${id}`),

    // Alerts
    getAlerts: (params?: { siteId?: string; zoneId?: string; severity?: string; resolved?: boolean; page?: number; limit?: number; sortBy?: string; sortDir?: 'asc' | 'desc' }, options?: { silent403?: boolean }) =>
      api.get(`${BASE}/alerts`, { params, ...options }).then((r: any) => r.data),

    getAlert: (id: string) =>
      api.get(`${BASE}/alerts/${id}`).then((r: any) => r.data),

    acknowledgeAlert: (id: string) =>
      api.patch(`${BASE}/alerts/${id}/acknowledge`).then((r: any) => r.data),

    resolveAlert: (id: string) =>
      api.patch(`${BASE}/alerts/${id}/resolve`).then((r: any) => r.data),

    // Users
    getUsers: (params?: { page?: number; limit?: number; enabled?: boolean }, options?: { silent403?: boolean }) =>
      api.get(`${BASE}/users`, { params, ...options }).then((r: any) => r.data),

    getUser: (id: string) =>
      api.get(`${BASE}/users/${id}`).then((r: any) => r.data),

    createUser: (data: { username: string; email: string; password: string; role: string; customPermissions?: string[] }) =>
      api.post(`${BASE}/users`, data).then((r: any) => r.data),

    updateUser: (id: string, data: Record<string, unknown>) =>
      api.patch(`${BASE}/users/${id}`, data).then((r: any) => r.data),

    deactivateUser: (id: string) =>
      api.delete(`${BASE}/users/${id}`).then((r: any) => r.data),

    unlockUser: (id: string) =>
      api.post(`${BASE}/users/${id}/unlock`).then((r: any) => r.data),

    getUserActivity: (id: string, period?: string) =>
      api.get(`${BASE}/users/${id}/activity`, { params: { period } }).then((r: any) => r.data),

    getUsersActivitySummary: (period?: string) =>
      api.get(`${BASE}/users/activity/summary`, { params: { period } }).then((r: any) => r.data),

    // Roles
    getRoles: () =>
      api.get(`${BASE}/roles`).then((r: any) => r.data),

    getRole: (id: string) =>
      api.get(`${BASE}/roles/${id}`).then((r: any) => r.data),

    createRole: (data: Record<string, unknown>) =>
      api.post(`${BASE}/roles`, data).then((r: any) => r.data),

    updateRole: (id: string, data: Record<string, unknown>) =>
      api.patch(`${BASE}/roles/${id}`, data).then((r: any) => r.data),

    deleteRole: (id: string) =>
      api.delete(`${BASE}/roles/${id}`).then((r: any) => r.data),

    // Alert Rules
    getAlertRules: (params?: { page?: number; limit?: number }, options?: { silent403?: boolean }) =>
      api.get(`${BASE}/alert-rules`, { params, ...options }).then((r: any) => r.data),

    getAlertRule: (id: string) =>
      api.get(`${BASE}/alert-rules/${id}`).then((r: any) => r.data),

    createAlertRule: (data: {
      name: string; alertType: string; description?: string;
      enabled?: boolean; cooldownMinutes?: number; notificationChannels?: string[];
    }) => api.post(`${BASE}/alert-rules`, data).then((r: any) => r.data),

    updateAlertRule: (id: string, data: Record<string, unknown>) =>
      api.patch(`${BASE}/alert-rules/${id}`, data).then((r: any) => r.data),

    deleteAlertRule: (id: string) =>
      api.delete(`${BASE}/alert-rules/${id}`),

    // Telegram Settings
    getTelegramSettings: () =>
      api.get(`${BASE}/settings/telegram`).then((r: any) => r.data),

    updateTelegramSettings: (data: Record<string, string>) =>
      api.patch(`${BASE}/settings/telegram`, data).then((r: any) => r.data),

    // LLM connection settings
    getLlmSettings: () => api.get(`${BASE}/settings/llm`).then((r: any) => r.data),
    updateLlmSettings: (data: Record<string, string>) =>
      api.patch(`${BASE}/settings/llm`, data).then((r: any) => r.data),
    clearLlmApiKey: () => api.delete(`${BASE}/settings/llm/key`).then((r: any) => r.data),

    // Telegram bot private-chat allowlist
    getTelegramUsers: () =>
      api.get(`${BASE}/telegram-users`).then((r: any) => r.data),
    addTelegramUser: (data: { telegramId: string; firstName?: string }) =>
      api.post(`${BASE}/telegram-users`, data).then((r: any) => r.data),
    setTelegramUserStatus: (telegramId: string, status: 'approved' | 'rejected' | 'pending') =>
      api.patch(`${BASE}/telegram-users/${telegramId}`, { status }).then((r: any) => r.data),
    deleteTelegramUser: (telegramId: string) =>
      api.delete(`${BASE}/telegram-users/${telegramId}`),

    // API Keys
    getApiKeys: (params?: { page?: number; limit?: number }) =>
      api.get(`${BASE}/api-keys`, { params }).then((r: any) => r.data),

    getApiKey: (id: string) =>
      api.get(`${BASE}/api-keys/${id}`).then((r: any) => r.data),

    createApiKey: (data: { name: string; permissions?: string[]; expiresAt?: string }) =>
      api.post(`${BASE}/api-keys`, data).then((r: any) => r.data),

    updateApiKey: (id: string, data: Record<string, unknown>) =>
      api.patch(`${BASE}/api-keys/${id}`, data).then((r: any) => r.data),

    deleteApiKey: (id: string) =>
      api.delete(`${BASE}/api-keys/${id}`),

    // Masterdata
    bulkUpdateCameras: (ids: string[], changes: Record<string, unknown>): Promise<{ updated: number; failed: Array<{ id: string; name: string; message: string }> }> =>
      api.patch(`${BASE}/cameras/bulk`, { ids, changes }).then((r: any) => r.data),
    getMasterdataOptions: (type: string): Promise<any[]> =>
      api.get(`${BASE}/masterdata/options`, { params: { type } }).then((r: any) => r.data),
    setDeviceChannels: (id: string, enabledChannels: number[]) =>
      api.put(`${BASE}/devices/${id}/channels`, { enabledChannels }).then((r: any) => r.data),
    getMasterdata: (params: { type: string; page?: number; limit?: number; isActive?: boolean }, options?: { silent403?: boolean }) =>
      api.get(`${BASE}/masterdata`, { params, ...options }).then((r: any) => r.data),

    createMasterdata: (data: any) =>
      api.post(`${BASE}/masterdata`, data).then((r: any) => r.data),

    updateMasterdata: (id: string, data: any) =>
      api.patch(`${BASE}/masterdata/${id}`, data).then((r: any) => r.data),

    deleteMasterdata: (id: string) =>
      api.delete(`${BASE}/masterdata/${id}`),

    // System Config
    // Name, logo and version only: readable before login. Everything else needs system-config:read.
    getSystemBranding: () =>
      api.get(`${BASE}/system-config/public`).then((r: any) => r.data),

    getSystemConfigs: (options?: { silent403?: boolean }) =>
      api.get(`${BASE}/system-config`, { ...options }).then((r: any) => r.data),

    updateSystemConfigs: (data: Record<string, string>) =>
      api.post(`${BASE}/system-config/bulk-update`, data).then((r: any) => r.data),

    // Required Fields configuration
    getRequiredFields: (options?: { silent403?: boolean }): Promise<Record<string, string[]>> =>
      api.get(`${BASE}/system-config/required-fields`, { ...options }).then((r: any) => r.data),

    updateRequiredFields: (data: Record<string, string[]>) =>
      api.put(`${BASE}/system-config/required-fields`, data).then((r: any) => r.data),

    // Audit Logs
    getAuditLogs: (params: {
      page?: number; limit?: number; action?: string; entity?: string;
      entityId?: string; userId?: string; from?: string; to?: string;
      sortBy?: string; sortDir?: 'asc' | 'desc';
    }) => api.get(`${BASE}/audit-logs`, { params }).then((r: any) => r.data),

    bulkDeleteAuditPreview: (days: number) =>
      api.get(`${BASE}/audit-logs/bulk-delete-preview`, { params: { days } }).then((r: any) => r.data),

    bulkDeleteAuditByAge: (days: number, password: string) =>
      api.post(`${BASE}/audit-logs/bulk-delete`, { days, password }).then((r: any) => r.data),

    // Backup
    getBackupStatus: () =>
      api.get(`${BASE}/backup/status`).then((r: any) => r.data),

    getBackupRecords: (params?: { page?: number; limit?: number; type?: string }) =>
      api.get(`${BASE}/backup`, { params }).then((r: any) => r.data),

    runDatabaseBackup: () =>
      api.post(`${BASE}/backup/run/database`).then((r: any) => r.data),

    runStorageBackup: () =>
      api.post(`${BASE}/backup/run/storage`).then((r: any) => r.data),

    runRestoreTest: (id: string) =>
      api.post(`${BASE}/backup/${id}/restore-test`).then((r: any) => r.data),

    // Storage Providers
    getStorageProviders: (params?: {}, options?: { silent403?: boolean }) =>
      api.get(`${BASE}/storage-providers`, { params, ...options }).then((r: any) => r.data),

    getStorageProvider: (id: string) =>
      api.get(`${BASE}/storage-providers/${id}`).then((r: any) => r.data),

    createStorageProvider: (data: any) =>
      api.post(`${BASE}/storage-providers`, data).then((r: any) => r.data),

    updateStorageProvider: (id: string, data: any) =>
      api.patch(`${BASE}/storage-providers/${id}`, data).then((r: any) => r.data),

    deleteStorageProvider: (id: string) =>
      api.delete(`${BASE}/storage-providers/${id}`),

    testStorageProvider: (id: string) =>
      api.post(`${BASE}/storage-providers/${id}/test`).then((r: any) => r.data),

    getStorageProviderMetrics: (id: string) =>
      api.get(`${BASE}/storage-providers/${id}/metrics`).then((r: any) => r.data),

    refreshStorageProviderCapacity: (id: string) =>
      api.post(`${BASE}/storage-providers/${id}/refresh-capacity`).then((r: any) => r.data),

    // Universal Search
    universalSearch: (q: string) =>
      api.get(`${BASE}/search`, { params: { q } }).then((r: any) => r.data),

    // Alerts bulk actions
    clearAllAlerts: (password: string) =>
      api.post(`${BASE}/alerts/clear-all`, { password }).then((r: any) => r.data),
    acknowledgeAllAlerts: () => api.post(`${BASE}/alerts/acknowledge-all`).then((r: any) => r.data),
    getUnacknowledgedCount: () => api.get(`${BASE}/alerts/unacknowledged-count`).then((r: any) => r.data),
    snoozeAlert: (id: string, hours = 4) =>
      api.post(`${BASE}/alerts/${id}/snooze`, { hours }).then((r: any) => r.data),

    // Recordings & Playback (Phase 4)
    getRecordingTimeline: (cameraId: string, date?: string) =>
      api.get(`${BASE}/recordings/timeline`, { params: { cameraId, date } }).then((r: any) => r.data),
    getRecordingSegments: (params: { cameraId: string; from?: string; to?: string; limit?: number }) =>
      api.get(`${BASE}/recordings/segments`, { params }).then((r: any) => r.data),
    exportRecordingClip: (data: {
      cameraId: string;
      incidentId?: string;
      title: string;
      description?: string;
      startTime: string;
      endTime: string;
      preBufferSeconds?: number;
      postBufferSeconds?: number;
      legalHold?: boolean;
    }) => api.post(`${BASE}/recordings/clips`, data).then((r: any) => r.data),
    getRecordingClips: (params?: { cameraId?: string; incidentId?: string }) =>
      api.get(`${BASE}/recordings/clips`, { params }).then((r: any) => r.data),
    toggleSegmentLegalHold: (id: string, legalHold: boolean) =>
      api.patch(`${BASE}/recordings/segments/${id}/legal-hold`, { legalHold }).then((r: any) => r.data),
    toggleClipLegalHold: (id: string, legalHold: boolean) =>
      api.patch(`${BASE}/recordings/clips/${id}/legal-hold`, { legalHold }).then((r: any) => r.data),
    seedDevRecordings: (cameraId: string, date?: string) =>
      api.post(`${BASE}/recordings/seed-dev`, { cameraId, date }).then((r: any) => r.data),
    getRecordingCoverage: (cameraId: string, start: string, end: string) =>
      api.get(`${BASE}/recordings/coverage`, { params: { cameraId, start, end } }).then((r: any) => r.data),

    /** Signed short-lived URL; the browser streams the clip to disk without holding it in memory. */
    getClipDownloadUrl: (clipId: string): Promise<string> =>
      api.post(`${BASE}/recordings/clips/${clipId}/download-link`).then((r: any) => `${BASE}${r.data.path}`),

    downloadRecordingClip: (filename: string): Promise<Blob> =>
      api.get(`${BASE}/recordings/clips/download/${encodeURIComponent(filename)}`, { responseType: 'blob' }).then((r: any) => r.data),

    getDeviceTimeline: (cameraId: string, date: string) =>
      api.get(`${BASE}/device-playback/timeline`, { params: { cameraId, date } }).then((r: any) => r.data),
    openDevicePlayback: (data: { cameraId: string; start: string; canPlayH265: boolean }) =>
      api.post(`${BASE}/device-playback/sessions`, data).then((r: any) => r.data),
    closeDevicePlayback: (sessionId: string) =>
      api.delete(`${BASE}/device-playback/sessions/${sessionId}`).then((r: any) => r.data),
    exportDeviceClip: (data: { cameraId: string; start: string; end: string; title: string; incidentId?: string; legalHold?: boolean }) =>
      api.post(`${BASE}/device-playback/clips`, data).then((r: any) => r.data),
    getPlaybackStream: (cameraId: string, start: string, duration = 300) =>
      api.get(`${BASE}/recordings/playback-stream`, { params: { cameraId, start, duration } }).then((r: any) => r.data),

    // Multi-Node Media Plane, Scale & WFH (Phase 5)
    getMediaNodes: (params?: { siteId?: string; status?: string }) =>
      api.get(`${BASE}/media-nodes`, { params }).then((r: any) => r.data),
    getMediaNode: (id: string) =>
      api.get(`${BASE}/media-nodes/${id}`).then((r: any) => r.data),
    createMediaNode: (data: any) =>
      api.post(`${BASE}/media-nodes`, data).then((r: any) => r.data),
    updateMediaNode: (id: string, data: any) =>
      api.patch(`${BASE}/media-nodes/${id}`, data).then((r: any) => r.data),
    deleteMediaNode: (id: string) =>
      api.delete(`${BASE}/media-nodes/${id}`).then((r: any) => r.data),
    failoverMediaNode: (id: string, targetNodeId?: string) =>
      api.post(`${BASE}/media-nodes/${id}/failover`, { targetNodeId }).then((r: any) => r.data),
    getCapacityBenchmark: (params: {
      channels?: number;
      mainKbps?: number;
      subKbps?: number;
      viewers?: number;
      retentionDays?: number;
      codec?: 'h264' | 'h265';
      raidType?: 'raid0' | 'raid5' | 'raid6' | 'raid10';
      raidOverhead?: number;
      headroom?: number;
    }) => api.get(`${BASE}/media-nodes/benchmark`, { params }).then((r: any) => r.data),
    getWfhIceConfig: () =>
      api.get(`${BASE}/media-nodes/wfh-ice-config`).then((r: any) => r.data),

    // Pilot & Release (Phase 6)
    getPreflightReadiness: () =>
      api.get(`${BASE}/release/preflight`).then((r: any) => r.data),
    getPilotRolloutPlan: (targetCameras?: number) =>
      api.get(`${BASE}/release/pilot-plan`, { params: { targetCameras } }).then((r: any) => r.data),
    getReleaseSignoffs: () =>
      api.get(`${BASE}/release/signoffs`).then((r: any) => r.data),
    submitReleaseSignoff: (data: {
      signedBy?: string;
      targetEnvironment?: string;
      scope?: string;
      notes?: string;
      checklistPassed?: boolean;
    }) => api.post(`${BASE}/release/signoff`, data).then((r: any) => r.data),
  };
}

export const imageServiceApi = createImageServiceApi(api);
