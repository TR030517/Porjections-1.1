// Bootstrap runs before a build in source checkouts, and from dist in API images.
// Both forms load the same versioned policy; no environment variable can relax it.
const { existsSync } = require('node:fs');
const path = require('node:path');
const source = path.resolve(__dirname, '../../src/common/password-policy-rules.json');
const rules = require(existsSync(source) ? source : '../../dist/common/password-policy-rules.json');

function validRolePassword(value, role) {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(rules.minimumUtf8BytesByRole, role)) return false;
  const bytes = Buffer.byteLength(value, 'utf8');
  return bytes >= rules.minimumUtf8BytesByRole[role] && bytes <= rules.maximumUtf8Bytes &&
    !rules.forbiddenCodePoints.some(point => value.includes(String.fromCodePoint(point)));
}

module.exports = { validRolePassword };
