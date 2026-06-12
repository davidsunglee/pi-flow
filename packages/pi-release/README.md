# @aphotic/pi-release

A standalone, project-agnostic release skill for Pi that drives single-package and monorepo releases through one unified interface. The skill auto-detects your project shape, runs a comprehensive security audit on every path, ensures manual review of release notes, and keeps all credentialed actions (npm publish, git push, tag push, GitHub release creation) fully under user control.

## Standalone Install

This package installs independently with no dependency on `@aphotic/pi-flow-core`. Use it in any Node.js project to unlock Pi's release capabilities without adopting the full platform.

## Safety

The release skill is built around security-first principles:

- **Full security audit on every path:** Every release path undergoes a comprehensive audit to catch configuration issues, insecure credentials, and publish-target mismatches before any irreversible action.
- **User-owned credentialed actions:** All privileged operations—npm publish, git push, tag creation, and GitHub release publication—remain entirely user-initiated. The skill never holds or automatically executes credentials.
- **Manual release-notes review:** Release notes are generated and presented for your explicit approval before publication, ensuring accuracy and consistency.

## Customizing Per Project

Projects can extend the release skill's behavior through a `.pi/release-profile.md` file, a governed extension point that allows you to add project-specific gates, validation rules, or customizations. The profile never weakens the core security audit—it only adds guards on top.
