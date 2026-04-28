import { defineConfig } from "vite";
import typegpu from "unplugin-typegpu/vite";

export default defineConfig({
  publicDir: "public",
  plugins: [typegpu()],
  build: {
    assetsInlineLimit: 0,
  },
});
