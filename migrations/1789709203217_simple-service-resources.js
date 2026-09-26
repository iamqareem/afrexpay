// migrations/1789709203217_simple-service-resources.js
//
// Simplification of 1789709203216: each resource belongs to exactly ONE
// service. The resource_services join table, the default-open rule, and
// the link matrix were overbuilt — a chair belongs to a service, full stop.
//
// Runs after 3216 in migration order (which creates the tables); IF EXISTS
// guards keep it re-runnable and safe if partially applied.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE resources ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE CASCADE;

    -- Migrate: first linked service wins; unlinked resources take the
    -- tenant's oldest service; tenants with no services lose their rows
    -- (a resource with no service can never take a booking).
    UPDATE resources r SET service_id = COALESCE(
      (SELECT rs.service_id FROM resource_services rs
        JOIN services s ON s.id = rs.service_id
        WHERE rs.resource_id = r.id
        ORDER BY s.created_at, s.id LIMIT 1),
      (SELECT s.id FROM services s
        WHERE s.tenant_id = r.tenant_id
        ORDER BY s.created_at, s.id LIMIT 1)
    )
    WHERE r.service_id IS NULL;

    DELETE FROM resources WHERE service_id IS NULL;
    ALTER TABLE resources ALTER COLUMN service_id SET NOT NULL;

    DROP TABLE IF EXISTS resource_services;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS resource_services (
      resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      PRIMARY KEY (resource_id, service_id)
    );
    INSERT INTO resource_services (resource_id, service_id)
    SELECT id, service_id FROM resources
    ON CONFLICT DO NOTHING;
    ALTER TABLE resources DROP COLUMN service_id;
  `);
};
