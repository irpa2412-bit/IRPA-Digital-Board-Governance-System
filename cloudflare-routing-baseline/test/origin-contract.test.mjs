import assert from "node:assert/strict";
import http from "node:http";
import worker from "../src/index.js";

const received = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", chunk => chunks.push(chunk));
  req.on("end", () => {
    received.push({
      url: req.url,
      authorization: req.headers.authorization,
      requestId: req.headers["x-irpa-request-id"],
      transactionId: req.headers["x-irpa-transaction-id"],
      body: Buffer.concat(chunks).toString()
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      firebase: true,
      firestore: true,
      routed: true
    }));
  });
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const env = { IRPA_FIREBASE_ORIGIN: "http://127.0.0.1:" + port };

try {
  const response = await worker.fetch(new Request("https://baseline.example/api/document/reference", {
    method: "POST",
    headers: {
      authorization: "Bearer firebase-layer2-test-token",
      "idempotency-key": "layer2-reference-1",
      "content-type": "application/json",
      "x-request-id": "layer2-request-1",
      "x-transaction-id": "layer2-transaction-1"
    },
    body: JSON.stringify({ operation: "document-reference-test" })
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    firebase: true,
    firestore: true,
    routed: true
  });

  const request = received.find(x => x.url.startsWith("/api/document/reference"));
  assert.ok(request);
  assert.equal(request.authorization, "Bearer firebase-layer2-test-token");
  assert.equal(request.requestId, "layer2-request-1");
  assert.equal(request.transactionId, "layer2-transaction-1");

  const emailResponse = await worker.fetch(new Request("https://baseline.example/api/email/transaction", {
    method: "POST",
    headers: {
      authorization: "Bearer firebase-layer2-email-token",
      "idempotency-key": "layer2-email-1",
      "content-type": "application/json"
    },
    body: JSON.stringify({ type: "notification", firestoreRecord: "test" })
  }), env);

  assert.equal(emailResponse.status, 200);
  const emailRequest = received.find(x => x.url.startsWith("/api/email/transaction"));
  assert.ok(emailRequest);
  assert.equal(emailRequest.authorization, "Bearer firebase-layer2-email-token");
  assert.ok(emailRequest.requestId);
  assert.ok(emailRequest.transactionId);

  console.log("Cloudflare second-layer origin contract tests passed.");
} finally {
  await new Promise(resolve => server.close(resolve));
}
