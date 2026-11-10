'use strict';

// Packager paths are relative to the source root. Keep credentials out even
// inside otherwise permitted runtime directories; .gitignore does not package-filter.
function ignorePackageFile(file) {
  const parts = file.replaceAll('\\', '/').replace(/^\/+/, '').split('/').filter(Boolean);
  if (!parts.length) return false;
  if (parts.some(part => /^\.env(?:\.|$)/i.test(part) || ['.git', '.npmrc', 'library.json', 'library.json.tmp', 'chatgpt-auth.json', 'chatgpt-auth.json.tmp', 'mcp-auth.json', 'mcp-auth.json.tmp', 'mcp-runtime.json', 'tokens.json', 'client_secret.json', 'calendar.ics', 'wake-status.json'].includes(part.toLowerCase()) || /\.(pem|key|p12|pfx|log)$/i.test(part))) return true;
  const [root] = parts;
  if (root === 'vendor' && ['local-ai', 'goclick'].includes(parts[1])) return true;
  if (root === 'browser-extension') {
    if (parts.length === 1) return false;
    return parts.length !== 2 || !['manifest.json', 'worker.js', 'tab-operations.js', 'page-agent.js', 'page-operations.js', 'site-agent.js', 'site-operations.js', 'popup.html', 'popup.js'].includes(parts[1]);
  }
  if (['assets', 'ui', 'vendor', 'node_modules'].includes(root)) return false;
  return !(parts.length === 1 && (
    /\.(js|ps1)$/.test(root) && !['package.js', 'build-icon.js', 'package-files.js'].includes(root) ||
    ['package.json', 'package-lock.json', 'LICENSE', 'README.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md'].includes(root)
  ));
}
module.exports = {ignorePackageFile};
