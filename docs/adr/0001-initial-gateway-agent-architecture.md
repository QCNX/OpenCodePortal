# ADR 0001: Gateway–Agent initial architecture

**Status:** Accepted (reconstructed record)

Portal uses a central Gateway and one outbound WSS Agent connection per Instance. The Gateway owns Dashboard CRUD, per-instance tokens, Host-based subdomain routing, and JSONC-backed persistent instance definitions. Agents only forward traffic to a local OpenCode server.

## Decisions

- Agent mode is the only proxy mode; Gateway never opens an inbound connection to an Agent.
- An Instance is created by Dashboard/API before registration. Its `id` is its DNS subdomain and it owns an `ocp-at-*` token.
- `data/state.jsonc` persists instance definition, token, Gateway ID, and optional upstream OpenCode credentials. Runtime connections, heartbeat status, and proxy counts are never persisted.
- Gateway routes the apex Host to Portal routes and `<instance>.<baseDomain>` to OpenCode. No path-prefix routing or instance cookie is used.
- TLS terminates at NPM; Gateway serves raw HTTP and WebSocket only.

## Consequences

The persisted registry is a single operational dependency and must be backed up. The topology works across NAT with no Agent-side inbound port, but one Instance maps to one live Agent connection.

## Replaces missing historical record

This reconstructed ADR is the source for legacy references to “ADR 0001 decision 1–4” in source comments and later ADRs.
