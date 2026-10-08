import type { NextConfig } from "next";

// Legacy filesystem endpoints read runtime archives, not source files. Next's
// conservative dynamic-path tracing otherwise bundles the whole frontend.
// Compiled chunks and node_modules stay included; user archives/secrets do not.
const legacyArchiveExcludes = [
  "src/**/*", "public/**/*", "scripts/**/*", "*.md", "*.config.*",
  "components.json", "tsconfig*", "package-lock.json", ".env*", "output/**/*",
];

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/api/imports": legacyArchiveExcludes,
    "/api/reconciliation-reviews": legacyArchiveExcludes,
    "/api/trace-documents": legacyArchiveExcludes,
    "/api/mapping-reviews": legacyArchiveExcludes,
  },
};

export default nextConfig;
