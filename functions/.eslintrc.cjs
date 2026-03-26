module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: 2022,
  },
  rules: {
    // Keep the Functions codebase simple/portable.
    "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  },
};
