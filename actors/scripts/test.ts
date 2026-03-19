import { createClient } from "rivetkit/client";
import type { registry } from "../actors";

const client = createClient<typeof registry>();

const auth = client.operatorAuth.getOrCreate("main", {
  createWithInput: { adminDids: ["did:plc:ulg2bzgrgs7ddjjlmhtegk3v"] },
});

console.log(await auth.signingKey());
