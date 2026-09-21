import { getFunctions, httpsCallable } from "firebase/functions";
import app from "./config";

export const functions = getFunctions(app, "us-central1");
\nexport async function createAdministrator(data){ const call=httpsCallable(functions,"createAdministrator"); const result=await call(data); return result.data; }\n