import { Capability } from "iso-ucan/capability";
import { Store } from "iso-ucan/store";
import { MemoryDriver } from "iso-kv/drivers/memory.js";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { Resolver } from "iso-signatures/verifiers/resolver.js";
import * as EdDSA from "iso-signatures/verifiers/eddsa.js";
import { type } from "arktype";
import { Invocation } from "iso-ucan/invocation";

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
const alice = await EdDSASigner.generate(); // Resource owner
const bob = await EdDSASigner.generate(); // Requesting access

const nowInSeconds = Math.floor(Date.now() / 1000);

// Alice grants Bob permission to read files
// This delegation can be stored, transmitted, or embedded in applications
const delegation = await FileReadCap.delegate({
  iss: alice, // Alice issues this capability
  aud: bob.did, // Bob is authorized to use it
  sub: alice.did, // Alice's resources are the subject
  pol: [], // No additional policy constraints
  exp: nowInSeconds + 3600, // Expires in 1 hour for security
  store,
});

// Store delegation to enable later invocation validation
// The store enables automatic delegation chain resolution
await store.add([delegation]);

// Bob exercises the delegated capability to read a specific file
// This creates a cryptographically verifiable access request
const invocation = await FileReadCap.invoke({
  iss: bob, // Bob is invoking the capability
  sub: alice.did, // Alice's system will process the request
  args: {
    path: "/documents/report.pdf", // Specific file Bob wants to read
  },
  store, // Store containing the delegation proof
  exp: nowInSeconds + 300, // Invocation expires in 5 minutes
});

const validated = await Invocation.from({
  bytes: invocation.bytes,
  audience: bob.verifiableDid,
  resolveProof: store.resolveProof.bind(store),
  verifierResolver,
});

console.log(validated);
