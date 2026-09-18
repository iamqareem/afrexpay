// migrations/1751500000002_per-vehicle-booking.js
//
// Scopes double-booking prevention per service (per vehicle), not per
// tenant. Each vehicle a merchant lists is its own `services` row (e.g.
// "Toyota Corolla — White — UBH 123X") — that's already fully supported,
// no new table needed. The bug: the exclusion constraint keyed on
// tenant_id, so booking Vehicle A at 2pm incorrectly collided with
// booking Vehicle B at 2pm too, since both bookings belong to the same
// tenant. Keying on service_id instead fixes this correctly — two
// bookings for the SAME service_id (same vehicle) still correctly
// collide; different service_ids (different vehicles) never do.
// tenant_id isn't needed in the constraint at all once service_id is
// used — a booking's service already belongs to exactly one tenant.
//
// Constraint name verified directly against a real Postgres instance
// before writing this migration (SELECT conname FROM pg_constraint ...),
// not assumed from the original migration's inline SQL.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE bookings DROP CONSTRAINT bookings_tenant_id_time_range_excl;
    ALTER TABLE bookings ADD CONSTRAINT bookings_service_id_time_range_excl
      EXCLUDE USING gist (service_id WITH =, time_range WITH &&) WHERE (status != 'cancelled');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE bookings DROP CONSTRAINT bookings_service_id_time_range_excl;
    ALTER TABLE bookings ADD CONSTRAINT bookings_tenant_id_time_range_excl
      EXCLUDE USING gist (tenant_id WITH =, time_range WITH &&) WHERE (status != 'cancelled');
  `);
};
