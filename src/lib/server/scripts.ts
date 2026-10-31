// All security state changes and their metrics commit together on Redis.
// KEYS: link, session, challenge, binding, messages, totals, daily, events,
// links index, pending expiry, active sessions, link-id lookup, customer.
const helpers = `
local now = tonumber(ARGV[1])
local function event(kind, id)
  redis.call('HINCRBY', KEYS[6], kind, 1)
  redis.call('HINCRBY', KEYS[7], kind, 1)
  redis.call('EXPIRE', KEYS[7], 7776000)
  redis.call('LPUSH', KEYS[8], cjson.encode({type=kind, at=now, linkId=id}))
  redis.call('LTRIM', KEYS[8], 0, 99)
end
local function get(key)
  local raw = redis.call('GET', key)
  if raw then return cjson.decode(raw) end
  return nil
end
local function saveLink(link)
  redis.call('SET', KEYS[1], cjson.encode(link))
end
local function expireLink(link)
  if link.status == 'PENDING' and link.expiresAt <= now then
    link.status = 'EXPIRED'
    saveLink(link)
    redis.call('ZREM', KEYS[10], link.tokenHash)
    event('LINK_EXPIRED', link.id)
  end
end
local function sessionValid(s, link)
  return s and link and not s.revoked and link.status == 'ACTIVATED'
    and link.sessionHash == ARGV[3] and s.absoluteExpiresAt > now and s.idleExpiresAt > now
end
`;

export const transaction =
  helpers +
  `
local action = ARGV[2]
if action == 'event' then
  event(ARGV[4], ARGV[5])
  return 'OK'
end
if action == 'create' then
  local link = cjson.decode(ARGV[4])
  if redis.call('EXISTS', KEYS[1]) == 1 then return 'CONFLICT' end
  saveLink(link)
  redis.call('SET', KEYS[12], link.tokenHash)
  redis.call('SET', KEYS[13], cjson.encode({id=link.customerId, name=link.customerName}))
  redis.call('ZADD', KEYS[9], now, link.tokenHash)
  redis.call('ZADD', KEYS[10], link.expiresAt, link.tokenHash)
  redis.call('HINCRBY', KEYS[6], 'CHANNEL_' .. link.channel, 1)
  event('LINK_CREATED', link.id)
  return 'OK'
end
local link = get(KEYS[1])
if action == 'expire-session' then
  local score = redis.call('ZSCORE', KEYS[11], ARGV[3])
  if score and tonumber(score) <= now then
    redis.call('ZREM', KEYS[11], ARGV[3])
    event('SESSION_EXPIRED', link and link.id or nil)
  end
  return 'OK'
end
if not link then return 'INVALID_LINK' end
expireLink(link)
if action == 'inspect' then
  link.openedAt = link.openedAt or now
  if not link.openCount then
    redis.call('HINCRBY', KEYS[6], 'UNIQUE_OPENED', 1)
  end
  link.openCount = (link.openCount or 0) + 1
  saveLink(link)
  event('LINK_OPENED', link.id)
  return link.status
end
if action == 'expire' then return link.status end
if action == 'activation-failed' then
  link.blockedAttempts = link.blockedAttempts + 1
  saveLink(link)
  event('ACTIVATION_FAILED', link.id)
  return 'OK'
end
if action == 'revoke' then
  if link.status ~= 'REVOKED' then
    if link.status == 'EXPIRED' then redis.call('HINCRBY', KEYS[6], 'REVOKED_FROM_EXPIRED', 1) end
    link.status = 'REVOKED'
    saveLink(link)
    redis.call('ZREM', KEYS[10], link.tokenHash)
    redis.call('ZREM', KEYS[11], link.sessionHash or '')
    local session = get(KEYS[2])
    if session then
      session.revoked = true
      redis.call('SET', KEYS[2], cjson.encode(session), 'KEEPTTL')
    end
    event('LINK_REVOKED', link.id)
  end
  return 'OK'
end
if action == 'activate' or action == 'activation-challenge' then
  if link.status ~= 'PENDING' then
    link.blockedAttempts = link.blockedAttempts + 1
    saveLink(link)
    event(link.status == 'ACTIVATED' and 'LINK_ALREADY_USED' or 'ACTIVATION_FAILED', link.id)
    return link.status == 'ACTIVATED' and 'ALREADY_USED' or link.status
  end
  if action == 'activation-challenge' then
    redis.call('SET', KEYS[3], ARGV[4], 'EX', 60, 'NX')
    return 'OK'
  end
  local challenge = get(KEYS[3])
  if not challenge or challenge.expiresAt <= now or challenge.kind ~= 'activation'
    or challenge.subject ~= link.tokenHash or challenge.bindingId ~= ARGV[5] then return 'CHALLENGE_INVALID' end
  redis.call('DEL', KEYS[3])
  local session = cjson.decode(ARGV[4])
  link.status = 'ACTIVATED'
  link.activatedAt = now
  link.sessionHash = ARGV[3]
  saveLink(link)
  redis.call('SET', KEYS[2], ARGV[4], 'PX', session.absoluteExpiresAt - now + 60000)
  redis.call('SET', KEYS[4], ARGV[6], 'PX', session.absoluteExpiresAt - now + 60000)
  redis.call('ZREM', KEYS[10], link.tokenHash)
  redis.call('ZADD', KEYS[11], session.idleExpiresAt, ARGV[3])
  event('LINK_ACTIVATED', link.id)
  event('SESSION_CREATED', link.id)
  return 'OK'
end
local session = get(KEYS[2])
if not sessionValid(session, link) then return 'SESSION_INVALID' end
if action == 'session-challenge' then
  local challenge = cjson.decode(ARGV[4])
  if challenge.subject ~= session.id or challenge.bindingId ~= session.bindingId then return 'SESSION_INVALID' end
  redis.call('SET', KEYS[3], ARGV[4], 'EX', 60, 'NX')
  return 'OK'
end
local challenge = get(KEYS[3])
if not challenge or challenge.expiresAt <= now or challenge.kind ~= 'session'
  or challenge.subject ~= session.id or challenge.bindingId ~= session.bindingId
  or challenge.payload ~= ARGV[4] then return 'CHALLENGE_INVALID' end
redis.call('DEL', KEYS[3])
session.idleExpiresAt = math.min(session.absoluteExpiresAt, now + tonumber(ARGV[5]))
redis.call('ZADD', KEYS[11], session.idleExpiresAt, ARGV[3])
if action == 'resume' then
  event('SESSION_RESUMED', link.id)
end
if not session.started then
  session.started = true
  event('CHAT_STARTED', link.id)
end
redis.call('SET', KEYS[2], cjson.encode(session), 'KEEPTTL')
if action == 'send' then
  local count = redis.call('LLEN', KEYS[5])
  if count >= 1000 then return 'MESSAGE_LIMIT' end
  redis.call('RPUSH', KEYS[5], ARGV[6], ARGV[7])
  redis.call('PEXPIRE', KEYS[5], session.absoluteExpiresAt - now + 86400000)
  link.messageCount = link.messageCount + 1
  saveLink(link)
  event('MESSAGE_SENT', link.id)
end
return cjson.encode(redis.call('LRANGE', KEYS[5], -200, -1))
`;

export const rateScript = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;
