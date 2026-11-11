/**
 * Required Fields Catalog — source of truth for the "Required Fields Settings" page.
 *
 * Each entry describes an entity (a tab), its logical field groups, and the fields
 * within each group. Field `key`s MUST match the real payload keys produced by the
 * corresponding create/edit form (verified against the backend Zod schemas /
 * controllers). `labelKey`s reference i18n strings under `imageService.requiredFields.*`.
 *
 * Adding a new entity/field here automatically makes it configurable on the settings
 * page. Enforcement in forms is opt-in via the `useRequiredFields(entity)` hook — see
 * that hook and `ImageServiceCameras.tsx` for the currently-wired forms.
 */
export interface RequiredFieldDef {
  key: string;
  labelKey: string;
  /** Hard-required by the system regardless of config (shown checked + disabled). */
  alwaysRequired?: boolean;
}

export interface RequiredFieldGroup {
  labelKey: string;
  fields: RequiredFieldDef[];
}

export interface RequiredFieldEntity {
  entity: string;
  labelKey: string;
  groups: RequiredFieldGroup[];
}

const f = (key: string, alwaysRequired = false): RequiredFieldDef => ({
  key,
  labelKey: `imageService.requiredFields.field_${key}`,
  ...(alwaysRequired ? { alwaysRequired } : {}),
});

export const REQUIRED_FIELD_CATALOG: RequiredFieldEntity[] = [
  {
    entity: 'camera',
    labelKey: 'imageService.requiredFields.camera',
    groups: [
      {
        labelKey: 'imageService.requiredFields.groupGeneral',
        fields: [
          f('name', true),
          f('description'),
          f('retentionPolicyId', true),
        ],
      },
      {
        // [R2.3] CCTV stream source; the factory SMB fields left the camera form.
        labelKey: 'imageService.requiredFields.groupStream',
        fields: [
          f('ipAddress'),
          f('rtspUrl'),
          f('rtspUrlSub'),
          f('streamPath'),
        ],
      },
    ],
  },
  {
    entity: 'incident',
    labelKey: 'imageService.requiredFields.incident',
    groups: [
      {
        labelKey: 'imageService.requiredFields.groupClassification',
        fields: [
          f('reason'),
          f('rootCause'),
          f('priority'),
          f('impact'),
        ],
      },
      {
        labelKey: 'imageService.requiredFields.groupGeneral',
        fields: [
          f('problemDesc'),
          f('description'),
          f('assignedTo'),
          f('estimatedFinish'),
          f('attachments'),
        ],
      },
    ],
  },
  {
    entity: 'storageProvider',
    labelKey: 'imageService.requiredFields.storageProvider',
    groups: [
      {
        labelKey: 'imageService.requiredFields.groupGeneral',
        fields: [
          f('name', true),
          f('type', true),
          f('priority'),
          f('description'),
        ],
      },
      {
        labelKey: 'imageService.requiredFields.groupConfig',
        fields: [
          f('endpoint'),
          f('accessKey'),
          f('secretKey'),
          f('bucket'),
          f('basePath'),
          f('share'),
        ],
      },
    ],
  },
  {
    entity: 'retention',
    labelKey: 'imageService.requiredFields.retention',
    groups: [
      {
        labelKey: 'imageService.requiredFields.groupGeneral',
        fields: [
          f('name', true),
          f('description'),
        ],
      },
      {
        labelKey: 'imageService.requiredFields.groupRetentionDays',
        fields: [
          f('recordingRetentionDays', true),
        ],
      },
    ],
  },
  {
    entity: 'alertRule',
    labelKey: 'imageService.requiredFields.alertRule',
    groups: [
      {
        labelKey: 'imageService.requiredFields.groupGeneral',
        fields: [
          f('name', true),
          f('alertType', true),
          f('description'),
        ],
      },
      {
        labelKey: 'imageService.requiredFields.groupNotification',
        fields: [
          f('cooldownMinutes'),
          f('notificationChannels'),
        ],
      },
    ],
  },
  {
    entity: 'apiKey',
    labelKey: 'imageService.requiredFields.apiKey',
    groups: [
      {
        labelKey: 'imageService.requiredFields.groupGeneral',
        fields: [
          f('name', true),
          f('permissions'),
          f('expiresAt'),
        ],
      },
    ],
  },
  {
    entity: 'masterdata',
    labelKey: 'imageService.requiredFields.masterdata',
    groups: [
      {
        labelKey: 'imageService.requiredFields.groupGeneral',
        fields: [
          f('code', true),
          f('description'),
          f('sortOrder'),
        ],
      },
      {
        labelKey: 'imageService.requiredFields.groupNames',
        fields: [
          f('nameTh'),
          f('nameEn'),
          f('nameCn'),
          f('nameMm'),
          f('nameJp'),
        ],
      },
    ],
  },
  {
    entity: 'user',
    labelKey: 'imageService.requiredFields.user',
    groups: [
      {
        labelKey: 'imageService.requiredFields.groupGeneral',
        fields: [
          f('username', true),
          f('email', true),
          f('password', true),
          f('role', true),
        ],
      },
      {
        labelKey: 'imageService.requiredFields.groupPermissions',
        fields: [
          f('customPermissions'),
        ],
      },
    ],
  },
  {
    entity: 'role',
    labelKey: 'imageService.requiredFields.role',
    groups: [
      {
        labelKey: 'imageService.requiredFields.groupGeneral',
        fields: [
          f('code', true),
          f('nameTh', true),
          f('nameEn', true),
          f('description'),
        ],
      },
      {
        labelKey: 'imageService.requiredFields.groupPermissions',
        fields: [
          f('permissions'),
        ],
      },
    ],
  },
];

/** All field keys defined for an entity (flattened across groups). */
export function catalogFieldsFor(entity: string): RequiredFieldDef[] {
  const e = REQUIRED_FIELD_CATALOG.find(c => c.entity === entity);
  return e ? e.groups.flatMap(g => g.fields) : [];
}
