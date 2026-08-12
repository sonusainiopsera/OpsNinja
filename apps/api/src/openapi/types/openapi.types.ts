/**
 * Minimal OpenAPI 3.1 type definitions used by the OpsNinja builder (WO-099).
 *
 * These are hand-authored structural types sufficient for the builder to
 * construct a valid OpenAPI 3.1 document without importing the heavy
 * `openapi-types` package.  They mirror the OpenAPI 3.1 spec structures
 * we actually use.
 *
 * @see https://spec.openapis.org/oas/v3.1.0
 */

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace OpenAPIV3_1 {
  export interface Document {
    openapi: '3.1.0';
    info: InfoObject;
    servers?: ServerObject[];
    paths: PathsObject;
    components?: ComponentsObject;
    security?: SecurityRequirementObject[];
    tags?: TagObject[];
  }

  export interface InfoObject {
    title: string;
    version: string;
    description?: string;
    contact?: { name?: string; url?: string; email?: string };
    license?: { name: string; url?: string };
  }

  export interface ServerObject {
    url: string;
    description?: string;
  }

  export interface TagObject {
    name: string;
    description?: string;
  }

  export interface PathsObject {
    [path: string]: PathItemObject;
  }

  export interface PathItemObject {
    summary?: string;
    description?: string;
    get?: OperationObject;
    post?: OperationObject;
    put?: OperationObject;
    patch?: OperationObject;
    delete?: OperationObject;
    parameters?: (ParameterObject | ReferenceObject)[];
  }

  export interface OperationObject {
    operationId: string;
    summary: string;
    description?: string;
    tags?: string[];
    security?: SecurityRequirementObject[];
    deprecated?: boolean;
    parameters?: (ParameterObject | ReferenceObject)[];
    requestBody?: RequestBodyObject | ReferenceObject;
    responses: ResponsesObject;
    'x-sunset'?: string;
    'x-internal-reason'?: string;
  }

  export interface ParameterObject {
    name: string;
    in: 'query' | 'header' | 'path' | 'cookie';
    required?: boolean;
    description?: string;
    deprecated?: boolean;
    schema?: SchemaObject | ReferenceObject;
    example?: unknown;
  }

  export interface RequestBodyObject {
    required?: boolean;
    description?: string;
    content: ContentObject;
  }

  export interface ResponsesObject {
    [statusCode: string]: ResponseObject | ReferenceObject;
  }

  export interface ResponseObject {
    description: string;
    headers?: Record<string, HeaderObject | ReferenceObject>;
    content?: ContentObject;
  }

  export interface HeaderObject {
    description?: string;
    required?: boolean;
    schema?: SchemaObject | ReferenceObject;
  }

  export interface ContentObject {
    [mediaType: string]: MediaTypeObject;
  }

  export interface MediaTypeObject {
    schema?: SchemaObject | ReferenceObject;
    example?: unknown;
    examples?: Record<string, ExampleObject | ReferenceObject>;
  }

  export interface ExampleObject {
    summary?: string;
    description?: string;
    value?: unknown;
  }

  export interface ComponentsObject {
    schemas?: Record<string, SchemaObject | ReferenceObject>;
    responses?: Record<string, ResponseObject | ReferenceObject>;
    parameters?: Record<string, ParameterObject | ReferenceObject>;
    examples?: Record<string, ExampleObject | ReferenceObject>;
    securitySchemes?: Record<string, SecuritySchemeObject | ReferenceObject>;
    headers?: Record<string, HeaderObject | ReferenceObject>;
  }

  export type SchemaObject = {
    type?: string | string[];
    format?: string;
    title?: string;
    description?: string;
    required?: string[];
    properties?: Record<string, SchemaObject | ReferenceObject>;
    items?: SchemaObject | ReferenceObject;
    enum?: unknown[];
    const?: unknown;
    allOf?: (SchemaObject | ReferenceObject)[];
    anyOf?: (SchemaObject | ReferenceObject)[];
    oneOf?: (SchemaObject | ReferenceObject)[];
    not?: SchemaObject | ReferenceObject;
    nullable?: boolean;
    readOnly?: boolean;
    writeOnly?: boolean;
    deprecated?: boolean;
    default?: unknown;
    example?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    minItems?: number;
    maxItems?: number;
    pattern?: string;
    additionalProperties?: boolean | SchemaObject | ReferenceObject;
    discriminator?: { propertyName: string; mapping?: Record<string, string> };
    $ref?: string;
  };

  export interface ReferenceObject {
    $ref: string;
    description?: string;
  }

  export interface SecuritySchemeObject {
    type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
    description?: string;
    name?: string;
    in?: 'query' | 'header' | 'cookie';
    scheme?: string;
    bearerFormat?: string;
    flows?: OAuthFlowsObject;
    openIdConnectUrl?: string;
  }

  export interface OAuthFlowsObject {
    implicit?: OAuthFlowObject;
    password?: OAuthFlowObject;
    clientCredentials?: OAuthFlowObject;
    authorizationCode?: OAuthFlowObject;
  }

  export interface OAuthFlowObject {
    authorizationUrl?: string;
    tokenUrl?: string;
    refreshUrl?: string;
    scopes: Record<string, string>;
  }

  export type SecurityRequirementObject = Record<string, string[]>;
}
