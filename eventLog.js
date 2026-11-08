const MAX = 80;
const buf = [];

function push(entry) {
  buf.unshift({ ...entry, ts: new Date().toISOString() });
  if (buf.length > MAX) buf.pop();
}

function all() {
  return buf;
}

module.exports = { push, all };
