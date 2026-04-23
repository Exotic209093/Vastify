import { authApi } from './api';

export interface AuthUser {
  tenantId: string;
  userId: string | null;
  role: 'admin' | 'member';
  memberCount: number;
  displayName: string | null;
  email: string | null;
  sfUsername: string | null;
}

export async function fetchMe(): Promise<AuthUser> {
  return authApi<AuthUser>('/auth/me');
}
