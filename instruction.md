# Firmware Release Publisher

## Objective

Implement a firmware release publisher that reconciles the supplied build manifest, creates canonical release descriptors, signs each descriptor using the distribution gateway's current signing key, publishes the signed descriptors through the gateway, and persists publication receipts for idempotent reruns.

## Input

The manifest is located at:

`/app/fixtures/build_manifest.csv`

Load this manifest into DuckDB and reconcile it using the following rules:

- Consider only records where `record_type = 'BUILD'`.
- Collapse exact duplicate records: two manifest rows are duplicates only when every column is identical. Keep one copy.
- Exclude a BUILD whose `entry_id` appears as a `supersedes_id` in a `WITHDRAWAL` record.
- Group the remaining records by `bundle_id`.
- For each bundle calculate:
  - `artifact_count`: number of artifacts.
  - `total_bytes`: sum of `size_bytes`.

## Release descriptor

For every resulting bundle, create a JSON descriptor containing exactly:

- `artifact_count`
- `bundle_id`
- `total_bytes`

The descriptor must be canonical JSON: UTF-8 encoded, lexicographically sorted object keys, and no insignificant whitespace.

The descriptor bytes used for signing must be exactly the descriptor bytes submitted to the gateway.

## Signing key

Obtain the current signing-key metadata from:

`GET http://127.0.0.1:7070/v1/signing-key/current`

Use the current signing certificate and private key supplied by the environment.

Sign each canonical descriptor using OpenSSL CMS with binary input, the current signing certificate and private key, detached output, and PEM output.

The gateway verifies the signature against its current certificate, so descriptors must be signed using the current key.

## Publishing

Publish each signed descriptor to:

`POST http://127.0.0.1:7070/v1/publications`

The JSON request must contain:

- `descriptor`
- `signature`
- `request_token`

Use the deterministic request token `token-<bundle_id>` for each bundle (e.g. `token-BND-101`), so that rerunning the publisher is idempotent.

A successful response has the form:

```json
{
  "publication_id": "...",
  "request_token": "...",
  "status": "PUBLISHED"
}

```

## Output format

For each bundle, print exactly these two lines to stdout, in this order, once the descriptor is signed and once it is published:

```
BUNDLE <bundle_id> SIGNED KEY=<key_id>
BUNDLE <bundle_id> PUBLISHED RECEIPT=<publication_id> TOKEN=<request_token> STATUS=PUBLISHED

```

`<key_id>` is the current signing key's identifier as returned by the gateway. Process bundles in ascending `bundle_id` order so output is deterministic.

The expected deterministic output for the supplied manifest is stored at:

`/app/reports/publications.expected.txt`

## Persistence and idempotency

Use DuckDB to persist successful publication receipts, in a database file at:

`/app/releases.duckdb`

Before publishing a bundle, check whether its receipt has already been recorded locally. If it has, do not create another publication; reuse the stored receipt.

A successful publication must store:

- `bundle_id`
- `request_token`
- `publication_id`
- `status`

Running the publisher multiple times must not create duplicate publications.

## Environment

The distribution gateway is available at:

`http://127.0.0.1:7070`

Do not modify the provided distribution gateway implementation. Interact with it through its documented HTTP endpoints.

## Success condition

The publisher must successfully reconcile the manifest, create canonical descriptors, sign them with the current signing key, publish them through the gateway, record the receipts, and behave idempotently when executed again.

The reference solution is located at:

`/solution/publish.sh`

The automated tests are located under:

`/tests`

The publisher should operate from:

`/app` DONE ITS ALL GOOD?