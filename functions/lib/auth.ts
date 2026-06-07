// functions/lib/auth.ts
// Workspace identity & authorization — resolve the workspace from the JWT, gate
// privileged actions by role, and emit the RLS primitive for Hush's own tables.
//
// Ticket:  agents/tasks/0048-multi-tenant-workspaces-auth.md
// Defends: today there is no account model — one seeded tenant, one backend. Every
//          other production ticket (GitHub, sites, backend, secrets, dashboard)
//          hangs off a WORKSPACE identity. This is the foundation. Hush dogfoods
//          its own thesis: it scopes its own data with the exact `workspace_id =
//          ANY(jwt ids)` RLS primitive it diagnoses in customers' backends.
//
// Pure, testable core (built on lib/jwt.ts): resolve the set of workspaces a token
// belongs to and the active one (never trusting a client-supplied id that isn't in
// the token), the caller's role, role-gated capability checks, the RLS predicate
// for a product table, a hard cross-workspace isolation check, and short-lived
// workspace-scoped capture-key validation. The tables/RLS in toml, the auth pages,
// and signature verification (done by the edge runtime) are the seam.

import type { JwtClaims } from './jwt.js';

export type Role = 'owner' | 'admin' | 'member';

/** Workspace-aware claims layered on the base JWT body. */
export interface WorkspaceClaims extends JwtClaims {
  /** Every workspace the user is a member of. The RLS array source of truth. */
  workspace_ids?: string[];
  /** The workspace this session is acting in. Must be ∈ workspace_ids. */
  active_workspace?: string;
  /** The caller's role IN the active workspace. */
  role?: Role;
}

/** All workspaces the token is a member of (deduped, string-typed). */
export function resolveWorkspaceIds(claims: WorkspaceClaims): string[] {
  const ids = claims.workspace_ids;
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
}

export interface ActiveWorkspaceResult {
  workspaceId: string | null;
  reason: string;
}

/**
 * Resolve the active workspace. A client may REQUEST one, but we only honor it if
 * the token proves membership — never trust a client-supplied id that isn't in the
 * JWT (this is the cross-tenant boundary). Falls back to the token's
 * `active_workspace`, then the sole membership; null when the user belongs to none.
 */
export function activeWorkspace(claims: WorkspaceClaims, requested?: string): ActiveWorkspaceResult {
  const member = new Set(resolveWorkspaceIds(claims));
  if (member.size === 0) return { workspaceId: null, reason: 'token has no workspace memberships' };

  if (requested !== undefined) {
    return member.has(requested)
      ? { workspaceId: requested, reason: 'requested workspace verified against token membership' }
      : { workspaceId: null, reason: 'requested workspace not in the token — refused (cross-workspace access)' };
  }
  if (claims.active_workspace && member.has(claims.active_workspace)) {
    return { workspaceId: claims.active_workspace, reason: 'active workspace from token' };
  }
  if (member.size === 1) return { workspaceId: [...member][0]!, reason: 'sole workspace membership' };
  return { workspaceId: null, reason: 'multiple memberships and no active workspace selected' };
}

/** The caller's role in the active workspace; defaults to the least privilege. */
export function roleFor(claims: WorkspaceClaims): Role {
  return claims.role === 'owner' || claims.role === 'admin' ? claims.role : 'member';
}

// ── role-gated capabilities ────────────────────────────────────────────────────────

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

/** Only owner/admin may connect GitHub or a backend, or manage secrets. */
export function canConnectIntegrations(role: Role): boolean { return RANK[role] >= RANK.admin; }
/** Only owner/admin may invite or remove members. */
export function canManageMembers(role: Role): boolean { return RANK[role] >= RANK.admin; }
/** Only the owner may delete the workspace or transfer ownership. */
export function canDeleteWorkspace(role: Role): boolean { return role === 'owner'; }

// ── RLS primitive (Hush dogfoods its own thesis) ────────────────────────────────────

/**
 * The RLS predicate every product table carries — the SAME primitive Hush
 * diagnoses when a customer's policy keys on the wrong claim. A tenant-scoping bug
 * in Hush's own schema is exactly what Hush catches in customers'.
 */
export function rlsPredicate(table: string): string {
  return `${table}.workspace_id = ANY((auth.jwt() -> 'workspace_ids')::uuid[])`;
}

/**
 * Hard cross-workspace isolation check: may a caller with these workspace ids read
 * a row owned by `rowWorkspaceId`? The app-layer mirror of the RLS policy — a
 * defense-in-depth assert so a query bug can't leak across the boundary.
 */
export function canReadRow(callerWorkspaceIds: string[], rowWorkspaceId: string): boolean {
  return new Set(callerWorkspaceIds).has(rowWorkspaceId);
}

// ── workspace-scoped capture key ────────────────────────────────────────────────────

/** Claims of a short-lived key the capture SDK uses to post sessions (no user session). */
export interface CaptureKeyClaims {
  kind?: string;
  workspace_id?: string;
  /** Expiry, seconds since epoch. */
  exp?: number;
}

export interface CaptureKeyResult {
  ok: boolean;
  workspaceId: string | null;
  reason: string;
}

/**
 * Validate a capture key: it must be a capture-kind key, carry a workspace id, and
 * be unexpired. Short-lived + rotatable — an expired key is refused so a leaked key
 * has a bounded blast radius. (Signature verification is the runtime's job; this
 * validates the decoded claims.)
 */
export function verifyCaptureKey(claims: CaptureKeyClaims, nowSec: number): CaptureKeyResult {
  if (claims.kind !== 'capture') return { ok: false, workspaceId: null, reason: 'not a capture-scoped key' };
  if (!claims.workspace_id) return { ok: false, workspaceId: null, reason: 'capture key missing workspace_id' };
  if (typeof claims.exp !== 'number' || claims.exp <= nowSec) {
    return { ok: false, workspaceId: null, reason: 'capture key expired or missing exp — rotate it' };
  }
  return { ok: true, workspaceId: claims.workspace_id, reason: 'capture key valid' };
}
