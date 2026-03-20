import { Agent, CredentialSession } from "@atproto/api";
import { createClient } from "rivetkit/client";
import type { registry } from "../actors";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { Delegation } from "iso-ucan/delegation";
import { capabilities } from "../ucan";
import { Store } from "iso-ucan/store";
import { MemoryDriver } from "iso-kv/drivers/memory.js";
import { ulid } from "ulidx";
import { streamplaceSource } from "../actors/streamplaceSource";

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
const clientId = await EdDSASigner.generate();
console.log("clientId", clientId.did);

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
    clientDid: clientId.did,
  },
});

// Get the operator auth key which will serve as the audience for our UCANs.
const operatorAuthKey = await operatorAuth.signingKey();

// Request a delegation that allows us to perform admin actions against the actors
const { delegations } = await operatorAuth.requestAdminDelegations();
await store.add(
  await Promise.all(delegations.map((x) => Delegation.fromString(x))),
);

const invocation = await capabilities.CreateActor.invoke({
  iss: clientId,
  sub: operatorAuthKey,
  args: {},
  store,
});

const sink = await rivet.streamplaceSource.create(ulid(), {
  input: {
    streamplaceStreamDid: "did:plc:ulg2bzgrgs7ddjjlmhtegk3v",
    startDate: new Date(Date.now() + 2000).toString(),
    endDate: new Date(Date.now() + 18000).toString(),
    targetQueue: {
      actorKey: ["test"],
      actorKind: "test",
      queueName: "events",
    },
    invocation: invocation.bytes,
    delegations: invocation.delegations.map((x) => x.toString()),
  },
});

console.log(await sink.signingKey());
