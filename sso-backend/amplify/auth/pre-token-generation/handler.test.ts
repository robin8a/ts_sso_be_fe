import { describe, it, expect, vi } from 'vitest';
import type {
  PreTokenGenerationV2TriggerEvent,
  Context,
} from 'aws-lambda';
import {
  claimFromGroups,
  handler,
  type ClaimLogEntry,
} from './handler';
import { CLAIM_MAX_LENGTH } from '../validation-chain';
import { TS_ROLES_ATTRIBUTE } from '../client-attributes';

/**
 * Component tests for the pre-token (V2) `custom:tsRoles` claim builder
 * (06_Testing_Strategy.md "Component tests", 05_Error_Handling.md).
 *
 * Covers the pure `claimFromGroups` helper and the full V2 handler against a
 * minimal constructed event:
 *   - both catalog groups land on the claim, in catalog order;
 *   - a non-catalog group is absent and logged as ROLE_NOT_IN_CATALOG;
 *   - no catalog group omits the claim;
 *   - order is catalog order regardless of input order;
 *   - a set exceeding 2048 chars is omitted and logged CLAIM_TOO_LONG;
 *   - both the ID token and the access token receive the claim.
 *
 * Validates: Requirements 4.3, 4.4, 5.1
 */

const ORACULO_ADMIN = 'ts-oraculo-administrators';
const LEGALDOCS_ADMIN = 'ts-legalDocs-administrators';

describe('claimFromGroups (pure helper)', () => {
  it('joins both catalog groups with a single space in catalog order', () => {
    const value = claimFromGroups([ORACULO_ADMIN, LEGALDOCS_ADMIN]);
    expect(value).toBe(`${ORACULO_ADMIN} ${LEGALDOCS_ADMIN}`);
  });

  it('orders by catalog order regardless of the input order', () => {
    // Cognito may return groups in any order; the claim must be deterministic.
    const value = claimFromGroups([LEGALDOCS_ADMIN, ORACULO_ADMIN]);
    expect(value).toBe(`${ORACULO_ADMIN} ${LEGALDOCS_ADMIN}`);
  });

  it('has no leading or trailing space', () => {
    const value = claimFromGroups([ORACULO_ADMIN]);
    expect(value).toBe(ORACULO_ADMIN);
    expect(value!.startsWith(' ')).toBe(false);
    expect(value!.endsWith(' ')).toBe(false);
  });

  it('drops a non-catalog group and logs ROLE_NOT_IN_CATALOG, keeping catalog roles', () => {
    const log = vi.fn<(entry: ClaimLogEntry) => void>();
    // ts-dataDrones-administrators: app exists, role not catalogued -> dropped.
    const value = claimFromGroups(
      [ORACULO_ADMIN, 'ts-dataDrones-administrators'],
      log,
    );
    expect(value).toBe(ORACULO_ADMIN);
    expect(log).toHaveBeenCalledWith({
      code: 'ROLE_NOT_IN_CATALOG',
      appKey: 'ts-dataDrones',
      token: 'ts-dataDrones-administrators',
    });
  });

  it('logs a stray/malformed group as ROLE_MALFORMED and never includes it', () => {
    const log = vi.fn<(entry: ClaimLogEntry) => void>();
    const value = claimFromGroups([ORACULO_ADMIN, 'not-a-role!'], log);
    expect(value).toBe(ORACULO_ADMIN);
    const codes = log.mock.calls.map(([entry]) => entry.code);
    expect(codes).toContain('ROLE_MALFORMED');
  });

  it('omits the claim (undefined) when no group is catalogued', () => {
    const log = vi.fn<(entry: ClaimLogEntry) => void>();
    expect(claimFromGroups(['ts-dataDrones-administrators'], log)).toBeUndefined();
    expect(claimFromGroups([], log)).toBeUndefined();
  });

  it('omits the claim and logs CLAIM_TOO_LONG when the built string exceeds 2048', () => {
    const log = vi.fn<(entry: ClaimLogEntry) => void>();
    // Construct enough catalog roles to blow past 2048 chars. The two catalog
    // rows alone are short, so synthesize a long membership whose *matches*
    // exceed the limit by stubbing the catalog is overkill; instead feed a
    // group list whose catalog matches would join beyond 2048. Since only two
    // roles are catalogued, we assert the limit path with a dedicated unit
    // below. Here we prove the real catalog never trips it.
    const value = claimFromGroups([ORACULO_ADMIN, LEGALDOCS_ADMIN], log);
    expect(value).toBe(`${ORACULO_ADMIN} ${LEGALDOCS_ADMIN}`);
    expect(value!.length).toBeLessThanOrEqual(CLAIM_MAX_LENGTH);
    expect(log.mock.calls.map(([e]) => e.code)).not.toContain('CLAIM_TOO_LONG');
  });
});

/**
 * The 2048-character omit rule exercised directly. The initial catalog only has
 * two short roles, so a genuinely over-length claim cannot be produced from the
 * real catalog. We verify the rule by mocking the catalog's `roleParameters`
 * and `validation-chain` filter to return a long set of matches, proving the
 * handler omits the claim and logs CLAIM_TOO_LONG rather than truncating.
 */
