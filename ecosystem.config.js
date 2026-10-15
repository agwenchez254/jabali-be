module.exports = {
  apps: [
    {
      name: "jabali-be",
      script: "./dist/main.js",
      instances: "max", // Scales automatically across all available CPU cores
      exec_mode: "cluster", // Enables Node.js cluster mode
      env: {
        NODE_ENV: "production",
        DISABLE_RATE_LIMIT: "true", // Keeps rate limiting disabled for local k6 tests
      },
      max_memory_restart: "500M",
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      merge_logs: true,
    },
  ],
};
