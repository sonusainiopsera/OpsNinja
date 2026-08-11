import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readSidebarCollapsed, writeSidebarCollapsed } from '../../lib/store/sidebarCollapse';

describe('sidebarCollapse', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns false when localStorage has no entry', () => {
    expect(readSidebarCollapsed()).toBe(false);
  });

  it('returns true when stored value is "true"', () => {
    localStorage.setItem('opsninja.shell.sidebar', 'true');
    expect(readSidebarCollapsed()).toBe(true);
  });

  it('returns false when stored value is "false"', () => {
    localStorage.setItem('opsninja.shell.sidebar', 'false');
    expect(readSidebarCollapsed()).toBe(false);
  });

  it('persists collapsed=true', () => {
    writeSidebarCollapsed(true);
    expect(localStorage.getItem('opsninja.shell.sidebar')).toBe('true');
  });

  it('persists collapsed=false', () => {
    writeSidebarCollapsed(false);
    expect(localStorage.getItem('opsninja.shell.sidebar')).toBe('false');
  });

  it('returns false and does not throw when localStorage throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => readSidebarCollapsed()).not.toThrow();
    expect(readSidebarCollapsed()).toBe(false);
  });

  it('does not throw when localStorage throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeSidebarCollapsed(true)).not.toThrow();
  });
});
