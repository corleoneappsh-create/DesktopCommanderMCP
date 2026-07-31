import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MCPDevice } from '../dist/remote-device/device.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-token-persist-'));
const configPath = path.join(temp, 'device.json');
let session = { access_token: 'access-1', refresh_token: 'refresh-1' };
let authCallback;
const device = new MCPDevice({ persistSession: true });
device.configPath = configPath;
device.deviceId = 'test-device';
device.desktop = {
  initialize: async () => {}, listClientTools: async () => [], shutdown: async () => {},
};
device.remoteChannel = {
  initialize: () => {}, setSession: async () => ({ error: null }),
  getSession: async () => ({ data: { session }, error: null }),
  onAuthStateChange: (callback) => {
    authCallback = callback;
    return { data: { subscription: { unsubscribe() {} } } };
  },
  registerDevice: async () => {}, startHeartbeat: () => {},
  user: { email: 'test@example.invalid' },
};
device.fetchSupabaseConfig = async () => ({ supabaseUrl: 'local', anonKey: 'test' });
device.loadPersistedConfig = async () => session;
await device.start();
assert.equal(typeof authCallback, 'function');
session = { access_token: 'access-2', refresh_token: 'refresh-2' };
authCallback('TOKEN_REFRESHED', session);
await device.sessionSaveQueue;
const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
assert.equal(saved.session.refresh_token, 'refresh-2');
assert.equal(saved.session.access_token, 'access-2');
assert.equal(fs.readdirSync(temp).filter((name) => name.endsWith('.tmp')).length, 0);
if (process.platform !== 'win32') assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
fs.rmSync(temp, { recursive: true, force: true });
console.log('PASS refreshed auth session is serialized and atomically persisted');