describe('claimFromGroups CLAIM_TOO_LONG omit rule', () => {
  it('omits and logs CLAIM_TOO_LONG for an over-length catalog set', async () => {
    vi.resetModules();
    // A long list of pattern-valid, catalogued role parameters whose join
    // exceeds 2048 chars.
    const longRoles = Array.from(
      { length: 120 },
      (_, i) => `ts-oraculo-role${i}`,
    );
    const joined = longRoles.join(' ');
    expect(joined.length).toBeGreaterThan(CLAIM_MAX_LENGTH);

    vi.doMock('../role-catalog', () => ({
      roleParameters: () => longRoles,
    }));
    vi.doMock('../validation-chain', () => ({
      CLAIM_MAX_LENGTH: 2048,
      // Treat every input group as a catalog match (raw === group).
      filterCatalogRoles: (tokens: readonly string[]) => ({
        matches: tokens.map((raw) => ({ raw })),
        dropped: [],
      }),
    }));

    const mod = await import('./handler');
    const log = vi.fn<(entry: ClaimLogEntry) => void>();
    const value = mod.claimFromGroups(longRoles, log);
    expect(value).toBeUndefined();
    expect(log).toHaveBeenCalledWith({ code: 'CLAIM_TOO_LONG' });

    vi.doUnmock('../role-catalog');
    vi.doUnmock('../validation-chain');
    vi.resetModules();
  });
});

/** Build a minimal V2 pre-token event with the given group membership. */
function makeEvent(
  groups: string[],
  userName = 'user-123',
): PreTokenGenerationV2TriggerEvent {
  return {
    version: '2',
    region: 'us-east-1',
    userPoolId: 'us-east-1_pool',
    userName,
    triggerSource: 'TokenGeneration_HostedAuth',
    callerContext: { awsSdkVersion: 'x', clientId: 'client-abc' },
    request: {
      userAttributes: { email: 'user@example.com' },
      groupConfiguration: { groupsToOverride: groups },
    },
    response: {
      claimsAndScopeOverrideDetails: {},
    },
  } as PreTokenGenerationV2TriggerEvent;
}

const CONTEXT = {} as Context;
const noop = () => undefined;

async function run(event: PreTokenGenerationV2TriggerEvent) {
  // The V2 handler is async and returns the mutated event.
  return (await handler(event, CONTEXT, noop)) as PreTokenGenerationV2TriggerEvent;
}

describe('handler (V2 event)', () => {
  it('sets custom:tsRoles on BOTH the ID token and the access token', async () => {
    const event = makeEvent([ORACULO_ADMIN, LEGALDOCS_ADMIN]);
    const result = await run(event);
    const details = result.response.claimsAndScopeOverrideDetails;
    const expected = `${ORACULO_ADMIN} ${LEGALDOCS_ADMIN}`;
    expect(details.idTokenGeneration?.claimsToAddOrOverride?.[TS_ROLES_ATTRIBUTE]).toBe(
      expected,
    );
    expect(
      details.accessTokenGeneration?.claimsToAddOrOverride?.[TS_ROLES_ATTRIBUTE],
    ).toBe(expected);
  });

  it('uses catalog order regardless of the order Cognito lists the groups', async () => {
    const event = makeEvent([LEGALDOCS_ADMIN, ORACULO_ADMIN]);
    const result = await run(event);
    const expected = `${ORACULO_ADMIN} ${LEGALDOCS_ADMIN}`;
    expect(
      result.response.claimsAndScopeOverrideDetails.idTokenGeneration
        ?.claimsToAddOrOverride?.[TS_ROLES_ATTRIBUTE],
    ).toBe(expected);
  });

  it('drops a non-catalog group from the claim and logs ROLE_NOT_IN_CATALOG', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const event = makeEvent([ORACULO_ADMIN, 'ts-dataDrones-administrators']);
    const result = await run(event);
    const claim =
      result.response.claimsAndScopeOverrideDetails.idTokenGeneration
        ?.claimsToAddOrOverride?.[TS_ROLES_ATTRIBUTE];
    expect(claim).toBe(ORACULO_ADMIN);
    expect(claim).not.toContain('dataDrones');
    // The drop was logged with its code, app key, and the Cognito username.
    const logged = warn.mock.calls.some(
      ([, payload]) =>
        payload &&
        (payload as Record<string, unknown>).code === 'ROLE_NOT_IN_CATALOG' &&
        (payload as Record<string, unknown>).username === 'user-123',
    );
    expect(logged).toBe(true);
    warn.mockRestore();
  });

  it('omits the claim entirely when the user has no catalog role', async () => {
    const event = makeEvent(['ts-dataDrones-administrators']);
    const result = await run(event);
    const details = result.response.claimsAndScopeOverrideDetails;
    expect(details.idTokenGeneration).toBeUndefined();
    expect(details.accessTokenGeneration).toBeUndefined();
  });

  it('omits the claim when the user has no groups at all (login still succeeds)', async () => {
    const event = makeEvent([]);
    const result = await run(event);
    // Handler returns the event unchanged (no override set) -> login succeeds.
    expect(
      result.response.claimsAndScopeOverrideDetails.idTokenGeneration,
    ).toBeUndefined();
  });

  it('never throws for a stray/malformed group name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const event = makeEvent([ORACULO_ADMIN, 'totally::invalid']);
    await expect(run(event)).resolves.toBeDefined();
    warn.mockRestore();
  });
});
