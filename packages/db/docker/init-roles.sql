-- Two database roles (docs/architecture.md §6, specs/003 research R5):
--   migrator  owns the schema and runs migrations from a deploy job
--   app_user  is what the API connects as; it cannot bypass row-level security
CREATE ROLE migrator LOGIN PASSWORD 'migrator';
CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOBYPASSRLS;
ALTER DATABASE cdevi OWNER TO migrator;
GRANT CONNECT ON DATABASE cdevi TO app_user;
