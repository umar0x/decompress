# Releasing

## Publication

The three public packages must be published in dependency order: core, compatibility adapter, then
CLI. The release workflow already uses that order.

1. Confirm every manifest and `CHANGELOG.md` use the intended version.
2. Run `npm run release:check` from a clean checkout.
3. Create a granular npm automation token authorized for the `@umar0x` scope and store it as the
   `NPM_TOKEN` GitHub Actions secret.
4. Push an annotated `v1.0.2` tag that points to the reviewed commit.
5. Verify all three npm packages, provenance attestations, the GitHub release, and the attached
   CycloneDX SBOM.

The workflow rejects a tag that does not match the package version.

## Trusted publishing after the first release

After each package exists on npm, configure its trusted publisher with these values:

- Provider: GitHub Actions
- Organization or user: `umar0x`
- Repository: `decompress`
- Workflow: `release.yml`
- Allowed action: `npm publish`

Trusted publishing requires npm 11.5.1 or later, Node 22.14 or later, a GitHub-hosted runner, and
`id-token: write`. The release workflow uses Node 24 and already grants that permission. Once all
three packages publish successfully through OIDC, remove `NPM_TOKEN` from the workflow and revoke
the automation token.

## Repository rules

Create an active ruleset for `main` that requires pull requests, resolved conversations, and all
`Test (...)`, `Release readiness`, and CodeQL checks. Block force pushes and branch deletion. Use a
separate tag ruleset for `v*.*.*` that restricts tag creation and deletion.

Enable private vulnerability reporting, Dependabot alerts and security updates, secret scanning,
push protection, and automatic deletion of merged branches. Allow squash and rebase merges, and
disable merge commits if a linear history is required.

Repository and npm account settings are external controls. They must be confirmed in the GitHub
and npm interfaces before publication.
