import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /**
       * Datei-Uploads laufen durch eine Server Action, deren Body per
       * Default auf 1 MB gedeckelt ist. Wir erlauben 4 MiB grosse Dateien
       * (SOURCE_FILE_MAX_BYTES) und lassen Luft fuer den Multipart-Overhead.
       * Nach oben begrenzt Vercel den Request-Body von Functions auf 4,5 MB.
       */
      bodySizeLimit: "4.4mb",
    },
  },
};

export default nextConfig;
