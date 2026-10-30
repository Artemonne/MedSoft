BEGIN;
ALTER TABLE "MedicalWorker" ADD COLUMN "middleName" VARCHAR(24);
ALTER TABLE "Account" ALTER COLUMN "username" TYPE VARCHAR(32);
ALTER TABLE "Account" DROP CONSTRAINT "Account_username_length_check";
ALTER TABLE "Account" ADD CONSTRAINT "Account_username_length_check"
CHECK (char_length("username") BETWEEN 3 AND 32);
COMMIT;
