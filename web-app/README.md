# Image Service — Frontend Module

Child module for the Smart Factory ERP Platform.

## Module Structure

```
web-app/
├── src/
│   ├── i18n/locales/          # Locale JSON files (merge into ERP)
│   │   ├── th.json
│   │   ├── en.json
│   │   ├── cn.json
│   │   ├── mm.json
│   │   └── jp.json
│   ├── pages/image-service/    # Page components (7 pages)
│   │   ├── ImageServiceOverview.tsx
│   │   ├── ImageServiceCameras.tsx
│   │   ├── ImageServiceSearch.tsx
│   │   ├── ImageServiceProcessingMonitor.tsx
│   │   ├── ImageServiceStorage.tsx
│   │   ├── ImageServiceProcessingLogs.tsx
│   │   ├── ImageServiceSettings.tsx
│   │   └── ImageServiceRetention.tsx
│   ├── services/
│   │   └── imageServiceApi.ts  # API client (factory function)
│   └── types/
│       └── image-service.ts    # TypeScript interfaces
```

## Integration Steps

### 1. Install Dependencies

Add to ERP's `package.json`:

```json
{
  "dependencies": {
    "recharts": "^2.15.0",
    "react-grid-layout": "^1.5.0",
    "react-resizable": "^3.0.5",
    "lucide-react": "^0.460.0"
  }
}
```

### 2. Merge i18n Locales

Merge each file from `src/i18n/locales/*.json` into the ERP's corresponding locale file.  
All keys are under `imageService.*` namespace.

### 3. Create API Instance

```tsx
import { createImageServiceApi } from '@/modules/image-service/services/imageServiceApi';
import api from '@/lib/axios';

export const imageServiceApi = createImageServiceApi(api);
```

### 4. Register Routes

```tsx
import { Route } from 'react-router-dom';
import ImageServiceOverview from '@/modules/image-service/pages/image-service/ImageServiceOverview';
import ImageServiceCameras from '@/modules/image-service/pages/image-service/ImageServiceCameras';
import ImageServiceSearch from '@/modules/image-service/pages/image-service/ImageServiceSearch';
import ImageServiceProcessingMonitor from '@/modules/image-service/pages/image-service/ImageServiceProcessingMonitor';
import ImageServiceStorage from '@/modules/image-service/pages/image-service/ImageServiceStorage';
import ImageServiceProcessingLogs from '@/modules/image-service/pages/image-service/ImageServiceProcessingLogs';
import ImageServiceSettings from '@/modules/image-service/pages/image-service/ImageServiceSettings';

// Inside your App's <Routes>:
<Route path="/image-service/overview" element={<ImageServiceOverview />} />
<Route path="/image-service/cameras" element={<ImageServiceCameras />} />
<Route path="/image-service/search" element={<ImageServiceSearch />} />
<Route path="/image-service/processing" element={<ImageServiceProcessingMonitor />} />
<Route path="/image-service/storage" element={<ImageServiceStorage />} />
<Route path="/image-service/logs" element={<ImageServiceProcessingLogs />} />
<Route path="/image-service/settings" element={<ImageServiceSettings />} />
```

### 5. Add Sidebar Menu Items

```tsx
// In ERP's sidebar config:
{ path: '/image-service/overview',  label: 'imageService.overview.title',  icon: LayoutDashboard },
{ path: '/image-service/cameras',   label: 'imageService.cameras.title',   icon: Camera },
{ path: '/image-service/search',    label: 'imageService.search.title',    icon: Search },
{ path: '/image-service/processing',label: 'imageService.processing.title',icon: Activity },
{ path: '/image-service/storage',   label: 'imageService.storage.title',   icon: HardDrive },
{ path: '/image-service/logs',      label: 'imageService.processingLogs.title', icon: FileText },
{ path: '/image-service/settings',  label: 'imageService.settings.title',  icon: Settings },
```

### 6. API Proxy Configuration

Add to vite config (if using Vite):

```ts
server: {
  proxy: {
    '/image-service': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
  },
}
```

## Page Dependencies (ERP Must Provide)

| Import Path | Provided By |
|---|---|
| `@/contexts/ThemeContext` → `useTheme()` | ERP ThemeContext |
| `@/contexts/ToastContext` → `useToast()` | ERP ToastContext |
| `@/utils/dateUtils` → `formatDateTime()` | ERP dateUtils |
| `@/utils/textUtils` → `getLocalizedValue()` | ERP textUtils |
| `@/components/ui` → `Modal, Button, SearchableSelect, TableSkeleton, ColumnSelector` | ERP UI library |
| `react-i18next` → `useTranslation()` | ERP i18n setup |
| `@tanstack/react-query` → `useQuery(), useQueryClient()` | ERP query client |

## API Endpoints

The Image Service API runs at `/image-service/api/v1/*`.  
Backend is proxied to `http://image-api:3001` (Docker internal) or `http://localhost:3001` (dev).
