import { Agent, CredentialSession } from "@atproto/api";
import { createClient } from "rivetkit/client";
import type { registry } from "../actors";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { Delegation } from "iso-ucan/delegation";
import { capabilities } from "../ucan";
import { Store } from "iso-ucan/store";
import { MemoryDriver } from "iso-kv/drivers/memory.js";
import { sleep } from "rivetkit/utils";

const store = new Store(new MemoryDriver());

// Create an ATProto auth session
const session = new CredentialSession(new URL("https://bsky.social"));

// Login to ATProto
await session.login({
  identifier: process.env.ATPROTO_USERNAME!,
  password: process.env.ATPROTO_APP_PASSWORD!,
});

// Create ATProto client ( agent )
const agent = new Agent(session);
const did = agent.assertDid;

// Fetch a service auth token from our PDS
const authResp = await agent.com.atproto.server.getServiceAuth({
  aud: "did:web::localhost",
});
const serviceAuthToken = authResp.data.token;

// Generate a local signing key for this client
const clientSigner = await EdDSASigner.generate();

// Connect to rivet
const rivet = createClient<typeof registry>();

// Connect to the operator auth actor
const operatorAuth = rivet.operatorAuth.getOrCreate("main", {
  // Create the actor if it does not exist, setting our ATProto account as an admin
  createWithInput: {
    adminDids: [did],
  },
  // Connect with the service auth token to prove out ATProto identity, and provide our client
  // signer DID that will be used to obtain auth tokens for use in the cluster
  params: {
    serviceAuthToken,
    clientDid: clientSigner.did,
  },
});

// Get the operator auth key which will serve as the audience for our UCANs.
const operatorAuthKey = await operatorAuth.signingKey();

// Request a delegation that allows us to echo
const { delegation: rawDelegation } =
  await operatorAuth.requestEchoDelegation();

const delegation = await Delegation.fromString(rawDelegation);
await store.add([delegation]);

const invocation = await capabilities.Echo.invoke({
  iss: clientSigner,
  args: { content: "hello john" },
  sub: operatorAuthKey as any,
  store,
});

const resp = await operatorAuth.echo(invocation.bytes);
console.log(resp);
