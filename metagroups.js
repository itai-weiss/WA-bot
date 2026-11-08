const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const METAGROUPS_PATH = path.join(__dirname, 'metagroups.json');

let metagroups = [];

function load() {
  if (!fs.existsSync(METAGROUPS_PATH)) {
    metagroups = [];
    return;
  }

  const raw = fs.readFileSync(METAGROUPS_PATH, 'utf8').trim();
  const parsed = raw ? JSON.parse(raw) : [];
  metagroups = Array.isArray(parsed) ? parsed : [];
}

function persist() {
  fs.writeFileSync(METAGROUPS_PATH, JSON.stringify(metagroups, null, 2));
}

function list() {
  return metagroups.map((item) => ({ ...item, groupIds: [...item.groupIds] }));
}

function create(input) {
  const name = String(input.name || '').trim();
  const groupIds = Array.isArray(input.groupIds) ? [...new Set(input.groupIds.map(String))] : [];

  if (!name) throw Object.assign(new Error('name is required'), { status: 400 });
  if (!groupIds.length) throw Object.assign(new Error('select at least one group'), { status: 400 });

  const metagroup = {
    id: 'mg_' + crypto.randomBytes(4).toString('hex'),
    name,
    groupIds,
    createdAt: new Date().toISOString(),
  };

  metagroups.push(metagroup);
  persist();
  return { ...metagroup, groupIds: [...metagroup.groupIds] };
}

function remove(id) {
  const before = metagroups.length;
  metagroups = metagroups.filter((item) => item.id !== id);
  if (metagroups.length === before) {
    throw Object.assign(new Error('metagroup not found'), { status: 404 });
  }
  persist();
}

load();

module.exports = {
  list,
  create,
  remove,
};
