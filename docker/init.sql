-- MCPForge Database Initialization & Security Roles
CREATE DATABASE mcpforge;
\c mcpforge;

-- 1. Published Versions Table
CREATE TABLE published_versions (
    id VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    server_slug VARCHAR(64) NOT NULL,
    version_number INT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    config JSONB NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Database-level Immutability Trigger (Prevent any UPDATE or DELETE)
CREATE OR REPLACE FUNCTION prevent_published_versions_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Immutability Violation: Published server versions cannot be modified or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_published_versions_immutable
BEFORE UPDATE OR DELETE ON published_versions
FOR EACH ROW EXECUTE FUNCTION prevent_published_versions_mutation();

-- 2. Server Active Version Pointers Table
CREATE TABLE server_active_pointers (
    tenant_id VARCHAR(64) NOT NULL,
    server_slug VARCHAR(64) NOT NULL,
    active_version_id VARCHAR(128) NOT NULL REFERENCES published_versions(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, server_slug)
);

-- 3. Jobs Table
CREATE TABLE jobs (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    job_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    spec_sha256 VARCHAR(64),
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Server Credentials Table
CREATE TABLE server_credentials (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    server_slug VARCHAR(64) NOT NULL,
    key_hash VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

-- 5. Dedicated Runtime DB Role
CREATE ROLE mcp_runtime WITH LOGIN PASSWORD 'runtime_secure_pass';
GRANT SELECT, INSERT ON published_versions TO mcp_runtime;
REVOKE UPDATE, DELETE ON published_versions FROM mcp_runtime;
GRANT SELECT, INSERT, UPDATE ON server_active_pointers TO mcp_runtime;
GRANT SELECT, INSERT, UPDATE ON jobs TO mcp_runtime;
GRANT SELECT ON server_credentials TO mcp_runtime;
