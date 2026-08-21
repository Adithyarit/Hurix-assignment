
import duckdb from "duckdb";
import fs from "fs";
import { execSync } from "child_process";
import http from "http";

const db = new duckdb.Database("releases.duckdb");

function getCurrentKey() {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: "127.0.0.1",
                port: 7070,
                path: "/v1/signing-key/current",
                method: "GET"
            },
            (res) => {
                let body = "";

                res.on("data", (chunk) => {
                    body += chunk;
                });

                res.on("end", () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (err) {
                        reject(err);
                    }
                });
            }
        );

        req.on("error", reject);
        req.end();
    });
}

function publishBundle(descriptor, signature, token) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            descriptor,
            signature,
            request_token: token
        });

        const options = {
            hostname: "127.0.0.1",
            port: 7070,
            path: "/v1/publications",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data)
            }
        };

        const req = http.request(options, (res) => {
            let body = "";

            res.on("data", (chunk) => {
                body += chunk;
            });

            res.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on("error", reject);

        req.write(data);
        req.end();
    });
}

db.run(
    `CREATE TABLE IF NOT EXISTS publications (
        bundle_id VARCHAR PRIMARY KEY,
        request_token VARCHAR,
        publication_id VARCHAR,
        status VARCHAR
    )`,
    (err) => {
        if (err) {
            console.error(err);
            return;
        }

        db.run(
            `CREATE OR REPLACE TABLE manifest AS
             SELECT *
             FROM read_csv_auto('fixtures/build_manifest.csv')`,
            (err) => {
                if (err) {
                    console.error(err);
                    return;
                }

                db.all(
                    `
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
                    ORDER BY bundle_id;
                    `,
                    async (err, rows) => {
                        if (err) {
                            console.error(err);
                            return;
                        }

                        for (const row of rows) {
                            const descriptor = {
                                artifact_count: Number(row.artifact_count),
                                bundle_id: row.bundle_id,
                                total_bytes: Number(row.total_bytes)
                            };

                            const descriptorString =
                                JSON.stringify(descriptor);

                            const token = `token-${row.bundle_id}`;

                            const existing = await new Promise(
                                (resolve, reject) => {
                                    db.all(
                                        `SELECT publication_id, status
                                         FROM publications
                                         WHERE bundle_id = ?`,
                                        [row.bundle_id],
                                        (err, rows) => {
                                            if (err) {
                                                reject(err);
                                            } else {
                                                resolve(rows);
                                            }
                                        }
                                    );
                                }
                            );

                            // Already published locally.
                            // Do not create another publication.
                            if (existing.length > 0) {
                                const receipt = existing[0];

                                console.log(
                                    `BUNDLE ${row.bundle_id} PUBLISHED ` +
                                    `RECEIPT=${receipt.publication_id} ` +
                                    `TOKEN=${token} ` +
                                    `STATUS=${receipt.status}`
                                );

                                continue;
                            }

                            // Get the current signing-key metadata
                            // immediately before signing.
                            const key = await getCurrentKey();

                            fs.writeFileSync(
                                "descriptor.json",
                                descriptorString
                            );

                            try {
                                execSync(
                                    `openssl cms -sign ` +
                                    `-in descriptor.json ` +
                                    `-signer /app/keys/current/current.cert.pem ` +
                                    `-inkey /app/keys/current/current.key.pem ` +
                                    `-out signature.pem ` +
                                    `-outform PEM ` +
                                    `-binary`
                                );
                            } catch (err) {
                                console.error(
                                    "OpenSSL signing failed:",
                                    err.message
                                );
                                return;
                            }

                            const signature = fs.readFileSync(
                                "signature.pem",
                                "utf8"
                            );

                            console.log(
                                `BUNDLE ${row.bundle_id} ` +
                                `SIGNED KEY=${key.key_id}`
                            );

                            const receipt = await publishBundle(
                                descriptorString,
                                signature,
                                token
                            );

                            if (receipt.status === "PUBLISHED") {
                                await new Promise((resolve, reject) => {
                                    db.run(
                                     `INSERT INTO publications
                                      (
                                          bundle_id,
                                         request_token,
                                          publication_id,
                                          status
                                     )
                                     VALUES (?, ?, ?, ?)`,
                                        row.bundle_id,
                                        token,
                                        receipt.publication_id,
                                        receipt.status,
                                            (err) => {
        if (err) {
            reject(err);
        } else {
            resolve();
        }
    }
);
                                });

                                console.log(
                                    `BUNDLE ${row.bundle_id} PUBLISHED ` +
                                    `RECEIPT=${receipt.publication_id} ` +
                                    `TOKEN=${token} ` +
                                    `STATUS=${receipt.status}`
                                );
                            } else {
                                console.error(
                                    "Publication failed:",
                                    receipt
                                );
                            }
                        }
                    }
                );
            }
        );
    }
);

