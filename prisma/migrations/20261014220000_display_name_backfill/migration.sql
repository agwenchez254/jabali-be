-- Accounts created before display names existed show the name of their linked customer record.
UPDATE "customer_accounts" AS a
SET "displayName" = c."name"
FROM "customers" AS c
WHERE c."id" = a."customerId" AND a."displayName" = '';
