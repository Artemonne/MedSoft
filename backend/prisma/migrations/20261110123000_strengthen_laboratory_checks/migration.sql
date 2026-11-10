ALTER TABLE "LabTest" DROP CONSTRAINT "LabTest_result_shape_check";
ALTER TABLE "LabTest" ADD CONSTRAINT "LabTest_result_shape_check" CHECK (
  ("resultKind" = 'TEXT' AND "unitCode" IS NULL AND "unitDisplay" IS NULL)
  OR
  ("resultKind" = 'QUANTITY' AND "unitCode" IS NOT NULL AND length(trim("unitCode")) > 0 AND "unitDisplay" IS NOT NULL AND length(trim("unitDisplay")) > 0)
);

ALTER TABLE "LabResult" DROP CONSTRAINT "LabResult_value_shape_check";
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_value_shape_check" CHECK (
  ("resultKind" = 'TEXT' AND "textValue" IS NOT NULL AND length(trim("textValue")) > 0 AND "quantityValue" IS NULL AND "unitCode" IS NULL)
  OR
  ("resultKind" = 'QUANTITY' AND "textValue" IS NULL AND "quantityValue" IS NOT NULL AND "unitCode" IS NOT NULL AND length(trim("unitCode")) > 0)
);
