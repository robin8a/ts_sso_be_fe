import { describe, it, expect, vi } from 'vitest';
import {
  applicationKey,
  roleParameter,
  claim,
  filterCatalogRoles,
  roleValidationChain,
  ValidationError,
  CLAIM_MAX_LENGTH,
  type ApplicationKey,
  type AuthorizationDecision,
} from './validation-chain';

/**
 * Unit tests for the role parameter validation chain (03_Validation_Chain.md,
 * 06_Testing_Strategy.md). Covers catalog examples, cross-app claims,
 * duplicates, the 2048-character limit, and strict vs authorize behavior.
 *
 * Validates: Requirements 3.4, 5.1, 5.2, 5.3
 */

const ORACULO: ApplicationKey = 'ts-oraculo';
const DATUM: ApplicationKey = 'ts-datum';

describe('applicationKey (strict)', () => {
  it.each(['ts-oraculo', 'ts-legalDocs', 'ts-dataDrones', 'ts-datum'])(
    'accepts catalogued application key %s',
    (key) => {
      expect(applicationKey(key)).toBe(key);
    },
  );

  it('rejects a well-formed key that is not in the catalog', () => {
    expect(() => applicationKey('ts-unknown')).toThrow(ValidationError);
  });

  it('rejects a malformed key (missing ts- prefix)', () => {
    expect(() => applicationKey('oraculo')).toThrow(ValidationError);
  });
});

describe('roleParameter (strict assignment)', () => {
  it('accepts ts-oraculo-administrators and returns parsed parts', () => {
    const parsed = roleParameter('ts-oraculo-administrators');
    expect(parsed).toEqual({
      raw: 'ts-oraculo-administrators',
      appKey: 'ts-oraculo',
      appID: 'oraculo',
      role: 'administrators',
    });
  });

  it('accepts ts-legalDocs-administrators', () => {
    const parsed = roleParameter('ts-legalDocs-administrators');
    expect(parsed.appKey).toBe('ts-legalDocs');
    expect(parsed.role).toBe('administrators');
  });

  // Requirement 3.4: names that omit the prefix, add hyphens, or change
  // separators are rejected.
  it.each([
    ['legalDocs-administrators', 'missing ts- prefix'],
    ['ts-legal-docs-administrators', 'extra hyphen / four segments'],
    ['ts-Oraculo-administrators', 'uppercase-led appID'],
    ['', 'empty string'],
    ['ts-oraculo-admin-istrators', 'extra hyphen in role'],
    ['ts_oraculo_administrators', 'wrong separator'],
  ])('rejects malformed role parameter %s (%s)', (value) => {
    expect(() => roleParameter(value)).toThrow(ValidationError);
    try {
      roleParameter(value);
    } catch (err) {
      expect((err as ValidationError).code).toBe('ROLE_MALFORMED');
    }
  });

  it('rejects a well-formed role whose application is not catalogued', () => {
    // No such application key in the catalog.
    expect(() => roleParameter('ts-unknownApp-administrators')).toThrow(
      ValidationError,
    );
    try {
      roleParameter('ts-unknownApp-administrators');
    } catch (err) {
      expect((err as ValidationError).code).toBe('ROLE_UNKNOWN_APP');
    }
  });

  it.each(['ts-dataDrones-administrators', 'ts-datum-administrators'])(
    'rejects a well-formed role whose full parameter is not in the catalog: %s',
    (value) => {
      // The application exists, but the role row does not (yet).
      try {
        roleParameter(value);
        throw new Error('expected rejection');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe('ROLE_NOT_IN_CATALOG');
      }
    },
  );

  it('rejects non-string input', () => {
    // Exercises the required-step guard against non-string callers.
    expect(() => roleParameter(undefined as unknown as string)).toThrow(
      ValidationError,
    );
  });
});

