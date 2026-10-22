import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { resolveGatewayUrl } from "./src/firebase/gatewayEnvironment.js";

export default defineConfig(({mode}) => {
  resolveGatewayUrl(loadEnv(mode, process.cwd(), ""));
  return {
    plugins:[react()],
    resolve:{alias:{"firebase/storage":resolve(process.cwd(),"src/firebase/signatureStorage.js")}},
    css:{devSourcemap:true},
    build:{outDir:"dist-responsive",emptyOutDir:true,sourcemap:true,rollupOptions:{input:{app:resolve(process.cwd(),"index.html"),responsiveFixture:resolve(process.cwd(),"tests/fixtures/portal-layout-fixture.html")}}},
    server:{host:"127.0.0.1",port:4180,strictPort:true},
    preview:{host:"127.0.0.1",port:4180,strictPort:true}
  };
});
