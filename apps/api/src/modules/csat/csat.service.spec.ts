import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { CsatService } from './csat.service';

describe('CsatService', () => {
  let service: CsatService;

  beforeEach(() => {
    service = new CsatService();
  });

  describe('submit', () => {
    it('returns { recorded: true } when UPDATE returns 1 row', async () => {
      const fakeTx = {
        execute: vi.fn().mockResolvedValue({ rows: [{ id: 'survey-id-1' }] }),
      } as unknown as Parameters<typeof service.submit>[0];

      const result = await service.submit(
        fakeTx,
        'tenant-id-1',
        'a'.repeat(64),
        { score: 4 },
        'form',
      );

      expect(result).toEqual({ recorded: true });
      expect(fakeTx.execute).toHaveBeenCalledOnce();
    });

    it('returns { recorded: true } when execute returns an array directly', async () => {
      const fakeTx = {
        execute: vi.fn().mockResolvedValue([{ id: 'survey-id-1' }]),
      } as unknown as Parameters<typeof service.submit>[0];

      const result = await service.submit(
        fakeTx,
        'tenant-id-1',
        'a'.repeat(64),
        { score: 5 },
      );

      expect(result).toEqual({ recorded: true });
    });

    it('throws ConflictException when UPDATE returns 0 rows (already responded)', async () => {
      const fakeTx = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      } as unknown as Parameters<typeof service.submit>[0];

      await expect(
        service.submit(fakeTx, 'tenant-id-1', 'b'.repeat(64), { score: 3 }),
      ).rejects.toThrow(ConflictException);
    });

    it('uses "form" as default responseSource', async () => {
      const fakeTx = {
        execute: vi.fn().mockResolvedValue({ rows: [{ id: 'x' }] }),
      } as unknown as Parameters<typeof service.submit>[0];

      await service.submit(fakeTx, 'tid', 'c'.repeat(64), { score: 2 });

      const callArg = vi.mocked(fakeTx.execute).mock.calls[0][0];
      const sqlString = String(callArg);
      expect(sqlString).toContain('form');
    });

    it('concurrent double-submit: second call gets 0 rows and throws 409', async () => {
      let callCount = 0;
      const fakeTx = {
        execute: vi.fn().mockImplementation(async () => {
          callCount++;
          return callCount === 1 ? { rows: [{ id: 'row' }] } : { rows: [] };
        }),
      } as unknown as Parameters<typeof service.submit>[0];

      const hash = 'd'.repeat(64);
      const [first, second] = await Promise.allSettled([
        service.submit(fakeTx, 't1', hash, { score: 4 }),
        service.submit(fakeTx, 't1', hash, { score: 4 }),
      ]);

      const succeeded = [first, second].filter((r) => r.status === 'fulfilled');
      const rejected = [first, second].filter((r) => r.status === 'rejected');
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    });
  });
});
