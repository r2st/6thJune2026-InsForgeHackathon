// functions/lib/auth.test.ts
// Acceptance tests for workspace identity & authorization (ticket 0048).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  activeWorkspace,
  canConnectIntegrations,
  canDeleteWorkspace,
  canManageMembers,
  canReadRow,
  resolveWorkspaceIds,
  rlsPredicate,
  roleFor,
  verifyCaptureKey,
  type WorkspaceClaims,
} from './auth.js';

describe('resolveWorkspaceIds', () => {
  it('returns the deduped string membership set', () => {
    expect(resolveWorkspaceIds({ workspace_ids: ['a', 'b', 'a'] })).toEqual(['a', 'b']);
  });
  it('empty when no memberships', () => {
    expect(resolveWorkspaceIds({})).toEqual([]);
  });
});

describe('activeWorkspace — never trust a client-supplied id not in the token', () => {
  const claims: WorkspaceClaims = { workspace_ids: ['ws1', 'ws2'], active_workspace: 'ws1' };

  it('honors a requested workspace the token proves membership of', () => {
    expect(activeWorkspace(claims, 'ws2').workspaceId).toBe('ws2');
  });

  it('refuses a requested workspace NOT in the token (cross-workspace access)', () => {
    const r = activeWorkspace(claims, 'ws-evil');
    expect(r.workspaceId).toBeNull();
    expect(r.reason).toMatch(/cross-workspace/);
  });

  it('falls back to the token active_workspace when none requested', () => {
    expect(activeWorkspace(claims).workspaceId).toBe('ws1');
  });

  it('uses the sole membership when there is exactly one and no active set', () => {
    expect(activeWorkspace({ workspace_ids: ['only'] }).workspaceId).toBe('only');
  });

  it('null when the user belongs to no workspace', () => {
    expect(activeWorkspace({}).workspaceId).toBeNull();
  });

  it('null when multiple memberships and nothing selected', () => {
    expect(activeWorkspace({ workspace_ids: ['a', 'b'] }).workspaceId).toBeNull();
  });
});

describe('roleFor + capability gates', () => {
  it('defaults to member (least privilege) for an absent/unknown role', () => {
    expect(roleFor({})).toBe('member');
    expect(roleFor({ role: 'superadmin' as never })).toBe('member');
  });

  it('only owner/admin connect integrations and manage members', () => {
    expect(canConnectIntegrations('member')).toBe(false);
    expect(canConnectIntegrations('admin')).toBe(true);
    expect(canConnectIntegrations('owner')).toBe(true);
    expect(canManageMembers('member')).toBe(false);
    expect(canManageMembers('admin')).toBe(true);
  });

  it('only the owner deletes the workspace', () => {
    expect(canDeleteWorkspace('admin')).toBe(false);
    expect(canDeleteWorkspace('owner')).toBe(true);
  });
});

describe('rlsPredicate — Hush dogfoods its own RLS primitive', () => {
  it('scopes a table by the JWT workspace_ids array', () => {
    expect(rlsPredicate('bug_runs')).toBe("bug_runs.workspace_id = ANY((auth.jwt() -> 'workspace_ids')::uuid[])");
  });
});

describe('canReadRow — hard cross-workspace isolation', () => {
  it('A can read its own row, never B’s', () => {
    expect(canReadRow(['ws-a'], 'ws-a')).toBe(true);
    expect(canReadRow(['ws-a'], 'ws-b')).toBe(false);
  });
});

describe('verifyCaptureKey — short-lived, workspace-scoped', () => {
  const now = 1_000_000;

  it('a valid, unexpired capture key resolves its workspace', () => {
    const r = verifyCaptureKey({ kind: 'capture', workspace_id: 'ws1', exp: now + 60 }, now);
    expect(r.ok).toBe(true);
    expect(r.workspaceId).toBe('ws1');
  });

  it('an expired key is refused (bounded blast radius)', () => {
    expect(verifyCaptureKey({ kind: 'capture', workspace_id: 'ws1', exp: now - 1 }, now).ok).toBe(false);
  });

  it('a non-capture key is refused', () => {
    expect(verifyCaptureKey({ kind: 'user', workspace_id: 'ws1', exp: now + 60 }, now).ok).toBe(false);
  });

  it('a key with no workspace_id is refused', () => {
    expect(verifyCaptureKey({ kind: 'capture', exp: now + 60 }, now).ok).toBe(false);
  });
});
