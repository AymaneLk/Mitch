# Third-party components

The root MIT license covers Mitch's source; it does not relicense dependencies or downloaded binaries.

- Electron and bundled Chromium/Node.js retain their upstream licenses and third-party notices. Preserve the license and notice files shipped by Electron in portable distributions.
- npm runtime dependencies include Ajv, node-ical, and undici. Their transitive dependencies retain their own licenses. The exact versions are recorded in `package-lock.json`; preserve installed package license files.
- Cua Driver 0.41.0 is downloaded separately by `scripts/setup-cua.js` from https://github.com/trycua/cua. Its distribution and any bundled components retain their upstream terms and notices. Preserve all license files included in the vendor archive and review upstream redistribution terms before a release.
- Packaging tools are development dependencies and are not licensed by Mitch's MIT grant.

This is an attribution guide, not a substitute for the actual dependency licenses. Do not remove upstream notices from packaged releases.
