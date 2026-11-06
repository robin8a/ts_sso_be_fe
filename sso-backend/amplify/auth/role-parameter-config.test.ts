import { describe, it, expect } from 'vitest';
import { ROLE_CATALOG, roleParameters } from './role-catalog';
import {
  TS_ROLES_ATTRIBUTE,
  clientReadAttributes,
  clientWriteAttributes,
  defaultClientReadAttributes,
  defaultClientWriteAttributes,
} from './client-attributes';

/**
 * Config-level tests for Task 4: the custom role parameter and the catalog
 * groups. The behavior that an end-user attribute write of `custom:tsRoles` is
 * rejected (`ROLE_NOT_WRITABLE`) ultimately runs against a deployed pool
 * (06_Testing_Strategy.md, integration/negative tests). What is verifiable
 * statically here is the invariant the backend relies on: every app client's
 * read attributes include the role attribute and the write attributes exclude
 * it, and the Cognito group list is driven by the catalog, one group per role
 * parameter in catalog order.
 *
 * Validates: Requirements 4.1, 4.2, 6.1
 */

describe('catalog-driven Cognito groups (Requirement 4.2 / 6.1)', () => {
  it('creates exactly one group per catalog role parameter, in catalog order', () => {
    // `defineAuth({ groups: roleParameters() })` in resource.ts is sourced from
    // the catalog module, never hard-coded. roleParameters() must mirror the
    // catalog one-to-one and in order.
    expect(roleParameters()).toEqual(
      ROLE_CATALOG.map((entry) => entry.roleParameter),
    );
  });

  it('is the current catalog of administrator role parameters', () => {
    expect(roleParameters()).toEqual([
      'ts-oraculo-administrators',
      'ts-legalDocs-administrators',
    ]);
  });

  it('has no duplicate group names', () => {
    const groups = roleParameters();
    expect(new Set(groups).size).toBe(groups.length);
  });
});

describe('app-client attribute permissions for custom:tsRoles (Requirement 4.1)', () => {
  it('read attributes include custom:tsRoles (client-readable: yes)', () => {
    expect(clientReadAttributes()).toContain(TS_ROLES_ATTRIBUTE);
    expect(defaultClientReadAttributes()).toContain(TS_ROLES_ATTRIBUTE);
  });

  it('write attributes exclude custom:tsRoles (user-writable: no -> ROLE_NOT_WRITABLE)', () => {
    expect(clientWriteAttributes()).not.toContain(TS_ROLES_ATTRIBUTE);
    expect(defaultClientWriteAttributes()).not.toContain(TS_ROLES_ATTRIBUTE);
  });

  it('keeps standard identity attributes readable and writable', () => {
    // email backs email login (Requirement 6.1); it stays writable for normal
    // self-service while the role attribute does not.
    expect(clientReadAttributes()).toContain('email');
    expect(clientWriteAttributes()).toContain('email');
  });

  it('returns fresh arrays so a caller cannot mutate shared state', () => {
    const first = clientReadAttributes();
    first.push('custom:injected');
    expect(clientReadAttributes()).not.toContain('custom:injected');
  });
});
