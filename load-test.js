import http from "k6/http";
import { check } from "k6";

export const options = {
  stages: [
    { duration: "10s", target: 10 },
    { duration: "20s", target: 50 },
    { duration: "10s", target: 0 },
  ],
};

export default function () {
  const res = http.get("http://localhost:5000/api/v1/health"); // Update endpoint

  // Track response status
  const success = check(res, {
    "status is 200": (r) => r.status === 200,
  });

  if (!success) {
    // This will print the actual failing HTTP status code (e.g., 500, 401, 429)
    console.log(`Failed request! Status: ${res.status} | Body: ${res.body}`);
  }
}
