/**
 * DTOs for the agent-scopes endpoints.
 */

export interface AgentScopeEntry {
  organization_id: string;
  access_level: string;
}

export interface UpdateAgentScopesDto {
  scopes: AgentScopeEntry[];
}

export interface AgentScopeOrganization {
  organization_id: string;
  name: string;
  access_level: string;
}

export interface GetAgentScopesResponse {
  user_id: string;
  scope_version: number;
  organizations: AgentScopeOrganization[];
}

export interface UpdateAgentScopesResponse {
  user_id: string;
  scope_version: number;
}
