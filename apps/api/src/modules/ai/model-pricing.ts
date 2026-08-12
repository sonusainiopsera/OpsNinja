/**
 * model-pricing.ts — Per-model inference price table (WO-063).
 *
 * Prices are expressed in integer micros per 1 000 tokens to avoid
 * floating-point drift. 1 micro = 0.000001 USD, so a price of 3 000
 * micros/1k tokens = $0.003 per 1k tokens.
 *
 * Update this table when AWS Bedrock prices change — no code change required
 * elsewhere as estimated_cost_micros is computed from this map.
 */

export interface ModelPrice {
  /** Micros (0.000001 USD) per 1 000 input tokens. */
  inputMicrosPerKToken: number;
  /** Micros (0.000001 USD) per 1 000 output tokens. */
  outputMicrosPerKToken: number;
}

/**
 * Price table keyed by the model id prefix returned by the LLM provider.
 * The lookup uses `startsWith` so version suffixes are handled automatically.
 */
export const MODEL_PRICE_TABLE: ReadonlyArray<readonly [string, ModelPrice]> = [
  // Claude 3 Sonnet on Bedrock
  ['anthropic.claude-3-sonnet',  { inputMicrosPerKToken: 3_000,  outputMicrosPerKToken: 15_000  }],
  // Claude 3 Haiku on Bedrock
  ['anthropic.claude-3-haiku',   { inputMicrosPerKToken: 250,    outputMicrosPerKToken: 1_250   }],
  // Claude 3 Opus on Bedrock
  ['anthropic.claude-3-opus',    { inputMicrosPerKToken: 15_000, outputMicrosPerKToken: 75_000  }],
  // Claude 3.5 Sonnet
  ['anthropic.claude-3-5-sonnet',{ inputMicrosPerKToken: 3_000,  outputMicrosPerKToken: 15_000  }],
  // Titan Text (fallback)
  ['amazon.titan-text',          { inputMicrosPerKToken: 200,    outputMicrosPerKToken: 300     }],
];

/**
 * Look up the price for a model id.
 * Falls back to a conservative default so cost is never under-estimated.
 */
export function getPriceForModel(modelId: string): ModelPrice {
  for (const [prefix, price] of MODEL_PRICE_TABLE) {
    if (modelId.startsWith(prefix)) return price;
  }
  // Conservative default: Claude 3 Sonnet pricing
  return { inputMicrosPerKToken: 3_000, outputMicrosPerKToken: 15_000 };
}

/**
 * Compute estimated cost in integer micros.
 *
 * @param inputTokens   Number of prompt tokens used.
 * @param outputTokens  Number of completion tokens used.
 * @param modelId       Model id returned by the provider.
 * @returns             Integer micros (0 = free / untracked).
 */
export function estimateCostMicros(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
): number {
  const price = getPriceForModel(modelId);
  const inputCost  = Math.round((inputTokens  / 1000) * price.inputMicrosPerKToken);
  const outputCost = Math.round((outputTokens / 1000) * price.outputMicrosPerKToken);
  return inputCost + outputCost;
}
