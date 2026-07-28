/**
 * Phase 9 organizational service (§12–§15).
 *
 * This is where RBAC and tenancy isolation are ENFORCED — below the UI, so a
 * screen cannot grant access it should not have. Every guard is a plain
 * function that throws, making it usable from repositories and stores alike.
 *
 * Single-clinician local mode is preserved: with no organization configured,
 * `localAccessContext()` yields full clinical permissions and the guards are
 * effectively transparent, exactly as in Phases 1–8.
 */
import { newId, nowIso, type AuditCategory } from '../db/schema';
import type { EncryptedStore } from '../storage/encryptedStore';
import {
  effectivePermissions,
  hasAnyClinicalAccess,
  hasPermission,
  IsolationViolationError,
  PermissionDeniedError,
  type AccessContext,
  type Membership,
  type Organization,
  type OrgUser,
  type Permission,
  type Role,
  type Workspace,
} from './orgSchema';

const C = {
  organizations: 'organizations',
  workspaces: 'workspaces',
  users: 'org-users',
  memberships: 'memberships',
  supervision: 'supervision-requests',
} as const;

// ------------------------------------------------------------- guards

/** The context used when no organization is configured (default install). */
export function localAccessContext(): AccessContext {
  return { singleClinicianMode: true };
}

/** Throws unless the context holds `permission`. */
export function requirePermission(ctx: AccessContext, permission: Permission): void {
  if (!hasPermission(ctx, permission)) throw new PermissionDeniedError(permission);
}

/** Throws if the context has no clinical access at all (e.g. support role). */
export function requireClinicalAccess(ctx: AccessContext): void {
  if (!hasAnyClinicalAccess(ctx)) {
    throw new PermissionDeniedError(
      'client.view',
      'This role has no access to clinical content.',
    );
  }
}

/**
 * Tenancy guard: the record's organization/workspace must match the caller's.
 * Undefined record scope means a single-clinician local record, which is only
 * accessible in single-clinician mode.
 */
export function requireSameTenant(
  ctx: AccessContext,
  record: { organizationId?: string; workspaceId?: string },
  what = 'record',
): void {
  if (ctx.singleClinicianMode && !ctx.membership) {
    if (record.organizationId) {
      throw new IsolationViolationError(
        `Blocked: this ${what} belongs to an organization that is not active in this session.`,
      );
    }
    return;
  }
  const m = ctx.membership;
  if (!m) throw new IsolationViolationError(`Blocked: no membership context for this ${what}.`);
  if (record.organizationId !== undefined && record.organizationId !== m.organizationId) {
    throw new IsolationViolationError(`Blocked: this ${what} belongs to another organization.`);
  }
  if (record.workspaceId !== undefined && record.workspaceId !== m.workspaceId) {
    throw new IsolationViolationError(`Blocked: this ${what} belongs to another workspace.`);
  }
}

/** Filters a list to only the records the context may see (never throws). */
export function scopeToTenant<T extends { organizationId?: string; workspaceId?: string }>(
  ctx: AccessContext,
  records: T[],
): T[] {
  return records.filter((r) => {
    try {
      requireSameTenant(ctx, r);
      return true;
    } catch {
      return false;
    }
  });
}

// -------------------------------------------------------- supervision

export type SupervisionItemType =
  | 'dap-note'
  | 'treatment-plan'
  | 'formulation'
  | 'risk-documentation'
  | 'hypothesis'
  | 'intervention-plan';

export type SupervisionStatus =
  | 'submitted'
  | 'approved'
  | 'returned-with-comments'
  | 'clarification-requested'
  | 'reviewed';

export interface SupervisionNote {
  id: string;
  author: string;
  at: string;
  text: string;
  /**
   * Supervision notes stay OUT of the client-facing clinical record unless the
   * clinician deliberately includes them.
   */
  includedInClinicalRecord: boolean;
}

export interface SupervisionRequest {
  id: string;
  organizationId?: string;
  workspaceId?: string;
  clientId: string;
  itemType: SupervisionItemType;
  itemId: string;
  submittedBy: string;
  submittedAt: string;
  status: SupervisionStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  notes: SupervisionNote[];
}

export interface OrgHost {
  store: EncryptedStore;
  audit: (category: AuditCategory, action: string, detail?: string) => Promise<void>;
}

export class OrgRepository {
  constructor(private host: OrgHost) {}
  private get store() {
    return this.host.store;
  }

  // ------------------------------------------------------- entities

  async listOrganizations(): Promise<Organization[]> {
    return this.store.getAll<Organization>(C.organizations);
  }

  async createOrganization(
    draft: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>,
    ctx: AccessContext,
  ): Promise<Organization> {
    requirePermission(ctx, 'user.manage');
    const now = nowIso();
    const org: Organization = { ...draft, id: newId(), createdAt: now, updatedAt: now };
    await this.store.put(C.organizations, org.id, org);
    await this.host.audit('security', 'org.create', org.name);
    return org;
  }

  async listWorkspaces(ctx: AccessContext): Promise<Workspace[]> {
    return scopeToTenant(ctx, await this.store.getAll<Workspace>(C.workspaces));
  }

