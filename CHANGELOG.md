# Changelog

## v0.2.5

- Fixed manual audio output selection sometimes reverting to the monitor rule after the Chrome extension service worker restarted.
- Manual output overrides are now stored in `chrome.storage.session`, so they survive normal MV3 service worker suspension and resume.
- Added regression coverage for preserving and clearing manual overrides.

## v0.2.4

- Initial public release.
- Added GitHub Release packaging for a loadable Chrome extension ZIP.
