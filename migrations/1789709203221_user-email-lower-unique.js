// migrations/1789709203221_user-email-lower-unique.js
//
// Login and password-reset match LOWER(email), but the original UNIQUE is
// case-sensitive — Admin@x.com and admin@x.com could both register, leaving
// one account un-loggable-in and resets targeting an arbitrary one. Belt
// and braces on top of the application-level normalized check.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uniq ON users (LOWER(email));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS users_email_lower_uniq;
  `);
};
