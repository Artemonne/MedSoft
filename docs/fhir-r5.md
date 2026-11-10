# MedSoft FHIR R5 read API

The protected endpoint is `/api/fhir/r5`. Its public absolute URL is generated only from `FHIR_PUBLIC_BASE_URL` (for example `https://his.example.org/api/fhir/r5`), never from the request `Host` header. The variable must use HTTPS and contain no query or fragment.

This educational implementation supports FHIR 5.0.0 JSON, `read` and `search-type` for Patient, Practitioner, ServiceRequest and Observation. It accepts `_count` (1–100), the server paging parameter `_offset`, and the resource-specific parameters advertised by `/metadata`. Unknown parameters fail with an OperationOutcome instead of being ignored. Search result links are generated inside the configured public base URL.

Authentication requires an active LIS service account and Bearer access token. XML, history, conditional operations, `_include`, `_revinclude`, chained search, POST/PUT/PATCH/DELETE and Observation creation are not implemented. The resources are mapped directly from the HIS relational data and are not a separate FHIR database. Formal validation by the external HL7 validator is not part of the local test suite; tests assert the implemented R5 structures and relationships.
