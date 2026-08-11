-- apply-event.lua
-- Atomically deduplicates an event by its (tenant, eventId) token and applies
-- a batch of Redis mutation commands.
--
-- KEYS[1]  = dedup key  e.g. dash:{tenant}:evt:{eventId}
-- KEYS[2]  = meta key   e.g. dash:{tenant}:meta
--
-- ARGV[1]  = DEDUP_TTL_SECONDS (integer string)
-- ARGV[2]  = JSON-encoded array of mutation commands
--            Each command: ["HINCRBY", key, field, increment]
--                       or ["ZINCRBY", key, increment, member]
--                       or ["ZADD",    key, "GT", score, member]
--                       or ["ZREM",    key, member]
--                       or ["LPUSH",   key, value]
--                       or ["LTRIM",   key, start, stop]
--                       or ["HSET",    key, field, value]
--
-- Returns: 0 if deduplicated (no-op), 1 if applied.

local dedup_key = KEYS[1]
local meta_key  = KEYS[2]
local ttl       = tonumber(ARGV[1])
local cmds_json = ARGV[2]

-- Attempt to claim the dedup key atomically (NX = only set if not exists)
local claimed = redis.call('SET', dedup_key, '1', 'NX', 'EX', ttl)
if claimed == false then
  -- Already processed — idempotent no-op
  return 0
end

-- Decode and apply each mutation command
local cmds = cjson.decode(cmds_json)
for _, cmd in ipairs(cmds) do
  local op = cmd[1]
  if op == 'HINCRBY' then
    -- Clamp to zero: read current, compute new, set if below 0
    local cur = tonumber(redis.call('HGET', cmd[2], cmd[3])) or 0
    local nxt = cur + tonumber(cmd[4])
    if nxt < 0 then
      nxt = 0
    end
    redis.call('HSET', cmd[2], cmd[3], nxt)
  elseif op == 'ZINCRBY' then
    redis.call('ZINCRBY', cmd[2], cmd[3], cmd[4])
  elseif op == 'ZADD' then
    -- cmd: ["ZADD", key, "GT"|"NX", score, member]
    redis.call('ZADD', cmd[2], cmd[3], cmd[4], cmd[5])
  elseif op == 'ZREM' then
    redis.call('ZREM', cmd[2], cmd[3])
  elseif op == 'LPUSH' then
    redis.call('LPUSH', cmd[2], cmd[3])
  elseif op == 'LTRIM' then
    redis.call('LTRIM', cmd[2], tonumber(cmd[3]), tonumber(cmd[4]))
  elseif op == 'HSET' then
    redis.call('HSET', cmd[2], cmd[3], cmd[4])
  end
end

-- Increment sequence and record updatedAt on the meta hash
redis.call('HINCRBY', meta_key, 'seq', 1)
redis.call('HSET', meta_key, 'updatedAt', tonumber(redis.call('TIME')[1]))
redis.call('HSET', meta_key, 'source', 'incremental')

return 1
