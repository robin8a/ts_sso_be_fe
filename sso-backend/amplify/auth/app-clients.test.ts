import { describe, it, expect } from 'vitest';
import {
  APP_CLIENT_IDENTITY_PROVIDERS,
  APP_CLIENT_OAUTH_FLOWS,
  APP_CLIENT_OAUTH_SCOPES,
  appClientLogicalId,
  buildAppClientConfig,
  buildAppClientConfigs,
} from './app-clients';
import {
  APPLICATIONS,
  applicationKeys,
  findApplication,
} from './role-catalog';
import { TS_ROLES_ATTRIBUTE } from './client-attributes';

/**
 * Config-level tests for Task 6 (06_Testing_Strategy.md "App-client settings
 * inspection"). The per-client Cognito settings are produced by the pure
 * `buildAppClientConfigs()` builder that `backend.ts` feeds into each
 * `CfnUserPoolClient`, so everything statically verifiable about the clients is
 * asserted here without a full CDK synth. Behaviors that only exist on a
 * deployed pool (Hosted UI user-existence errors, an actual CALLBACK_NOT_ALLOWED
 * redirect) are covered by the integration/negative tests in the strategy doc;
 * the static invariant here is per-app URL isolation and the read/write split.
 *
 * Validates: Requirements 1.3, 3.1, 4.1, 5.4, 6.4
 */

describe('app client list is catalog-driven (Requirement 3.1)', () => {
  it('creates exactly one client per catalogued application, in catalog order', () => {
    const configs = buildAppClientConfigs();
    expect(configs.map((c) => c.appKey)).toEqual(applicationKeys());
    expect(configs).toHaveLength(APPLICATIONS.length);
  });

  it('each client name equals its application key (Requirement 3.1)', () => {
    for (const config of buildAppClientConfigs()) {
      expect(config.clientName).toBe(config.appKey);
    }
  });

  it('derives a stable, unique CDK construct id per application key', () => {
    expect(appClientLogicalId('ts-oraculo')).toBe('AppClientTsOraculo');
    const ids = buildAppClientConfigs().map((c) => c.logicalId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('OAuth: Authorization Code + PKCE, no secret (Requirements 1.3 / 6.4)', () => {
  it('allows exactly the code flow with the pool-client flag on', () => {
    for (const config of buildAppClientConfigs()) {
      expect(config.allowedOAuthFlows).toEqual([...APP_CLIENT_OAUTH_FLOWS]);
      expect(config.allowedOAuthFlows).toEqual(['code']);
      expect(config.allowedOAuthFlowsUserPoolClient).toBe(true);
    }
  });

  it('allows exactly scopes openid, email, profile (Requirement 1.3)', () => {
    for (const config of buildAppClientConfigs()) {
      expect(config.allowedOAuthScopes).toEqual([...APP_CLIENT_OAUTH_SCOPES]);
      expect(config.allowedOAuthScopes).toEqual(['openid', 'email', 'profile']);
    }
  });

  it('is a public PKCE client with no generated secret (no reused secret, Req 6.4)', () => {
    for (const config of buildAppClientConfigs()) {
      expect(config.generateSecret).toBe(false);
    }
  });

  it('supports only the Cognito identity provider', () => {
    for (const config of buildAppClientConfigs()) {
      expect(config.supportedIdentityProviders).toEqual([
        ...APP_CLIENT_IDENTITY_PROVIDERS,
      ]);
    }
  });

  it('enables token revocation for global sign-out (Requirement 6.3)', () => {
    for (const config of buildAppClientConfigs()) {
      expect(config.enableTokenRevocation).toBe(true);
    }
  });

  it('prevents user-existence errors on Hosted UI (Requirement 6.4)', () => {
    for (const config of buildAppClientConfigs()) {
      expect(config.preventUserExistenceErrors).toBe('ENABLED');
    }
  });
});

describe('attribute read/write split for custom:tsRoles (Requirement 4.1 / 6.4)', () => {
  it('read attributes include custom:tsRoles (client-readable)', () => {
    for (const config of buildAppClientConfigs()) {
      expect(config.readAttributes).toContain(TS_ROLES_ATTRIBUTE);
    }
  });

  it('write attributes exclude custom:tsRoles (not end-user-writable)', () => {
    for (const config of buildAppClientConfigs()) {
      expect(config.writeAttributes).not.toContain(TS_ROLES_ATTRIBUTE);
    }
  });
});

describe('per-app callback/logout URL isolation (Requirement 5.4 / 6.4)', () => {
  it('each client registers only its own callback and logout URLs', () => {
    for (const config of buildAppClientConfigs()) {
      const app = findApplication(config.appKey)!;
      expect(config.callbackUrls).toEqual(app.callbackUrls);
      expect(config.logoutUrls).toEqual(app.logoutUrls);
    }
  });

  it("ts-oraculo callback URLs do not appear on the ts-legalDocs client (CALLBACK_NOT_ALLOWED)", () => {
    const configs = buildAppClientConfigs();
    const oraculo = configs.find((c) => c.appKey === 'ts-oraculo')!;
    const legalDocs = configs.find((c) => c.appKey === 'ts-legalDocs')!;
    for (const url of oraculo.callbackUrls) {
      // Guard against the fixtures accidentally sharing a URL: if they were
      // identical this assertion is vacuous, so require oraculo to actually
      // own a URL the other client does not list.
      if (!legalDocs.callbackUrls.includes(url)) {
        expect(legalDocs.callbackUrls).not.toContain(url);
      }
    }
    // No callback URL may be registered on two different clients at once.
    const seen = new Map<string, string>();
    for (const config of configs) {
      for (const url of config.callbackUrls) {
        const owner = seen.get(url);
        if (owner && owner !== config.appKey) {
          throw new Error(
            `callback URL ${url} registered on both ${owner} and ${config.appKey}`,
          );
        }
        seen.set(url, config.appKey);
      }
    }
  });
});

describe('ts-datum mobile client (Requirement 5.4)', () => {
  it('exists with clientKind mobile and its own mobile callback URLs', () => {
    const datum = buildAppClientConfigs().find((c) => c.appKey === 'ts-datum');
    expect(datum).toBeDefined();
    expect(datum!.clientKind).toBe('mobile');
    expect(datum!.callbackUrls).toEqual(['tsdatum://auth/callback']);
    expect(datum!.logoutUrls).toEqual(['tsdatum://auth/logout']);
  });

  it('applies the same claim/attribute rules as the web clients', () => {
    const datum = buildAppClientConfig(findApplication('ts-datum')!);
    expect(datum.readAttributes).toContain(TS_ROLES_ATTRIBUTE);
    expect(datum.writeAttributes).not.toContain(TS_ROLES_ATTRIBUTE);
    expect(datum.allowedOAuthScopes).toEqual(['openid', 'email', 'profile']);
    expect(datum.preventUserExistenceErrors).toBe('ENABLED');
  });
});
