---
title: "API Versioning and Deprecation Policy"
audience: "integration-developer"
last-reviewed: "2026-08-11"
---

# API Versioning and Deprecation Policy

## URL Versioning

The OpsNinja API is versioned by a path prefix: `/api/v1/`. All publicly documented endpoints
are stable within a major version.

Breaking changes bump the major version (`v1` → `v2`). Both versions are supported in parallel
for a minimum deprecation window. There is no minor-version path segment.

## What Constitutes a Breaking Change

The following are breaking changes and require a major version increment:

- Removing an endpoint or an HTTP method.
- Renaming or removing a request parameter or response field.
- Changing the type of an existing field (e.g. `string` → `integer`).
- Narrowing an enum (removing a previously valid value).
- Changing a 2xx response code to 4xx.
- Changing authentication requirements on an endpoint.
- Changing the error `code` string for an existing condition.

### Non-Breaking (Additive) Changes

These changes may appear in any release without a version bump:

- Adding a new optional request parameter with a documented default.
- Adding new fields to a response object.
- Adding new enum values (widening).
- Adding new endpoints or HTTP methods.
- Adding new error `code` values for new error conditions.
- Changing rate limits (up or down) with advance notice.

## Deprecation Lifecycle

Deprecated endpoints and fields follow this process:

1. **Announcement** — Deprecation notice added to the changelog with the sunset date.
   The response includes `Deprecation: <date>` and `Sunset: <date>` headers.
2. **Deprecation window** — Minimum **6 months** from announcement. Both old and new
   surface remain functional.
3. **Sunset** — The deprecated endpoint or field is removed. After sunset, requests to
   removed endpoints receive `HTTP 410 Gone` with code `ENDPOINT_REMOVED`.

You can subscribe to deprecation notices via the changelog page or by watching the
`#opsninja-api-changelog` Slack channel.

## Changelog

The [Changelog](../changelog.md) page lists all API changes per release, grouped into:

- **Breaking changes** — require client updates before the sunset date.
- **Additive changes** — safe to adopt at your own pace.
- **Webhook catalogue changes** — new event types, payload schema changes.

The changelog is generated automatically from the OpenAPI contract-diff between each release
snapshot. Fields annotated `x-opsninja-deprecated` in the spec are included in the changelog
with their `deprecatedAt` and `sunsetAt` dates.

## Pinning to a Specific Release

Documentation for previous releases is available at:

```
https://docs.opsninja.io/api/v<MAJOR>/releases/<VERSION>/
```

Use the `Accept-Version` header to request behaviour matching a specific patch release:

```
Accept-Version: 1.4.2
```

This header only affects documented backward-compatibility shims during the deprecation window.
It is not a substitute for migrating before the sunset date.

## Webhook Event Schema Evolution

Webhook payload schemas follow the same deprecation policy as the REST API:

- Fields can be added to existing event payloads without notice (additive).
- Fields deprecated in an event payload carry a 6-month sunset window.
- During the deprecation window, old and new fields coexist (both present in the payload).
- Schema versions are tracked in the event registry and rendered on each event's catalogue page.

Consumers must be tolerant of unknown fields in webhook payloads. Parsers that reject unknown
fields will break when new fields are added.
