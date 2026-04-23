export class BackupWriteNotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented in Plan 1 — implement in Plan 2`);
    this.name = 'BackupWriteNotImplementedError';
  }
}

export class HubSpotWriteNotSupportedError extends Error {
  constructor() {
    super('HubSpot write operations are not supported');
    this.name = 'HubSpotWriteNotSupportedError';
  }
}

export class CredentialNotFoundError extends Error {
  constructor(connectedOrgId: string) {
    super(`No credentials found for connected org: ${connectedOrgId}`);
    this.name = 'CredentialNotFoundError';
  }
}

export class TokenRefreshError extends Error {
  constructor(crmType: string, status: number, body: string) {
    super(`${crmType} token refresh failed (${status}): ${body}`);
    this.name = 'TokenRefreshError';
  }
}
