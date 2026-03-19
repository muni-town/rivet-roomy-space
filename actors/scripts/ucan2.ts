import { Capability } from "iso-ucan/capability";
import { Store } from "iso-ucan/store";
import { MemoryDriver } from "iso-kv/drivers/memory.js";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { Resolver } from "iso-signatures/verifiers/resolver.js";
import * as EdDSA from "iso-signatures/verifiers/eddsa.js";
import { type } from "arktype";
import { Invocation } from "iso-ucan/invocation";
import { Delegation } from "iso-ucan/delegation";

// Initialize delegation store for tracking capability chains
// In production, this might be backed by a database or persistent storage
const store = new Store(new MemoryDriver());

const verifierResolver = new Resolver({
	...EdDSA.verifier,
});

// Define file read capability with path validation schema
// The schema ensures all invocations include a valid file path
const FileReadCap = Capability.from({
	cmd: "/file/read",
	schema: type({
		path: "string",
	}),
	verifierResolver,
});

// Create cryptographic identities for resource owner and accessor
// In a real system, these would be persistent identity keypairs
const alice = await EdDSASigner.import(
	"gCaPiHTXZAMK4Y9QUN7OzFUeMiK/NDRWFWCjZxdlXsOYGQ==",
);
console.log("alice:", alice.did);
const bob = await EdDSASigner.import(
	"gCYQiu/X3XbExwbtyW7VuTd/G39f/SR6LxMqsb4+OqAUwA==",
);
console.log("bob:", bob.did);
const charlie = await EdDSASigner.import(
	"gCYi3EdI5uiqOxAVZbK3eU8WmtRHpT1BdJip/LnCxMZyuQ==",
);
console.log("charlie:", charlie.did);

const d = await Delegation.create({
	iss: charlie,
	aud: alice.did,
	sub: charlie.did,
	cmd: "/",
	pol: [],
});
store.add([d]);

const nowInSeconds = Math.floor(Date.now() / 1000);

// Alice grants Bob permission to read files
// This delegation can be stored, transmitted, or embedded in applications
const delegation = await Delegation.create({
	iss: alice, // Alice issues this capability
	aud: bob.did, // Bob is authorized to use it
	sub: null, // Alice's resources are the subject
	pol: [], // No additional policy constraints
	exp: nowInSeconds + 3600, // Expires in 1 hour for security
	cmd: "/file/read",
});

// Store delegation to enable later invocation validation
// The store enables automatic delegation chain resolution
await store.add([delegation]);

// Bob exercises the delegated capability to read a specific file
// This creates a cryptographically verifiable access request
const invocation = await FileReadCap.invoke({
	iss: bob, // Bob is invoking the capability
	sub: charlie.did, // Alice's resources are the subject of the request
	aud: alice.did,
	args: {
		path: "/documents/report.pdf", // Specific file Bob wants to read
	},
	store, // Store containing the delegation proof
	exp: nowInSeconds + 300, // Invocation expires in 5 minutes
});

await Invocation.from({
	bytes: invocation.bytes,
	audience: alice.verifiableDid,
	resolveProof: store.resolveProof.bind(store),
	verifierResolver,
});
