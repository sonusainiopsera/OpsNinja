/**
 * Data Classification Registry — single source of truth.
 *
 * Every tenant-scoped entity and field is declared here with:
 *   tier             — Public | Internal | Confidential | Restricted
 *   retentionCategory — business domain of the data
 *   redactionStrategy — none | mask | hash | tokenize | drop
 *
 * The build-time completeness test (classification-completeness.spec.ts)
 * reflects over the Drizzle schema exports and fails if any column is missing
 * from this registry.
 *
 * ADDING A NEW TABLE: add an entry keyed by the Drizzle table name (camelCase)
 * and list every column. The completeness test enforces coverage.
 */

export type DataTier = 'public' | 'internal' | 'confidential' | 'restricted';

export type RetentionCategory =
  | 'system'
  | 'operational'
  | 'identity'
  | 'ticket_content'
  | 'audit_trail'
  | 'integration_secret'
  | 'analytics_aggregate';

export type RedactionStrategy = 'none' | 'mask' | 'hash' | 'tokenize' | 'drop';

export interface FieldClassification {
  tier: DataTier;
  retentionCategory: RetentionCategory;
  redactionStrategy: RedactionStrategy;
}

/**
 * Registry keyed by entity name (Drizzle camelCase table var name) then
 * column key (camelCase field name as used in TypeScript — the JS property
 * name on the Drizzle column object).
 */
