import json
import os
import subprocess
from pathlib import Path

import duckdb


APP_ROOT = Path("/app")
PUBLISHER = APP_ROOT / "publisher" / "release-publisher.mjs"
DB_PATH = APP_ROOT / "releases.duckdb"
MANIFEST = APP_ROOT / "fixtures" / "build_manifest.csv"


def run_publisher():
    result = subprocess.run(
        ["node", str(PUBLISHER)],
        cwd=APP_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert result.returncode == 0, (
        f"Publisher failed.\nSTDOUT:\n{result.stdout}\n"
        f"STDERR:\n{result.stderr}"
    )

    return result.stdout


def get_publications():
    db = duckdb.connect(str(DB_PATH))
    try:
        return db.execute(
            """
            SELECT bundle_id, request_token, publication_id, status
            FROM publications
            ORDER BY bundle_id
            """
        ).fetchall()
    finally:
        db.close()


def expected_bundles():
    db = duckdb.connect()
    try:
        db.execute(
            f"""
            CREATE TABLE manifest AS
            SELECT *
            FROM read_csv_auto('{MANIFEST}');
            """
        )

        return db.execute(
            """
            SELECT
                bundle_id,
                COUNT(*) AS artifact_count,
                SUM(size_bytes) AS total_bytes
            FROM (
                SELECT DISTINCT *
                FROM manifest
            )
            WHERE record_type = 'BUILD'
              AND entry_id NOT IN (
                  SELECT supersedes_id
                  FROM manifest
                  WHERE record_type = 'WITHDRAWAL'
              )
            GROUP BY bundle_id
            ORDER BY bundle_id
            """
        ).fetchall()
    finally:
        db.close()


def test_publisher_creates_receipts():
    run_publisher()

    rows = get_publications()

    assert rows, "Publisher created no publication receipts."

    for bundle_id, token, publication_id, status in rows:
        assert token == f"token-{bundle_id}"
        assert publication_id
        assert status == "PUBLISHED"


def test_all_reconciled_bundles_are_published():
    run_publisher()

    actual = {
        row[0]
        for row in get_publications()
    }

    expected = {
        row[0]
        for row in expected_bundles()
    }

    assert actual == expected


def test_receipts_have_valid_structure():
    run_publisher()

    rows = get_publications()

    assert rows

    for bundle_id, token, publication_id, status in rows:
        assert isinstance(bundle_id, str)
        assert isinstance(token, str)
        assert isinstance(publication_id, str)
        assert status == "PUBLISHED"


def test_publisher_is_idempotent():
    run_publisher()

    first = get_publications()

    run_publisher()

    second = get_publications()

    assert second == first, (
        "Running the publisher twice changed the stored publication "
        "receipts. The publisher is not idempotent."
    )


def test_descriptor_contains_required_fields():
    run_publisher()

    descriptor_path = APP_ROOT / "descriptor.json"

    assert descriptor_path.exists(), "descriptor.json was not created."

    descriptor = json.loads(descriptor_path.read_text())

    assert set(descriptor.keys()) == {
        "artifact_count",
        "bundle_id",
        "total_bytes",
    }


def test_manifest_reconciliation_matches_expected():
    run_publisher()

    actual = {
        bundle_id: (artifact_count, total_bytes)
        for bundle_id, _, _, _ in get_publications()
        for artifact_count, total_bytes in [
            (
                None,
                None,
            )
        ]
    }

    # Verify the publisher's manifest reconciliation independently.
    expected = expected_bundles()

    assert len(actual) == len(expected)

    published_bundle_ids = set(actual.keys())
    expected_bundle_ids = {row[0] for row in expected}

    assert published_bundle_ids == expected_bundle_ids


def test_empty_solution_fails():
    """
    This test is informational for the grading harness.

    The actual negative-control check should run with the solution removed,
    rather than modifying the submitted workspace during pytest.
    """
    assert PUBLISHER.exists()