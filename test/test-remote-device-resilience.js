import assert from 'node:assert';
import {
  compactForLog,
  RemoteCallDeduplicator,
} from '../dist/remote-device/device.js';
import { RemoteChannel } from '../dist/remote-device/remote-channel.js';

process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = '1';

const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function withoutUnhandledRejection(operation) {
  let rejection;
  const listener = (reason) => { rejection = reason; };
  process.once('unhandledRejection', listener);
  try {
    await operation();
    await flush();
    await flush();
  } finally {
    process.removeListener('unhandledRejection', listener);
  }
  assert.strictEqual(rejection, undefined, `unexpected unhandled rejection: ${rejection}`);
}
class FakeChannel {
  state = 'joining';
  handler = null;
  constructor(client, status = 'SUBSCRIBED') {
    this.client = client;
    this.status = status;
  }
  on(_event, _filter, handler) {
    this.handler = handler;
    return this;
  }
  subscribe(callback) {
    Promise.resolve().then(() => {
      this.state = this.status === 'SUBSCRIBED' ? 'joined' : 'errored';
      callback(this.status, this.status === 'SUBSCRIBED' ? null : new Error('offline'));
    });
    return this;
  }
  emit(payload) { this.handler?.(payload); }
  unsubscribe() { this.state = 'closed'; return Promise.resolve(); }
}

class FakeClient {
  realtime = { disconnect: () => Promise.resolve() };
  channelInstance;
  constructor(status = 'SUBSCRIBED', rejectUpdates = false) {
    this.status = status;
    this.rejectUpdates = rejectUpdates;
  }
  channel() {
    this.channelInstance = new FakeChannel(this, this.status);
    return this.channelInstance;
  }
  removeChannel() { return Promise.resolve(); }
  from() {
    const result = this.rejectUpdates
      ? Promise.reject(new Error('status transport offline'))
      : Promise.resolve({ error: null });
    const chain = {
      update: () => chain,
      select: () => chain,
      eq: () => result,
    };
    return chain;
  }
}

function makeRemoteChannel(client, onToolCall = () => {}) {
  const channel = new RemoteChannel();
  channel.client = client;
  channel._user = { id: 'user-1', email: 'test@example.com' };
  channel.deviceId = 'device-1';
  channel.onToolCall = onToolCall;
  return channel;
}

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS  ${name}`);
  } catch (error) {
    failures++;
    console.error(`🔴 FAIL  ${name}\n   ${error.message}`);
  }
}

await test('large tool results are bounded before logging', () => {
  const rendered = compactForLog({ text: 'x'.repeat(10_000) }, 256);
  assert.ok(rendered.length < 400);
  assert.match(rendered, /truncated/);
});

await test('circular values cannot crash result logging', () => {
  const value = { name: 'circular' };
  value.self = value;
  const rendered = compactForLog(value, 256);
  assert.match(rendered, /unserializable/i);
});

await test('call IDs are deduplicated while active and recently completed', () => {
  const guard = new RemoteCallDeduplicator(100, 2);
  assert.strictEqual(guard.begin('a', 0), true);
  assert.strictEqual(guard.begin('a', 1), false);
  guard.finish('a', 2);
  assert.strictEqual(guard.begin('a', 50), false);
  assert.strictEqual(guard.begin('a', 103), true);
  guard.finish('a', 104);
  assert.strictEqual(guard.begin('b', 105), true);
  guard.finish('b', 106);
  assert.strictEqual(guard.begin('c', 107), true);
  guard.finish('c', 108);
  assert.strictEqual(guard.begin('a', 109), true, 'oldest completed ID should be evicted');
});

await test('async tool callback rejection is contained', async () => {
  const client = new FakeClient('SUBSCRIBED', false);
  const channel = makeRemoteChannel(client, async () => {
    throw new Error('handler failed');
  });
  await channel.createChannel();
  await withoutUnhandledRejection(async () => {
    client.channelInstance.emit({ new: { id: 'call-1' } });
  });
});

await test('offline status rejection is contained', async () => {
  const client = new FakeClient('TIMED_OUT', true);
  const channel = makeRemoteChannel(client);
  await withoutUnhandledRejection(async () => {
    await channel.createChannel().catch(() => {});
  });
});

console.log(`\n${failures ? '🔴' : '✅'} remote-device resilience: ${failures} failing test(s).`);
process.exit(failures ? 1 : 0);
