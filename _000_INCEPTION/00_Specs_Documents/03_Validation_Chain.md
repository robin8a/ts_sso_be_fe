# Role Parameter Validation Chain

The chain checks application keys, role parameters, and the `custom:tsRoles` claim before a role is assigned or an application is entered. It is the only parser for the `<ts>-<appID>-<role>` standard.

## Grammar

```text
appID       = [a-z][A-Za-z0-9]*
role        = [a-z][A-Za-z0-9]*
appKey      = "ts-" appID
roleParam   = appKey "-" role
claim       = roleParam *(" " roleParam)
```

| Check | Rule |
| --- | --- |
| Application key | `^ts-[a-z][A-Za-z0-9]*$` and a catalog entry |
| Role parameter | `^ts-[a-z][A-Za-z0-9]*-[a-z][A-Za-z0-9]*$`, exactly three `-` segments, catalog entry |
| Claim | Length 1–2048, no leading or trailing space, tokens split on a single space, no duplicates |

`legalDocs-administrators` fails: the first segment is not `ts`. The accepted value is `ts-legalDocs-administrators`.

`ts-dataDrones` and `ts-datum` pass as application keys. A role for either application passes only after that exact `ts-<appID>-<role>` string is in the catalog.

## Modes

| Mode | Caller | Failure behavior |
| --- | --- | --- |
| `strict` | Role assignment and catalog writes | Any invalid token rejects the operation |
| `authorize` | An application reading its token | A malformed claim denies access. Well-formed roles for other apps are kept in the claim and removed from the local allow-list. Tokens that match the pattern but are not in the catalog are dropped and logged. |

## Chain

Assignment of one role:

1. `required` — value is a non-empty string.
2. `pattern` — matches the role-parameter expression.
3. `segments` — split on `-` yields `ts`, `appID`, `role`.
4. `knownApplication` — `ts-<appID>` is in the application catalog.
5. `catalogRole` — the full string is in the role catalog.
6. `accept` — return the parsed role parameter.

Claim authorization for caller `ts-<appID>`:

1. `required` — missing or blank claim yields `noRole` with reason `CLAIM_MISSING` (authenticated, not authorized). A non-string claim yields `malformed`.
2. `maxLength` — more than 2048 characters yields `malformed`.
3. `split` — leading space, trailing space, or an empty token yields `malformed`.
4. `pattern` — any token that fails the role expression yields `malformed`.
5. `catalog` — drop tokens whose application key or full role is not in the catalog; log each drop.
6. `unique` — duplicate tokens yield `malformed`.
7. `scope` — keep tokens whose application key equals the caller.
8. `decide` — one or more scoped roles yields `authorized`. Zero scoped roles, after a well-formed claim, yields `noRole` with reason `UNAUTHORIZED_APP`.

The pre-token trigger uses steps 4 and 5 only. It never rejects the login. It publishes the catalog matches or omits the claim.

## Interface

```typescript
type ApplicationKey = `ts-${string}`;

interface RoleParameter {
  raw: string;
  appKey: ApplicationKey;
  appID: string;
  role: string;
}

interface ValidationIssue {
  code:
    | 'ROLE_MALFORMED'
    | 'ROLE_UNKNOWN_APP'
    | 'ROLE_NOT_IN_CATALOG'
    | 'CLAIM_MALFORMED'
    | 'CLAIM_TOO_LONG';
  token?: string;
}

type AuthorizationDecision =
  | { status: 'authorized'; roles: RoleParameter[] }
  | { status: 'noRole'; reason: 'CLAIM_MISSING' | 'UNAUTHORIZED_APP' }
  | { status: 'malformed'; issues: ValidationIssue[] };

interface RoleValidationChain {
  applicationKey(value: string): ApplicationKey;
  roleParameter(value: string): RoleParameter;
  claim(value: string, callerAppKey: ApplicationKey): AuthorizationDecision;
}
```

`roleParameter` throws a `ValidationIssue` for strict assignment. `claim` returns a decision and does not throw for `noRole`.

## Examples

Caller `ts-oraculo`. Catalog contains `ts-oraculo-administrators` and `ts-legalDocs-administrators`.

| `custom:tsRoles` | Decision |
| --- | --- |
| `ts-oraculo-administrators` | `authorized` with `administrators` |
| `ts-oraculo-administrators ts-legalDocs-administrators` | `authorized` with only the oraculo role |
| `ts-legalDocs-administrators` | `noRole` / `UNAUTHORIZED_APP` |
| omitted | `noRole` / `CLAIM_MISSING` |
| `legalDocs-administrators` | `malformed` (`ROLE_MALFORMED`) |
| `ts-oraculo-administrators ts-oraculo-administrators` | `malformed` (duplicate) |
| `ts-dataDrones-administrators` while that role is not catalogued | token dropped; `noRole` / `UNAUTHORIZED_APP` if nothing remains for the caller |

Caller `ts-datum` with claim `ts-oraculo-administrators` returns `noRole` / `UNAUTHORIZED_APP`. The same user entering `ts-oraculo` is `authorized`.
