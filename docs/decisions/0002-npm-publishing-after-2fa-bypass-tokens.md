# ADR-0002: npm publishing after 2FA-bypass tokens lose direct publish

- Status: Proposed (planned for December 2026)
- Date: 2026-11-22
- Deadline: before January 2027

## Context

The `oh-my-prompt` npm package is published with a granular access token
(all packages, read-write, "bypass 2FA" on). The same token is used in two
places:

1. **Local or agent releases** (`npm publish` from `packages/omp-cli`, with the
   token from the password manager). 2026.1120.1 was released this way.
2. **Gitea CI** (`.gitea/workflows/publish-cli.yml`, secret `NPM_TOKEN`), which
   runs on a `v*` tag on the self-hosted Gitea runner.

npm is phasing out what these tokens can do
([changelog, 2026-07-31](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)):

- **Already in effect:** a 2FA-bypass token can no longer create or delete
  tokens, or change package access, maintainers, or trusted publishing
  settings. These now need an interactive 2FA challenge. On 2026-11-22,
  `npm token create` with the publish token returned
  `403 … Granular access tokens that bypass two-factor authentication may not perform this action`.
- **Targeted for January 2027:** 2FA-bypass tokens lose direct `npm publish`.
  They will still be able to read private packages and **stage** a publish,
  which a maintainer then approves with 2FA.

The token rotated in November 2026 expires around 2027-02-20. It will
probably lose direct publish before it expires, so rotating it is not
enough.

### Constraints

- **Trusted publishing (OIDC) does not work from Gitea.** npm supports trusted
  publishers only on GitHub Actions (GitHub-hosted runners), GitLab CI/CD
  (GitLab.com shared runners), and CircleCI cloud. "Self-hosted runners are not
  currently supported" ([docs](https://docs.npmjs.com/trusted-publishers)).
  The Gitea runner can't mint the OIDC token npm needs. This is also why
  `publish-cli.yml` already dropped `--provenance`.
- **GitHub Actions was retired for this repo in #36 (2026-08-17)** to save on
  billing. That change removed CI that duplicated Gitea's work. A
  publish-only job runs only on release tags, a few minutes per release.
  Standard GitHub-hosted runners are free for public repositories, so this
  job should cost nothing. Confirm that before reintroducing it.
- Trusted publishing needs npm CLI ≥ 11.5.1 and Node ≥ 22.14.0.
  Staged publishing needs npm CLI ≥ 11.15.0 and Node ≥ 22.14.0
  ([docs](https://docs.npmjs.com/staged-publishing)).
- Changing trusted-publisher or publishing-access settings on npmjs.com needs
  an interactive 2FA session, so a person has to do it. A token can't.

## Options

| | A. GitHub Actions trusted publishing | B. Staged publishing (token) | C. Interactive publish with OTP |
|:--|:--|:--|:--|
| Where it runs | One publish-only job on GitHub-hosted runner | Gitea CI or local/agent | Local, by a person |
| Long-lived npm secret | None | 2FA-bypass token (stage only) | None |
| Human step per release | None (push tag) | Approve with 2FA on npmjs.com or `npm stage approve` | Enter OTP |
| Provenance | Automatic (public repo) | No (Gitea) | No |
| Works after Jan 2027 | Yes | Yes | Yes |
| Cost | GitHub Actions minutes (free for public repos, verify) | None | None |

## Decision (proposed)

1. **Primary: A.** Add a single publish-only GitHub Actions workflow,
   triggered by `v*` tags pushed to GitHub, that builds `packages/omp-cli` and
   runs `npm publish`. Configure it on npmjs.com as the package's trusted
   publisher. Gitea keeps tests, Docker build, and deploy.
2. **Fallback: B.** Keep one token, used only for `npm stage publish`, for
   releases made from an agent session or when GitHub Actions is unavailable.
   A person approves the staged version with 2FA.
3. Once A has published a release successfully, set the package's
   **Publishing access** to "Require two-factor authentication and disallow
   tokens". Trusted publishers keep working under that setting, and direct
   token publishing becomes impossible. Then remove `NPM_TOKEN` from the
   Gitea repo and narrow or revoke the token (if B is kept, check whether
   staging still works with tokens disallowed).

## Plan (December 2026)

| Step | Who | What |
|:--|:--|:--|
| 1 | Agent | Confirm the repo is public and the GitHub Actions billing status. Record the result here. |
| 2 | Agent (PR) | Add `.github/workflows/publish-npm.yml`: `on: push: tags: ['v*']`, `permissions: id-token: write, contents: read`, Node 22.14+, `npm install -g npm@^11.15` or newer, pnpm install, `scripts/build-cli.sh`, `verify-build.js`, the same tag → version mapping as `publish-cli.yml`, skip if the version already exists, `npm publish --access public` with no token. Use a GitHub environment (e.g. `npm`), optionally with required reviewers. |
| 3 | Agent (PR) | In `publish-cli.yml`, make the npm publish step a no-op or `npm stage publish`, so the two workflows don't race on the same tag. The GitHub release step can stay. |
| 4 | Person (2FA) | npmjs.com → `oh-my-prompt` → Settings → Trusted Publisher → GitHub Actions: user `jiunbae`, repo `oh-my-prompt`, workflow `publish-npm.yml`, environment `npm`. Allowed actions: publish and dist-tag. |
| 5 | Agent + person | Release a patch version by pushing its tag. Check the published version on the registry and its provenance badge. |
| 6 | Person (2FA) | Set Publishing access to "Require 2FA and disallow tokens". Remove Gitea `NPM_TOKEN`. Revoke the token, or keep it only for staging (fallback B). |
| 7 | Agent | Update release instructions (this ADR, password-manager notes, agent docs) so agents stage, not publish, when releasing locally. |

### Rollback

- Before step 6: nothing is removed, and the token path keeps working.
- After step 6: set Publishing access back to allow tokens (person, 2FA), and
  restore `NPM_TOKEN` on Gitea. Trusted publisher settings can be removed
  without affecting existing versions.

## Open questions

- Does `npm stage publish` with a token still work when the package
  disallows tokens? (Docs don't say. Test this in step 6 before revoking.)
- How long does a staged version stay pending before it expires? (Not
  documented.)
- If GitHub Actions billing is not actually free for this account, fall back
  to B as the primary path.
