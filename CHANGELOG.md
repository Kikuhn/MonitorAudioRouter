# Changelog

## v0.2.6

- Fixed stale output-device cache recovery so Chrome/Windows `AbortError` failures clear the cached device ID and guide the user to retry cleanly.
- Added proper extension toolbar icons and aligned the popup header branding with the product icon.
- Refined the popup dark charcoal and blue-accent UI spacing, row rhythm, status text handling, and monitor/device layout.
- Removed temporary permission and diagnostics buttons from the popup; extension permissions are now prepared on install/startup where Chrome allows it.

## v0.2.5

- Fixed manual audio output selection sometimes reverting to the monitor rule after the Chrome extension service worker restarted.
- Manual output overrides are now stored in `chrome.storage.session`, so they survive normal MV3 service worker suspension and resume.
- Added regression coverage for preserving and clearing manual overrides.

## v0.2.4

- Initial public release.
- Added GitHub Release packaging for a loadable Chrome extension ZIP.
