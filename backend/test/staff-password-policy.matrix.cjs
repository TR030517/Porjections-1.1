// Synthetic inputs shared by DTO/service, the actual staff form validator and
// isolated HTTP/SQL regressions. These are test values, never account secrets.
module.exports = [
  { name: 'ASCII-11', value: 'a'.repeat(11), bytes: 11, accepted: false },
  { name: 'ASCII-12', value: 'a'.repeat(12), bytes: 12, accepted: true },
  { name: 'ASCII-72', value: 'a'.repeat(72), bytes: 72, accepted: true },
  { name: 'ASCII-73', value: 'a'.repeat(73), bytes: 73, accepted: false },
  { name: 'CJK-4', value: '密'.repeat(4), bytes: 12, accepted: true },
  { name: 'CJK-24', value: '密'.repeat(24), bytes: 72, accepted: true },
  { name: 'CJK-24-plus-ASCII', value: '密'.repeat(24) + 'a', bytes: 73, accepted: false },
  { name: 'emoji-3', value: '😀'.repeat(3), bytes: 12, accepted: true },
  { name: 'emoji-18', value: '😀'.repeat(18), bytes: 72, accepted: true },
  { name: 'emoji-18-plus-ASCII', value: '😀'.repeat(18) + 'a', bytes: 73, accepted: false },
  { name: 'NUL', value: 'a'.repeat(11) + '\0', bytes: 12, accepted: false },
  { name: 'CR', value: 'a'.repeat(11) + '\r', bytes: 12, accepted: false },
  { name: 'LF', value: 'a'.repeat(11) + '\n', bytes: 12, accepted: false },
  { name: 'leading-and-trailing-spaces', value: ' abcdefghij ', bytes: 12, accepted: true },
];
