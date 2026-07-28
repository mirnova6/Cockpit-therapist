import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import { makeTestDb } from '../ai/phase4TestUtils';
import {
  effectivePermissions,
  hasAnyClinicalAccess,
  hasPermission,
  IsolationViolationError,
  localAccessContext,
  PermissionDeniedError,
  requireClinicalAccess,
  requirePermission,
  requireSameTenant,
  scopeToTenant,
} from './orgService';
import { CLINICAL_PERMISSIONS, PERMISSIONS, ROLE_PERMISSIONS, type AccessContext, type Membership, type Role } from './orgSchema';

let auth: AuthService;
let db: ClinicalDatabase;

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-org'));
});
afterEach(async () => {
  await auth.close();
});

function ctxFor(role: Role, over: Partial<Membership> = {}): AccessContext {
  const membership: Membership = {
    id: 'm1',
    userId: 'u1',
    organizationId: 'org-A',
    workspaceId: 'ws-1',
    role,
    extraPermissions: [],
    deniedPermissions: [],
    startDate: '2026-01-01',
    status: 'active',
    ...over,
  };
  return { membership, singleClinicianMode: false };
}

describe('single-clinician local mode is preserved', () => {
  it('grants every permission when no organization is configured', () => {
    const ctx = localAccessContext();
    for (const p of PERMISSIONS) expect(hasPermission(ctx, p.value)).toBe(true);
    expect(hasAnyClinicalAccess(ctx)).toBe(true);
    expect(() => requireClinicalAccess(ctx)).not.toThrow();
  });

  it('still refuses records that carry a foreign organization id', () => {
    expect(() => requireSameTenant(localAccessContext(), { organizationId: 'org-A' })).toThrow(
      IsolationViolationError,
    );
    expect(() => requireSameTenant(localAccessContext(), {})).not.toThrow();
  });
});

describe('role-based permissions', () => {
  it('support role has NO clinical access by default', () => {
    const ctx = ctxFor('support');
    expect(ROLE_PERMISSIONS.support).toEqual([]);
    expect(hasAnyClinicalAccess(ctx)).toBe(false);
    for (const p of CLINICAL_PERMISSIONS) expect(hasPermission(ctx, p)).toBe(false);
    expect(() => requireClinicalAccess(ctx)).toThrow(PermissionDeniedError);
  });

  it('auditor can read audit logs but cannot open or export clinical records', () => {
    const ctx = ctxFor('auditor');
    expect(hasPermission(ctx, 'audit.view')).toBe(true);
    expect(hasPermission(ctx, 'client.view')).toBe(false);
    expect(hasPermission(ctx, 'record.export')).toBe(false);
    expect(hasAnyClinicalAccess(ctx)).toBe(false);
  });

  it('clinician has full clinical permissions but cannot manage users or policies', () => {
    const ctx = ctxFor('clinician');
    expect(hasPermission(ctx, 'document.approve')).toBe(true);
    expect(hasPermission(ctx, 'risk.review')).toBe(true);
    expect(hasPermission(ctx, 'user.manage')).toBe(false);
    expect(hasPermission(ctx, 'policy.manage')).toBe(false);
  });

  it('supervisor can review supervision but cannot approve documents', () => {
    const ctx = ctxFor('supervisor');
    expect(hasPermission(ctx, 'supervision.review')).toBe(true);
    expect(hasPermission(ctx, 'document.approve')).toBe(false);
  });

  it('explicit denials beat role defaults and extra grants', () => {
    const ctx = ctxFor('clinician', {
      extraPermissions: ['user.manage'],
      deniedPermissions: ['record.export', 'user.manage'],
    });
    expect(hasPermission(ctx, 'record.export')).toBe(false);
    expect(hasPermission(ctx, 'user.manage')).toBe(false);
  });

  it('inactive or ended memberships grant nothing', () => {
    expect(effectivePermissions(ctxFor('clinician', { status: 'ended' })).size).toBe(0);
    expect(effectivePermissions(ctxFor('clinician', { endDate: '2000-01-01' })).size).toBe(0);
  });
});

describe('tenancy isolation', () => {
  const ctx = ctxFor('clinician');

  it('blocks records from another organization', () => {
    expect(() => requireSameTenant(ctx, { organizationId: 'org-B', workspaceId: 'ws-1' })).toThrow(
      /another organization/i,
    );
  });

  it('blocks records from another workspace in the same organization', () => {
    expect(() => requireSameTenant(ctx, { organizationId: 'org-A', workspaceId: 'ws-2' })).toThrow(
      /another workspace/i,
    );
  });

  it('allows records in the caller\'s own organization and workspace', () => {
    expect(() => requireSameTenant(ctx, { organizationId: 'org-A', workspaceId: 'ws-1' })).not.toThrow();
  });

  it('scopeToTenant filters foreign records instead of leaking them', () => {
    const rows = [
      { id: 1, organizationId: 'org-A', workspaceId: 'ws-1' },
      { id: 2, organizationId: 'org-B', workspaceId: 'ws-9' },
      { id: 3, organizationId: 'org-A', workspaceId: 'ws-2' },
    ];
    expect(scopeToTenant(ctx, rows).map((r) => r.id)).toEqual([1]);
  });
});

