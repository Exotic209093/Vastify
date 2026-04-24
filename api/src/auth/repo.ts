import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

export interface User {
  id: string;
  sfUserId: string;
  sfOrgId: string;
  sfUsername: string;
  displayName: string;
  email: string | null;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface Tenant {
  id: string;
  name: string;
  apiKeyHash: string;
  sfOrgId: string | null;
  displayName: string | null;
  provisionedAt: number | null;
  createdAt: number;
}

export interface TenantMember {
  id: string;
  tenantId: string;
  userId: string;
  role: 'admin' | 'member';
  joinedAt: number;
}

export interface TenantInvite {
  id: string;
  tenantId: string;
  invitedByUserId: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
}

export interface TenantStorageConfig {
  tenantId: string;
  useOwnS3: boolean;
  s3BucketName: string | null;
  s3Region: string | null;
  s3AccessKeyIdEnc: string | null;
  s3SecretEnc: string | null;
  useOwnGcs: boolean;
  gcsBucketName: string | null;
  gcsProjectId: string | null;
  gcsServiceAccountJsonEnc: string | null;
  updatedAt: number;
}

export interface AuthRepo {
  users: {
    findById(id: string): User | null;
    findBySfUserId(sfUserId: string): User | null;
    upsert(user: Omit<User, 'id'> & { id?: string }): User;
  };
  tenants: {
    findBySfOrgId(sfOrgId: string): Tenant | null;
    create(sfOrgId: string, displayName: string): Tenant;
  };
  members: {
    findByTenantAndUser(tenantId: string, userId: string): TenantMember | null;
    findByTenant(tenantId: string): TenantMember[];
    insert(member: TenantMember): void;
    remove(tenantId: string, userId: string): void;
    countByTenant(tenantId: string): number;
  };
  invites: {
    findByToken(token: string): TenantInvite | null;
    findByTenant(tenantId: string): TenantInvite[];
    insert(invite: TenantInvite): void;
    accept(token: string, acceptedAt: number): void;
  };
  storageConfig: {
    findByTenant(tenantId: string): TenantStorageConfig | null;
    upsert(config: TenantStorageConfig): void;
    initForTenant(tenantId: string): void;
  };
}

type UserRow = {
  id: string; sf_user_id: string; sf_org_id: string; sf_username: string;
  display_name: string; email: string | null; created_at: number; last_login_at: number | null;
};
type TenantRow = {
  id: string; name: string; api_key_hash: string; sf_org_id: string | null;
  display_name: string | null; provisioned_at: number | null; created_at: number;
};
type MemberRow = { id: string; tenant_id: string; user_id: string; role: string; joined_at: number };
type InviteRow = {
  id: string; tenant_id: string; invited_by_user_id: string; email: string; role: string;
  token: string; created_at: number; expires_at: number; accepted_at: number | null;
};
type StorageRow = {
  tenant_id: string; use_own_s3: number; s3_bucket_name: string | null; s3_region: string | null;
  s3_access_key_id_enc: string | null; s3_secret_enc: string | null; use_own_gcs: number;
  gcs_bucket_name: string | null; gcs_project_id: string | null;
  gcs_service_account_json_enc: string | null; updated_at: number;
};

function rowToUser(r: UserRow): User {
  return {
    id: r.id, sfUserId: r.sf_user_id, sfOrgId: r.sf_org_id, sfUsername: r.sf_username,
    displayName: r.display_name, email: r.email, createdAt: r.created_at, lastLoginAt: r.last_login_at,
  };
}

function rowToMember(r: MemberRow): TenantMember {
  return { id: r.id, tenantId: r.tenant_id, userId: r.user_id, role: r.role as 'admin' | 'member', joinedAt: r.joined_at };
}

function rowToInvite(r: InviteRow): TenantInvite {
  return {
    id: r.id, tenantId: r.tenant_id, invitedByUserId: r.invited_by_user_id, email: r.email,
    role: r.role as 'admin' | 'member', token: r.token, createdAt: r.created_at,
    expiresAt: r.expires_at, acceptedAt: r.accepted_at,
  };
}

function rowToStorage(r: StorageRow): TenantStorageConfig {
  return {
    tenantId: r.tenant_id, useOwnS3: r.use_own_s3 === 1, s3BucketName: r.s3_bucket_name,
    s3Region: r.s3_region, s3AccessKeyIdEnc: r.s3_access_key_id_enc, s3SecretEnc: r.s3_secret_enc,
    useOwnGcs: r.use_own_gcs === 1, gcsBucketName: r.gcs_bucket_name, gcsProjectId: r.gcs_project_id,
    gcsServiceAccountJsonEnc: r.gcs_service_account_json_enc, updatedAt: r.updated_at,
  };
}

export function createAuthRepo(db: Database): AuthRepo {
  return {
    users: {
      findById(id) {
        const r = db.query<UserRow, [string]>('SELECT * FROM users WHERE id = ?').get(id);
        return r ? rowToUser(r) : null;
      },
      findBySfUserId(sfUserId) {
        const r = db.query<UserRow, [string]>('SELECT * FROM users WHERE sf_user_id = ?').get(sfUserId);
        return r ? rowToUser(r) : null;
      },
      upsert(user) {
        const newId = user.id ?? randomUUID();
        // ON CONFLICT(sf_user_id) keeps the existing row's id — so the `newId`
        // we passed in is only used when this is a fresh insert. We must read
        // back the actual stored id; otherwise a returned-but-fake id breaks
        // any FK that downstream code creates against users(id).
        const row = db.prepare(`
          INSERT INTO users (id, sf_user_id, sf_org_id, sf_username, display_name, email, created_at, last_login_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(sf_user_id) DO UPDATE SET
            sf_username = excluded.sf_username,
            display_name = excluded.display_name,
            email = excluded.email,
            last_login_at = excluded.last_login_at
          RETURNING id
        `).get(newId, user.sfUserId, user.sfOrgId, user.sfUsername, user.displayName, user.email ?? null, user.createdAt, user.lastLoginAt ?? null) as { id: string };
        return { ...user, id: row.id };
      },
    },
    tenants: {
      findBySfOrgId(sfOrgId) {
        const r = db.query<TenantRow, [string]>('SELECT * FROM tenants WHERE sf_org_id = ?').get(sfOrgId);
        if (!r) return null;
        return { id: r.id, name: r.name, apiKeyHash: r.api_key_hash, sfOrgId: r.sf_org_id, displayName: r.display_name, provisionedAt: r.provisioned_at, createdAt: r.created_at };
      },
      create(sfOrgId, displayName) {
        const id = randomUUID();
        const now = Date.now();
        db.prepare(`
          INSERT INTO tenants (id, name, api_key_hash, sf_org_id, display_name, provisioned_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, displayName, '', sfOrgId, displayName, now, now);
        return { id, name: displayName, apiKeyHash: '', sfOrgId, displayName, provisionedAt: now, createdAt: now };
      },
    },
    members: {
      findByTenantAndUser(tenantId, userId) {
        const r = db.query<MemberRow, [string, string]>('SELECT * FROM tenant_members WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId);
        return r ? rowToMember(r) : null;
      },
      findByTenant(tenantId) {
        return db.query<MemberRow, [string]>('SELECT * FROM tenant_members WHERE tenant_id = ?').all(tenantId).map(rowToMember);
      },
      insert(member) {
        db.prepare('INSERT OR IGNORE INTO tenant_members (id, tenant_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)')
          .run(member.id, member.tenantId, member.userId, member.role, member.joinedAt);
      },
      remove(tenantId, userId) {
        db.prepare('DELETE FROM tenant_members WHERE tenant_id = ? AND user_id = ?').run(tenantId, userId);
      },
      countByTenant(tenantId) {
        const r = db.query<{ count: number }, [string]>('SELECT COUNT(*) as count FROM tenant_members WHERE tenant_id = ?').get(tenantId);
        return r?.count ?? 0;
      },
    },
    invites: {
      findByToken(token) {
        const r = db.query<InviteRow, [string]>('SELECT * FROM tenant_invites WHERE token = ?').get(token);
        return r ? rowToInvite(r) : null;
      },
      findByTenant(tenantId) {
        return db.query<InviteRow, [string]>('SELECT * FROM tenant_invites WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId).map(rowToInvite);
      },
      insert(invite) {
        db.prepare(`INSERT INTO tenant_invites (id, tenant_id, invited_by_user_id, email, role, token, created_at, expires_at, accepted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(invite.id, invite.tenantId, invite.invitedByUserId, invite.email, invite.role, invite.token, invite.createdAt, invite.expiresAt, invite.acceptedAt ?? null);
      },
      accept(token, acceptedAt) {
        db.prepare('UPDATE tenant_invites SET accepted_at = ? WHERE token = ?').run(acceptedAt, token);
      },
    },
    storageConfig: {
      findByTenant(tenantId) {
        const r = db.query<StorageRow, [string]>('SELECT * FROM tenant_storage_config WHERE tenant_id = ?').get(tenantId);
        return r ? rowToStorage(r) : null;
      },
      upsert(config) {
        db.prepare(`
          INSERT INTO tenant_storage_config
            (tenant_id, use_own_s3, s3_bucket_name, s3_region, s3_access_key_id_enc, s3_secret_enc,
             use_own_gcs, gcs_bucket_name, gcs_project_id, gcs_service_account_json_enc, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tenant_id) DO UPDATE SET
            use_own_s3 = excluded.use_own_s3,
            s3_bucket_name = excluded.s3_bucket_name,
            s3_region = excluded.s3_region,
            s3_access_key_id_enc = excluded.s3_access_key_id_enc,
            s3_secret_enc = excluded.s3_secret_enc,
            use_own_gcs = excluded.use_own_gcs,
            gcs_bucket_name = excluded.gcs_bucket_name,
            gcs_project_id = excluded.gcs_project_id,
            gcs_service_account_json_enc = excluded.gcs_service_account_json_enc,
            updated_at = excluded.updated_at
        `).run(
          config.tenantId, config.useOwnS3 ? 1 : 0, config.s3BucketName ?? null, config.s3Region ?? null,
          config.s3AccessKeyIdEnc ?? null, config.s3SecretEnc ?? null, config.useOwnGcs ? 1 : 0,
          config.gcsBucketName ?? null, config.gcsProjectId ?? null, config.gcsServiceAccountJsonEnc ?? null,
          config.updatedAt,
        );
      },
      initForTenant(tenantId) {
        db.prepare(`
          INSERT OR IGNORE INTO tenant_storage_config (tenant_id, use_own_s3, use_own_gcs, updated_at)
          VALUES (?, 0, 0, ?)
        `).run(tenantId, Date.now());
      },
    },
  };
}