export const CLASSIFICATION_REGISTRY: Record<string, Record<string, FieldClassification>> = {
  // ── tenants ───────────────────────────────────────────────────────────────
  tenants: {
    id:        { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    name:      { tier: 'internal', retentionCategory: 'operational',  redactionStrategy: 'none' },
    slug:      { tier: 'internal', retentionCategory: 'operational',  redactionStrategy: 'none' },
    active:    { tier: 'public',   retentionCategory: 'system',       redactionStrategy: 'none' },
    createdAt: { tier: 'public',   retentionCategory: 'system',       redactionStrategy: 'none' },
    updatedAt: { tier: 'public',   retentionCategory: 'system',       redactionStrategy: 'none' },
  },

  // ── organizations ─────────────────────────────────────────────────────────
  organizations: {
    id:           { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:     { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    name:         { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    tier:         { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    active:       { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    customFields: { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    createdAt:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    updatedAt:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── users ─────────────────────────────────────────────────────────────────
  users: {
    id:            { tier: 'public',       retentionCategory: 'identity', redactionStrategy: 'none' },
    tenantId:      { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    email:         { tier: 'confidential', retentionCategory: 'identity', redactionStrategy: 'mask' },
    principalKind: { tier: 'internal',     retentionCategory: 'identity', redactionStrategy: 'none' },
    active:        { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    createdAt:     { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    updatedAt:     { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
  },

  // ── tickets ───────────────────────────────────────────────────────────────
  tickets: {
    id:              { tier: 'public',       retentionCategory: 'ticket_content', redactionStrategy: 'none' },
    tenantId:        { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    organizationId:  { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    subject:         { tier: 'confidential', retentionCategory: 'ticket_content', redactionStrategy: 'mask' },
    status:          { tier: 'public',       retentionCategory: 'ticket_content', redactionStrategy: 'none' },
    priority:        { tier: 'public',       retentionCategory: 'ticket_content', redactionStrategy: 'none' },
    assigneeId:      { tier: 'public',       retentionCategory: 'ticket_content', redactionStrategy: 'none' },
    aiSummary:       { tier: 'confidential', retentionCategory: 'ticket_content', redactionStrategy: 'drop' },
    affectedAreaTags:{ tier: 'internal',     retentionCategory: 'ticket_content', redactionStrategy: 'none' },
    createdAt:       { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    updatedAt:       { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    resolvedAt:      { tier: 'public',       retentionCategory: 'ticket_content', redactionStrategy: 'none' },
  },

  // ── ticketComments ────────────────────────────────────────────────────────
  ticketComments: {
    id:             { tier: 'public',       retentionCategory: 'ticket_content', redactionStrategy: 'none' },
    tenantId:       { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    ticketId:       { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    organizationId: { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    authorId:       { tier: 'public',       retentionCategory: 'ticket_content', redactionStrategy: 'none' },
    body:           { tier: 'confidential', retentionCategory: 'ticket_content', redactionStrategy: 'drop' },
    visibility:     { tier: 'internal',     retentionCategory: 'ticket_content', redactionStrategy: 'none' },
    createdAt:      { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    updatedAt:      { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
  },

  // ── ticketAttachments ─────────────────────────────────────────────────────
  ticketAttachments: {
    id:             { tier: 'public',       retentionCategory: 'ticket_content', redactionStrategy: 'none' },
    tenantId:       { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    ticketId:       { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    commentId:      { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    organizationId: { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    filename:       { tier: 'confidential', retentionCategory: 'ticket_content', redactionStrategy: 'mask' },
    mimeType:       { tier: 'internal',     retentionCategory: 'ticket_content', redactionStrategy: 'none' },
    s3Key:          { tier: 'restricted',   retentionCategory: 'integration_secret', redactionStrategy: 'drop' },
    createdAt:      { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
  },

  // ── tenantSettings ────────────────────────────────────────────────────────
  tenantSettings: {
    tenantId:               { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    portalAiSummaryEnabled: { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    updatedAt:              { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── refreshSessions ───────────────────────────────────────────────────────
  refreshSessions: {
    id:               { tier: 'public',       retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    tenantId:         { tier: 'public',       retentionCategory: 'system',      redactionStrategy: 'none' },
    userId:           { tier: 'public',       retentionCategory: 'identity',    redactionStrategy: 'none' },
    familyId:         { tier: 'public',       retentionCategory: 'identity',    redactionStrategy: 'none' },
    tokenHashPreview: { tier: 'internal',     retentionCategory: 'identity',    redactionStrategy: 'none' },
    rotationCounter:  { tier: 'public',       retentionCategory: 'identity',    redactionStrategy: 'none' },
    ipAddress:        { tier: 'confidential', retentionCategory: 'identity',    redactionStrategy: 'mask' },
    userAgent:        { tier: 'internal',     retentionCategory: 'identity',    redactionStrategy: 'none' },
    createdAt:        { tier: 'public',       retentionCategory: 'system',      redactionStrategy: 'none' },
    lastRotatedAt:    { tier: 'public',       retentionCategory: 'identity',    redactionStrategy: 'none' },
    revokedAt:        { tier: 'public',       retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    revokeReason:     { tier: 'internal',     retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    expiresAt:        { tier: 'public',       retentionCategory: 'identity',    redactionStrategy: 'none' },
  },

  // ── auditLogs ─────────────────────────────────────────────────────────────
  auditLogs: {
    id:                 { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    tenantId:           { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    actorId:            { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    actorKind:          { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    eventType:          { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    outcome:            { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    requiredPermission: { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    route:              { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    ipAddress:          { tier: 'confidential', retentionCategory: 'audit_trail', redactionStrategy: 'mask' },
    traceId:            { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    metadata:           { tier: 'internal', retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    createdAt:          { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    resourceType:       { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    resourceId:         { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    action:             { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    beforeState:        { tier: 'internal', retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    afterState:         { tier: 'internal', retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    changedFields:      { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    source:             { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    idempotencyKey:     { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    requestId:          { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    ipHash:             { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    userAgent:          { tier: 'internal', retentionCategory: 'audit_trail', redactionStrategy: 'none' },
  },

  // ── agentOrgScopes ────────────────────────────────────────────────────────
  agentOrgScopes: {
    id:             { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:       { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    userId:         { tier: 'public',   retentionCategory: 'identity',    redactionStrategy: 'none' },
    organizationId: { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    accessLevel:    { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    scopeVersion:   { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    createdAt:      { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    updatedAt:      { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── notificationTemplates ─────────────────────────────────────────────────
  notificationTemplates: {
    tenantId:     { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    key:          { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    channel:      { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    locale:       { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    subject:      { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    bodyTemplate: { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'drop' },
    textTemplate: { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'drop' },
    version:      { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    isActive:     { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    createdAt:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    updatedAt:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── notifications ─────────────────────────────────────────────────────────
  notifications: {
    id:                 { tier: 'public',       retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:           { tier: 'public',       retentionCategory: 'system',      redactionStrategy: 'none' },
    ticketId:           { tier: 'public',       retentionCategory: 'system',      redactionStrategy: 'none' },
    recipientContactId: { tier: 'public',       retentionCategory: 'identity',    redactionStrategy: 'none' },
    recipientEmail:     { tier: 'confidential', retentionCategory: 'identity',    redactionStrategy: 'drop' },
    channel:            { tier: 'public',       retentionCategory: 'operational', redactionStrategy: 'none' },
    templateKey:        { tier: 'public',       retentionCategory: 'operational', redactionStrategy: 'none' },
    payload:            { tier: 'confidential', retentionCategory: 'ticket_content', redactionStrategy: 'drop' },
    dedupeKey:          { tier: 'public',       retentionCategory: 'system',      redactionStrategy: 'none' },
    status:             { tier: 'public',       retentionCategory: 'operational', redactionStrategy: 'none' },
    attempts:           { tier: 'public',       retentionCategory: 'operational', redactionStrategy: 'none' },
    providerMessageId:  { tier: 'internal',     retentionCategory: 'operational', redactionStrategy: 'none' },
    errorCode:          { tier: 'public',       retentionCategory: 'operational', redactionStrategy: 'none' },
    createdAt:          { tier: 'public',       retentionCategory: 'system',      redactionStrategy: 'none' },
    sentAt:             { tier: 'public',       retentionCategory: 'operational', redactionStrategy: 'none' },
  },

  // ── notificationSuppressions ──────────────────────────────────────────────
  notificationSuppressions: {
    tenantId:  { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    emailHash: { tier: 'internal', retentionCategory: 'identity',    redactionStrategy: 'none' },
    reason:    { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    createdAt: { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── webhookEndpoints ──────────────────────────────────────────────────────
  webhookEndpoints: {
    tenantId:                   { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    id:                         { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    url:                        { tier: 'internal',   retentionCategory: 'integration_secret', redactionStrategy: 'none' },
    description:                { tier: 'internal',   retentionCategory: 'operational',        redactionStrategy: 'none' },
    eventTypes:                 { tier: 'internal',   retentionCategory: 'operational',        redactionStrategy: 'none' },
    status:                     { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    secretCiphertext:           { tier: 'restricted', retentionCategory: 'integration_secret', redactionStrategy: 'drop' },
    secretKeyVersion:           { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    previousSecretCiphertext:   { tier: 'restricted', retentionCategory: 'integration_secret', redactionStrategy: 'drop' },
    previousSecretExpiresAt:    { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    consecutiveFailures:        { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    lastSuccessAt:              { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    createdBy:                  { tier: 'public',     retentionCategory: 'audit_trail',        redactionStrategy: 'none' },
    createdAt:                  { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    updatedAt:                  { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    deletedAt:                  { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
  },

  // ── webhookDeliveries ─────────────────────────────────────────────────────
  webhookDeliveries: {
    tenantId:            { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    id:                  { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    endpointId:          { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    eventId:             { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    eventType:           { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    attempt:             { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    status:              { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    httpStatus:          { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    latencyMs:           { tier: 'public',     retentionCategory: 'analytics_aggregate', redactionStrategy: 'none' },
    requestHeadersMeta:  { tier: 'internal',   retentionCategory: 'audit_trail',        redactionStrategy: 'none' },
    responseSnippet:     { tier: 'restricted', retentionCategory: 'integration_secret', redactionStrategy: 'drop' },
    errorCode:           { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    canonicalPayload:    { tier: 'restricted', retentionCategory: 'integration_secret', redactionStrategy: 'drop' },
    createdAt:           { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
  },

  // ── organizationsRegistry ─────────────────────────────────────────────────
  organizationsRegistry: {
    id:               { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:         { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    name:             { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    slug:             { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    slaTier:          { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    region:           { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    status:           { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    customFieldValues:{ tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    primaryContactId: { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    deactivatedAt:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    createdAt:        { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    updatedAt:        { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── customerAccounts ──────────────────────────────────────────────────────
  customerAccounts: {
    id:             { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:       { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    name:           { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    externalId:     { tier: 'internal', retentionCategory: 'integration_secret', redactionStrategy: 'none' },
    organizationId: { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    status:         { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    createdAt:      { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    updatedAt:      { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── contacts ──────────────────────────────────────────────────────────────
  contacts: {
    id:                  { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    tenantId:            { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    organizationId:      { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    email:               { tier: 'confidential', retentionCategory: 'identity', redactionStrategy: 'mask' },
    fullName:            { tier: 'confidential', retentionCategory: 'identity', redactionStrategy: 'mask' },
    jobTitle:            { tier: 'internal',     retentionCategory: 'identity', redactionStrategy: 'none' },
    portalAccessEnabled: { tier: 'internal',     retentionCategory: 'identity', redactionStrategy: 'none' },
    status:              { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    lastPortalLoginAt:   { tier: 'public',       retentionCategory: 'identity', redactionStrategy: 'none' },
    createdAt:           { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    updatedAt:           { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
  },

  // ── organizationVerifiedDomains ───────────────────────────────────────────
  organizationVerifiedDomains: {
    id:             { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:       { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    organizationId: { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    domain:         { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    verifiedVia:    { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    verifiedAt:     { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    createdAt:      { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── customFieldDefs ───────────────────────────────────────────────────────
  customFieldDefs: {
    id:           { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:     { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    fieldKey:     { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    label:        { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    dataType:     { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    options:      { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    required:     { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    appliesTo:    { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    displayOrder: { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    archivedAt:   { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    createdAt:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    updatedAt:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── savedViews ────────────────────────────────────────────────────────────
  savedViews: {
    id:          { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    ownerUserId: { tier: 'public',   retentionCategory: 'identity',    redactionStrategy: 'none' },
    name:        { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    filterAst:   { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    sortSpec:    { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    columns:     { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    scope:       { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    isActive:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    slug:        { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    createdAt:   { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    updatedAt:   { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── savedViewPins ─────────────────────────────────────────────────────────
  savedViewPins: {
    tenantId:     { tier: 'public', retentionCategory: 'system',      redactionStrategy: 'none' },
    userId:       { tier: 'public', retentionCategory: 'identity',    redactionStrategy: 'none' },
    viewId:       { tier: 'public', retentionCategory: 'system',      redactionStrategy: 'none' },
    displayOrder: { tier: 'public', retentionCategory: 'operational', redactionStrategy: 'none' },
    pinnedAt:     { tier: 'public', retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── jiraConnections ───────────────────────────────────────────────────────
  jiraConnections: {
    id:             { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    tenantId:       { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    siteUrl:        { tier: 'internal',   retentionCategory: 'integration_secret', redactionStrategy: 'none' },
    cloudId:        { tier: 'internal',   retentionCategory: 'integration_secret', redactionStrategy: 'none' },
    authMethod:     { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    scopes:         { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    secretRef:      { tier: 'restricted', retentionCategory: 'integration_secret', redactionStrategy: 'drop' },
    tokenExpiresAt: { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    state:          { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    lastTestedAt:   { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    createdBy:      { tier: 'public',     retentionCategory: 'audit_trail',        redactionStrategy: 'none' },
    createdAt:      { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    updatedAt:      { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
  },

  // ── slaCalendars ──────────────────────────────────────────────────────────
  slaCalendars: {
    id:           { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:     { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    name:         { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    calendarType: { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    timezone:     { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    isActive:     { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    createdAt:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    updatedAt:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── slaCalendarWindows ────────────────────────────────────────────────────
  slaCalendarWindows: {
    id:             { tier: 'public', retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:       { tier: 'public', retentionCategory: 'system',      redactionStrategy: 'none' },
    calendarId:     { tier: 'public', retentionCategory: 'system',      redactionStrategy: 'none' },
    weekday:        { tier: 'public', retentionCategory: 'operational', redactionStrategy: 'none' },
    startLocalTime: { tier: 'public', retentionCategory: 'operational', redactionStrategy: 'none' },
    endLocalTime:   { tier: 'public', retentionCategory: 'operational', redactionStrategy: 'none' },
  },

  // ── slaCalendarHolidays ───────────────────────────────────────────────────
  slaCalendarHolidays: {
    id:          { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    calendarId:  { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    holidayDate: { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    label:       { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
  },

  // ── slaPolicies ───────────────────────────────────────────────────────────
  slaPolicies: {
    id:                   { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:             { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    scopeType:            { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    scopeId:              { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    priority:             { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    responseTargetMins:   { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    resolutionTargetMins: { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    calendarId:           { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    reminderPctFirst:     { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    reminderPctSecond:    { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    isActive:             { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    targetsRatified:      { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    version:              { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    createdAt:            { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    updatedAt:            { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    createdBy:            { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    updatedBy:            { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
  },

  // ── slaPolicyVersions ─────────────────────────────────────────────────────
  slaPolicyVersions: {
    id:        { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:  { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    policyId:  { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    version:   { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    payload:   { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    changedBy: { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    changedAt: { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── csatSurveys ───────────────────────────────────────────────────────────
  csatSurveys: {
    tenantId:        { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    id:              { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    ticketId:        { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    contactId:       { tier: 'public',       retentionCategory: 'identity',       redactionStrategy: 'none' },
    tokenHash:       { tier: 'restricted',   retentionCategory: 'identity',       redactionStrategy: 'drop' },
    score:           { tier: 'internal',     retentionCategory: 'analytics_aggregate', redactionStrategy: 'none' },
    comment:         { tier: 'confidential', retentionCategory: 'ticket_content', redactionStrategy: 'drop' },
    responseSource:  { tier: 'internal',     retentionCategory: 'analytics_aggregate', redactionStrategy: 'none' },
    sentAt:          { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    delivered:       { tier: 'public',       retentionCategory: 'operational',    redactionStrategy: 'none' },
    expiresAt:       { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
    respondedAt:     { tier: 'public',       retentionCategory: 'analytics_aggregate', redactionStrategy: 'none' },
    reminderSentAt:  { tier: 'public',       retentionCategory: 'operational',    redactionStrategy: 'none' },
    createdAt:       { tier: 'public',       retentionCategory: 'system',         redactionStrategy: 'none' },
  },

  // ── reportDefinitions ─────────────────────────────────────────────────────
  reportDefinitions: {
    id:           { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    tenantId:     { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    name:         { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    description:  { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    metrics:      { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    groupBy:      { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    filterAst:    { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    chartType:    { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    sharingScope: { tier: 'public',   retentionCategory: 'operational', redactionStrategy: 'none' },
    schedule:     { tier: 'internal', retentionCategory: 'operational', redactionStrategy: 'none' },
    createdBy:    { tier: 'public',   retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    createdAt:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    updatedAt:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
    deletedAt:    { tier: 'public',   retentionCategory: 'system',      redactionStrategy: 'none' },
  },

  // ── exportJobs ────────────────────────────────────────────────────────────
  exportJobs: {
    id:                 { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    tenantId:           { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    reportDefinitionId: { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    requestedBy:        { tier: 'public',     retentionCategory: 'audit_trail',        redactionStrategy: 'none' },
    format:             { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    status:             { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    s3Key:              { tier: 'restricted', retentionCategory: 'integration_secret', redactionStrategy: 'drop' },
    rowCount:           { tier: 'public',     retentionCategory: 'analytics_aggregate', redactionStrategy: 'none' },
    byteSize:           { tier: 'public',     retentionCategory: 'analytics_aggregate', redactionStrategy: 'none' },
    errorCode:          { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
    expiresAt:          { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    createdAt:          { tier: 'public',     retentionCategory: 'system',             redactionStrategy: 'none' },
    completedAt:        { tier: 'public',     retentionCategory: 'operational',        redactionStrategy: 'none' },
  },

  // ── portalSignupRequests ──────────────────────────────────────────────────
  portalSignupRequests: {
    id:                      { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    tenantId:                { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    organizationId:          { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    email:                   { tier: 'confidential', retentionCategory: 'identity', redactionStrategy: 'drop' },
    applicantName:           { tier: 'confidential', retentionCategory: 'identity', redactionStrategy: 'mask' },
    status:                  { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    verifiedAt:              { tier: 'public',       retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    verificationEmailStatus: { tier: 'internal',     retentionCategory: 'operational', redactionStrategy: 'none' },
    createdAt:               { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    updatedAt:               { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
  },

  // ── portalVerificationTokens ──────────────────────────────────────────────
  portalVerificationTokens: {
    tokenId:         { tier: 'public',     retentionCategory: 'system',   redactionStrategy: 'none' },
    signupRequestId: { tier: 'public',     retentionCategory: 'system',   redactionStrategy: 'none' },
    tenantId:        { tier: 'public',     retentionCategory: 'system',   redactionStrategy: 'none' },
    tokenHash:       { tier: 'restricted', retentionCategory: 'identity', redactionStrategy: 'drop' },
    expiresAt:       { tier: 'public',     retentionCategory: 'system',   redactionStrategy: 'none' },
    consumedAt:      { tier: 'public',     retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    attemptCount:    { tier: 'public',     retentionCategory: 'audit_trail', redactionStrategy: 'none' },
    createdAt:       { tier: 'public',     retentionCategory: 'system',   redactionStrategy: 'none' },
  },

  // ── portalUsers ───────────────────────────────────────────────────────────
  portalUsers: {
    id:              { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    tenantId:        { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    organizationId:  { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    signupRequestId: { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    email:           { tier: 'confidential', retentionCategory: 'identity', redactionStrategy: 'mask' },
    name:            { tier: 'confidential', retentionCategory: 'identity', redactionStrategy: 'mask' },
    role:            { tier: 'internal',     retentionCategory: 'identity', redactionStrategy: 'none' },
    createdAt:       { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
    updatedAt:       { tier: 'public',       retentionCategory: 'system',   redactionStrategy: 'none' },
  },
};

/**
 * Type-safe accessor.  Returns undefined if the entity or field is unknown.
 * Use the completeness test to ensure coverage rather than a runtime throw here,
 * since unknown fields in log records should not crash the logging path.
 */
export function getClassification(
  entity: string,
  field: string,
): FieldClassification | undefined {
  return CLASSIFICATION_REGISTRY[entity]?.[field];
}
