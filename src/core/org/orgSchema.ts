/**
 * Phase 9 organizational architecture (§12–§13).
 *
 * Adds Organization / Workspace / User / Membership entities and a role-based
 * permission model. This is ADDITIVE: single-clinician local mode remains the
 * default and is fully supported — when no organization exists, the app runs
 * exactly as it did in Phases 1–8 with an implicit local owner who holds every
 * clinical permission.
 *
 * Permissions are enforced in the service/repository layer (see orgService),
 * never only in the UI.
 */

export type OrgStatus = 'active' | 'suspended' | 'closed';
export type UserStatus = 'active' | 'invited' | 'suspended' | 'deactivated';
export type MembershipStatus = 'active' | 'pending' | 'ended';

// ---------------------------------------------------------------- roles

export type Role =
  | 'org-admin'
  | 'security-admin'
  | 'clinical-admin'
  | 'clinician'
  | 'supervisor'
  | 'auditor'
  | 'support';

export const ROLES: Array<{ value: Role; label: string; detail: string }> = [
  { value: 'org-admin', label: 'Organization Administrator', detail: 'Manages users, policies and organization settings.' },
  { value: 'security-admin', label: 'Security Administrator', detail: 'Manages security settings, providers and audit review.' },
  { value: 'clinical-admin', label: 'Clinical Administrator', detail: 'Manages clinical configuration and knowledge sources.' },
  { value: 'clinician', label: 'Clinician', detail: 'Full clinical access to assigned clients.' },
  { value: 'supervisor', label: 'Supervisor', detail: 'Reviews and approves supervisee clinical work.' },
  { value: 'auditor', label: 'Read-Only Auditor', detail: 'Reads audit logs and governance records — no clinical editing.' },
  { value: 'support', label: 'Support (no clinical access)', detail: 'Technical support role with NO access to clinical content.' },
];

// ---------------------------------------------------------- permissions

export type Permission =
  | 'client.view'
  | 'client.create'
  | 'client.edit'
  | 'client.delete'
  | 'transcript.viewRaw'
  | 'document.generate'
  | 'document.approve'
  | 'risk.review'
  | 'record.export'
  | 'knowledge.manage'
  | 'provider.manage'
  | 'audit.view'
  | 'user.manage'
  | 'policy.manage'
  | 'phiGate.complete'
  | 'supervision.review';

export const PERMISSIONS: Array<{ value: Permission; label: string }> = [
  { value: 'client.view', label: 'View client' },
  { value: 'client.create', label: 'Create client' },
  { value: 'client.edit', label: 'Edit client' },
  { value: 'client.delete', label: 'Delete client' },
  { value: 'transcript.viewRaw', label: 'View raw transcripts' },
  { value: 'document.generate', label: 'Generate documents' },
  { value: 'document.approve', label: 'Approve documents' },
  { value: 'risk.review', label: 'Review risk information' },
  { value: 'record.export', label: 'Export records' },
  { value: 'knowledge.manage', label: 'Manage knowledge sources' },
  { value: 'provider.manage', label: 'Manage AI providers' },
  { value: 'audit.view', label: 'View audit logs' },
  { value: 'user.manage', label: 'Manage users' },
  { value: 'policy.manage', label: 'Manage policies' },
  { value: 'phiGate.complete', label: 'Complete PHI-readiness gates' },
  { value: 'supervision.review', label: 'Review supervision submissions' },
];

/** Every permission that grants sight of clinical content. */
export const CLINICAL_PERMISSIONS: Permission[] = [
  'client.view',
  'client.create',
  'client.edit',
  'client.delete',
  'transcript.viewRaw',
  'document.generate',
  'document.approve',
  'risk.review',
  'record.export',
  'supervision.review',
];

/**
 * Default role → permission map.
 *
 * NOTE the deliberate gaps: `support` gets NO clinical permission at all, and
 * `auditor` can read audit/governance but cannot open a client record or export.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  'org-admin': [
    'client.view', 'client.create', 'client.edit', 'client.delete',
    'record.export', 'knowledge.manage', 'provider.manage', 'audit.view',
    'user.manage', 'policy.manage', 'phiGate.complete',
  ],
  'security-admin': ['provider.manage', 'audit.view', 'policy.manage', 'phiGate.complete'],
  'clinical-admin': ['client.view', 'client.create', 'client.edit', 'knowledge.manage', 'audit.view'],
  clinician: [
    'client.view', 'client.create', 'client.edit', 'client.delete',
    'transcript.viewRaw', 'document.generate', 'document.approve',
    'risk.review', 'record.export',
  ],
  supervisor: [
    'client.view', 'transcript.viewRaw', 'document.generate',
    'risk.review', 'supervision.review',
  ],
  auditor: ['audit.view'],
  support: [], // no clinical access by default — intentionally empty
};

// ------------------------------------------------------------- entities

export interface Organization {
  id: string;
  name: string;
  status: OrgStatus;
  /** Organization-level online-processing policy; overrides workspace settings. */
  onlineProcessingAllowed: boolean;
  /** Organization-wide emergency stop for all online AI. */
  onlineKillSwitch: boolean;
  approvedProviderIds: string[];
  retentionNotes?: string;
  exportPolicyNotes?: string;
  backupPolicyNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  storageMode: 'browser' | 'native-file';
  /** Nothing in this workspace may be sent to an online provider. */
  localOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrgUser {
  id: string;
  organizationId: string;
  name: string;
  identifier: string;
  role: Role;
  status: UserStatus;
  authMethod: 'passphrase' | 'device' | 'sso-planned';
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  workspaceId: string;
  role: Role;
  /** Explicit grants layered on top of the role defaults. */
  extraPermissions: Permission[];
  /** Explicit denials; these WIN over role defaults and extra grants. */
  deniedPermissions: Permission[];
  startDate: string;
  endDate?: string;
  status: MembershipStatus;
}

// ------------------------------------------------------- permission math

export interface AccessContext {
  /** Absent in single-clinician local mode. */
  membership?: Membership;
  /** True when the app is running as a single local clinician (no org). */
  singleClinicianMode: boolean;
}

/**
 * Effective permissions for a context.
 *
 * Single-clinician local mode keeps every clinical permission (Phases 1–8
 * behavior). In organizational mode: role defaults + extra grants − denials,
 * and an inactive/ended membership grants nothing.
 */
export function effectivePermissions(ctx: AccessContext): Set<Permission> {
  if (ctx.singleClinicianMode && !ctx.membership) {
    return new Set<Permission>(PERMISSIONS.map((p) => p.value));
  }
  const m = ctx.membership;
  if (!m || m.status !== 'active') return new Set<Permission>();
  if (m.endDate && m.endDate < new Date().toISOString().slice(0, 10)) return new Set<Permission>();
  const granted = new Set<Permission>([...(ROLE_PERMISSIONS[m.role] ?? []), ...m.extraPermissions]);
  for (const denied of m.deniedPermissions) granted.delete(denied);
  return granted;
}

export function hasPermission(ctx: AccessContext, permission: Permission): boolean {
  return effectivePermissions(ctx).has(permission);
}

/** True when the context can see ANY clinical content. */
export function hasAnyClinicalAccess(ctx: AccessContext): boolean {
  const perms = effectivePermissions(ctx);
  return CLINICAL_PERMISSIONS.some((p) => perms.has(p));
}

export class PermissionDeniedError extends Error {
  constructor(
    readonly permission: Permission,
    message?: string,
  ) {
    super(message ?? `Permission denied: ${permission}`);
    this.name = 'PermissionDeniedError';
  }
}

export class IsolationViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsolationViolationError';
  }
}
