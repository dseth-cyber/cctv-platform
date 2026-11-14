import { describe, it, expect } from 'vitest';
import { storageRouter } from './storage-router.js';

const local = (id: string, isActive: boolean, isDefault = false) => ({
  id, name: id, type: 'local' as const, config: { basePath: `/tmp/cctv-router-test-${id}` } as any, isDefault, isActive,
});

describe('storageRouter.getActive', () => {
  it('keeps inactive providers registered but leaves them out of getActive', () => {
    storageRouter.register(local('on', true, true));
    storageRouter.register(local('off', false));
    expect(storageRouter.getAll().map((p) => p.id)).toEqual(expect.arrayContaining(['on', 'off']));
    expect(storageRouter.getActive().map((p) => p.id)).toContain('on');
    expect(storageRouter.getActive().map((p) => p.id)).not.toContain('off');
  });

  it('follows a provider turned on or off later, and forgets an unregistered one', () => {
    storageRouter.register(local('off', true));
    expect(storageRouter.getActive().map((p) => p.id)).toContain('off');
    storageRouter.register(local('on', false, true));
    expect(storageRouter.getActive().map((p) => p.id)).not.toContain('on');
    storageRouter.unregister('off');
    expect(storageRouter.getActive().map((p) => p.id)).not.toContain('off');
    storageRouter.unregister('on');
  });
});
