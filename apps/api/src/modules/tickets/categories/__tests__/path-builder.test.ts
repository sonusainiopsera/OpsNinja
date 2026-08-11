import { describe, it, expect } from 'vitest';
import {
  buildSlug,
  buildPath,
  wouldCreateCycle,
  exceedsMaxDepth,
  recomputeSubtreePaths,
  normaliseName,
} from '../path-builder.js';

describe('buildSlug', () => {
  it('lowercases and trims', () => {
    expect(buildSlug('  Pipeline  ')).toBe('pipeline');
  });

  it('replaces spaces with hyphens', () => {
    expect(buildSlug('Jenkins Integration')).toBe('jenkins-integration');
  });

  it('collapses consecutive special chars', () => {
    expect(buildSlug('CI/CD Pipeline')).toBe('ci-cd-pipeline');
  });

  it('strips leading/trailing hyphens', () => {
    expect(buildSlug('---weird---')).toBe('weird');
  });

  it('handles unicode-like runs', () => {
    expect(buildSlug('Cloud Infrastructure')).toBe('cloud-infrastructure');
  });
});

describe('buildPath', () => {
  it('root node uses just the slug', () => {
    expect(buildPath(null, 'pipeline')).toBe('pipeline');
  });

  it('child node appends to parent path', () => {
    expect(buildPath('pipeline', 'jenkins-integration')).toBe('pipeline/jenkins-integration');
  });

  it('nested path builds correctly', () => {
    expect(buildPath('pipeline/jenkins-integration', 'builds')).toBe(
      'pipeline/jenkins-integration/builds',
    );
  });

  it('empty string parent is treated as root', () => {
    expect(buildPath('', 'pipeline')).toBe('pipeline');
  });
});

describe('wouldCreateCycle', () => {
  it('moving to root is always safe', () => {
    expect(wouldCreateCycle('pipeline', null)).toBe(false);
  });

  it('moving under itself is a cycle', () => {
    expect(wouldCreateCycle('pipeline', 'pipeline')).toBe(true);
  });

  it('moving under a direct descendant is a cycle', () => {
    expect(wouldCreateCycle('pipeline', 'pipeline/jenkins-integration')).toBe(true);
  });

  it('moving under a deeply nested descendant is a cycle', () => {
    expect(wouldCreateCycle('a', 'a/b/c/d')).toBe(true);
  });

  it('moving under a sibling is not a cycle', () => {
    expect(wouldCreateCycle('pipeline', 'secrets')).toBe(false);
  });

  it('path prefix match stops at slash boundary', () => {
    // "pipeline-extra" does NOT start with "pipeline/"
    expect(wouldCreateCycle('pipeline', 'pipeline-extra')).toBe(false);
  });

  it('moving to a different subtree root is safe', () => {
    expect(wouldCreateCycle('pipeline/jenkins', 'cloud/aws')).toBe(false);
  });
});

describe('exceedsMaxDepth', () => {
  it('root node (parentDepth -1) does not exceed maxLevels 3', () => {
    expect(exceedsMaxDepth(-1, 3)).toBe(false);
  });

  it('child of depth 1 fits in maxLevels 3', () => {
    expect(exceedsMaxDepth(1, 3)).toBe(false);
  });

  it('depth 2 is max allowed for maxLevels 3', () => {
    // parent depth 1 → child depth 2, maxLevels 3 → max depth = 2
    expect(exceedsMaxDepth(1, 3)).toBe(false);
    // parent depth 2 → child depth 3, exceeds maxLevels 3
    expect(exceedsMaxDepth(2, 3)).toBe(true);
  });

  it('respects custom maxLevels', () => {
    expect(exceedsMaxDepth(0, 1)).toBe(true); // only root allowed
    expect(exceedsMaxDepth(-1, 1)).toBe(false);
  });
});

describe('recomputeSubtreePaths', () => {
  const nodes = [
    { id: 'node', path: 'a/b/node', depth: 2 },
    { id: 'child1', path: 'a/b/node/child1', depth: 3 },
    { id: 'child2', path: 'a/b/node/child2', depth: 3 },
    { id: 'grandchild', path: 'a/b/node/child1/grandchild', depth: 4 },
  ];

  it('rewrites node and descendant paths', () => {
    const result = recomputeSubtreePaths(nodes, 'node', 'a/b/node', 'x/y', 'node', 1);

    const resultMap = Object.fromEntries(result.map((n) => [n.id, n]));
    expect(resultMap['node']?.path).toBe('x/y/node');
    expect(resultMap['node']?.depth).toBe(2);
    expect(resultMap['child1']?.path).toBe('x/y/node/child1');
    expect(resultMap['child1']?.depth).toBe(3);
    expect(resultMap['grandchild']?.path).toBe('x/y/node/child1/grandchild');
    expect(resultMap['grandchild']?.depth).toBe(4);
  });

  it('handles move to root', () => {
    const result = recomputeSubtreePaths(nodes, 'node', 'a/b/node', null, 'node', -1);

    const resultMap = Object.fromEntries(result.map((n) => [n.id, n]));
    expect(resultMap['node']?.path).toBe('node');
    expect(resultMap['node']?.depth).toBe(0);
    expect(resultMap['child1']?.path).toBe('node/child1');
    expect(resultMap['child1']?.depth).toBe(1);
  });
});

describe('normaliseName', () => {
  it('lowercases and trims', () => {
    expect(normaliseName('  Pipeline  ')).toBe('pipeline');
  });

  it('treats case differences as equal', () => {
    expect(normaliseName('JENKINS')).toBe(normaliseName('jenkins'));
  });
});
