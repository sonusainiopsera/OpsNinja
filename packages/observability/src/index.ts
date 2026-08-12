// ---------------------------------------------------------------------------
// Legacy log-redactor exports (kept for backward compatibility)
// ---------------------------------------------------------------------------
export { redactEmailsInString, redactLogObject, toRedactedLogString } from './log-redactor';

// ---------------------------------------------------------------------------
// Enhanced privacy redactor (WO-094)
// ---------------------------------------------------------------------------
export {
  redactObject,
  redactString,
  maskEmail,
  maskIp,
  hashValue,
  MAX_DEPTH,
  MAX_KEYS,
  MAX_STRING_LEN,
  DROP_KEYS,
  MASK_KEYS,
  HASH_KEYS,
  REDACT_KEYS,
} from './privacy/redactor';

// ---------------------------------------------------------------------------
// Classification registry
// ---------------------------------------------------------------------------
export {
  CLASSIFICATION_REGISTRY,
  getClassification,
} from './privacy/classification.registry';

export type {
  DataTier,
  RetentionCategory,
  RedactionStrategy,
  FieldClassification,
} from './privacy/classification.registry';

// ---------------------------------------------------------------------------
// Redaction port (injectable interface for audit writer and AI hook)
// ---------------------------------------------------------------------------
export {
  REDACTION_PORT,
  DefaultRedactionService,
} from './privacy/redaction.port';

export type { RedactionPort } from './privacy/redaction.port';

// ---------------------------------------------------------------------------
// Deterministic anonymiser
// ---------------------------------------------------------------------------
export { Anonymizer } from './privacy/anonymizer';
export type { AnonymizerOptions } from './privacy/anonymizer';

// ---------------------------------------------------------------------------
// Logger factory
// ---------------------------------------------------------------------------
export { createLogger } from './logging/create-logger';
export type { CreateLoggerOptions } from './logging/create-logger';

// ---------------------------------------------------------------------------
// Jira SLI metric definitions (WO-059)
// ---------------------------------------------------------------------------
export {
  JIRA_METRICS,
  buildJiraLabels,
  computeInboundLag,
  computeOutboundLag,
} from './jira-metrics';

export type {
  MetricDescriptor,
  JiraMetricLabels,
} from './jira-metrics';

// ---------------------------------------------------------------------------
// Metrics registry (WO-071)
// ---------------------------------------------------------------------------
export {
  MetricsRegistry,
  getRegistry,
  _resetRegistriesForTesting,
  LATENCY_BUCKETS_S,
  LAG_BUCKETS_MS,
} from './metrics-registry';

export type { MetricDef, MetricType } from './metrics-registry';

// ---------------------------------------------------------------------------
// Health indicators (WO-071)
// ---------------------------------------------------------------------------
export {
  LivenessIndicator,
  RedisPingIndicator,
  PgBouncerPingIndicator,
  ReadinessComposite,
} from './health/readiness.indicator';

export type {
  HealthResult,
  ReadinessIndicator,
  ReadinessCheckResult,
} from './health/readiness.indicator';

// ---------------------------------------------------------------------------
// PII corpus fixture (for test use)
// ---------------------------------------------------------------------------
export {
  CORPUS_EMAILS,
  CORPUS_PHONES_E164,
  CORPUS_PHONES_NANP,
  CORPUS_IPV4,
  CORPUS_IPV6,
  CORPUS_JWTS,
  CORPUS_AWS_KEYS,
  CORPUS_HIGH_ENTROPY,
  CORPUS_LOG_SNIPPETS,
  CORPUS_STRUCTURED_RECORDS,
  CORPUS_SAFE_VALUES,
} from './privacy/pii-corpus';