describe('enforcement is below the UI (repository layer)', () => {
  it('refuses user management without the permission', async () => {
    await expect(
      db.org.createUser(
        {
          organizationId: 'org-A',
          name: 'Tester',
          identifier: 't@example.test',
          role: 'clinician',
          status: 'active',
          authMethod: 'passphrase',
        },
        ctxFor('clinician'),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('allows user management for an org admin and scopes listing to the org', async () => {
    const admin = ctxFor('org-admin');
    const user = await db.org.createUser(
      {
        organizationId: 'org-A',
        name: 'Clinician One',
        identifier: 'c1@example.test',
        role: 'clinician',
        status: 'active',
        authMethod: 'passphrase',
      },
      admin,
    );
    expect(user.id).toBeTruthy();
    const listed = await db.org.listUsers(admin);
    expect(listed.map((u) => u.identifier)).toContain('c1@example.test');
  });

  it('does not let a support role list users or access supervision', async () => {
    const support = ctxFor('support');
    await expect(db.org.listUsers(support)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      db.org.submitForSupervision(
        { clientId: 'c1', itemType: 'dap-note', itemId: 'd1', submittedBy: 'x' },
        support,
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('scopes workspace listing across organizations', async () => {
    const adminA = ctxFor('org-admin');
    await db.org.createWorkspace(
      { organizationId: 'org-A', name: 'A-ws', storageMode: 'browser', localOnly: true },
      adminA,
    );
    await db.org.createWorkspace(
      { organizationId: 'org-B', name: 'B-ws', storageMode: 'browser', localOnly: true },
      adminA,
    );
    // A clinician in org-A / ws-1 must not see org-B's workspace.
    const visible = await db.org.listWorkspaces(ctxFor('clinician'));
    expect(visible.every((w) => w.organizationId === 'org-A')).toBe(true);
    expect(visible.some((w) => w.name === 'B-ws')).toBe(false);
  });

  it('organization deletion cascades its scoped records', async () => {
    const admin = ctxFor('org-admin');
    await db.org.createWorkspace(
      { organizationId: 'org-A', name: 'doomed', storageMode: 'browser', localOnly: true },
      admin,
    );
    await db.org.createUser(
      { organizationId: 'org-A', name: 'u', identifier: 'u@x.test', role: 'clinician', status: 'active', authMethod: 'passphrase' },
      admin,
    );
    const removed = await db.org.deleteOrganizationCascade('org-A', admin);
    expect(removed).toBeGreaterThanOrEqual(2);
  });
});

describe('supervision workflow', () => {
  it('keeps supervision notes out of the clinical record until the clinician includes them', async () => {
    const clinician = ctxFor('clinician');
    const req = await db.org.submitForSupervision(
      { organizationId: 'org-A', workspaceId: 'ws-1', clientId: 'c1', itemType: 'dap-note', itemId: 'd1', submittedBy: 'Dr. A' },
      clinician,
    );
    expect(req.status).toBe('submitted');

    const reviewed = await db.org.reviewSupervision(
      req.id,
      'returned-with-comments',
      'Sup. B',
      'Consider documenting the safety plan discussion.',
      ctxFor('supervisor'),
    );
    expect(reviewed.status).toBe('returned-with-comments');
    expect(reviewed.notes).toHaveLength(1);
    // Separate from the clinical record by default.
    expect(reviewed.notes[0].includedInClinicalRecord).toBe(false);

    const included = await db.org.includeSupervisionNoteInRecord(req.id, reviewed.notes[0].id, clinician);
    expect(included.notes[0].includedInClinicalRecord).toBe(true);
  });

  it('refuses supervisor review without the supervision permission', async () => {
    const clinician = ctxFor('clinician');
    const req = await db.org.submitForSupervision(
      { clientId: 'c1', itemType: 'formulation', itemId: 'f1', submittedBy: 'Dr. A' },
      clinician,
    );
    await expect(
      db.org.reviewSupervision(req.id, 'approved', 'Dr. A', undefined, clinician),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('refuses cross-organization supervision review', async () => {
    const req = await db.org.submitForSupervision(
      { organizationId: 'org-B', workspaceId: 'ws-9', clientId: 'c1', itemType: 'dap-note', itemId: 'd1', submittedBy: 'x' },
      localAccessContext(),
    );
    await expect(
      db.org.reviewSupervision(req.id, 'approved', 'Sup', undefined, ctxFor('supervisor')),
    ).rejects.toBeInstanceOf(IsolationViolationError);
  });
});

describe('guard helpers', () => {
  it('requirePermission throws the typed error', () => {
    expect(() => requirePermission(ctxFor('support'), 'client.view')).toThrow(PermissionDeniedError);
  });
});
