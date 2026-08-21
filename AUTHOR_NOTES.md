Author Notes
Design

The task requires a firmware release publisher that:

reconciles the supplied build manifest using DuckDB SQL
removes exact duplicate records
applies withdrawals
derives publishable bundles
calculates artifact counts and total bytes
obtains the current signing-key metadata from the distribution gateway
signs release descriptors using OpenSSL CMS
submits publications to the gateway
persists publication receipts and request tokens
behaves idempotently on repeated runs

The reference implementation is stored under solution/ and is not shipped inside environment/publisher/.

Important Traps

The solver environment must begin without the reference publisher implementation.

The provided distribution gateway under environment/distribution-gateway/ is not modified.

The publisher must derive its results from the supplied manifest rather than hardcoding the expected output.


 Proof A (empty run - expected reward 0)

Command:

    docker run --name hurix-proof-a -v "%cd%\tests:/tests" firmware-publisher bash -c \
      "cd /app/distribution-gateway && node server.js > /tmp/gateway.log 2>&1 & sleep 2; bash /tests/test.sh"

Run against the image built from environment/, with environment/publisher/ empty
(no reference implementation present) and the gateway started in the background.

Result: 7 failed, 0 passed.

    Error: Cannot find module '/app/publisher/release-publisher.mjs'
        code: 'MODULE_NOT_FOUND'

All 6 functional tests fail identically on this MODULE_NOT_FOUND error when
attempting to run the (absent) publisher. The 7th test, test_empty_solution_fails,
explicitly asserts PUBLISHER.exists() and fails as expected:

    AssertionError: assert False
     +  where False = exists()
     +    where exists = PosixPath('/app/publisher/release-publisher.mjs').exists

    7 failed in 2.66s
    pytest exit code: 1

Per tests/test.sh, a non-zero pytest exit code writes reward.txt = 0.
Confirms the test suite correctly rejects a submission with no solution present.

cat /logs/verifier/reward.txt -> 0

 Proof B (solution run - expected reward 1)

First attempt failed for an environmental reason, not a test failure - the
distribution gateway hadn't been started yet in that container:

    docker run --name hurix-proof-b -v "%cd%\solution:/solution" -v "%cd%\tests:/tests" \
      firmware-publisher bash -c "cd /solution && bash publish.sh"
    -> Error: connect ECONNREFUSED 127.0.0.1:7070

Corrected by starting the gateway first (same pattern as Proof A) before running
the solution:

    docker run --name hurix-proof-b -v "%cd%\solution:/solution" -v "%cd%\tests:/tests" \
      firmware-publisher bash -c \
      "cd /app/distribution-gateway && node server.js > /tmp/gateway.log 2>&1 & sleep 2; \
       cd /solution && bash publish.sh && bash /tests/test.sh"

Output:

    BUNDLE BND-101 SIGNED KEY=fw-signing-2026-current
    BUNDLE BND-101 PUBLISHED RECEIPT=pub_d844c658a8a4a865ef90972c TOKEN=token-BND-101 STATUS=PUBLISHED
    BUNDLE BND-102 SIGNED KEY=fw-signing-2026-current
    BUNDLE BND-102 PUBLISHED RECEIPT=pub_2cb4f6e5c76d5d6f2eaf20ab TOKEN=token-BND-102 STATUS=PUBLISHED
    BUNDLE BND-103 SIGNED KEY=fw-signing-2026-current
    BUNDLE BND-103 PUBLISHED RECEIPT=pub_2c343f0b7bc6965e2666a7d7 TOKEN=token-BND-103 STATUS=PUBLISHED

    7 passed in 3.62s

solution/publish.sh copies solution/release-publisher.mjs into /app/publisher/
before invoking it, so the reference implementation is installed fresh in each
container rather than relying on it already being present. All three publishable
bundles (BND-101, BND-102, BND-103) are signed with the current key and published
successfully; BND-104 (fully withdrawn in the manifest) is correctly excluded.

Per tests/test.sh, a zero pytest exit code writes reward.txt = 1.

cat /logs/verifier/reward.txt -> 1

 Verification

Both proofs were demonstrated in separate, freshly-created containers from the
same built image (firmware-publisher):

- Empty run (no reference implementation in /app/publisher/) -> 7/7 tests fail,
  pytest exit code 1 -> reward.txt = 0.
- Solution run (solution/publish.sh executed) -> 7/7 tests pass,
  pytest exit code 0 -> reward.txt = 1.

This confirms the test suite is non-trivial (it rejects an empty solution) and
that the reference implementation satisfies it fully, including idempotency,
correct reconciliation of the build manifest, and current-key signing.