describe('claim (authorize mode)', () => {
  it('authorizes only the caller-scoped role, keeping other apps in the claim', () => {
    // Requirement 5.1 / 5.2
    const decision = claim(
      'ts-oraculo-administrators ts-legalDocs-administrators',
      ORACULO,
    );
    expect(decision.status).toBe('authorized');
    const authorized = decision as Extract<
      AuthorizationDecision,
      { status: 'authorized' }
    >;
    expect(authorized.roles).toHaveLength(1);
    expect(authorized.roles[0].raw).toBe('ts-oraculo-administrators');
    expect(authorized.roles[0].appKey).toBe('ts-oraculo');
  });

  it('authorizes a single caller role', () => {
    const decision = claim('ts-oraculo-administrators', ORACULO);
    expect(decision.status).toBe('authorized');
  });

  it("returns noRole UNAUTHORIZED_APP when the claim holds only another app's role", () => {
    // Requirement 5.2 / 5.3
    const decision = claim('ts-legalDocs-administrators', ORACULO);
    expect(decision).toEqual({ status: 'noRole', reason: 'UNAUTHORIZED_APP' });
  });

  it('returns noRole CLAIM_MISSING when the claim is omitted (undefined)', () => {
    expect(claim(undefined, ORACULO)).toEqual({
      status: 'noRole',
      reason: 'CLAIM_MISSING',
    });
  });

  it('returns noRole CLAIM_MISSING when the claim is null or blank', () => {
    expect(claim(null, ORACULO)).toEqual({
      status: 'noRole',
      reason: 'CLAIM_MISSING',
    });
    expect(claim('', ORACULO)).toEqual({
      status: 'noRole',
      reason: 'CLAIM_MISSING',
    });
  });

  it('returns malformed for a non-string claim', () => {
    const decision = claim(42 as unknown as string, ORACULO);
    expect(decision.status).toBe('malformed');
  });

  it('returns malformed for a malformed token (ROLE_MALFORMED)', () => {
    const decision = claim('legalDocs-administrators', ORACULO);
    expect(decision.status).toBe('malformed');
    const malformed = decision as Extract<
      AuthorizationDecision,
      { status: 'malformed' }
    >;
    expect(malformed.issues[0].code).toBe('ROLE_MALFORMED');
  });

  it('returns malformed for a duplicate token', () => {
    const decision = claim(
      'ts-oraculo-administrators ts-oraculo-administrators',
      ORACULO,
    );
    expect(decision.status).toBe('malformed');
  });

  it('returns malformed for a double space (empty token)', () => {
    const decision = claim(
      'ts-oraculo-administrators  ts-legalDocs-administrators',
      ORACULO,
    );
    expect(decision.status).toBe('malformed');
  });

  it('returns malformed for a leading or trailing space', () => {
    expect(claim(' ts-oraculo-administrators', ORACULO).status).toBe('malformed');
    expect(claim('ts-oraculo-administrators ', ORACULO).status).toBe('malformed');
  });

  it('does not trip the length check at exactly 2048 characters', () => {
    // Build a single well-formed, pattern-matching token exactly 2048 chars
    // long: `ts-oraculo-` (11 chars) + a 2037-char alphanumeric role suffix.
    // The role segment is all lower-case-led alphanumerics, so it matches
    // ROLE_PARAMETER_PATTERN; it just is not catalogued -> dropped -> noRole.
    // That proves the maxLength step did NOT fire at exactly 2048.
    const suffix = 'a'.repeat(CLAIM_MAX_LENGTH - 'ts-oraculo-'.length);
    const atLimit = `ts-oraculo-${suffix}`;
    expect(atLimit.length).toBe(CLAIM_MAX_LENGTH);
    const decision = claim(atLimit, ORACULO);
    // Not malformed (length ok, pattern ok); dropped by catalog -> noRole.
    expect(decision).toEqual({ status: 'noRole', reason: 'UNAUTHORIZED_APP' });
  });

  it('returns malformed CLAIM_TOO_LONG for a 2049-character string', () => {
    const tooLong = 'a'.repeat(CLAIM_MAX_LENGTH + 1);
    expect(tooLong.length).toBe(2049);
    const decision = claim(tooLong, ORACULO);
    expect(decision.status).toBe('malformed');
    const malformed = decision as Extract<
      AuthorizationDecision,
      { status: 'malformed' }
    >;
    expect(malformed.issues[0].code).toBe('CLAIM_TOO_LONG');
  });

  it('caller ts-datum with ts-oraculo-administrators returns noRole UNAUTHORIZED_APP', () => {
    // Requirement 5.3 — mobile caller has no catalog role here.
    expect(claim('ts-oraculo-administrators', DATUM)).toEqual({
      status: 'noRole',
      reason: 'UNAUTHORIZED_APP',
    });
  });

  it('drops a non-catalogued token and returns noRole when nothing remains', () => {
    // ts-dataDrones-administrators is not yet catalogued -> dropped and logged.
    const log = vi.fn();
    const decision = claim('ts-dataDrones-administrators', ORACULO, log);
    expect(decision).toEqual({ status: 'noRole', reason: 'UNAUTHORIZED_APP' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({
      token: 'ts-dataDrones-administrators',
      code: 'ROLE_NOT_IN_CATALOG',
    });
  });

  it('keeps the caller role even when a non-catalogued token is dropped', () => {
    const decision = claim(
      'ts-oraculo-administrators ts-dataDrones-administrators',
      ORACULO,
    );
    expect(decision.status).toBe('authorized');
    const authorized = decision as Extract<
      AuthorizationDecision,
      { status: 'authorized' }
    >;
    expect(authorized.roles).toHaveLength(1);
    expect(authorized.roles[0].raw).toBe('ts-oraculo-administrators');
  });
});

describe('filterCatalogRoles (reusable pattern+catalog filter, pre-token Task 5)', () => {
  it('keeps catalogued roles and drops the rest with reasons', () => {
    const log = vi.fn();
    const result = filterCatalogRoles(
      [
        'ts-oraculo-administrators',
        'ts-legalDocs-administrators',
        'ts-dataDrones-administrators', // app exists, role not catalogued
        'ts-unknownApp-administrators', // app not catalogued
        'legalDocs-administrators', // malformed
      ],
      log,
    );
    expect(result.matches.map((r) => r.raw)).toEqual([
      'ts-oraculo-administrators',
      'ts-legalDocs-administrators',
    ]);
    expect(result.dropped).toEqual([
      { token: 'ts-dataDrones-administrators', code: 'ROLE_NOT_IN_CATALOG' },
      { token: 'ts-unknownApp-administrators', code: 'ROLE_UNKNOWN_APP' },
      { token: 'legalDocs-administrators', code: 'ROLE_MALFORMED' },
    ]);
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('never throws and returns empty matches for an all-dropped list', () => {
    const result = filterCatalogRoles(['nope', 'ts-datum-administrators']);
    expect(result.matches).toHaveLength(0);
    expect(result.dropped).toHaveLength(2);
  });
});

describe('roleValidationChain object', () => {
  it('exposes applicationKey, roleParameter, and claim bound to the catalog', () => {
    expect(roleValidationChain.applicationKey('ts-oraculo')).toBe('ts-oraculo');
    expect(roleValidationChain.roleParameter('ts-oraculo-administrators').role).toBe(
      'administrators',
    );
    expect(roleValidationChain.claim('ts-oraculo-administrators', ORACULO).status).toBe(
      'authorized',
    );
  });
});
