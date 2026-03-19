import { createClient } from "rivetkit/client";
import type { registry } from "../actors";

const client = createClient<typeof registry>();

const auth = client.operatorAuth.getOrCreate(["main"]);

console.log(await auth.signingKey());
