// migrations/1789709203216_multi-resource-booking.js
//
// Multi-resource booking: staff/chairs/rooms that can each take parallel
// bookings for the same service. Previously the exclusion constraint keyed
// on service_id, so one booking per service per slot — a 3-chair salon
// couldn't take 3 simultaneous haircuts.
//
// Design notes:
// - bookings.resource_id is NULLABLE. Postgres exclusion constraints ignore
//   NULLs, so legacy rows degrade safely instead of erroring.
// - Backfill creates one "Default" resource PER SERVICE (not per tenant):
//   a single tenant-wide resource would newly collide across services that
//   are parallel today. Per-service defaults preserve exact old semantics.
// - resource_services is a join table; a service with NO links means "any
//   active resource" (default-open), so merchants who never touch this
//   feature see byte-identical behavior.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE resources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_resources_tenant_id ON resources (tenant_id);

    CREATE TABLE resource_services (
      resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      PRIMARY KEY (resource_id, service_id)
    );
    CREATE INDEX idx_resource_services_service_id ON resource_services (service_id);

    ALTER TABLE bookings ADD COLUMN resource_id UUID REFERENCES resources(id);
    CREATE INDEX idx_bookings_resource_id ON bookings (resource_id);

    -- Backfill: one default resource per service, linked to it, then point
    -- existing non-cancelled bookings at their service's default.
    -- DISTINCT ON keeps it deterministic when two services share a name
    -- (each service still gets exactly one link); leftover unlinked
    -- defaults from name collisions are deleted as orphans below.
    WITH new_resources AS (
      INSERT INTO resources (tenant_id, name)
      SELECT tenant_id, 'Default — ' || name FROM services
      RETURNING id, tenant_id, name
    ),
    linked AS (
      INSERT INTO resource_services (resource_id, service_id)
      SELECT DISTINCT ON (s.id) nr.id, s.id FROM services s
      JOIN new_resources nr ON nr.tenant_id = s.tenant_id AND nr.name = 'Default — ' || s.name
      ORDER BY s.id, nr.id
      RETURNING resource_id, service_id
    )
    UPDATE bookings b SET resource_id = (
      SELECT l.resource_id FROM linked l WHERE l.service_id = b.service_id LIMIT 1
    )
    WHERE b.status != 'cancelled' AND b.resource_id IS NULL;

    DELETE FROM resources r
    WHERE r.name LIKE 'Default — %'
      AND NOT EXISTS (SELECT 1 FROM resource_services rs WHERE rs.resource_id = r.id);

    ALTER TABLE bookings DROP CONSTRAINT bookings_service_id_time_range_excl;
    ALTER TABLE bookings ADD CONSTRAINT bookings_resource_id_time_range_excl
      EXCLUDE USING gist (resource_id WITH =, time_range WITH &&) WHERE (status != 'cancelled');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE bookings DROP CONSTRAINT bookings_resource_id_time_range_excl;
    ALTER TABLE bookings ADD CONSTRAINT bookings_service_id_time_range_excl
      EXCLUDE USING gist (service_id WITH =, time_range WITH &&) WHERE (status != 'cancelled');
    ALTER TABLE bookings DROP COLUMN resource_id;
    DROP TABLE resource_services;
    DROP TABLE resources;
  `);
};
