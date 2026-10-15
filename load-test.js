import http from "k6/http";
import { check } from "k6";

export const options = {
  stages: [
    { duration: "15s", target: 50 }, // Warm-up: Ramp up to 50 VUs over 15 seconds
    { duration: "30s", target: 200 }, // Heavy Load: Ramp up to 200 VUs over 30 seconds
    { duration: "30s", target: 1200 }, // Peak Stress: Push to 500 VUs over 30 seconds
    { duration: "15s", target: 0 }, // Cooldown: Scale back down to 0
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
