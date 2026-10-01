const LRU_MAX = Number(process.env.CACHE_LRU_MAX || 1000);

const localCache = new Map();
let redisClient = null;
let redisReady = false;

const getRedisClient = async () => {
  if (redisClient || !process.env.REDIS_URL) return redisClient;
  try {
    const { createClient } = require('redis');
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', () => {
      redisReady = false;
    });
    await redisClient.connect();
    redisReady = true;
  } catch (_) {
    redisClient = null;
    redisReady = false;
  }
  return redisClient;
};

const pruneLocalCache = () => {
  if (localCache.size <= LRU_MAX) return;
  const oldestKey = localCache.keys().next().value;
  if (oldestKey) localCache.delete(oldestKey);
};

const setLocal = (key, value, ttlSeconds) => {
  localCache.set(key, {
    value,
    expiresAt: Date.now() + (ttlSeconds * 1000)
  });
  pruneLocalCache();
};

const getLocal = (key) => {
  const entry = localCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    localCache.delete(key);
    return null;
  }
  return entry.value;
};

/**
 * Every cache key is namespaced by the verticals of the request that asks for
 * it.
 *
 * Without this, isolation holds in the database and then leaks straight back
 * out through the cache: a Chhattisgarh user warms `geo:districts:v1:...`, the
 * Maharashtra user asks for the same key a second later and is served
 * Chhattisgarh's rows — never touching Mongo, so no query filter can help.
 *
 * Done here rather than at the 93 call sites, for the same reason the query
 * filter is a plugin: a namespace that depends on 93 people remembering is not
 * a namespace.
 *
 * Outside a request there is no context and the key is left alone, so the
 * background jobs' own cache entries keep their existing names.
 */
const { currentVerticals } = require('../config/verticals');
const nsKey = (key) => {
  const v = currentVerticals();
  return v ? `v:${v.join('+')}|${key}` : String(key);
};

const get = async (key) => {
  key = nsKey(key);
  try {
    const client = await getRedisClient();
    if (client && redisReady) {
      const raw = await client.get(key);
      if (raw) return JSON.parse(raw);
    }
  } catch (_) {
    redisReady = false;
  }
  return getLocal(key);
};

const set = async (key, value, ttlSeconds) => {
  key = nsKey(key);
  try {
    const client = await getRedisClient();
    if (client && redisReady) {
      await client.setEx(key, ttlSeconds, JSON.stringify(value));
    }
  } catch (_) {
    redisReady = false;
  }
  setLocal(key, value, ttlSeconds);
};

const del = async (key) => {
  key = nsKey(key);
  localCache.delete(key);
  try {
    const client = await getRedisClient();
    if (client && redisReady) await client.del(key);
  } catch (_) {
    redisReady = false;
  }
};

// ─── Versioned namespaces ──────────────────────────────────────────
// Plain TTL invalidation has a race: if a GET is already in flight when a
// DELETE fires, the GET can finish (and call `set`) AFTER invalidation runs,
// silently re-populating the cache with pre-delete data for the rest of the
// TTL — the deleted item then reappears on the next refresh within that
// window. Embedding a version number in the cache key closes this: bumping
// the version on mutation makes every in-flight read's cache key stale, so
// its write lands in a slot nothing will ever read again.
const versions = new Map();

const getVersion = async (namespace) => {
  try {
    const client = await getRedisClient();
    if (client && redisReady) {
      const v = await client.get(`cachever:${namespace}`);
      if (v !== null && v !== undefined) return parseInt(v, 10) || 0;
    }
  } catch (_) {
    redisReady = false;
  }
  return versions.get(namespace) || 0;
};

const bumpVersion = async (namespace) => {
  const next = (versions.get(namespace) || 0) + 1;
  versions.set(namespace, next);
  try {
    const client = await getRedisClient();
    if (client && redisReady) await client.set(`cachever:${namespace}`, String(next));
  } catch (_) {
    redisReady = false;
  }
  return next;
};

const invalidatePrefix = async (prefix) => {
  const keys = Array.from(localCache.keys());
  keys.forEach((key) => {
    if (key.startsWith(prefix)) localCache.delete(key);
  });

  try {
    const client = await getRedisClient();
    if (!client || !redisReady) return;
    let cursor = '0';
    do {
      const result = await client.scan(cursor, { MATCH: `${prefix}*`, COUNT: 100 });
      cursor = result.cursor;
      if (result.keys.length > 0) await client.del(result.keys);
    } while (cursor !== '0');
  } catch (_) {
    redisReady = false;
  }
};

module.exports = {
  get,
  set,
  del,
  invalidatePrefix,
  getVersion,
  bumpVersion
};
