'use strict';

/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['../../.eslintrc.cjs'],
  rules: {
    // Enforce determinism: all randomness must go through the seeded PRNG.
    // Direct Math.random() calls would break seed-reproducibility guarantees.
    'no-restricted-syntax': [
      'error',
      {
        selector: 'MemberExpression[object.name="Math"][property.name="random"]',
        message:
          'Math.random() is banned in @opsninja/test-seed. Use the injected SeededPrng instance instead to guarantee deterministic output.',
      },
    ],
  },
};
