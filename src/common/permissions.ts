/** Permission strings enforced by PermissionsGuard. */
export const PERMISSIONS = [
  'product:read',
  'product:write',
  'inventory:read',
  'inventory:write',
  'promotion:read',
  'promotion:write',
  'order:read',
  'order:write',
  'order:refund',
  'content:read',
  'content:write',
  'content:publish',
  'media:read',
  'media:write',
  'delivery:read',
  'delivery:write',
  'settings:read',
  'settings:write',
  'staff:read',
  'staff:write',
  'audit:read',
  'analytics:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const readOnly = PERMISSIONS.filter(
  (p) => p.endsWith(':read') && !['staff:read', 'audit:read', 'settings:read'].includes(p),
);

export const ROLE_DEFINITIONS: Record<string, { description: string; permissions: Permission[] }> = {
  owner: { description: 'Full access', permissions: [...PERMISSIONS] },
  manager: {
    description: 'Catalogue, promotions, orders, content, delivery',
    permissions: PERMISSIONS.filter(
      (p) => !p.startsWith('staff:') && !p.startsWith('audit:') && p !== 'settings:write',
    ),
  },
  content_editor: {
    description: 'Content, media and testimonials',
    permissions: ['content:read', 'content:write', 'content:publish', 'media:read', 'media:write', 'product:read'],
  },
  fulfilment: {
    description: 'Orders and inventory',
    permissions: ['order:read', 'order:write', 'inventory:read', 'inventory:write', 'product:read'],
  },
  viewer: { description: 'Read-only', permissions: readOnly },
};
