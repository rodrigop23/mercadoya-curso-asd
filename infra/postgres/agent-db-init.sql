\set ON_ERROR_STOP on
\getenv agent_password AGENT_DB_PASSWORD

SELECT 'CREATE ROLE agent_server LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_server')
\gexec

SELECT format('ALTER ROLE agent_server PASSWORD %L', :'agent_password')
\gexec

SELECT 'CREATE DATABASE agent_server OWNER agent_server'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'agent_server')
\gexec
