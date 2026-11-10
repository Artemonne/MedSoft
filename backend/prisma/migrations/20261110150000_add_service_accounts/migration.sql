CREATE TYPE "ServiceAccountRole" AS ENUM ('LIS');
ALTER TYPE "RefreshSessionSubjectType" ADD VALUE 'SERVICE';
ALTER TYPE "AuditActorType" ADD VALUE 'SERVICE';
