-- Merge the CASHIER and WAITER roles into a single STAFF role.
-- Postgres can't drop/rename individual enum values in place, so the enum
-- is recreated and existing User rows are remapped in the same statement.
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('ADMIN', 'STAFF', 'KITCHEN');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING (
  CASE "role"::text
    WHEN 'CASHIER' THEN 'STAFF'
    WHEN 'WAITER' THEN 'STAFF'
    ELSE "role"::text
  END
)::"Role";
DROP TYPE "Role_old";
