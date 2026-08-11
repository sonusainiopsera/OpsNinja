import { ReplicaLagProbe } from '../replica-lag.probe';

function makePoolMock(lagSeconds: number | null) {
  const release = jest.fn();
  const query = jest.fn().mockResolvedValue({
    rows: [{ lag_seconds: lagSeconds }],
  });
  const connect = jest.fn().mockResolvedValue({ query, release });
  const end = jest.fn().mockResolvedValue(undefined);
  return { connect, end, query };
}

describe('ReplicaLagProbe', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns lagSeconds 0 and isStandalone true before any sample is taken', () => {
    const pool = makePoolMock(5);
    const probe = new ReplicaLagProbe(pool as never);

    const freshness = probe.getReplicaFreshness();
    expect(freshness.lagSeconds).toBe(0);
    expect(freshness.isStandalone).toBe(true);
    expect(freshness.sampledAt).toBe(0);
  });

  it('updates freshness after the first sample with a real lag value', async () => {
    const pool = makePoolMock(7.5);
    const probe = new ReplicaLagProbe(pool as never);

    probe.onApplicationBootstrap();
    await jest.runAllTimersAsync();
    await jest.runAllTimersAsync();

    const freshness = probe.getReplicaFreshness();
    expect(freshness.lagSeconds).toBe(7.5);
    expect(freshness.isStandalone).toBe(false);
    expect(freshness.sampledAt).toBeGreaterThan(0);
  });

  it('sets isStandalone true and lagSeconds 0 when pg returns null (not in recovery)', async () => {
    const pool = makePoolMock(null);
    const probe = new ReplicaLagProbe(pool as never);

    probe.onApplicationBootstrap();
    await jest.runAllTimersAsync();
    await jest.runAllTimersAsync();

    const freshness = probe.getReplicaFreshness();
    expect(freshness.lagSeconds).toBe(0);
    expect(freshness.isStandalone).toBe(true);
  });

  it('polls again after 15 seconds', async () => {
    const pool = makePoolMock(3);
    const probe = new ReplicaLagProbe(pool as never);

    probe.onApplicationBootstrap();
    await jest.runAllTimersAsync();
    const callsAfterInit = (pool.connect as jest.Mock).mock.calls.length;

    jest.advanceTimersByTime(15_000);
    await jest.runAllTimersAsync();

    expect((pool.connect as jest.Mock).mock.calls.length).toBeGreaterThan(callsAfterInit);
  });

  it('drains the probe pool on shutdown', async () => {
    const pool = makePoolMock(0);
    const probe = new ReplicaLagProbe(pool as never);

    probe.onApplicationBootstrap();
    await jest.runAllTimersAsync();
    await probe.onApplicationShutdown();

    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('clears the interval on shutdown so the probe stops polling', async () => {
    const pool = makePoolMock(1);
    const probe = new ReplicaLagProbe(pool as never);

    probe.onApplicationBootstrap();
    await jest.runAllTimersAsync();
    const callsBeforeShutdown = (pool.connect as jest.Mock).mock.calls.length;

    await probe.onApplicationShutdown();
    jest.advanceTimersByTime(60_000);
    await jest.runAllTimersAsync();

    expect((pool.connect as jest.Mock).mock.calls.length).toBe(callsBeforeShutdown);
  });
});