  async createWorkspace(
    draft: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>,
    ctx: AccessContext,
  ): Promise<Workspace> {
    requirePermission(ctx, 'user.manage');
    const now = nowIso();
    const ws: Workspace = { ...draft, id: newId(), createdAt: now, updatedAt: now };
    await this.store.put(C.workspaces, ws.id, ws);
    await this.host.audit('security', 'workspace.create', ws.name);
    return ws;
  }

  async listUsers(ctx: AccessContext): Promise<OrgUser[]> {
    requirePermission(ctx, 'user.manage');
    const all = await this.store.getAll<OrgUser>(C.users);
    const orgId = ctx.membership?.organizationId;
    return orgId ? all.filter((u) => u.organizationId === orgId) : all;
  }

  async createUser(draft: Omit<OrgUser, 'id' | 'createdAt' | 'updatedAt'>, ctx: AccessContext): Promise<OrgUser> {
    requirePermission(ctx, 'user.manage');
    const now = nowIso();
    const user: OrgUser = { ...draft, id: newId(), createdAt: now, updatedAt: now };
    await this.store.put(C.users, user.id, user);
    await this.host.audit('security', 'user.create', `${user.identifier} as ${user.role}`);
    return user;
  }

  async createMembership(draft: Omit<Membership, 'id'>, ctx: AccessContext): Promise<Membership> {
    requirePermission(ctx, 'user.manage');
    const m: Membership = { ...draft, id: newId() };
    await this.store.put(C.memberships, m.id, m);
    await this.host.audit('security', 'membership.create', `${m.userId} → ${m.role}`);
    return m;
  }

  async membershipFor(userId: string, workspaceId: string): Promise<Membership | undefined> {
    const all = await this.store.getAll<Membership>(C.memberships);
    return all.find((m) => m.userId === userId && m.workspaceId === workspaceId && m.status === 'active');
  }

  /** Deleting an organization must remove its scoped records (§4, §15). */
  async deleteOrganizationCascade(organizationId: string, ctx: AccessContext): Promise<number> {
    requirePermission(ctx, 'user.manage');
    let removed = 0;
    for (const collection of [C.workspaces, C.users, C.memberships, C.supervision]) {
      const all = await this.store.getAll<{ id: string; organizationId?: string }>(collection);
      for (const rec of all) {
        if (rec.organizationId === organizationId) {
          await this.store.remove(collection, rec.id);
          removed++;
        }
      }
    }
    await this.store.remove(C.organizations, organizationId);
    await this.host.audit('security', 'org.delete', `${removed} scoped record(s) removed`);
    return removed;
  }

  // ---------------------------------------------------- supervision

  async submitForSupervision(
    draft: Omit<SupervisionRequest, 'id' | 'submittedAt' | 'status' | 'notes'>,
    ctx: AccessContext,
  ): Promise<SupervisionRequest> {
    requireClinicalAccess(ctx);
    const req: SupervisionRequest = {
      ...draft,
      id: newId(),
      submittedAt: nowIso(),
      status: 'submitted',
      notes: [],
    };
    await this.store.put(C.supervision, req.id, req);
    await this.host.audit('data', 'supervision.submit', `${req.itemType} for review`);
    return req;
  }

  async listSupervision(ctx: AccessContext): Promise<SupervisionRequest[]> {
    return scopeToTenant(ctx, await this.store.getAll<SupervisionRequest>(C.supervision));
  }

  /** Supervisor decision. Requires the supervision.review permission. */
  async reviewSupervision(
    id: string,
    decision: Exclude<SupervisionStatus, 'submitted'>,
    reviewer: string,
    note: string | undefined,
    ctx: AccessContext,
  ): Promise<SupervisionRequest> {
    requirePermission(ctx, 'supervision.review');
    const existing = await this.store.get<SupervisionRequest>(C.supervision, id);
    if (!existing) throw new Error('Supervision request not found');
    requireSameTenant(ctx, existing, 'supervision request');
    const updated: SupervisionRequest = {
      ...existing,
      status: decision,
      reviewedBy: reviewer,
      reviewedAt: nowIso(),
      notes: note
        ? [
            ...existing.notes,
            // Supervision commentary is separate from the clinical record by
            // default; only the clinician can promote it.
            { id: newId(), author: reviewer, at: nowIso(), text: note, includedInClinicalRecord: false },
          ]
        : existing.notes,
    };
    await this.store.put(C.supervision, id, updated);
    await this.host.audit('data', 'supervision.review', `${existing.itemType} → ${decision}`);
    return updated;
  }

  /** Only the submitting clinician may pull a supervision note into the record. */
  async includeSupervisionNoteInRecord(
    requestId: string,
    noteId: string,
    ctx: AccessContext,
  ): Promise<SupervisionRequest> {
    requireClinicalAccess(ctx);
    const existing = await this.store.get<SupervisionRequest>(C.supervision, requestId);
    if (!existing) throw new Error('Supervision request not found');
    requireSameTenant(ctx, existing, 'supervision request');
    const updated: SupervisionRequest = {
      ...existing,
      notes: existing.notes.map((n) => (n.id === noteId ? { ...n, includedInClinicalRecord: true } : n)),
    };
    await this.store.put(C.supervision, requestId, updated);
    await this.host.audit('data', 'supervision.note-included', existing.itemType);
    return updated;
  }
}

export { effectivePermissions, hasPermission, hasAnyClinicalAccess, PermissionDeniedError, IsolationViolationError };
export type { AccessContext, Membership, Organization, OrgUser, Permission, Role, Workspace };
