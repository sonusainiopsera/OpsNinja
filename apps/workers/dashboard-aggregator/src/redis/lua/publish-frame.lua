-- publish-frame.lua — WO-069
--
-- Atomic publish-frame operation. Executed via EVALSHA.
--
-- Responsibilities (all within a single Lua call, so they are atomic):
--   1. Allocate the next sequence number (INCR on meta.seq).
--   2. Write the new published-state snapshot (SET published).
--   3. RPUSH the serialised frame JSON onto the ring buffer.
--   4. LTRIM the ring buffer to the configured retention size.
--   5. Refresh the ring-buffer TTL.
--   6. PUBLISH the frame to the tenant pub/sub channel.
--
-- KEYS[1]  = dash:{tenant}:meta        — seq counter hash
-- KEYS[2]  = dash:{tenant}:published   — last-published snapshot (string)
-- KEYS[3]  = dash:{tenant}:frames      — ring buffer (list)
-- KEYS[4]  = dash:{tenant}             — pub/sub channel name
--
-- ARGV[1]  = new published snapshot JSON (string)
-- ARGV[2]  = frame JSON to push and publish (string)
-- ARGV[3]  = retention size (integer string, e.g. "120")
-- ARGV[4]  = ring-buffer TTL in seconds (integer string, e.g. "900")
--
-- Returns: the allocated sequence number (integer).

local meta_key       = KEYS[1]
local published_key  = KEYS[2]
local frames_key     = KEYS[3]
local channel        = KEYS[4]

local snapshot_json  = ARGV[1]
local frame_json     = ARGV[2]
local retention      = tonumber(ARGV[3])
local ttl            = tonumber(ARGV[4])

-- 1. Allocate next sequence number
local seq = redis.call('HINCRBY', meta_key, 'seq', 1)

-- 2. Persist new published state snapshot
redis.call('SET', published_key, snapshot_json)

-- 3. Push frame to ring buffer
redis.call('RPUSH', frames_key, frame_json)

-- 4. Trim ring buffer to retention length
redis.call('LTRIM', frames_key, -retention, -1)

-- 5. Refresh TTL on ring buffer
redis.call('EXPIRE', frames_key, ttl)

-- 6. Publish to pub/sub channel
redis.call('PUBLISH', channel, frame_json)

return seq
